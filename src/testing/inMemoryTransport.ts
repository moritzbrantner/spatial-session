import type {
  SpatialSessionRole,
  SpatialTransport,
  TransportPeer,
  Unsubscribe,
} from "../types.js";

type PeerListener = (peer: TransportPeer) => void;
type PeerIdListener = (peerId: string) => void;
type MessageListener = (peerId: string, message: string) => void;

export class InMemoryNetwork {
  private readonly transports = new Map<string, InMemoryTransport>();

  register(transport: InMemoryTransport): void {
    this.transports.set(transport.peerId, transport);
    this.refreshDiscovery();
  }

  unregister(transport: InMemoryTransport): void {
    this.transports.delete(transport.peerId);

    for (const other of this.transports.values()) {
      if (other.isConnectedTo(transport.peerId)) {
        other.disconnectFromNetwork(transport.peerId);
      }
    }

    this.refreshDiscovery();
  }

  connect(client: InMemoryTransport, targetPeerId: string): void {
    const host = this.transports.get(targetPeerId);
    if (!host || host.role !== "host") {
      throw new Error(`Host ${targetPeerId} is not available.`);
    }
    if (client.role !== "client") {
      throw new Error("Only clients can initiate in-memory connections.");
    }

    client.prepareConnectionFromNetwork(host);
    host.prepareConnectionFromNetwork(client);
    client.emitConnectedFromNetwork(host);
    host.emitConnectedFromNetwork(client);
    this.refreshDiscovery();
  }

  deliver(sender: InMemoryTransport, targetPeerId: string, message: string): void {
    const target = this.transports.get(targetPeerId);
    if (!target || !sender.isConnectedTo(targetPeerId)) {
      throw new Error(`Peer ${targetPeerId} is not connected.`);
    }

    target.receiveFromNetwork(sender.peerId, message);
  }

  private refreshDiscovery(): void {
    const hosts = [...this.transports.values()].filter((transport) => transport.role === "host");
    for (const transport of this.transports.values()) {
      transport.refreshDiscoveredHosts(hosts);
    }
  }
}

export class InMemoryTransport implements SpatialTransport {
  readonly role: SpatialSessionRole;
  readonly peerId: string;

  private name = "";
  private started = false;
  private readonly connectedPeers = new Map<string, TransportPeer>();
  private readonly discoveredPeers = new Map<string, TransportPeer>();
  private readonly peerFoundListeners = new Set<PeerListener>();
  private readonly peerLostListeners = new Set<PeerIdListener>();
  private readonly peerConnectedListeners = new Set<PeerListener>();
  private readonly peerDisconnectedListeners = new Set<PeerIdListener>();
  private readonly messageListeners = new Set<MessageListener>();

  constructor(
    private readonly network: InMemoryNetwork,
    role: SpatialSessionRole,
    peerId = createPeerId(),
  ) {
    this.role = role;
    this.peerId = peerId;
  }

  async start(deviceName: string): Promise<void> {
    if (this.started) {
      return;
    }

    this.name = deviceName;
    this.started = true;
    this.network.register(this);
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.network.unregister(this);
    this.connectedPeers.clear();
    this.discoveredPeers.clear();
  }

  async connect(peerId: string): Promise<void> {
    if (!this.started) {
      throw new Error("Transport must be started before connecting.");
    }
    this.network.connect(this, peerId);
  }

  async send(peerId: string, message: string): Promise<void> {
    this.network.deliver(this, peerId, message);
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

  isConnectedTo(peerId: string): boolean {
    return this.connectedPeers.has(peerId);
  }

  refreshDiscoveredHosts(hosts: InMemoryTransport[]): void {
    if (!this.started || this.role !== "client") {
      return;
    }

    const next = new Map<string, TransportPeer>();
    for (const host of hosts) {
      if (host.peerId !== this.peerId && !this.connectedPeers.has(host.peerId)) {
        next.set(host.peerId, host.asPeer());
      }
    }

    for (const [peerId, peer] of next) {
      if (!this.discoveredPeers.has(peerId)) {
        this.discoveredPeers.set(peerId, peer);
        emit(this.peerFoundListeners, peer);
      }
    }

    for (const peerId of [...this.discoveredPeers.keys()]) {
      if (!next.has(peerId)) {
        this.discoveredPeers.delete(peerId);
        emit(this.peerLostListeners, peerId);
      }
    }
  }

  prepareConnectionFromNetwork(peer: InMemoryTransport): void {
    this.connectedPeers.set(peer.peerId, peer.asPeer());
    this.discoveredPeers.delete(peer.peerId);
  }

  emitConnectedFromNetwork(peer: InMemoryTransport): void {
    emit(this.peerConnectedListeners, peer.asPeer());
  }

  disconnectFromNetwork(peerId: string): void {
    if (!this.connectedPeers.delete(peerId)) {
      return;
    }
    emit(this.peerDisconnectedListeners, peerId);
  }

  receiveFromNetwork(peerId: string, message: string): void {
    emitMessage(this.messageListeners, peerId, message);
  }

  private asPeer(): TransportPeer {
    return { peerId: this.peerId, name: this.name };
  }
}

export function createInMemoryTransportPair(): {
  network: InMemoryNetwork;
  host: InMemoryTransport;
  client: InMemoryTransport;
} {
  const network = new InMemoryNetwork();
  return {
    network,
    host: new InMemoryTransport(network, "host", "host-peer"),
    client: new InMemoryTransport(network, "client", "client-peer"),
  };
}

function subscribe<T>(listeners: Set<(value: T) => void>, listener: (value: T) => void): Unsubscribe {
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

function createPeerId(): string {
  return `peer-${Math.random().toString(36).slice(2, 10)}`;
}
