import { describe, expect, it } from "vitest";
import { parseMessage, serializeMessage } from "../src/protocol.js";

describe("wire protocol", () => {
  it("round-trips a hello message", () => {
    const raw = serializeMessage({
      version: 1,
      type: "hello",
      deviceId: "phone-a",
      deviceName: "Phone A",
      role: "host",
      roomId: "room-a",
    });

    expect(parseMessage(raw)).toEqual({
      version: 1,
      type: "hello",
      deviceId: "phone-a",
      deviceName: "Phone A",
      role: "host",
      roomId: "room-a",
    });
  });

  it("ignores malformed and unknown messages", () => {
    expect(parseMessage("not-json")).toBeUndefined();
    expect(parseMessage('{"version":2,"type":"hello"}')).toBeUndefined();
    expect(parseMessage('{"version":1,"type":"other"}')).toBeUndefined();
  });
});
