import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { RoleCode } from '@carrental/database';
import { IdentityErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { REQUIRED_PERMISSIONS, REQUIRED_ROLES } from './authorization.decorator';

@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const principal = context.switchToHttp().getRequest<Request>().principal;
    if (!principal) return false;
    const roles = this.reflector.getAllAndOverride<RoleCode[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    const permissions = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles?.length && !roles.some((role) => principal.roles.includes(role))) {
      throw new ApplicationException(
        IdentityErrorCode.ROLE_REQUIRED,
        'The required role is not assigned.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (permissions?.length && !permissions.every((item) => principal.permissions.includes(item))) {
      throw new ApplicationException(
        IdentityErrorCode.PERMISSION_DENIED,
        'The required permission is not assigned.',
        HttpStatus.FORBIDDEN,
      );
    }
    return true;
  }
}
