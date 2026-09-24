import type { PoseEstimate, SpatialSessionRole } from "./types.js";

export const PROTOCOL_VERSION = 3 as const;

export type HelloMessage = {
  version: typeof PROTOCOL_VERSION;
  type: "hello";
  deviceId: string;
  deviceName: string;
  streamId: string;
  role: SpatialSessionRole;
  roomId?: string;
};

export type PoseMessage = {
  version: typeof PROTOCOL_VERSION;
  type: "pose";
  estimate: Omit<PoseEstimate, "receivedAtMs">;
};

export type PeerLeftMessage = {
  version: typeof PROTOCOL_VERSION;
  type: "peer-left";
  deviceId: string;
};

export type ClockProbeMessage = {
  version: typeof PROTOCOL_VERSION;
  type: "clock-probe";
  probeId: string;
  clientSendMs: number;
};

export type ClockReplyMessage = {
  version: typeof PROTOCOL_VERSION;
  type: "clock-reply";
  probeId: string;
  clientSendMs: number;
  hostReceiveMs: number;
  hostSendMs: number;
};

export type SpatialWireMessage =
  | HelloMessage
  | PoseMessage
  | PeerLeftMessage
  | ClockProbeMessage
  | ClockReplyMessage;

export function serializeMessage(message: SpatialWireMessage): string {
  return JSON.stringify(message);
}

export function parseMessage(raw: string): SpatialWireMessage | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== PROTOCOL_VERSION || typeof value.type !== "string") {
      return undefined;
    }

    if (value.type === "hello") {
      if (
        typeof value.deviceId !== "string" ||
        typeof value.deviceName !== "string" ||
        typeof value.streamId !== "string" ||
        value.streamId.length === 0 ||
        (value.role !== "host" && value.role !== "client") ||
        (value.roomId !== undefined && typeof value.roomId !== "string")
      ) {
        return undefined;
      }

      return {
        version: PROTOCOL_VERSION,
        type: "hello",
        deviceId: value.deviceId,
        deviceName: value.deviceName,
        streamId: value.streamId,
        role: value.role,
        ...(value.roomId === undefined ? {} : { roomId: value.roomId }),
      };
    }

    if (value.type === "peer-left") {
      if (typeof value.deviceId !== "string") {
        return undefined;
      }

      return {
        version: PROTOCOL_VERSION,
        type: "peer-left",
        deviceId: value.deviceId,
      };
    }

    if (value.type === "clock-probe") {
      if (
        typeof value.probeId !== "string" ||
        value.probeId.length === 0 ||
        !isFiniteNumber(value.clientSendMs)
      ) {
        return undefined;
      }

      return {
        version: PROTOCOL_VERSION,
        type: "clock-probe",
        probeId: value.probeId,
        clientSendMs: value.clientSendMs,
      };
    }

    if (value.type === "clock-reply") {
      if (
        typeof value.probeId !== "string" ||
        value.probeId.length === 0 ||
        !isFiniteNumber(value.clientSendMs) ||
        !isFiniteNumber(value.hostReceiveMs) ||
        !isFiniteNumber(value.hostSendMs)
      ) {
        return undefined;
      }

      return {
        version: PROTOCOL_VERSION,
        type: "clock-reply",
        probeId: value.probeId,
        clientSendMs: value.clientSendMs,
        hostReceiveMs: value.hostReceiveMs,
        hostSendMs: value.hostSendMs,
      };
    }

    if (value.type === "pose" && isPoseEstimatePayload(value.estimate)) {
      return {
        version: PROTOCOL_VERSION,
        type: "pose",
        estimate: value.estimate,
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function isPoseEstimatePayload(value: unknown): value is Omit<PoseEstimate, "receivedAtMs"> {
  if (!isRecord(value) || !isRecord(value.pose)) {
    return false;
  }

  const pose = value.pose;
  const position = pose.position;
  const orientation = pose.orientation;
  const matrix = pose.matrix;

  return (
    typeof value.deviceId === "string" &&
    typeof value.deviceName === "string" &&
    typeof value.roomId === "string" &&
    typeof value.streamId === "string" &&
    value.streamId.length > 0 &&
    typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 1 &&
    value.frameId === "room" &&
    (value.trackingState === "normal" ||
      value.trackingState === "limited" ||
      value.trackingState === "unavailable") &&
    typeof value.sessionTimeMs === "number" &&
    Number.isFinite(value.sessionTimeMs) &&
    (value.sourceTimestampMs === undefined ||
      (typeof value.sourceTimestampMs === "number" && Number.isFinite(value.sourceTimestampMs))) &&
    isRecord(position) &&
    isFiniteNumber(position.x) &&
    isFiniteNumber(position.y) &&
    isFiniteNumber(position.z) &&
    isRecord(orientation) &&
    isFiniteNumber(orientation.x) &&
    isFiniteNumber(orientation.y) &&
    isFiniteNumber(orientation.z) &&
    isFiniteNumber(orientation.w) &&
    Array.isArray(matrix) &&
    matrix.length === 16 &&
    matrix.every(isFiniteNumber)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
