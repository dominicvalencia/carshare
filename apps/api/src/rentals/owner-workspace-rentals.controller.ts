import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { InspectionType } from '@carrental/database';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { RequireOwnerPermission } from '../owner-access/owner-access.decorator';
import { OwnerAccessGuard } from '../owner-access/owner-access.guard';
import { OwnerAccessService } from '../owner-access/owner-access.service';
import type { OwnerPermissionCode } from '../owner-access/owner-permissions';
import type { OwnerAccessContext, RequestPrincipal } from '../security/security-context';
import {
  ConfirmVehicleReceiptDto,
  CreateIncidentDto,
  HandoverEvidenceWaiverDto,
  HandoverTravelTransitionDto,
  OverdueHandoverRecoveryDto,
  ReturnConfirmationDto,
  SubmitInspectionDto,
  UpsertInspectionDraftMediaDto,
  VerifyPickupDto,
} from './rentals.dto';
import { RentalsService } from './rentals.service';

@Controller('owner/workspaces/:ownerProfileId/rentals')
@UseGuards(AccessTokenGuard, OwnerAccessGuard)
export class OwnerWorkspaceRentalsController {
  constructor(
    private readonly rentals: RentalsService,
    private readonly ownerAccess: OwnerAccessService,
  ) {}

  @Get()
  @RequireOwnerPermission('rentals.view')
  list(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.rentals.listForOwnerAccess(principal.ownerAccess!);
  }

