import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { InspectionType, RoleCode } from '@carrental/database';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import {
  CurrentPrincipal,
  RequirePermissions,
  RequireRoles,
} from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';
import type { RequestPrincipal } from '../security/security-context';
import { ClaimsService } from '../claims/claims.service';
import {
  CreateClaimDto,
  AdminHandoverResolutionDto,
  AdminInspectionCorrectionQueryDto,
  CreateIncidentDto,
  IncidentStatusDto,
  OperationalHoldDto,
  RequestInspectionCorrectionDto,
  ReviewInspectionCorrectionDto,
  ReturnConfirmationDto,
  SubmitInspectionDto,
  UpsertInspectionDraftMediaDto,
  VerifyPickupDto,
} from './rentals.dto';
import { RentalsService } from './rentals.service';

@ApiBearerAuth()
@ApiTags('Renter rental operations')
@Controller('bookings/:reference/rental')
@RequireRoles(RoleCode.RENTER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class RenterRentalsController {
  constructor(private readonly rentals: RentalsService) {}

  @Get()
  detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('reference') reference: string) {
    return this.rentals.participantDetail(principal, reference);
  }

  @Post('pickup/confirm')
  confirmPickup(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Req() request: Request,
  ) {
    return this.rentals.issuePickupCode(principal.userId, reference, requestMetadata(request));
  }

  @Post('return/start')
  startReturn(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Req() request: Request,
  ) {
    return this.rentals.initiateReturn(principal.userId, reference, requestMetadata(request));
  }

  @Post('return/inspection')
  returnInspection(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: SubmitInspectionDto,
    @Req() request: Request,
  ) {
    return this.rentals.submitInspection(
      principal.userId,
      reference,
      InspectionType.RETURN,
      input,
      requestMetadata(request),
    );
  }

  @Post('return/confirm')
  confirmReturn(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: ReturnConfirmationDto,
    @Req() request: Request,
  ) {
    return this.rentals.confirmReturn(principal.userId, reference, input, requestMetadata(request));
  }

  @Post('incidents')
  incident(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: CreateIncidentDto,
    @Req() request: Request,
  ) {
    return this.rentals.reportIncident(
      principal.userId,
      reference,
      input,
      requestMetadata(request),
    );
  }
}

@ApiBearerAuth()
@ApiTags('Owner rental operations')
@Controller('owner/bookings/:reference/rental')
@RequireRoles(RoleCode.OWNER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class OwnerRentalsController {
  constructor(
    private readonly rentals: RentalsService,
    private readonly claims: ClaimsService,
  ) {}

  @Get()
  detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('reference') reference: string) {
    return this.rentals.ownerDetail(principal, reference);
  }

  @Get('pickup/inspection/draft')
  pickupInspectionDraft(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
  ) {
    return this.rentals.ownerPickupInspectionDraft(principal.userId, reference);
  }

  @Put('pickup/inspection/draft/media')
  pickupInspectionDraftMedia(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: UpsertInspectionDraftMediaDto,
  ) {
    return this.rentals.upsertOwnerPickupInspectionDraftMedia(principal.userId, reference, input);
  }

  @Post('pickup/inspection')
  pickupInspection(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: SubmitInspectionDto,
    @Req() request: Request,
  ) {
    return this.rentals.submitInspection(
      principal.userId,
      reference,
      InspectionType.PICKUP,
      input,
      requestMetadata(request),
    );
  }

  @Post('pickup/verify')
  verifyPickup(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: VerifyPickupDto,
    @Req() request: Request,
  ) {
    return this.rentals.verifyPickup(
      principal.userId,
      reference,
      input.code,
      requestMetadata(request),
    );
  }

  @Post('return/start')
  startReturn(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Req() request: Request,
  ) {
    return this.rentals.initiateReturn(principal.userId, reference, requestMetadata(request));
  }

  @Post('return/inspection')
  returnInspection(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: SubmitInspectionDto,
    @Req() request: Request,
  ) {
    return this.rentals.submitInspection(
      principal.userId,
      reference,
      InspectionType.RETURN,
      input,
      requestMetadata(request),
    );
  }

  @Post('return/confirm')
  confirmReturn(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: ReturnConfirmationDto,
    @Req() request: Request,
  ) {
    return this.rentals.confirmReturn(principal.userId, reference, input, requestMetadata(request));
  }

  @Post('claims')
  claim(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: CreateClaimDto,
    @Req() request: Request,
  ) {
    return this.claims.createOwnerClaim(
      principal.userId,
      reference,
      {
        category: input.category,
        description: input.description,
        evidence: (input.evidenceFileIds ?? []).map((fileAssetId) => ({ fileAssetId })),
      },
      requestMetadata(request),
    );
  }

  @Post('incidents')
  incident(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: CreateIncidentDto,
    @Req() request: Request,
  ) {
    return this.rentals.reportIncident(
      principal.userId,
      reference,
      input,
      requestMetadata(request),
    );
  }

  @Post('inspections/:inspectionId/corrections')
  requestCorrection(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Param('inspectionId') inspectionId: string,
    @Body() input: RequestInspectionCorrectionDto,
    @Req() request: Request,
  ) {
    return this.rentals.requestInspectionCorrection(
      principal.userId,
      reference,
      inspectionId,
      input,
      requestMetadata(request),
    );
  }
}

@ApiBearerAuth()
@ApiTags('Admin rental operations')
@Controller('admin/rentals')
@RequirePermissions('rentals.read')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminRentalsController {
  constructor(private readonly rentals: RentalsService) {}

  @Get()
  queue() {
    return this.rentals.adminQueue();
  }

  @Get('inspection-corrections')
  corrections(@Query() query: AdminInspectionCorrectionQueryDto) {
    return this.rentals.adminInspectionCorrections(query.status);
  }

  @Get('inspection-corrections/:correctionId')
  correction(@Param('correctionId') correctionId: string) {
    return this.rentals.adminInspectionCorrection(correctionId);
  }

  @Get(':reference')
  detail(@Param('reference') reference: string) {
    return this.rentals.adminDetail(reference);
  }

  @Post(':reference/operational-hold')
  @RequirePermissions('rentals.intervene')
  hold(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: OperationalHoldDto,
    @Req() request: Request,
  ) {
    return this.rentals.setOperationalHold(principal, reference, input, requestMetadata(request));
  }

  @Post(':reference/handover-resolution')
  @RequirePermissions('rentals.intervene')
  resolveHandover(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: AdminHandoverResolutionDto,
    @Req() request: Request,
  ) {
    return this.rentals.adminResolveHandover(principal, reference, input, requestMetadata(request));
  }

  @Post('incidents/:incidentId/status')
  @RequirePermissions('incidents.manage')
  incidentStatus(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('incidentId') incidentId: string,
    @Body() input: IncidentStatusDto,
    @Req() request: Request,
  ) {
    return this.rentals.setIncidentStatus(principal, incidentId, input, requestMetadata(request));
  }

  @Post('inspection-corrections/:correctionId/review')
  @RequirePermissions('rentals.intervene')
  reviewCorrection(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('correctionId') correctionId: string,
    @Body() input: ReviewInspectionCorrectionDto,
    @Req() request: Request,
  ) {
    return this.rentals.reviewInspectionCorrection(
      principal,
      correctionId,
      input,
      requestMetadata(request),
    );
  }
}
