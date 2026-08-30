import { forwardRef, useImperativeHandle, useMemo, useRef, type ComponentProps } from "react";
import { callback } from "react-native-nitro-modules";
import {
  XRView,
  checkAvailability,
  requestCameraPermission,
  requestInstall,
  type XRFrame,
  type XRTrackingState,
  type XRViewRef,
} from "munim-xr";
import { createRoomCalibration } from "../calibration.js";
import type { SpatialSession } from "../session.js";
import type { RoomCalibration, Vector3 } from "../types.js";

export type SpatialXrViewProps = Omit<
  ComponentProps<typeof XRView>,
  | "hybridRef"
  | "onFrame"
  | "frameCallbackFps"
  | "depthEnabled"
  | "planeDetection"
  | "lightEstimationEnabled"
  | "onError"
  | "onTrackingStateChange"
> & {
  session: SpatialSession;
  frameCallbackFps?: number;
  depthEnabled?: boolean;
  planeDetection?: "none" | "horizontal" | "vertical" | "both";
  lightEstimationEnabled?: boolean;
  onTrackingStateChange?: (state: XRTrackingState) => void;
  onError?: (message: string) => void;
};

export type SpatialXrViewHandle = {
  start(): Promise<void>;
  pause(): void;
  reset(): Promise<void>;
  captureOrigin(): Promise<Vector3>;
  captureForward(): Promise<RoomCalibration>;
  clearCalibration(): void;
};

export const SpatialXrView = forwardRef<SpatialXrViewHandle, SpatialXrViewProps>(
  function SpatialXrView(
    {
      session,
      frameCallbackFps = 10,
      depthEnabled = false,
      planeDetection = "both",
      lightEstimationEnabled = false,
      onTrackingStateChange,
      onError,
      ...viewProps
    },
    forwardedRef,
  ) {
    const xrRef = useRef<XRViewRef | null>(null);
    const originRef = useRef<Vector3 | undefined>(undefined);

    const hybridRef = useMemo(() => callback((ref: XRViewRef) => (xrRef.current = ref)), []);
    const frameHandler = useMemo(
      () =>
        callback((frame: XRFrame) => {
          session.publishLocalPose({
            pose: {
              position: { ...frame.cameraPose.position },
              orientation: { ...frame.cameraPose.orientation },
              matrix: [...frame.cameraPose.matrix],
            },
            trackingState: frame.trackingState,
            sourceTimestampMs: frame.timestamp * 1_000,
          });
        }),
      [session],
    );
    const trackingHandler = useMemo(
      () =>
        callback((state: XRTrackingState) => {
          onTrackingStateChange?.(state);
        }),
      [onTrackingStateChange],
    );
    const errorHandler = useMemo(
      () =>
        callback((message: string) => {
          onError?.(message);
        }),
      [onError],
    );

    useImperativeHandle(
      forwardedRef,
      () => ({
        async start() {
          if (!(await requestCameraPermission())) {
            throw new Error("Camera permission was denied.");
          }

          const availability = await checkAvailability();
          if (availability === "not-installed" || availability === "update-required") {
            if (!(await requestInstall())) {
              throw new Error("AR services are not available on this device.");
            }
          }
          if (availability === "unsupported") {
            throw new Error("AR world tracking is not supported on this device.");
          }

          if (!xrRef.current) {
            throw new Error("XR view is not ready yet.");
          }
          await xrRef.current.start();
        },
        pause() {
          xrRef.current?.pause();
        },
        async reset() {
          originRef.current = undefined;
          session.clearCalibration();
          if (xrRef.current) {
            await xrRef.current.reset();
          }
        },
        async captureOrigin() {
          const point = await hitCenter(xrRef.current);
          originRef.current = point;
          return point;
        },
        async captureForward() {
          const origin = originRef.current;
          if (!origin) {
            throw new Error("Capture the room origin first.");
          }
          const forward = await hitCenter(xrRef.current);
          const calibration = createRoomCalibration(origin, forward);
          session.setCalibration(calibration);
          return calibration;
        },
        clearCalibration() {
          originRef.current = undefined;
          session.clearCalibration();
        },
      }),
      [session],
    );

    return (
      <XRView
        {...viewProps}
        depthEnabled={depthEnabled}
        frameCallbackFps={frameCallbackFps}
        hybridRef={hybridRef}
        lightEstimationEnabled={lightEstimationEnabled}
        onError={errorHandler}
        onFrame={frameHandler}
        onTrackingStateChange={trackingHandler}
        planeDetection={planeDetection}
      />
    );
  },
);

async function hitCenter(xrRef: XRViewRef | null): Promise<Vector3> {
  if (!xrRef) {
    throw new Error("XR view is not ready yet.");
  }

  const hits = await xrRef.hitTest(0.5, 0.5);
  const first = hits[0];
  if (!first) {
    throw new Error("No surface found under the center crosshair.");
  }

  return { ...first.pose.position };
}
