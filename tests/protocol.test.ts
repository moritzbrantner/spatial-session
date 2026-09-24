import { describe, expect, it } from "vitest";
import { parseMessage, serializeMessage } from "../src/protocol.js";

describe("wire protocol", () => {
  it("round-trips a hello message with stream identity", () => {
    const raw = serializeMessage({
      version: 2,
      type: "hello",
      deviceId: "phone-a",
      deviceName: "Phone A",
      streamId: "stream-a",
      role: "host",
      roomId: "room-a",
    });

    expect(parseMessage(raw)).toEqual({
      version: 2,
      type: "hello",
      deviceId: "phone-a",
      deviceName: "Phone A",
      streamId: "stream-a",
      role: "host",
      roomId: "room-a",
    });
  });

  it("accepts ordered pose metadata", () => {
    const raw = JSON.stringify({
      version: 2,
      type: "pose",
      estimate: {
        deviceId: "phone-a",
        deviceName: "Phone A",
        roomId: "room-a",
        streamId: "stream-a",
        sequence: 7,
        frameId: "room",
        pose: {
          position: { x: 1, y: 2, z: 3 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
          matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1],
        },
        trackingState: "normal",
        sessionTimeMs: 123,
      },
    });

    expect(parseMessage(raw)).toMatchObject({
      version: 2,
      type: "pose",
      estimate: {
        streamId: "stream-a",
        sequence: 7,
      },
    });
  });

  it("rejects legacy, malformed, and invalid sequence messages", () => {
    expect(parseMessage("not-json")).toBeUndefined();
    expect(
      parseMessage(
        JSON.stringify({
          version: 1,
          type: "hello",
          deviceId: "phone-a",
          deviceName: "Phone A",
          streamId: "stream-a",
          role: "host",
        }),
      ),
    ).toBeUndefined();
    expect(parseMessage('{"version":2,"type":"other"}')).toBeUndefined();

    const invalidSequence = JSON.stringify({
      version: 2,
      type: "pose",
      estimate: {
        deviceId: "phone-a",
        deviceName: "Phone A",
        roomId: "room-a",
        streamId: "stream-a",
        sequence: 0,
        frameId: "room",
        pose: {
          position: { x: 0, y: 0, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
          matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        },
        trackingState: "normal",
        sessionTimeMs: 123,
      },
    });
    expect(parseMessage(invalidSequence)).toBeUndefined();
  });
});
