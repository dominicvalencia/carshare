import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { RoleCode } from '@carrental/database';
import { IdentityErrorCode } from '@carrental/api-contracts';
import type { ApiEnvironment } from '@carrental/config';
import { AuthService } from '../auth/auth.service';
import { requestMetadata } from '../auth/auth.controller';
import { ApplicationException } from '../common/errors/application.exception';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import {
  CurrentPrincipal,
  RequirePermissions,
  RequireRoles,
} from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';
import type { RequestPrincipal } from '../security/security-context';
import { SecurityEventService } from '../security/security-event.service';
import {
  AdminLoginDto,
  AdminOwnerQueryDto,
  AdminReasonDto,
  AdminUserQueryDto,
  ChangeUserStatusDto,
} from './admin.dto';
import { AdminService } from './admin.service';

const ADMIN_ROLES: readonly RoleCode[] = [
  RoleCode.ADMIN,
  RoleCode.SUPER_ADMIN,
  RoleCode.SUPPORT,
  RoleCode.FINANCE_ADMIN,
];

@ApiTags('Administration')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly auth: AuthService,
    private readonly events: SecurityEventService,
    private readonly configuration: ConfigService<ApiEnvironment, true>,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('auth/login')
  async login(
    @Body() input: AdminLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(input, requestMetadata(request));
    if (!result.user.roles.some((role) => ADMIN_ROLES.includes(role))) {
      await this.auth.logout(result.sessionId, requestMetadata(request));
      throw new ApplicationException(
        IdentityErrorCode.PERMISSION_DENIED,
        'Administrative access is required.',
        HttpStatus.FORBIDDEN,
      );
    }
    response.cookie(
      this.configuration.getOrThrow('ADMIN_REFRESH_COOKIE_NAME', { infer: true }),
      result.refreshToken,
      {
        httpOnly: true,
        maxAge:
          this.configuration.getOrThrow('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 86_400_000,
        sameSite: 'strict',
        secure: this.configuration.getOrThrow('COOKIE_SECURE', { infer: true }),
      },
    );
    await this.events.record('ADMIN_LOGIN', {
      ...requestMetadata(request),
      sessionId: result.sessionId,
      userId: result.user.id,
    });
    const { refreshToken: _secret, ...safeResult } = result;
    return safeResult;
  }

  @ApiBearerAuth()
  @Get('users')
  @RequirePermissions('users.read')
  @RequireRoles(...ADMIN_ROLES)
  @UseGuards(AccessTokenGuard, PolicyGuard)
  users(@Query() query: AdminUserQueryDto) {
    return this.admin.listUsers(query.query);
  }

  @ApiBearerAuth()
  @Get('users/:id')
  @RequirePermissions('users.read')
  @RequireRoles(...ADMIN_ROLES)
  @UseGuards(AccessTokenGuard, PolicyGuard)
  user(@Param('id') id: string) {
    return this.admin.user(id);
  }

  @ApiBearerAuth()
  @Patch('users/:id/status')
  @RequirePermissions('users.suspend')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  userStatus(
    @Param('id') id: string,
    @Body() input: ChangeUserStatusDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.admin.changeUserStatus(
      id,
      input.status,
      input.reason,
      actor.userId,
      requestMetadata(request),
    );
  }

  @ApiBearerAuth()
  @Get('owners')
  @RequirePermissions('owners.read')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  owners(@Query() query: AdminOwnerQueryDto) {
    return this.admin.listOwners(query.status);
  }

  @ApiBearerAuth()
  @Get('owners/:id')
  @RequirePermissions('owners.read')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  owner(@Param('id') id: string) {
    return this.admin.owner(id);
  }

  @ApiBearerAuth()
  @Post('owners/:id/approval')
  @RequirePermissions('owners.verify')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  approve(
    @Param('id') id: string,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.admin.approveOwner(id, actor.userId, requestMetadata(request));
  }

  @ApiBearerAuth()
  @Post('owners/:id/rejection')
  @RequirePermissions('owners.verify')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  reject(
    @Param('id') id: string,
    @Body() input: AdminReasonDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.admin.rejectOwner(id, input.reason, actor.userId, requestMetadata(request));
  }

  @ApiBearerAuth()
  @Post('owners/:id/suspension')
  @RequirePermissions('owners.suspend')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  suspend(
    @Param('id') id: string,
    @Body() input: AdminReasonDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.admin.suspendOwner(id, input.reason, actor.userId, requestMetadata(request));
  }

  @ApiBearerAuth()
  @Get('audit-logs')
  @RequirePermissions('audit.read')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  auditLogs() {
    return this.admin.auditLogs();
  }
}
