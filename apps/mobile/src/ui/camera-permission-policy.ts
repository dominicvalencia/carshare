export type CameraPermissionAction = 'allow' | 'request' | 'settings';

export function cameraPermissionAction(permission: {
  readonly granted: boolean;
  readonly canAskAgain?: boolean;
}): CameraPermissionAction {
  if (permission.granted) return 'allow';
  return permission.canAskAgain === false ? 'settings' : 'request';
}
