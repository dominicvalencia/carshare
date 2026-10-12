import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { OwnerAccessGuard } from '../owner-access/owner-access.guard';
import type { RequestPrincipal } from '../security/security-context';
import {
  AcceptOwnerStaffInvitationDto,
  BeginOwnerStaffSetupDto,
  CompleteOwnerStaffSetupDto,
  CompleteStaffPasswordResetDto,
  InviteOwnerStaffDto,
  OwnerStaffQueryDto,
  OwnerStaffReasonDto,
  StaffAccessLoginDto,
  RequestStaffPasswordResetDto,
  VerifyStaffPasswordResetDto,
  PreviewOwnerStaffInvitationDto,
  VerifyOwnerStaffInvitationMobileDto,
  UpdateOwnerStaffDto,
  UpdateOwnerStaffPermissionsDto,
  UpdateOwnerStaffScopeDto,
} from './owner-staff.dto';
import { OwnerStaffService } from './owner-staff.service';

@ApiBearerAuth()
@ApiTags('Owner Staff')
@Controller('owner/workspaces/:ownerProfileId/staff')
@UseGuards(AccessTokenGuard, OwnerAccessGuard)
export class OwnerStaffController {
  constructor(private readonly staff: OwnerStaffService) {}

  @Get()
  list(@CurrentPrincipal() actor: RequestPrincipal, @Query() query: OwnerStaffQueryDto) {
    return this.staff.list(actor.ownerAccess!, query);
  }

  @Post('invitations')
  invite(
    @CurrentPrincipal() actor: RequestPrincipal,
    @Body() input: InviteOwnerStaffDto,
    @Req() request: Request,
  ) {
    return this.staff.invite(actor.ownerAccess!, actor.userId, input, requestMetadata(request));
  }

  @Get(':membershipId')
  detail(@CurrentPrincipal() actor: RequestPrincipal, @Param('membershipId') membershipId: string) {
    return this.staff.detail(actor.ownerAccess!, membershipId);
  }

  @Patch(':membershipId')
  update(
    @CurrentPrincipal() actor: RequestPrincipal,
    @Param('membershipId') membershipId: string,
    @Body() input: UpdateOwnerStaffDto,
    @Req() request: Request,
  ) {
    return this.staff.updateDisplayName(
      actor.ownerAccess!,
      actor.userId,
      membershipId,
      input.displayName,
      requestMetadata(request),
    );
  }

  @Put(':membershipId/permissions')
  permissions(
    @CurrentPrincipal() actor: RequestPrincipal,
    @Param('membershipId') membershipId: string,
    @Body() input: UpdateOwnerStaffPermissionsDto,
    @Req() request: Request,
  ) {
    return this.staff.updatePermissions(
      actor.ownerAccess!,
      actor.userId,
      membershipId,
      input.permissions,
      requestMetadata(request),
    );
  }

  @Put(':membershipId/vehicle-scope')
  scope(
    @CurrentPrincipal() actor: RequestPrincipal,
    @Param('membershipId') membershipId: string,
    @Body() input: UpdateOwnerStaffScopeDto,
    @Req() request: Request,
  ) {
    return this.staff.updateScope(
      actor.ownerAccess!,
      actor.userId,
      membershipId,
      input,
      requestMetadata(request),
    );
  }

  @Post(':membershipId/suspend')
  suspend(
    @CurrentPrincipal() actor: RequestPrincipal,
    @Param('membershipId') membershipId: string,
    @Body() input: OwnerStaffReasonDto,
    @Req() request: Request,
  ) {
    return this.staff.suspend(
      actor.ownerAccess!,
      actor.userId,
      membershipId,
      input.reason,
      requestMetadata(request),
    );
  }

  @Post(':membershipId/reactivate')
  reactivate(
    @CurrentPrincipal() actor: RequestPrincipal,
    @Param('membershipId') membershipId: string,
    @Req() request: Request,
  ) {
    return this.staff.reactivate(
      actor.ownerAccess!,
      actor.userId,
      membershipId,
      requestMetadata(request),
    );
  }

  @Post(':membershipId/disable')
  disable(
    @CurrentPrincipal() actor: RequestPrincipal,
    @Param('membershipId') membershipId: string,
    @Body() input: OwnerStaffReasonDto,
    @Req() request: Request,
  ) {
    return this.staff.disable(
      actor.ownerAccess!,
      actor.userId,
      membershipId,
      input.reason,
      requestMetadata(request),
    );
  }

  @Post(':membershipId/invitation/reissue')
  reissue(
    @CurrentPrincipal() actor: RequestPrincipal,
    @Param('membershipId') membershipId: string,
    @Req() request: Request,
  ) {
    return this.staff.reissueInvitation(
      actor.ownerAccess!,
      actor.userId,
      membershipId,
      requestMetadata(request),
    );
  }

