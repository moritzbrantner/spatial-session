import { transformPoseToRoom } from "./calibration.js";
import {
  PROTOCOL_VERSION,
  parseMessage,
  serializeMessage,
  type HelloMessage,
  type PoseMessage,
  type SpatialWireMessage,
} from "./protocol.js";
import type {
  DiscoveredPeer,
  Pose,
  PoseEstimate,
  RoomCalibration,
  SpatialPeer,
  SpatialSessionSnapshot,
  SpatialTransport,
  TrackingState,
  TransportPeer,
  Unsubscribe,
} from "./types.js";

export type SpatialSessionConfig = {
  deviceName: string;
  transport: SpatialTransport;
  deviceId?: string;
  roomId?: string;
};

export type PublishPoseInput = {
  pose: Pose;
  trackingState: TrackingState;
  sourceTimestampMs?: number;
  sessionTimeMs?: number;
};

export class SpatialSession {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly role: SpatialTransport["role"];

  private readonly transport: SpatialTransport;
  private roomId: string | undefined;
  private calibration: RoomCalibration | undefined;
  private status: SpatialSessionSnapshot["status"] = "idle";
  private error: string | undefined;
  private latestLocalPose: PoseEstimate | undefined;
  private readonly discoveredPeers = new Map<string, DiscoveredPeer>();
  private readonly transportPeers = new Map<string, TransportPeer>();
  private readonly transportPeerToDeviceId = new Map<string, string>();
  private readonly peers = new Map<string, SpatialPeer>();
  private readonly listeners = new Set<(snapshot: SpatialSessionSnapshot) => void>();
  private readonly transportUnsubscribers: Unsubscribe[] = [];

