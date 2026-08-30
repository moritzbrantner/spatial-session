# Architecture

`spatial-session` turns per-device spatial tracking into a small shared-room primitive for Expo and React Native applications.

## MVP boundary

The MVP owns four things:

1. a transport-independent session/protocol for peer membership and pose exchange;
2. a room coordinate frame established from two shared physical calibration points;
3. conversion of local ARKit/ARCore camera poses into that room frame;
4. Expo adapters for nearby networking and XR tracking.

It deliberately does **not** own rendering, game state, camera recording, scene reconstruction, or a general AR engine.

## Data flow

```text
ARKit / ARCore (munim-xr)
        |
        | local 6-DoF camera pose
        v
 two-point room calibration
        |
        | room-space 6-DoF pose
        v
     SpatialSession
        |
        | versioned JSON messages
        v
 ExpoNearbyTransport
        |
        +---- host <----> client A
        |        ^
        |        +-----> client B
        v
 remote room-space poses
```

`P2P_STAR` is used intentionally. The host is the relay and owns the `roomId`; clients connect to it and adopt that room identifier. The session core itself only depends on `SpatialTransport`, so a future Internet or cross-platform local transport does not change the application API.

## Coordinate frame

Every AR session begins with its own unrelated local coordinate system. Each device therefore captures the same two physical points:

- **origin**: becomes `(0, 0, 0)`;
- **+X reference**: establishes the room's positive X direction.

The vector from origin to the second point is projected onto the horizontal plane. Gravity supplies +Y. +Z is derived orthogonally. This creates `roomFromLocal`, a 4x4 transform applied to every camera pose before it is published.

This manual calibration is an MVP feature, not a workaround hidden behind the API. It keeps the shared-frame assumption explicit and gives automatic visual alignment, shared anchors, or UWB fusion a well-defined future seam.

## Timing

The wire model carries both `sessionTimeMs` and the XR source timestamp. In the MVP `sessionTimeMs` uses the local wall clock. That is adequate for interactive pose visualization but is **not** a synchronized multi-camera clock. A proper clock-offset/uncertainty model is required before spatial metadata should be treated as frame-accurate recording data.

## Current limitations

- Nearby networking is same-platform because `expo-nearby-connections` currently uses Google Nearby Connections on Android and Multipeer Connectivity on iOS.
- Calibration must be performed independently on every phone against the same two physical points.
- No UWB ranging/direction fusion yet.
- No shared scene mesh or room reconstruction yet.
- No cross-device clock synchronization yet.
- The API reports AR tracking state but does not yet quantify positional/angular uncertainty.

## Intended next seams

Future capabilities should extend the existing model rather than change its meaning:

- `SpatialTransport`: Google Nearby on both platforms and/or Internet relay transport;
- `RoomFrameProvider`: visual marker, shared anchors, automatic map alignment;
- `SpatialConstraintProvider`: UWB range/direction observations;
- `SessionClock`: offset estimation and uncertainty;
- pose-quality metadata and optional sensor fusion.
