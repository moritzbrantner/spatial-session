import {
  cross,
  dot,
  length,
  multiplyMatrix4,
  normalize,
  poseFromMatrix,
  subtract,
} from "./math.js";
import type { Matrix4, Pose, RoomCalibration, Vector3 } from "./types.js";

const MINIMUM_BASELINE_METERS = 0.2;

export function createRoomCalibration(
  originLocal: Vector3,
  forwardLocal: Vector3,
  createdAtMs = Date.now(),
): RoomCalibration {
  const rawForward = subtract(forwardLocal, originLocal);
  const horizontalForward: Vector3 = {
    x: rawForward.x,
    y: 0,
    z: rawForward.z,
  };

  if (length(horizontalForward) < MINIMUM_BASELINE_METERS) {
    throw new Error(
      `Calibration points must be at least ${MINIMUM_BASELINE_METERS}m apart horizontally.`,
    );
  }

  const roomXInLocal = normalize(horizontalForward);
  const roomYInLocal: Vector3 = { x: 0, y: 1, z: 0 };
  const roomZInLocal = normalize(cross(roomXInLocal, roomYInLocal));

  const tx = -dot(roomXInLocal, originLocal);
  const ty = -dot(roomYInLocal, originLocal);
  const tz = -dot(roomZInLocal, originLocal);

  const roomFromLocal: Matrix4 = [
    roomXInLocal.x,
    roomYInLocal.x,
    roomZInLocal.x,
    0,
    roomXInLocal.y,
    roomYInLocal.y,
    roomZInLocal.y,
    0,
    roomXInLocal.z,
    roomYInLocal.z,
    roomZInLocal.z,
    0,
    tx,
    ty,
    tz,
    1,
  ];

  return {
    roomFromLocal,
    originLocal: { ...originLocal },
    forwardLocal: { ...forwardLocal },
    createdAtMs,
  };
}

export function transformPoseToRoom(localPose: Pose, calibration: RoomCalibration): Pose {
  return poseFromMatrix(multiplyMatrix4(calibration.roomFromLocal, localPose.matrix));
}
