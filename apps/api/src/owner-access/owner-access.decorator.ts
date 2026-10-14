import { SetMetadata } from '@nestjs/common';
import type { OwnerPermissionCode } from './owner-permissions';

export const REQUIRED_OWNER_PERMISSION = 'required_owner_permission';
export const REQUIRED_ANY_OWNER_PERMISSION = 'required_any_owner_permission';

export const RequireOwnerPermission = (permission: OwnerPermissionCode) =>
  SetMetadata(REQUIRED_OWNER_PERMISSION, permission);

export const RequireAnyOwnerPermission = (...permissions: OwnerPermissionCode[]) =>
  SetMetadata(REQUIRED_ANY_OWNER_PERMISSION, permissions);