  @Get(':reference')
  @RequireOwnerPermission('rentals.view')
  detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('reference') reference: string) {
    return this.rentals.ownerDetailForAccess(principal.ownerAccess!, reference);
  }

  @Post(':reference/incidents')
  @RequireOwnerPermission('incidents.create')
  async reportIncident(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: CreateIncidentDto,
    @Req() request: Request,
  ) {
    const booking = await this.authority(principal.ownerAccess!, reference, 'incidents.create');
    const result = await this.rentals.reportIncident(
      booking.ownerUserId,
      reference,
      input,
      requestMetadata(request),
      { actorUserId: principal.userId, ownerUserId: booking.ownerUserId },
    );
    await this.audit(principal, request, reference, 'incidents.create', 'RENTAL_INCIDENT_REPORTED');
    return result;
  }

  @Get(':reference/pickup/inspection/draft')
  @RequireOwnerPermission('rentals.view')
  async pickupInspectionDraft(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
  ) {
    const booking = await this.inspectionAuthority(principal.ownerAccess!, reference);
    return this.rentals.ownerPickupInspectionDraft(
      booking.ownerUserId,
      reference,
      principal.userId,
    );
  }

  @Put(':reference/pickup/inspection/draft/media')
  @RequireOwnerPermission('rentals.view')
  async pickupInspectionDraftMedia(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: UpsertInspectionDraftMediaDto,
    @Req() request: Request,
  ) {
    const context = principal.ownerAccess!;
    const booking = await this.inspectionAuthority(context, reference);
    const result = await this.rentals.upsertOwnerPickupInspectionDraftMedia(
      booking.ownerUserId,
      reference,
      input,
      principal.userId,
    );
    await this.audit(
      principal,
      request,
      reference,
      'inspections.update',
      'PICKUP_INSPECTION_EVIDENCE_UPDATED',
    );
    return result;
  }

  @Post(':reference/pickup/inspection')
  @RequireOwnerPermission('rentals.view')
  async pickupInspection(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: SubmitInspectionDto,
    @Req() request: Request,
  ) {
    const context = principal.ownerAccess!;
    const booking = await this.inspectionAuthority(context, reference);
    const result = await this.rentals.submitInspection(
      principal.userId,
      reference,
      InspectionType.PICKUP,
      input,
      requestMetadata(request),
      { actorUserId: principal.userId, ownerUserId: booking.ownerUserId },
    );
    await this.audit(
      principal,
      request,
      reference,
      'inspections.update',
      'PICKUP_INSPECTION_SUBMITTED',
    );
    return result;
  }

  @Post(':reference/handover/travel')
  @RequireOwnerPermission('rentals.view')
  async transitionHandoverTravel(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: HandoverTravelTransitionDto,
    @Req() request: Request,
  ) {
    const permission = input.phase === 'START' ? 'handover.perform' : 'return.perform';
    const booking = await this.authority(principal.ownerAccess!, reference, permission);
    const result = await this.rentals.transitionHandoverTravel(
      booking.ownerUserId,
      reference,
      input,
      requestMetadata(request),
      principal.userId,
    );
    await this.audit(
      principal,
      request,
      reference,
      permission,
      `HANDOVER_${input.phase}_TRAVEL_UPDATED`,
    );
    return result;
  }

  @Post(':reference/pickup/verify')
  @RequireOwnerPermission('rentals.view')
  async verifyPickup(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: VerifyPickupDto,
    @Req() request: Request,
  ) {
    const booking = await this.authority(principal.ownerAccess!, reference, 'handover.perform');
    const result = await this.rentals.verifyPickup(
      booking.ownerUserId,
      reference,
      input.code,
      requestMetadata(request),
      principal.userId,
    );
    await this.audit(
      principal,
      request,
      reference,
      'handover.perform',
      'PICKUP_HANDOVER_COMPLETED',
    );
    return result;
  }

  @Post(':reference/return/start')
  @RequireOwnerPermission('rentals.view')
  async startReturn(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Req() request: Request,
  ) {
    const booking = await this.authority(principal.ownerAccess!, reference, 'return.perform');
    const result = await this.rentals.initiateReturn(
      principal.userId,
      reference,
      requestMetadata(request),
      { actorUserId: principal.userId, ownerUserId: booking.ownerUserId },
    );
    await this.audit(principal, request, reference, 'return.perform', 'RETURN_STARTED');
    return result;
  }

  @Post(':reference/return/confirm')
  @RequireOwnerPermission('rentals.view')
  async confirmReturn(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: ReturnConfirmationDto,
    @Req() request: Request,
  ) {
    const booking = await this.authority(principal.ownerAccess!, reference, 'return.perform');
    const result = await this.rentals.confirmReturn(
      principal.userId,
      reference,
      input,
      requestMetadata(request),
      { actorUserId: principal.userId, ownerUserId: booking.ownerUserId },
    );
    await this.audit(principal, request, reference, 'return.perform', 'RETURN_CONFIRMED');
    return result;
  }

  @Post(':reference/return/receipt')
  @RequireOwnerPermission('rentals.view')
  async receipt(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: ConfirmVehicleReceiptDto,
    @Req() request: Request,
  ) {
    const booking = await this.authority(principal.ownerAccess!, reference, 'return.perform');
    const result = await this.rentals.confirmVehicleReceipt(
      booking.ownerUserId,
      reference,
      input,
      requestMetadata(request),
      principal.userId,
    );
    await this.audit(principal, request, reference, 'return.perform', 'RETURN_RECEIPT_CONFIRMED');
    return result;
  }

  @Post(':reference/pickup/evidence-waiver')
  @RequireOwnerPermission('rentals.view')
  waiveStart(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: HandoverEvidenceWaiverDto,
    @Req() request: Request,
  ) {
    return this.waive(principal, request, reference, 'START', input);
  }

  @Post(':reference/return/evidence-waiver')
  @RequireOwnerPermission('rentals.view')
  waiveReturn(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: HandoverEvidenceWaiverDto,
    @Req() request: Request,
  ) {
    return this.waive(principal, request, reference, 'RETURN', input);
  }

  @Post(':reference/overdue-handover-recovery')
  @RequireOwnerPermission('rentals.view')
  async overdueRecovery(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: OverdueHandoverRecoveryDto,
    @Req() request: Request,
  ) {
    const permissions: OwnerPermissionCode[] =
      input.scope === 'BOTH'
        ? ['handover.perform', 'return.perform']
        : [input.scope === 'START' ? 'handover.perform' : 'return.perform'];
    let booking: Awaited<ReturnType<OwnerAccessService['assertBookingAccess']>> | undefined;
    for (const permission of permissions)
      booking = await this.authority(principal.ownerAccess!, reference, permission);
    const result = await this.rentals.reportOverdueHandoverRecovery(
      booking!.ownerUserId,
      reference,
      input,
      requestMetadata(request),
      principal.userId,
    );
    await Promise.all(
      permissions.map((permission) =>
        this.audit(
          principal,
          request,
          reference,
          permission,
          `OVERDUE_HANDOVER_RECOVERY_${input.scope}_REPORTED`,
        ),
      ),
    );
    return result;
  }

  private async waive(
    principal: RequestPrincipal,
    request: Request,
    reference: string,
    phase: 'START' | 'RETURN',
    input: HandoverEvidenceWaiverDto,
  ) {
    const permission = phase === 'START' ? 'handover.perform' : 'return.perform';
    const booking = await this.authority(principal.ownerAccess!, reference, permission);
    const result = await this.rentals.waiveEvidence(
      principal.userId,
      reference,
      phase,
      input,
      requestMetadata(request),
      { actorUserId: principal.userId, ownerUserId: booking.ownerUserId },
    );
    await this.audit(
      principal,
      request,
      reference,
      permission,
      `${phase}_INSPECTION_EVIDENCE_WAIVED`,
    );
    return result;
  }

  private async authority(
    context: OwnerAccessContext,
    reference: string,
    permission: OwnerPermissionCode,
  ) {
    return this.ownerAccess.assertBookingAccess(context, reference, permission);
  }

  private async inspectionAuthority(context: OwnerAccessContext, reference: string) {
    this.ownerAccess.requirePermission(context, 'inspections.create');
    return this.ownerAccess.assertBookingAccess(context, reference, 'inspections.update');
  }

  private async audit(
    principal: RequestPrincipal,
    request: Request,
    reference: string,
    permission: OwnerPermissionCode,
    action: string,
  ) {
    const booking = await this.ownerAccess.assertBookingAccess(
      principal.ownerAccess!,
      reference,
      permission,
    );
    return this.ownerAccess.auditDelegatedAction({
      action,
      actorUserId: principal.userId,
      context: principal.ownerAccess!,
      permission,
      request: requestMetadata(request),
      targetId: reference,
      targetType: 'RENTAL',
      vehicleId: booking.vehicleId,
    });
  }
}
