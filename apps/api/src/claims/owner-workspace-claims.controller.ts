import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { RequireOwnerPermission } from '../owner-access/owner-access.decorator';
import { OwnerAccessGuard } from '../owner-access/owner-access.guard';
import { OwnerAccessService } from '../owner-access/owner-access.service';
import type { OwnerPermissionCode } from '../owner-access/owner-permissions';
import type { RequestPrincipal } from '../security/security-context';
import { AddClaimEvidenceDto, ClaimListQueryDto, CreatePostReturnClaimDto } from './claims.dto';
import { ClaimsService } from './claims.service';

@Controller('owner/workspaces/:ownerProfileId')
@UseGuards(AccessTokenGuard, OwnerAccessGuard)
export class OwnerWorkspaceClaimsController {
  constructor(
    private readonly claims: ClaimsService,
    private readonly ownerAccess: OwnerAccessService,
  ) {}

  @Get('claims')
  @RequireOwnerPermission('claims.view')
  list(@CurrentPrincipal() principal: RequestPrincipal, @Query() query: ClaimListQueryDto) {
    return this.claims.ownerClaimsForAccess(principal.ownerAccess!, query);
  }

  @Get('claims/:id')
  @RequireOwnerPermission('claims.view')
  detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('id') id: string) {
    return this.claims.ownerClaimForAccess(principal.ownerAccess!, id);
  }

  @Post('bookings/:reference/claims')
  @RequireOwnerPermission('claims.create')
  async create(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: CreatePostReturnClaimDto,
    @Req() request: Request,
  ) {
    const authority = await this.ownerAccess.assertBookingAccess(
      principal.ownerAccess!,
      reference,
      'claims.create',
    );
    const result = await this.claims.createOwnerClaim(
      authority.ownerUserId,
      reference,
      input,
      requestMetadata(request),
      { actorUserId: principal.userId, ownerUserId: authority.ownerUserId },
    );
    await this.audit(principal, request, 'claims.create', result.id, authority.vehicleId);
    return result;
  }

  @Post('claims/:id/evidence')
  @RequireOwnerPermission('claims.respond')
  async evidence(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: AddClaimEvidenceDto,
    @Req() request: Request,
  ) {
    const authority = await this.ownerAccess.assertClaimAccess(
      principal.ownerAccess!,
      id,
      'claims.respond',
    );
    const result = await this.claims.addOwnerEvidenceForAccess(
      principal.ownerAccess!,
      principal.userId,
      id,
      input,
    );
    await this.audit(principal, request, 'claims.respond', id, authority.vehicleId);
    return result;
  }

  private audit(
    principal: RequestPrincipal,
    request: Request,
    permission: OwnerPermissionCode,
    claimId: string,
    vehicleId: string,
  ) {
    return this.ownerAccess.auditDelegatedAction({
      action: permission === 'claims.create' ? 'POST_RETURN_CLAIM_CREATED' : 'CLAIM_EVIDENCE_ADDED',
      actorUserId: principal.userId,
      context: principal.ownerAccess!,
      permission,
      request: requestMetadata(request),
      targetId: claimId,
      targetType: 'POST_RETURN_CLAIM',
      vehicleId,
    });
  }
}
