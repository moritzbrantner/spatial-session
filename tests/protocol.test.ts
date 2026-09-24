import { describe, expect, it } from "vitest";
import { parseMessage, serializeMessage } from "../src/protocol.js";

describe("wire protocol", () => {
  it("round-trips a hello message with stream identity", () => {
    const raw = serializeMessage({
      version: 3,
      type: "hello",
      deviceId: "phone-a",
      deviceName: "Phone A",
      streamId: "stream-a",
      role: "host",
      roomId: "room-a",
    });

    expect(parseMessage(raw)).toEqual({
      version: 3,
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
      version: 3,
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
      version: 3,
      type: "pose",
      estimate: {
        streamId: "stream-a",
        sequence: 7,
      },
    });
  });

  it("round-trips finite clock synchronization messages", () => {
    const probe = serializeMessage({
      version: 3,
      type: "clock-probe",
      probeId: "probe-1",
      clientSendMs: 100,
    });
    expect(parseMessage(probe)).toEqual({
      version: 3,
      type: "clock-probe",
      probeId: "probe-1",
      clientSendMs: 100,
    });

    const reply = serializeMessage({
      version: 3,
      type: "clock-reply",
      probeId: "probe-1",
      clientSendMs: 100,
      hostReceiveMs: 150,
      hostSendMs: 151,
    });
    expect(parseMessage(reply)).toEqual({
      version: 3,
      type: "clock-reply",
      probeId: "probe-1",
      clientSendMs: 100,
      hostReceiveMs: 150,
      hostSendMs: 151,
    });

    expect(
      parseMessage(
        JSON.stringify({
          version: 3,
          type: "clock-reply",
          probeId: "probe-1",
          clientSendMs: 100,
          hostReceiveMs: Number.NaN,
          hostSendMs: 151,
        }),
      ),
    ).toBeUndefined();
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
    expect(parseMessage('{"version":3,"type":"other"}')).toBeUndefined();

    const invalidSequence = JSON.stringify({
      version: 3,
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
