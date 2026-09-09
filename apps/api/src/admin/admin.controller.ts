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
  ActivateAdminInvitationDto,
  AdminLoginDto,
  AdminOwnerQueryDto,
  AdminReasonDto,
  AdminUserQueryDto,
  ChangeUserStatusDto,
  CreateAdminStaffDto,
  AdminStaffQueryDto,
  UpdateAdminStaffDto,
} from './admin.dto';
import { AdminService } from './admin.service';
import { AdminStaffService } from './admin-staff.service';

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
    private readonly staff: AdminStaffService,
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
    let adminIdentity;
    try {
      adminIdentity = await this.staff.completeLogin(result.user.id);
    } catch {
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
    return { ...safeResult, admin: adminIdentity };
  }

  @HttpCode(HttpStatus.OK)
  @Post('auth/activate')
  activate(@Body() input: ActivateAdminInvitationDto, @Req() request: Request) {
    return this.staff.activate(input.token, input.password, requestMetadata(request));
  }

  @ApiBearerAuth()
  @Get('auth/me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentPrincipal() actor: RequestPrincipal) {
    return this.staff.me(actor.adminUserId!);
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('auth/logout')
  @UseGuards(AccessTokenGuard)
  async logout(
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(actor.sessionId, requestMetadata(request));
    response.clearCookie(
      this.configuration.getOrThrow('ADMIN_REFRESH_COOKIE_NAME', { infer: true }),
      {
        httpOnly: true,
        sameSite: 'strict',
        secure: this.configuration.getOrThrow('COOKIE_SECURE', { infer: true }),
      },
    );
  }

  @ApiBearerAuth()
  @Get('staff/permissions')
  @RequirePermissions('staff.view')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  staffPermissions() {
    return this.staff.permissions();
  }

  @ApiBearerAuth()
  @Get('staff')
  @RequirePermissions('staff.view')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  staffList(@Query() query: AdminStaffQueryDto) {
    return this.staff.list(query);
  }

  @ApiBearerAuth()
  @Post('staff')
  @RequirePermissions('staff.create')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  createStaff(
    @Body() input: CreateAdminStaffDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.staff.create(input, actor, requestMetadata(request));
  }

  @ApiBearerAuth()
  @Get('staff/:id')
  @RequirePermissions('staff.view')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  staffDetail(@Param('id') id: string) {
    return this.staff.detail(id);
  }

  @ApiBearerAuth()
  @Get('staff/:id/local-invitation')
  @RequirePermissions('staff.create')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  localStaffInvitation(@Param('id') id: string, @CurrentPrincipal() actor: RequestPrincipal) {
    return this.staff.localInvitationLink(id, actor);
  }

  @ApiBearerAuth()
  @Patch('staff/:id')
  @RequirePermissions('staff.edit', 'staff.permissions.manage')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  updateStaff(
    @Param('id') id: string,
    @Body() input: UpdateAdminStaffDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.staff.update(id, input, actor, requestMetadata(request));
  }

  @ApiBearerAuth()
  @Post('staff/:id/suspend')
  @RequirePermissions('staff.suspend')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  suspendStaff(
    @Param('id') id: string,
    @Body() input: AdminReasonDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.staff.suspend(id, input.reason, actor, requestMetadata(request));
  }

  @ApiBearerAuth()
  @Post('staff/:id/reactivate')
  @RequirePermissions('staff.suspend')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  reactivateStaff(
    @Param('id') id: string,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.staff.reactivate(id, actor, requestMetadata(request));
  }

  @ApiBearerAuth()
  @Post('staff/:id/disable')
  @RequirePermissions('staff.disable')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  disableStaff(
    @Param('id') id: string,
    @Body() input: AdminReasonDto,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.staff.disable(id, input.reason, actor, requestMetadata(request));
  }

  @ApiBearerAuth()
  @Post('staff/:id/resend-invite')
  @RequirePermissions('staff.create')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  resendStaffInvite(
    @Param('id') id: string,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.staff.resendInvitation(id, actor, requestMetadata(request));
  }

  @ApiBearerAuth()
  @Post('staff/:id/revoke-invite')
  @RequirePermissions('staff.create')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  revokeStaffInvite(
    @Param('id') id: string,
    @CurrentPrincipal() actor: RequestPrincipal,
    @Req() request: Request,
  ) {
    return this.staff.revokeInvitation(id, actor, requestMetadata(request));
  }

  @ApiBearerAuth()
  @Get('audit')
  @RequirePermissions('audit.read')
  @UseGuards(AccessTokenGuard, PolicyGuard)
  adminAudit(
    @Query('actorAdminId') actorAdminId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
  ) {
    return this.staff.auditLogs({
      ...(actorAdminId ? { actorAdminId } : {}),
      ...(action ? { action } : {}),
      ...(entityType ? { entityType } : {}),
    });
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
