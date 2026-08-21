import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { DatabaseService } from '../infrastructure/database/database.service';
import { SecurityEventService } from '../security/security-event.service';
import type { RequestPrincipal } from '../security/security-context';
import { requestMetadata } from '../auth/auth.controller';

@ApiBearerAuth()
@ApiTags('Sessions')
@Controller('sessions')
@UseGuards(AccessTokenGuard)
export class SessionsController {
  constructor(
    private readonly database: DatabaseService,
    private readonly events: SecurityEventService,
  ) {}

  @Get()
  list(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.database.client.session.findMany({
      orderBy: { lastUsedAt: 'desc' },
      select: {
        appVersion: true,
        createdAt: true,
        deviceIdentifier: true,
        deviceName: true,
        expiresAt: true,
        id: true,
        lastUsedAt: true,
        platform: true,
        revokedAt: true,
        revocationReason: true,
      },
      where: { userId: principal.userId },
    });
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('sessionId') sessionId: string,
    @Req() request: Request,
  ): Promise<void> {
    const session = await this.database.client.session.findFirstOrThrow({
      where: { id: sessionId, userId: principal.userId },
    });
    await this.revokeWhere({ id: session.id });
    await this.events.record('SESSION_REVOKED', {
      ...requestMetadata(request),
      sessionId,
      userId: principal.userId,
    });
  }

  @Post('logout-others')
  @HttpCode(HttpStatus.NO_CONTENT)
  logoutOthers(@CurrentPrincipal() principal: RequestPrincipal): Promise<void> {
    return this.revokeWhere({ id: { not: principal.sessionId }, userId: principal.userId });
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  logoutAll(@CurrentPrincipal() principal: RequestPrincipal): Promise<void> {
    return this.revokeWhere({ userId: principal.userId });
  }

  private async revokeWhere(where: {
    id?: string | { not: string };
    userId?: string;
  }): Promise<void> {
    const now = new Date();
    const sessions = await this.database.client.session.findMany({ select: { id: true }, where });
    const ids = sessions.map(({ id }) => id);
    if (!ids.length) return;
    await this.database.client.$transaction([
      this.database.client.session.updateMany({
        data: { revocationReason: 'USER_SESSION_MANAGEMENT', revokedAt: now },
        where: { id: { in: ids }, revokedAt: null },
      }),
      this.database.client.refreshToken.updateMany({
        data: { revokedAt: now },
        where: { revokedAt: null, sessionId: { in: ids } },
      }),
    ]);
  }
}
