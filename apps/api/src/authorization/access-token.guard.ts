import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { IdentityErrorCode } from '@carrental/api-contracts';
import { AdminStatus, UserStatus } from '@carrental/database';
import { effectiveAdminPermissions } from '../admin/admin-permissions';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import { TokenService } from '../auth/token.service';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw this.unauthorized();

    try {
      const claims = await this.tokens.verifyAccessToken(token);
      const session = await this.database.client.session.findUnique({
        where: { id: claims.sessionId },
        include: {
          user: {
            include: {
              adminIdentity: {
                include: { permissions: { include: { permission: true } } },
              },
              roles: {
                include: {
                  role: { include: { permissions: { include: { permission: true } } } },
                },
              },
            },
          },
        },
      });
      if (
        !session ||
        session.userId !== claims.sub ||
        session.revokedAt ||
        session.expiresAt <= new Date()
      ) {
        throw new ApplicationException(
          IdentityErrorCode.SESSION_REVOKED,
          'The session is no longer active.',
          HttpStatus.UNAUTHORIZED,
        );
      }
      this.assertActive(session.user.status);
      const requiresAdministrativeIdentity = /(?:^|\/)admin(?:\/|$)/u.test(request.path);
      if (requiresAdministrativeIdentity && !session.user.adminIdentity)
        throw new ApplicationException(
          IdentityErrorCode.PERMISSION_DENIED,
          'Administrative access is required.',
          HttpStatus.FORBIDDEN,
        );
      if (session.user.adminIdentity) this.assertAdminActive(session.user.adminIdentity.status);
      const rolePermissions = [
        ...new Set(
          session.user.roles.flatMap(({ role }) =>
            role.permissions.map(({ permission }) => permission.code),
          ),
        ),
      ];
      const admin = session.user.adminIdentity;
      request.principal = {
        permissions: admin
          ? effectiveAdminPermissions(
              admin.role,
              admin.permissions.map(({ permission }) => permission.code),
            )
          : rolePermissions,
        roles: session.user.roles.map(({ role }) => role.code),
        sessionId: session.id,
        status: session.user.status,
        userId: session.userId,
        ...(admin
          ? { adminRole: admin.role, adminStatus: admin.status, adminUserId: admin.id }
          : {}),
      };
      return true;
    } catch (error) {
      if (error instanceof ApplicationException) throw error;
      throw this.unauthorized();
    }
  }

  private assertAdminActive(status: AdminStatus): void {
    if (status === AdminStatus.ACTIVE) return;
    throw new ApplicationException(
      IdentityErrorCode.PERMISSION_DENIED,
      'Administrative access is unavailable.',
      HttpStatus.FORBIDDEN,
    );
  }

  private assertActive(status: UserStatus): void {
    const statusErrors = {
      BLOCKED: [IdentityErrorCode.ACCOUNT_BLOCKED, 'This account is blocked.'],
      DEACTIVATED: [IdentityErrorCode.ACCOUNT_DEACTIVATED, 'This account is deactivated.'],
      SUSPENDED: [IdentityErrorCode.ACCOUNT_SUSPENDED, 'This account is suspended.'],
    } as const;
    if (status === UserStatus.ACTIVE) return;
    const [code, message] = statusErrors[status];
    throw new ApplicationException(code, message, HttpStatus.FORBIDDEN);
  }

  private unauthorized(): ApplicationException {
    return new ApplicationException(
      IdentityErrorCode.INVALID_ACCESS_TOKEN,
      'Authentication is required.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