  constructor(config: SpatialSessionConfig) {
    this.deviceId = config.deviceId ?? createId("device");
    this.deviceName = config.deviceName;
    this.transport = config.transport;
    this.role = config.transport.role;
    this.roomId = config.roomId ?? (this.role === "host" ? createId("room") : undefined);
  }

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "starting") {
      return;
    }

    this.status = "starting";
    this.error = undefined;
    this.emit();
    this.attachTransportListeners();

    try {
      await this.transport.start(this.deviceName);
      this.status = "running";
      this.emit();
    } catch (error) {
      this.status = "error";
      this.error = error instanceof Error ? error.message : String(error);
      this.emit();
      throw error;
    }
  }

  async stop(): Promise<void> {
    while (this.transportUnsubscribers.length > 0) {
      this.transportUnsubscribers.pop()?.();
    }

    await this.transport.stop();
    this.status = "stopped";
    this.discoveredPeers.clear();
    this.transportPeers.clear();
    this.transportPeerToDeviceId.clear();
    this.peers.clear();
    this.latestLocalPose = undefined;
    this.emit();
  }

  async connect(peerId: string): Promise<void> {
    await this.transport.connect(peerId);
  }

  setCalibration(calibration: RoomCalibration): void {
    this.calibration = calibration;
    this.emit();
  }

  clearCalibration(): void {
    this.calibration = undefined;
    this.latestLocalPose = undefined;
    this.emit();
  }

  getCalibration(): RoomCalibration | undefined {
    return this.calibration;
  }

  publishLocalPose(input: PublishPoseInput): PoseEstimate | undefined {
    if (!this.calibration || !this.roomId) {
      return undefined;
    }

    const now = Date.now();
    const estimate: PoseEstimate = {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      roomId: this.roomId,
      frameId: "room",
      pose: transformPoseToRoom(input.pose, this.calibration),
      trackingState: input.trackingState,
      sessionTimeMs: input.sessionTimeMs ?? now,
      ...(input.sourceTimestampMs === undefined
        ? {}
        : { sourceTimestampMs: input.sourceTimestampMs }),
      receivedAtMs: now,
    };

    this.latestLocalPose = estimate;
    this.emit();

    const message: PoseMessage = {
      version: PROTOCOL_VERSION,
      type: "pose",
      estimate: omitReceivedAt(estimate),
    };
    void this.broadcast(serializeMessage(message));

    return estimate;
  }

  snapshot(): SpatialSessionSnapshot {
    return {
      status: this.status,
      role: this.role,
      ...(this.roomId === undefined ? {} : { roomId: this.roomId }),
      localDeviceId: this.deviceId,
      localDeviceName: this.deviceName,
      calibrated: this.calibration !== undefined,
      discoveredPeers: [...this.discoveredPeers.values()],
      peers: [...this.peers.values()],
      ...(this.latestLocalPose === undefined ? {} : { latestLocalPose: this.latestLocalPose }),
      ...(this.error === undefined ? {} : { error: this.error }),
    };
  }

  subscribe(listener: (snapshot: SpatialSessionSnapshot) => void): Unsubscribe {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  private attachTransportListeners(): void {
    if (this.transportUnsubscribers.length > 0) {
      return;
    }

    this.transportUnsubscribers.push(
      this.transport.onPeerFound((peer) => {
        this.discoveredPeers.set(peer.peerId, { ...peer });
        this.emit();
      }),
      this.transport.onPeerLost((peerId) => {
        this.discoveredPeers.delete(peerId);
        this.emit();
      }),
      this.transport.onPeerConnected((peer) => {
        this.transportPeers.set(peer.peerId, peer);
        this.discoveredPeers.delete(peer.peerId);
        void this.sendHello(peer.peerId);
        this.emit();
      }),
      this.transport.onPeerDisconnected((peerId) => {
        this.handleDisconnectedPeer(peerId);
      }),
      this.transport.onMessage((peerId, raw) => {
        this.handleMessage(peerId, raw);
      }),
    );
  }

  private async sendHello(peerId: string): Promise<void> {
    const message: HelloMessage = {
      version: PROTOCOL_VERSION,
      type: "hello",
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      role: this.role,
      ...(this.roomId === undefined ? {} : { roomId: this.roomId }),
    };
    await this.transport.send(peerId, serializeMessage(message));
  }

  private handleMessage(peerId: string, raw: string): void {
    const message = parseMessage(raw);
    if (!message) {
      return;
    }

    if (message.type === "hello") {
      this.handleHello(peerId, message);
      return;
    }

    if (message.type === "peer-left") {
      this.peers.delete(message.deviceId);
      this.emit();
      return;
    }

    if (message.type === "pose") {
      this.handlePose(peerId, message);
    }
  }

  private handleHello(peerId: string, message: HelloMessage): void {
    if (this.role === "client" && message.role === "host" && message.roomId) {
      this.roomId = message.roomId;
      this.transportPeerToDeviceId.set(peerId, message.deviceId);
    }

    if (this.role === "host") {
      this.transportPeerToDeviceId.set(peerId, message.deviceId);

      for (const existing of this.peers.values()) {
        if (existing.deviceId === message.deviceId) {
          continue;
        }
        const existingHello: HelloMessage = {
          version: PROTOCOL_VERSION,
          type: "hello",
          deviceId: existing.deviceId,
          deviceName: existing.deviceName,
          role: "client",
          ...(this.roomId === undefined ? {} : { roomId: this.roomId }),
        };
        void this.transport.send(peerId, serializeMessage(existingHello));
      }
    }

    this.peers.set(message.deviceId, {
      ...this.peers.get(message.deviceId),
      deviceId: message.deviceId,
      deviceName: message.deviceName,
      connected: true,
    });

    if (this.role === "host") {
      const normalizedHello: HelloMessage = {
        ...message,
        ...(this.roomId === undefined ? {} : { roomId: this.roomId }),
      };
      void this.broadcast(serializeMessage(normalizedHello), peerId);
    }

    this.emit();
  }

  private handlePose(peerId: string, message: PoseMessage): void {
    if (!this.roomId || message.estimate.roomId !== this.roomId) {
      return;
    }

    const estimate: PoseEstimate = {
      ...message.estimate,
      receivedAtMs: Date.now(),
    };

    const existing = this.peers.get(estimate.deviceId);
    this.peers.set(estimate.deviceId, {
      deviceId: estimate.deviceId,
      deviceName: estimate.deviceName,
      connected: existing?.connected ?? true,
      latestPose: estimate,
    });

    if (this.role === "host") {
      void this.broadcast(serializeMessage(message), peerId);
    }

    this.emit();
  }

  private handleDisconnectedPeer(peerId: string): void {
    this.discoveredPeers.delete(peerId);
    this.transportPeers.delete(peerId);
    const deviceId = this.transportPeerToDeviceId.get(peerId);
    this.transportPeerToDeviceId.delete(peerId);

    if (this.role === "client") {
      this.peers.clear();
    } else if (deviceId) {
      this.peers.delete(deviceId);
      const message: SpatialWireMessage = {
        version: PROTOCOL_VERSION,
        type: "peer-left",
        deviceId,
      };
      void this.broadcast(serializeMessage(message));
    }

    this.emit();
  }

  private async broadcast(raw: string, excludedPeerId?: string): Promise<void> {
    const sends: Promise<void>[] = [];
    for (const peerId of this.transportPeers.keys()) {
      if (peerId !== excludedPeerId) {
        sends.push(this.transport.send(peerId, raw));
      }
    }
    await Promise.allSettled(sends);
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function omitReceivedAt(estimate: PoseEstimate): Omit<PoseEstimate, "receivedAtMs"> {
  const { receivedAtMs: _receivedAtMs, ...wireEstimate } = estimate;
  return wireEstimate;
}
