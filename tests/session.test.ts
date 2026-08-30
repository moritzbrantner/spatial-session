import { describe, expect, it } from "vitest";
import { createRoomCalibration } from "../src/calibration.js";
import { poseFromMatrix } from "../src/math.js";
import { SpatialSession } from "../src/session.js";
import { InMemoryNetwork, InMemoryTransport } from "../src/testing/inMemoryTransport.js";

const calibration = createRoomCalibration({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });

function poseAt(x: number, y: number, z: number) {
  return poseFromMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

describe("SpatialSession", () => {
  it("discovers a host, connects, shares a room id, and exchanges poses", async () => {
    const network = new InMemoryNetwork();
    const host = new SpatialSession({
      deviceId: "host-device",
      deviceName: "Host",
      roomId: "room-1",
      transport: new InMemoryTransport(network, "host", "host-peer"),
    });
    const client = new SpatialSession({
      deviceId: "client-device",
      deviceName: "Client",
      transport: new InMemoryTransport(network, "client", "client-peer"),
    });

    await host.start();
    await client.start();

    expect(client.snapshot().discoveredPeers).toEqual([{ peerId: "host-peer", name: "Host" }]);

    await client.connect("host-peer");
    expect(client.snapshot().roomId).toBe("room-1");
    expect(host.snapshot().peers[0]?.deviceId).toBe("client-device");

    host.setCalibration(calibration);
    client.setCalibration(calibration);
    client.publishLocalPose({ pose: poseAt(1, 2, 3), trackingState: "normal" });

    const clientOnHost = host.snapshot().peers.find((peer) => peer.deviceId === "client-device");
    expect(clientOnHost?.latestPose?.pose.position).toMatchObject({ x: 1, y: 2, z: 3 });

    host.publishLocalPose({ pose: poseAt(4, 5, 6), trackingState: "normal" });
    const hostOnClient = client.snapshot().peers.find((peer) => peer.deviceId === "host-device");
    expect(hostOnClient?.latestPose?.pose.position).toMatchObject({ x: 4, y: 5, z: 6 });
  });

  it("relays client poses through the host to other clients", async () => {
    const network = new InMemoryNetwork();
    const host = new SpatialSession({
      deviceId: "host-device",
      deviceName: "Host",
      roomId: "room-1",
      transport: new InMemoryTransport(network, "host", "host-peer"),
    });
    const first = new SpatialSession({
      deviceId: "first-device",
      deviceName: "First",
      transport: new InMemoryTransport(network, "client", "first-peer"),
    });
    const second = new SpatialSession({
      deviceId: "second-device",
      deviceName: "Second",
      transport: new InMemoryTransport(network, "client", "second-peer"),
    });

    await host.start();
    await first.start();
    await second.start();
    await first.connect("host-peer");
    await second.connect("host-peer");

    expect(second.snapshot().peers.some((peer) => peer.deviceId === "first-device")).toBe(true);

    first.setCalibration(calibration);
    first.publishLocalPose({ pose: poseAt(2, 0, 0), trackingState: "normal" });

    const relayed = second.snapshot().peers.find((peer) => peer.deviceId === "first-device");
    expect(relayed?.latestPose?.pose.position.x).toBeCloseTo(2);
  });
});
