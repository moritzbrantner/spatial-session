import { describe, expect, it } from "vitest";
import { createRoomCalibration, transformPoseToRoom } from "../src/calibration.js";
import { poseFromMatrix } from "../src/math.js";

function translation(x: number, y: number, z: number) {
  return poseFromMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

describe("room calibration", () => {
  it("maps the chosen origin to zero and forward direction to +X", () => {
    const calibration = createRoomCalibration({ x: 1, y: 0, z: 2 }, { x: 2, y: 0, z: 2 });
    const roomPose = transformPoseToRoom(translation(3, 1, 4), calibration);

    expect(roomPose.position.x).toBeCloseTo(2);
    expect(roomPose.position.y).toBeCloseTo(1);
    expect(roomPose.position.z).toBeCloseTo(2);
  });

  it("aligns a local +Z forward direction with room +X", () => {
    const calibration = createRoomCalibration({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    const roomPose = transformPoseToRoom(translation(0, 0, 2), calibration);

    expect(roomPose.position.x).toBeCloseTo(2);
    expect(roomPose.position.y).toBeCloseTo(0);
    expect(roomPose.position.z).toBeCloseTo(0);
  });

  it("rejects calibration points that are too close", () => {
    expect(() => createRoomCalibration({ x: 0, y: 0, z: 0 }, { x: 0.05, y: 0, z: 0 })).toThrow(
      /at least 0.2m/,
    );
  });
});
