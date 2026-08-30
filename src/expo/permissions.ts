import { PermissionsAndroid, Platform } from "react-native";

export async function requestNearbyPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") {
    return true;
  }

  const permissions = androidNearbyPermissions();
  if (permissions.length === 0) {
    return true;
  }

  const results = await PermissionsAndroid.requestMultiple(permissions);
  return permissions.every(
    (permission) => results[permission] === PermissionsAndroid.RESULTS.GRANTED,
  );
}

type AndroidPermission = Parameters<typeof PermissionsAndroid.requestMultiple>[0][number];

function androidNearbyPermissions(): AndroidPermission[] {
  const sdk = typeof Platform.Version === "number" ? Platform.Version : Number(Platform.Version);
  const permissions: AndroidPermission[] = [];

  if (sdk >= 31) {
    addIfDefined(permissions, PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
    addIfDefined(permissions, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
    addIfDefined(permissions, PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE);
  } else {
    addIfDefined(permissions, PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  }

  if (sdk >= 33) {
    addIfDefined(permissions, PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES);
  }

  return permissions;
}

function addIfDefined(
  permissions: AndroidPermission[],
  permission: AndroidPermission | undefined,
): void {
  if (permission) {
    permissions.push(permission);
  }
}