  @Post(':membershipId/invitation/revoke')
  revoke(
    @CurrentPrincipal() actor: RequestPrincipal,
    @Param('membershipId') membershipId: string,
    @Req() request: Request,
  ) {
    return this.staff.revokeInvitation(
      actor.ownerAccess!,
      actor.userId,
      membershipId,
      requestMetadata(request),
    );
  }
}

@ApiBearerAuth()
@ApiTags('Owner Staff Access')
@Controller('owner/workspaces/:ownerProfileId/staff-access-link')
@UseGuards(AccessTokenGuard, OwnerAccessGuard)
export class OwnerStaffAccessLinkController {
  constructor(private readonly staff: OwnerStaffService) {}

  @Get()
  accessLink(@CurrentPrincipal() actor: RequestPrincipal, @Req() request: Request) {
    return this.staff.staffAccessLink(actor.ownerAccess!, actor.userId, requestMetadata(request));
  }

  @Post('regenerate')
  regenerateAccessLink(@CurrentPrincipal() actor: RequestPrincipal, @Req() request: Request) {
    return this.staff.regenerateStaffAccessLink(
      actor.ownerAccess!,
      actor.userId,
      requestMetadata(request),
    );
  }
}

@ApiBearerAuth()
@ApiTags('Owner Staff Invitations')
@Controller('owner/staff-invitations')
export class OwnerStaffInvitationController {
  constructor(private readonly staff: OwnerStaffService) {}

  @Get('preview')
  preview(@Query() input: PreviewOwnerStaffInvitationDto) {
    return this.staff.previewInvitation(input.token);
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post('setup')
  beginSetup(@Body() input: BeginOwnerStaffSetupDto, @Req() request: Request) {
    return this.staff.beginInvitationSetup(input, requestMetadata(request));
  }

  @HttpCode(HttpStatus.OK)
  @Post('setup/complete')
  completeSetup(@Body() input: CompleteOwnerStaffSetupDto, @Req() request: Request) {
    return this.staff.completeInvitationSetup(input, requestMetadata(request));
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post('mobile-verification/requests')
  @UseGuards(AccessTokenGuard)
  requestMobileVerification(
    @CurrentPrincipal() actor: RequestPrincipal,
    @Body() input: VerifyOwnerStaffInvitationMobileDto,
    @Req() request: Request,
  ) {
    return this.staff.requestInvitationMobileVerification(
      input.token,
      actor.userId,
      input,
      requestMetadata(request),
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('accept')
  @UseGuards(AccessTokenGuard)
  accept(
    @CurrentPrincipal() actor: RequestPrincipal,
    @Body() input: AcceptOwnerStaffInvitationDto,
    @Req() request: Request,
  ) {
    return this.staff.acceptInvitation(input.token, actor.userId, requestMetadata(request));
  }
}

@ApiTags('Owner Staff Access')
@Controller('owner/staff-access')
export class OwnerStaffAccessController {
  constructor(private readonly staff: OwnerStaffService) {}

  @Get(':handle')
  resolve(@Param('handle') handle: string, @Req() request: Request) {
    return this.staff.resolveStaffAccessLink(handle, requestMetadata(request));
  }

  @HttpCode(HttpStatus.OK)
  @Post(':handle/login')
  login(
    @Param('handle') handle: string,
    @Body() input: StaffAccessLoginDto,
    @Req() request: Request,
  ) {
    return this.staff.loginStaffAccess(handle, input, requestMetadata(request));
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post(':handle/password-reset/requests')
  requestPasswordReset(
    @Param('handle') handle: string,
    @Body() input: RequestStaffPasswordResetDto,
    @Req() request: Request,
  ) {
    return this.staff.requestStaffPasswordReset(
      handle,
      input.mobileNumber,
      requestMetadata(request),
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post(':handle/password-reset/verify')
  verifyPasswordReset(
    @Param('handle') handle: string,
    @Body() input: VerifyStaffPasswordResetDto,
    @Req() request: Request,
  ) {
    return this.staff.verifyStaffPasswordReset(handle, input, requestMetadata(request));
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':handle/password-reset/complete')
  completePasswordReset(
    @Param('handle') handle: string,
    @Body() input: CompleteStaffPasswordResetDto,
    @Req() request: Request,
  ) {
    return this.staff.completeStaffPasswordReset(handle, input, requestMetadata(request));
  }

  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Post(':handle/authorize')
  @UseGuards(AccessTokenGuard)
  authorize(
    @CurrentPrincipal() actor: RequestPrincipal,
    @Param('handle') handle: string,
    @Req() request: Request,
  ) {
    return this.staff.authorizeStaffAccessLink(handle, actor.userId, requestMetadata(request));
  }
}
