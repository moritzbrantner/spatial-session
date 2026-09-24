# spatial-session

Shared room coordinates and live nearby-device poses for Expo and React Native.

`spatial-session` is an experimental library for applications where multiple phones in the same physical space need to know where the other phones are. Each device tracks its own 6-DoF pose with ARKit/ARCore, calibrates into a common room frame, and exchanges room-space poses over a nearby peer-to-peer session.

The first MVP is intentionally small: it proves the reusable spatial-session abstraction without implementing UWB, automatic room-map merging, or a general multiplayer engine.

## What works in the MVP

- host/client discovery and messaging through `expo-nearby-connections`;
- `P2P_STAR` sessions with host relay for multiple clients;
- ARKit/ARCore camera pose input through `munim-xr`;
- explicit two-point shared-room calibration;
- continuous position + quaternion + 4x4 transform exchange;
- tracking-state propagation;
- transport-independent core with an in-memory test transport;
- Expo `SpatialXrView` that composes tracking and the session API.

## Install

```bash
bun add spatial-session expo-nearby-connections munim-xr react-native-nitro-modules
```

The current native adapters require a development build and React Native's New Architecture; they do not run in Expo Go.

Configure the native packages in `app.json`:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-nearby-connections",
        {
          "bonjourServicesName": "spatial-session",
          "localNetworkUsagePermissionText": "$(PRODUCT_NAME) finds nearby devices for a shared spatial session.",
          "bluetoothUsagePermissionText": "$(PRODUCT_NAME) uses Bluetooth to find nearby devices."
        }
      ],
      [
        "munim-xr",
        {
          "cameraPermission": "$(PRODUCT_NAME) uses the camera to track this device in the room.",
          "arRequired": false
        }
      ]
    ]
  }
}
```

Then prebuild/rebuild the app:

```bash
bunx expo prebuild
bunx expo run:android
# or
bunx expo run:ios
```

## Basic API

Create one host and one or more clients:

```ts
import { SpatialSession } from "spatial-session";
import { ExpoNearbyTransport } from "spatial-session/expo";

const session = new SpatialSession({
  deviceName: "Alice's phone",
  transport: new ExpoNearbyTransport({ role: "host" }),
});

await session.start();

const unsubscribe = session.subscribe((snapshot) => {
  for (const peer of snapshot.peers) {
    console.log(peer.deviceName, peer.latestPose?.pose.position);
  }
});
```

A client uses `{ role: "client" }`, observes `snapshot.discoveredPeers`, and connects with `session.connect(peerId)`.

Use `SpatialXrView` to feed native AR poses into the session:

```tsx
import { useRef } from "react";
import { SpatialXrView, type SpatialXrViewHandle } from "spatial-session/expo";

const xr = useRef<SpatialXrViewHandle>(null);

<SpatialXrView ref={xr} session={session} style={{ flex: 1 }} />;

await xr.current?.start();
```

## Calibrating a room

Every participating phone must choose the **same two physical reference points**.

1. Aim the center of the camera at the agreed room origin and call `captureOrigin()`.
2. Aim at a second point at least 20 cm away in the direction everyone agrees is room **+X** and call `captureForward()`.

```ts
await xr.current?.captureOrigin();
await xr.current?.captureForward();
```

The library projects that baseline onto the horizontal plane, uses gravity for +Y, derives +Z, and transforms subsequent camera poses into the resulting common room frame.

For the MVP this explicit calibration is preferable to pretending independent ARKit/ARCore coordinate systems already agree. See [docs/architecture.md](docs/architecture.md) for the model and future seams.

## Example

`example/` contains an Expo SDK 55 development-build app. Run it on at least two physical phones. Select one as **Host**, the others as **Client**, connect them, start tracking, and perform the same two-point calibration on each phone. The overlay then shows live room-space coordinates for every participant.

## Current limitations

- **Android and iOS cannot currently discover each other through the bundled nearby adapter.** The underlying package uses different platform protocols. Android↔Android and iOS↔iOS are the supported MVP paths.
- No UWB distance/direction measurements yet.
- No automatic shared-map/anchor alignment yet.
- No cross-device clock synchronization yet; do not treat pose timestamps as frame-accurate multi-camera synchronization.
- Pose quality currently exposes AR tracking state, not covariance/error bounds.

These are deliberate follow-up layers rather than requirements for proving the spatial-session API.

## Development

```bash
bun install
bun run verify
```

The core geometry/session tests do not require phones. Testing the Expo adapters requires development builds on physical devices.
