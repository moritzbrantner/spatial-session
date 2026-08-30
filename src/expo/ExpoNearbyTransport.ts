import {
  Strategy,
  acceptConnection,
  disconnect,
  onConnected,
  onDisconnected,
  onInvitationReceived,
  onPeerFound,
  onPeerLost,
  onTextReceived,
  requestConnection,
  sendText,
  startAdvertise,
  startDiscovery,
  stopAdvertise,
  stopDiscovery,
  type BasePeer,
} from "expo-nearby-connections";
import type { SpatialSessionRole, SpatialTransport, TransportPeer, Unsubscribe } from "../types.js";

type ExpoNearbyTransportOptions = {
  role: SpatialSessionRole;
  strategy?: Strategy;
  autoAcceptInvitations?: boolean;
};

type PeerListener = (peer: TransportPeer) => void;
type PeerIdListener = (peerId: string) => void;
type MessageListener = (peerId: string, message: string) => void;

export class ExpoNearbyTransport implements SpatialTransport {
  readonly role: SpatialSessionRole;

  private readonly strategy: Strategy;
  private readonly autoAcceptInvitations: boolean;
  private readonly peerFoundListeners = new Set<PeerListener>();
  private readonly peerLostListeners = new Set<PeerIdListener>();
  private readonly peerConnectedListeners = new Set<PeerListener>();
  private readonly peerDisconnectedListeners = new Set<PeerIdListener>();
  private readonly messageListeners = new Set<MessageListener>();
  private nativeUnsubscribers: Unsubscribe[] = [];
  private started = false;

  constructor(options: ExpoNearbyTransportOptions) {
    this.role = options.role;
    this.strategy = options.strategy ?? Strategy.P2P_STAR;
    this.autoAcceptInvitations = options.autoAcceptInvitations ?? true;
  }

  async start(deviceName: string): Promise<void> {
    if (this.started) {
      return;
    }

    this.attachNativeListeners();
    try {
      if (this.role === "host") {
        await startAdvertise(deviceName, this.strategy);
      } else {
        await startDiscovery(deviceName, this.strategy);
      }
      this.started = true;
    } catch (error) {
      this.detachNativeListeners();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started && this.nativeUnsubscribers.length === 0) {
      return;
    }

    this.started = false;
    this.detachNativeListeners();
    await Promise.allSettled([
      this.role === "host" ? stopAdvertise() : stopDiscovery(),
      disconnect(),
    ]);
  }

  async connect(peerId: string): Promise<void> {
    if (this.role !== "client") {
      throw new Error("Only a discovery client can request a nearby connection.");
    }
    await requestConnection(peerId);
  }

  async send(peerId: string, message: string): Promise<void> {
    await sendText(peerId, message);
  }

  onPeerFound(listener: PeerListener): Unsubscribe {
    return subscribe(this.peerFoundListeners, listener);
  }

  onPeerLost(listener: PeerIdListener): Unsubscribe {
    return subscribe(this.peerLostListeners, listener);
  }

  onPeerConnected(listener: PeerListener): Unsubscribe {
    return subscribe(this.peerConnectedListeners, listener);
  }

  onPeerDisconnected(listener: PeerIdListener): Unsubscribe {
    return subscribe(this.peerDisconnectedListeners, listener);
  }

  onMessage(listener: MessageListener): Unsubscribe {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  private attachNativeListeners(): void {
    if (this.nativeUnsubscribers.length > 0) {
      return;
    }

    this.nativeUnsubscribers = [
      onPeerFound((peer) => emit(this.peerFoundListeners, toTransportPeer(peer))),
      onPeerLost(({ peerId }) => emit(this.peerLostListeners, peerId)),
      onConnected((peer) => emit(this.peerConnectedListeners, toTransportPeer(peer))),
      onDisconnected(({ peerId }) => emit(this.peerDisconnectedListeners, peerId)),
      onTextReceived(({ peerId, text }) => emitMessage(this.messageListeners, peerId, text)),
      onInvitationReceived(({ peerId }) => {
        if (this.role === "host" && this.autoAcceptInvitations) {
          void acceptConnection(peerId);
        }
      }),
    ];
  }

  private detachNativeListeners(): void {
    for (const unsubscribe of this.nativeUnsubscribers) {
      unsubscribe();
    }
    this.nativeUnsubscribers = [];
  }
}

function toTransportPeer(peer: BasePeer): TransportPeer {
  return { peerId: peer.peerId, name: peer.name };
}

function subscribe<T>(
  listeners: Set<(value: T) => void>,
  listener: (value: T) => void,
): Unsubscribe {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit<T>(listeners: Set<(value: T) => void>, value: T): void {
  for (const listener of listeners) {
    listener(value);
  }
}

function emitMessage(listeners: Set<MessageListener>, peerId: string, message: string): void {
  for (const listener of listeners) {
    listener(peerId, message);
  }
}
