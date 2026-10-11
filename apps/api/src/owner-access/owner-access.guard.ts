import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { OwnerAccessService } from './owner-access.service';
import { REQUIRED_OWNER_PERMISSION } from './owner-access.decorator';
import type { OwnerPermissionCode } from './owner-permissions';

@Injectable()
export class OwnerAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: OwnerAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const principal = request.principal;
    const rawOwnerProfileId = request.params.ownerProfileId;
    const ownerProfileId = Array.isArray(rawOwnerProfileId)
      ? rawOwnerProfileId[0]
      : rawOwnerProfileId;
    if (!principal || !ownerProfileId) return false;
    const ownerAccess = await this.access.resolve(principal.userId, ownerProfileId);
    const permission = this.reflector.getAllAndOverride<OwnerPermissionCode>(
      REQUIRED_OWNER_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (permission) this.access.requirePermission(ownerAccess, permission);
    request.principal = { ...principal, ownerAccess };
    return true;
  }
}
