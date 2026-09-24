export type Vector3 = {
  x: number;
  y: number;
  z: number;
};

export type Quaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type Matrix4 = readonly number[];

export type Pose = {
  position: Vector3;
  orientation: Quaternion;
  matrix: Matrix4;
};

export type TrackingState = "unavailable" | "limited" | "normal";

export type PoseEstimate = {
  deviceId: string;
  deviceName: string;
  roomId: string;
  streamId: string;
  sequence: number;
  frameId: "room";
  pose: Pose;
  trackingState: TrackingState;
  sessionTimeMs: number;
  sourceTimestampMs?: number;
  receivedAtMs: number;
};

export type RoomCalibration = {
  roomFromLocal: Matrix4;
  originLocal: Vector3;
  forwardLocal: Vector3;
  createdAtMs: number;
};

export type DiscoveredPeer = {
  peerId: string;
  name: string;
};

export type SpatialPeer = {
  deviceId: string;
  deviceName: string;
  streamId: string;
  connected: boolean;
  latestPose?: PoseEstimate;
};

export type SpatialSessionRole = "host" | "client";

export type SpatialSessionStatus = "idle" | "starting" | "running" | "stopped" | "error";

export type SpatialSessionSnapshot = {
  status: SpatialSessionStatus;
  role: SpatialSessionRole;
  roomId?: string;
  localDeviceId: string;
  localDeviceName: string;
  calibrated: boolean;
  discoveredPeers: DiscoveredPeer[];
  peers: SpatialPeer[];
  latestLocalPose?: PoseEstimate;
  error?: string;
};

export type TransportPeer = {
  peerId: string;
  name: string;
};

export type Unsubscribe = () => void;

export type SpatialTransport = {
  readonly role: SpatialSessionRole;
  start(deviceName: string): Promise<void>;
  stop(): Promise<void>;
  connect(peerId: string): Promise<void>;
  send(peerId: string, message: string): Promise<void>;
  onPeerFound(listener: (peer: TransportPeer) => void): Unsubscribe;
  onPeerLost(listener: (peerId: string) => void): Unsubscribe;
  onPeerConnected(listener: (peer: TransportPeer) => void): Unsubscribe;
  onPeerDisconnected(listener: (peerId: string) => void): Unsubscribe;
  onMessage(listener: (peerId: string, message: string) => void): Unsubscribe;
};
