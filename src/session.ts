import { transformPoseToRoom } from "./calibration.js";
import {
  PROTOCOL_VERSION,
  parseMessage,
  serializeMessage,
  type ClockProbeMessage,
  type ClockReplyMessage,
  type HelloMessage,
  type PoseMessage,
  type SpatialWireMessage,
} from "./protocol.js";
import type {
  DiscoveredPeer,
  Pose,
  PoseEstimate,
  RoomCalibration,
  SessionClockEstimate,
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
  streamId?: string;
  now?: () => number;
  idFactory?: (prefix: "device" | "room" | "stream" | "clock") => string;
  clockSyncTimeoutMs?: number;
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
  readonly streamId: string;

  private readonly transport: SpatialTransport;
  private readonly now: () => number;
  private readonly idFactory: NonNullable<SpatialSessionConfig["idFactory"]>;
  private readonly clockSyncTimeoutMs: number;
  private roomId: string | undefined;
  private calibration: RoomCalibration | undefined;
  private status: SpatialSessionSnapshot["status"] = "idle";
  private error: string | undefined;
  private latestLocalPose: PoseEstimate | undefined;
  private sessionClock: SessionClockEstimate | undefined;
  private hostPeerId: string | undefined;
  private readonly pendingClockProbes = new Map<
    string,
    {
      clientSendMs: number;
      resolve: (estimate: SessionClockEstimate) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly discoveredPeers = new Map<string, DiscoveredPeer>();
  private readonly transportPeers = new Map<string, TransportPeer>();
  private readonly transportPeerToDeviceId = new Map<string, string>();
  private readonly peers = new Map<string, SpatialPeer>();
  private readonly listeners = new Set<(snapshot: SpatialSessionSnapshot) => void>();
  private readonly transportUnsubscribers: Unsubscribe[] = [];
  private lifecycleGeneration = 0;
  private nextPoseSequence = 1;

  constructor(config: SpatialSessionConfig) {
    this.now = config.now ?? Date.now;
    this.idFactory = config.idFactory ?? ((prefix) => createId(prefix, this.now));
    this.clockSyncTimeoutMs = config.clockSyncTimeoutMs ?? 5_000;
    this.deviceId = config.deviceId ?? this.idFactory("device");
    this.deviceName = config.deviceName;
    this.transport = config.transport;
    this.role = config.transport.role;
    this.streamId = config.streamId ?? this.idFactory("stream");
    this.roomId = config.roomId ?? (this.role === "host" ? this.idFactory("room") : undefined);
  }

  async start(): Promise<void> {
    if (this.status === "running" || this.status === "starting") {
      return;
    }

    const generation = ++this.lifecycleGeneration;
    this.status = "starting";
    this.error = undefined;
    this.emit();
    this.attachTransportListeners();

    try {
      await this.transport.start(this.deviceName);
      if (generation !== this.lifecycleGeneration) {
        await this.transport.stop();
        return;
      }
      this.status = "running";
      this.emit();
    } catch (error) {
      if (generation !== this.lifecycleGeneration) {
        return;
      }
      this.status = "error";
      this.error = error instanceof Error ? error.message : String(error);
      this.emit();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.lifecycleGeneration += 1;
    while (this.transportUnsubscribers.length > 0) {
      this.transportUnsubscribers.pop()?.();
    }

    await this.transport.stop();
    this.status = "stopped";
    this.discoveredPeers.clear();
    this.transportPeers.clear();
    this.transportPeerToDeviceId.clear();
    this.peers.clear();
    this.rejectPendingClockProbes(new Error("Spatial session stopped."));
    this.hostPeerId = undefined;
    this.sessionClock = undefined;
    this.latestLocalPose = undefined;
    this.emit();
  }

  async connect(peerId: string): Promise<void> {
    await this.transport.connect(peerId);
  }

  async synchronizeClock(): Promise<SessionClockEstimate | undefined> {
    if (this.role !== "client" || !this.hostPeerId) {
      return undefined;
    }

    const hostPeerId = this.hostPeerId;
    const probeId = this.idFactory("clock");
    const clientSendMs = this.now();
    const estimatePromise = new Promise<SessionClockEstimate>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingClockProbes.delete(probeId);
        reject(new Error(`Clock synchronization timed out after ${this.clockSyncTimeoutMs} ms.`));
      }, this.clockSyncTimeoutMs);
      this.pendingClockProbes.set(probeId, { clientSendMs, resolve, reject, timeout });
    });

    const message: ClockProbeMessage = {
      version: PROTOCOL_VERSION,
      type: "clock-probe",
      probeId,
      clientSendMs,
    };

    try {
      await this.transport.send(hostPeerId, serializeMessage(message));
    } catch (error) {
      const pending = this.pendingClockProbes.get(probeId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingClockProbes.delete(probeId);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    return estimatePromise;
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

    const now = this.now();
    const estimate: PoseEstimate = {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      roomId: this.roomId,
      streamId: this.streamId,
      sequence: this.nextPoseSequence,
      frameId: "room",
      pose: transformPoseToRoom(input.pose, this.calibration),
      trackingState: input.trackingState,
      sessionTimeMs: input.sessionTimeMs ?? now + (this.sessionClock?.offsetMs ?? 0),
      ...(input.sourceTimestampMs === undefined
        ? {}
        : { sourceTimestampMs: input.sourceTimestampMs }),
      receivedAtMs: now,
    };

    this.nextPoseSequence += 1;
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
      ...(this.sessionClock === undefined ? {} : { sessionClock: this.sessionClock }),
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
        void this.sendHello(peer.peerId).catch((error: unknown) => {
          this.transportPeers.delete(peer.peerId);
          this.error = `Handshake with ${peer.name} failed: ${error instanceof Error ? error.message : String(error)}`;
          this.emit();
        });
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
      streamId: this.streamId,
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

    if (message.type === "clock-probe") {
      this.handleClockProbe(peerId, message);
      return;
    }

    if (message.type === "clock-reply") {
      this.handleClockReply(peerId, message);
      return;
    }

    if (message.type === "pose") {
      this.handlePose(peerId, message);
    }
  }

  private handleHello(peerId: string, message: HelloMessage): void {
    if (this.role === "client" && message.role === "host" && message.roomId) {
      if (this.roomId !== undefined && this.roomId !== message.roomId) {
        this.calibration = undefined;
        this.latestLocalPose = undefined;
      }
      this.roomId = message.roomId;
      if (this.hostPeerId !== undefined && this.hostPeerId !== peerId) {
        this.rejectPendingClockProbes(new Error("Clock host changed."));
        this.sessionClock = undefined;
      }
      this.hostPeerId = peerId;
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
          streamId: existing.streamId,
          role: "client",
          ...(this.roomId === undefined ? {} : { roomId: this.roomId }),
        };
        void this.transport.send(peerId, serializeMessage(existingHello));
      }
    }

    const existingPeer = this.peers.get(message.deviceId);
    this.peers.set(message.deviceId, {
      deviceId: message.deviceId,
      deviceName: message.deviceName,
      streamId: message.streamId,
      connected: true,
      ...(existingPeer?.streamId === message.streamId && existingPeer.latestPose !== undefined
        ? { latestPose: existingPeer.latestPose }
        : {}),
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

    const existing = this.peers.get(message.estimate.deviceId);
    if (!existing || existing.streamId !== message.estimate.streamId) {
      return;
    }

    if (
      this.role === "host" &&
      this.transportPeerToDeviceId.get(peerId) !== message.estimate.deviceId
    ) {
      return;
    }

    if (
      existing.latestPose?.streamId === message.estimate.streamId &&
      existing.latestPose.sequence >= message.estimate.sequence
    ) {
      return;
    }

    const estimate: PoseEstimate = {
      ...message.estimate,
      receivedAtMs: this.now(),
    };

    this.peers.set(estimate.deviceId, {
      ...existing,
      deviceName: estimate.deviceName,
      latestPose: estimate,
    });

    if (this.role === "host") {
      void this.broadcast(serializeMessage(message), peerId);
    }

    this.emit();
  }

  private handleClockProbe(peerId: string, message: ClockProbeMessage): void {
    if (this.role !== "host" || !this.transportPeerToDeviceId.has(peerId)) {
      return;
    }

    const hostReceiveMs = this.now();
    const reply: ClockReplyMessage = {
      version: PROTOCOL_VERSION,
      type: "clock-reply",
      probeId: message.probeId,
      clientSendMs: message.clientSendMs,
      hostReceiveMs,
      hostSendMs: this.now(),
    };
    void this.transport.send(peerId, serializeMessage(reply)).catch((error: unknown) => {
      if (this.transportPeers.has(peerId)) {
        this.error = `Clock reply to ${peerId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`;
        this.emit();
      }
    });
  }

  private handleClockReply(peerId: string, message: ClockReplyMessage): void {
    if (this.role !== "client" || peerId !== this.hostPeerId) {
      return;
    }

    const pending = this.pendingClockProbes.get(message.probeId);
    if (pending === undefined || pending.clientSendMs !== message.clientSendMs) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingClockProbes.delete(message.probeId);

    const clientReceiveMs = this.now();
    const roundTripTimeMs = Math.max(
      0,
      clientReceiveMs -
        message.clientSendMs -
        Math.max(0, message.hostSendMs - message.hostReceiveMs),
    );
    const offsetMs =
      (message.hostReceiveMs - message.clientSendMs + (message.hostSendMs - clientReceiveMs)) / 2;

    const estimate: SessionClockEstimate = {
      offsetMs,
      roundTripTimeMs,
      uncertaintyMs: roundTripTimeMs / 2,
      measuredAtMs: clientReceiveMs,
    };
    this.sessionClock = estimate;
    pending.resolve(estimate);
    this.emit();
  }

  private handleDisconnectedPeer(peerId: string): void {
    this.discoveredPeers.delete(peerId);
    this.transportPeers.delete(peerId);
    const deviceId = this.transportPeerToDeviceId.get(peerId);
    this.transportPeerToDeviceId.delete(peerId);

    if (this.role === "client") {
      if (peerId === this.hostPeerId) {
        this.hostPeerId = undefined;
        this.rejectPendingClockProbes(new Error("Clock host disconnected."));
        this.sessionClock = undefined;
      }
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

  private rejectPendingClockProbes(error: Error): void {
    for (const pending of this.pendingClockProbes.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingClockProbes.clear();
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

function createId(prefix: string, now: () => number): string {
  return `${prefix}-${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function omitReceivedAt(estimate: PoseEstimate): Omit<PoseEstimate, "receivedAtMs"> {
  const { receivedAtMs: _receivedAtMs, ...wireEstimate } = estimate;
  return wireEstimate;
}
