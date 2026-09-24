import { describe, expect, it } from "vitest";
import { createRoomCalibration } from "../src/calibration.js";
import { poseFromMatrix } from "../src/math.js";
import { PROTOCOL_VERSION } from "../src/protocol.js";
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

    second.setCalibration(calibration);
    second.publishLocalPose({ pose: poseAt(3, 0, 0), trackingState: "normal" });
    expect(
      first.snapshot().peers.find((peer) => peer.deviceId === "second-device")?.latestPose?.pose
        .position.x,
    ).toBeCloseTo(3);

    await first.stop();
    expect(host.snapshot().peers.some((peer) => peer.deviceId === "first-device")).toBe(false);
    expect(second.snapshot().peers.some((peer) => peer.deviceId === "first-device")).toBe(false);
  });

  it("rejects stale, duplicate, wrong-stream, and spoofed remote poses", async () => {
    const network = new InMemoryNetwork();
    const hostTransport = new InMemoryTransport(network, "host", "host-peer");
    const clientTransport = new InMemoryTransport(network, "client", "client-peer");
    const host = new SpatialSession({
      deviceId: "host-device",
      deviceName: "Host",
      roomId: "room-1",
      streamId: "host-stream",
      transport: hostTransport,
    });
    const client = new SpatialSession({
      deviceId: "client-device",
      deviceName: "Client",
      streamId: "client-stream",
      transport: clientTransport,
    });

    await host.start();
    await client.start();
    await client.connect("host-peer");
    client.setCalibration(calibration);

    const first = client.publishLocalPose({ pose: poseAt(1, 0, 0), trackingState: "normal" });
    const second = client.publishLocalPose({ pose: poseAt(2, 0, 0), trackingState: "normal" });
    if (!first || !second) {
      throw new Error("Expected calibrated local poses.");
    }

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
    expect(host.snapshot().peers[0]?.latestPose?.sequence).toBe(2);

    await clientTransport.send(
      "host-peer",
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "pose",
        estimate: first,
      }),
    );
    expect(host.snapshot().peers[0]?.latestPose?.sequence).toBe(2);
    expect(host.snapshot().peers[0]?.latestPose?.pose.position.x).toBeCloseTo(2);

    await clientTransport.send(
      "host-peer",
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "pose",
        estimate: {
          ...second,
          streamId: "superseded-stream",
          sequence: 99,
          pose: poseAt(99, 0, 0),
        },
      }),
    );
    expect(host.snapshot().peers[0]?.latestPose?.sequence).toBe(2);

    await clientTransport.send(
      "host-peer",
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "pose",
        estimate: {
          ...second,
          deviceId: "host-device",
          sequence: 100,
          pose: poseAt(100, 0, 0),
        },
      }),
    );
    expect(host.snapshot().peers[0]?.latestPose?.sequence).toBe(2);
  });

  it("accepts a restarted peer stream while rejecting delayed packets from the old stream", async () => {
    const network = new InMemoryNetwork();
    const hostTransport = new InMemoryTransport(network, "host", "host-peer");
    const firstTransport = new InMemoryTransport(network, "client", "first-peer");
    const host = new SpatialSession({
      deviceId: "host-device",
      deviceName: "Host",
      roomId: "room-1",
      streamId: "host-stream",
      transport: hostTransport,
    });
    const first = new SpatialSession({
      deviceId: "client-device",
      deviceName: "Client",
      streamId: "stream-1",
      transport: firstTransport,
    });

    await host.start();
    await first.start();
    await first.connect("host-peer");
    first.setCalibration(calibration);
    const oldPose = first.publishLocalPose({ pose: poseAt(1, 0, 0), trackingState: "normal" });
    if (!oldPose) {
      throw new Error("Expected a calibrated local pose.");
    }
    expect(host.snapshot().peers[0]?.streamId).toBe("stream-1");

    await first.stop();

    const secondTransport = new InMemoryTransport(network, "client", "first-peer");
    const second = new SpatialSession({
      deviceId: "client-device",
      deviceName: "Client",
      streamId: "stream-2",
      transport: secondTransport,
    });
    await second.start();
    await second.connect("host-peer");
    second.setCalibration(calibration);
    second.publishLocalPose({ pose: poseAt(2, 0, 0), trackingState: "normal" });

    expect(host.snapshot().peers[0]?.streamId).toBe("stream-2");
    expect(host.snapshot().peers[0]?.latestPose?.pose.position.x).toBeCloseTo(2);

    hostTransport.receiveFromNetwork(
      "first-peer",
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type: "pose",
        estimate: oldPose,
      }),
    );

    expect(host.snapshot().peers[0]?.streamId).toBe("stream-2");
    expect(host.snapshot().peers[0]?.latestPose?.pose.position.x).toBeCloseTo(2);
  });

  it("invalidates local calibration when reconnecting to a different room", async () => {
    const network = new InMemoryNetwork();
    const firstHost = new SpatialSession({
      deviceId: "first-host-device",
      deviceName: "First host",
      roomId: "room-1",
      transport: new InMemoryTransport(network, "host", "first-host-peer"),
    });
    const secondHost = new SpatialSession({
      deviceId: "second-host-device",
      deviceName: "Second host",
      roomId: "room-2",
      transport: new InMemoryTransport(network, "host", "second-host-peer"),
    });
    const client = new SpatialSession({
      deviceId: "client-device",
      deviceName: "Client",
      transport: new InMemoryTransport(network, "client", "client-peer"),
    });

    await firstHost.start();
    await secondHost.start();
    await client.start();
    await client.connect("first-host-peer");
    client.setCalibration(calibration);
    expect(
      client.publishLocalPose({ pose: poseAt(1, 0, 0), trackingState: "normal" }),
    ).toBeDefined();

    await firstHost.stop();
    await client.connect("second-host-peer");

    expect(client.snapshot()).toMatchObject({ roomId: "room-2", calibrated: false });
    expect(client.snapshot().latestLocalPose).toBeUndefined();
    expect(
      client.publishLocalPose({ pose: poseAt(1, 0, 0), trackingState: "normal" }),
    ).toBeUndefined();
  });

  it("estimates the host clock deterministically and uses it for session timestamps", async () => {
    const network = new InMemoryNetwork();
    let clientNow = 1_000;
    let hostNow = 1_050;
    const host = new SpatialSession({
      deviceId: "host-device",
      deviceName: "Host",
      roomId: "room-1",
      streamId: "host-stream",
      now: () => hostNow,
      transport: new InMemoryTransport(network, "host", "host-peer"),
    });
    const client = new SpatialSession({
      deviceId: "client-device",
      deviceName: "Client",
      streamId: "client-stream",
      now: () => clientNow,
      idFactory: (prefix) => `${prefix}-1`,
      transport: new InMemoryTransport(network, "client", "client-peer"),
    });

    await host.start();
    await client.start();
    await client.connect("host-peer");
    await client.synchronizeClock();

    expect(client.snapshot().sessionClock).toEqual({
      offsetMs: 50,
      roundTripTimeMs: 0,
      uncertaintyMs: 0,
      measuredAtMs: 1_000,
    });

    client.setCalibration(calibration);
    clientNow = 2_000;
    hostNow = 2_050;
    const pose = client.publishLocalPose({ pose: poseAt(1, 0, 0), trackingState: "normal" });
    expect(pose?.sessionTimeMs).toBe(2_050);

    await host.stop();
    expect(client.snapshot().sessionClock).toBeUndefined();
  });

  it("does not return to running when stop overtakes a pending start", async () => {
    const network = new InMemoryNetwork();
    let releaseStart: (() => void) | undefined;
    const transport = new (class extends InMemoryTransport {
      override async start(deviceName: string): Promise<void> {
        await new Promise<void>((resolve) => {
          releaseStart = resolve;
        });
        await super.start(deviceName);
      }
    })(network, "client", "client-peer");
    const client = new SpatialSession({ deviceName: "Client", transport });

    const starting = client.start();
    await client.stop();
    releaseStart?.();
    await starting;

    expect(client.snapshot().status).toBe("stopped");
    await expect(transport.connect("missing-host")).rejects.toThrow(
      "Transport must be started before connecting.",
    );
  });

  it("surfaces a failed hello handshake", async () => {
    const network = new InMemoryNetwork();
    const host = new SpatialSession({
      deviceName: "Host",
      roomId: "room-1",
      transport: new InMemoryTransport(network, "host", "host-peer"),
    });
    const transport = new (class extends InMemoryTransport {
      override async send(): Promise<void> {
        throw new Error("peer disappeared");
      }
    })(network, "client", "client-peer");
    const client = new SpatialSession({ deviceName: "Client", transport });

    await host.start();
    await client.start();
    await client.connect("host-peer");
    await Promise.resolve();

    expect(client.snapshot().error).toBe("Handshake with Host failed: peer disappeared");
  });
});
