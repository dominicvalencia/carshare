import { createParamDecorator, SetMetadata, ExecutionContext } from '@nestjs/common';
import type { RoleCode } from '@carrental/database';
import type { Request } from 'express';

export const REQUIRED_ROLES = 'required_roles';
export const REQUIRED_PERMISSIONS = 'required_permissions';

export const RequireRoles = (...roles: RoleCode[]) => SetMetadata(REQUIRED_ROLES, roles);
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<Request>();
    return request.principal;
  },
);
