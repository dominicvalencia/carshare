import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { IdentityErrorCode } from '@carrental/api-contracts';
import { AdminRole } from '@carrental/database';
import { ApplicationException } from '../common/errors/application.exception';

@Injectable()
export class OwnerOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const principal = context.switchToHttp().getRequest<Request>().principal;
    if (principal?.adminRole === AdminRole.OWNER) return true;
    throw new ApplicationException(
      IdentityErrorCode.PERMISSION_DENIED,
      'Business-owner analytics access is required.',
      HttpStatus.FORBIDDEN,
    );
  }
}
