import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SpatialSession, type SpatialSessionRole, type SpatialSessionSnapshot } from "spatial-session";
import {
  ExpoNearbyTransport,
  SpatialXrView,
  requestNearbyPermissions,
  type SpatialXrViewHandle,
} from "spatial-session/expo";

export default function App() {
  const [role, setRole] = useState<SpatialSessionRole | undefined>();
  const [deviceName, setDeviceName] = useState("Phone");

  if (!role) {
    return (
      <SafeAreaView style={styles.roleScreen}>
        <Text style={styles.title}>Spatial Session MVP</Text>
        <Text style={styles.copy}>
          Put two or more physical phones in the same room. Pick one host; every other phone is a
          client.
        </Text>
        <TextInput
          accessibilityLabel="Device name"
          onChangeText={setDeviceName}
          placeholder="Device name"
          style={styles.input}
          value={deviceName}
        />
        <View style={styles.buttonGap}>
          <Button onPress={() => setRole("host")} title="Host room" />
        </View>
        <Button onPress={() => setRole("client")} title="Join room" />
      </SafeAreaView>
    );
  }

  return <SessionScreen deviceName={deviceName || "Phone"} role={role} />;
}

function SessionScreen({ deviceName, role }: { deviceName: string; role: SpatialSessionRole }) {
  const session = useMemo(
    () =>
      new SpatialSession({
        deviceName,
        transport: new ExpoNearbyTransport({ role }),
      }),
    [deviceName, role],
  );
  const xrRef = useRef<SpatialXrViewHandle>(null);
  const [snapshot, setSnapshot] = useState<SpatialSessionSnapshot>(() => session.snapshot());
  const [message, setMessage] = useState("Starting nearby session…");

  useEffect(() => session.subscribe(setSnapshot), [session]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!(await requestNearbyPermissions())) {
          throw new Error("Nearby permissions were denied.");
        }
        await session.start();
        if (active) {
          setMessage(role === "host" ? "Advertising room" : "Looking for a host");
        }
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      active = false;
      void session.stop();
    };
  }, [role, session]);

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <View style={styles.sessionScreen}>
      <SpatialXrView ref={xrRef} session={session} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={styles.crosshair}>
        <View style={styles.crosshairHorizontal} />
        <View style={styles.crosshairVertical} />
      </View>

      <SafeAreaView style={styles.overlay}>
        <ScrollView contentContainerStyle={styles.panel}>
          <Text style={styles.title}>{role === "host" ? "Host" : "Client"}</Text>
          <Text style={styles.mono}>room: {snapshot.roomId ?? "waiting"}</Text>
          <Text style={styles.copy}>{message}</Text>

          {role === "client" && snapshot.discoveredPeers.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.heading}>Nearby hosts</Text>
              {snapshot.discoveredPeers.map((peer) => (
                <View key={peer.peerId} style={styles.peerRow}>
                  <Text style={styles.copy}>{peer.name}</Text>
                  <Button
                    onPress={() => run(() => session.connect(peer.peerId), `Connecting to ${peer.name}`)}
                    title="Connect"
                  />
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.heading}>Tracking & calibration</Text>
            <Text style={styles.copy}>
              All phones must capture the same physical origin, then the same second point defining
              room +X.
            </Text>
            <View style={styles.buttonGap}>
              <Button
                onPress={() => run(() => xrRef.current!.start(), "AR tracking started")}
                title="1. Start tracking"
              />
            </View>
            <View style={styles.buttonGap}>
              <Button
                onPress={() => run(() => xrRef.current!.captureOrigin(), "Origin captured")}
                title="2. Capture origin"
              />
            </View>
            <Button
              onPress={() => run(() => xrRef.current!.captureForward(), "Room frame calibrated")}
              title="3. Capture +X point"
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.heading}>Devices</Text>
            <PoseRow label={`${deviceName} (this phone)`} snapshot={snapshot.latestLocalPose} />
            {snapshot.peers.map((peer) => (
              <PoseRow key={peer.deviceId} label={peer.deviceName} snapshot={peer.latestPose} />
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function PoseRow({
  label,
  snapshot,
}: {
  label: string;
  snapshot: SpatialSessionSnapshot["latestLocalPose"];
}) {
  const position = snapshot?.pose.position;
  return (
    <View style={styles.poseRow}>
      <Text style={styles.copy}>{label}</Text>
      <Text style={styles.mono}>
        {position
          ? `x ${position.x.toFixed(2)}  y ${position.y.toFixed(2)}  z ${position.z.toFixed(2)}`
          : "no calibrated pose"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  roleScreen: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  sessionScreen: {
    flex: 1,
    backgroundColor: "black",
  },
  overlay: {
    flex: 1,
  },
  panel: {
    margin: 12,
    marginTop: 40,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    gap: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "white",
  },
  heading: {
    fontSize: 17,
    fontWeight: "600",
    color: "white",
  },
  copy: {
    fontSize: 15,
    color: "white",
  },
  mono: {
    fontFamily: "monospace",
    color: "white",
  },
  input: {
    borderWidth: 1,
    borderColor: "#888",
    borderRadius: 8,
    padding: 12,
    color: "white",
  },
  section: {
    gap: 8,
    marginTop: 12,
  },
  buttonGap: {
    marginBottom: 8,
  },
  peerRow: {
    gap: 6,
  },
  poseRow: {
    paddingVertical: 6,
    gap: 2,
  },
  crosshair: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 28,
    height: 28,
    marginLeft: -14,
    marginTop: -14,
  },
  crosshairHorizontal: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 13,
    height: 2,
    backgroundColor: "white",
  },
  crosshairVertical: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 13,
    width: 2,
    backgroundColor: "white",
  },
});
