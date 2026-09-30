import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { BookingErrorCode } from '@carrental/api-contracts';
import { RoleCode } from '@carrental/database';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import {
  CurrentPrincipal,
  RequirePermissions,
  RequireRoles,
} from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';
import { ApplicationException } from '../common/errors/application.exception';
import type { RequestPrincipal } from '../security/security-context';
import { HttpStatus } from '@nestjs/common';
import { BookingsService } from './bookings.service';
import {
  BookingAmendmentPreviewDto,
  CancelBookingDto,
  CancellationPreviewDto,
  CreateBookingHoldDto,
  ExecuteCancellationDto,
  PreCustodyCancellationDto,
  RejectBookingDto,
  OwnerAmendmentDeclineDto,
  SubmitBookingAmendmentDto,
} from './bookings.dto';
import { PaymentsService } from '../payments/payments.service';
import { CancellationService } from './cancellation.service';
import { AmendmentPreviewService } from './amendment-preview.service';
import { AmendmentSubmissionService } from './amendment-submission.service';
import { AmendmentWithdrawalService } from './amendment-withdrawal.service';
import { AmendmentOwnerDecisionService } from './amendment-owner-decision.service';
import { AdminBookingAmendmentsService } from './admin-booking-amendments.service';
import { AdminBookingAmendmentQueryDto } from './admin-booking-amendments.dto';

@ApiBearerAuth()
@ApiTags('Renter bookings')
@Controller('bookings')
@RequireRoles(RoleCode.RENTER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class RenterBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly payments: PaymentsService,
    private readonly cancellations: CancellationService,
    private readonly amendmentPreviews: AmendmentPreviewService,
    private readonly amendmentSubmissions: AmendmentSubmissionService,
    private readonly amendmentWithdrawals: AmendmentWithdrawalService,
  ) {}

  @Post(':reference/amendment-preview')
  amendmentPreview(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: BookingAmendmentPreviewDto,
  ) {
    return this.amendmentPreviews.previewRenter(principal.userId, reference, input);
  }

  @Post(':reference/amendments')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  submitAmendment(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: SubmitBookingAmendmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200)
      throw new ApplicationException(
        BookingErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'A valid Idempotency-Key header is required.',
        HttpStatus.BAD_REQUEST,
      );
    return this.amendmentSubmissions.submitRenter(
      principal.userId,
      reference,
      input.previewToken,
      idempotencyKey,
      requestMetadata(request),
    );
  }

  @Get(':reference/amendments/:amendmentReference')
  amendmentDetail(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Param('amendmentReference', new ParseUUIDPipe()) amendmentReference: string,
  ) {
    return this.amendmentSubmissions.detailRenter(principal.userId, reference, amendmentReference);
  }

  @Post(':reference/amendments/:amendmentReference/withdraw')
  withdrawAmendment(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Param('amendmentReference', new ParseUUIDPipe()) amendmentReference: string,
    @Req() request: Request,
  ) {
    return this.amendmentWithdrawals.withdrawRenter(
      principal.userId,
      reference,
      amendmentReference,
      requestMetadata(request),
    );
  }

  @Post(':reference/amendments/:amendmentReference/payment')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  payAmendment(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Param('amendmentReference', new ParseUUIDPipe()) amendmentReference: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200)
      throw new ApplicationException(
        BookingErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'A valid Idempotency-Key header is required.',
        HttpStatus.BAD_REQUEST,
      );
    return this.payments.payBookingAmendment(
      principal.userId,
      reference,
      amendmentReference,
      requestMetadata(request),
    );
  }

  @Post(':reference/amendments/:amendmentReference/refund')
  refundAmendment(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Param('amendmentReference', new ParseUUIDPipe()) amendmentReference: string,
  ) {
    return this.payments.refundBookingAmendment(principal.userId, reference, amendmentReference);
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Body() input: CreateBookingHoldDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new ApplicationException(
        BookingErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'A valid Idempotency-Key header is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.bookings.createHold(
      principal.userId,
      input.quoteId,
      idempotencyKey,
      requestMetadata(request),
    );
  }

  @Post(':reference/cancellation-preview')
  cancellationPreview(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: CancellationPreviewDto,
  ) {
    return this.cancellations.previewRenter(principal.userId, reference, input.reasonCode);
  }

  @Post(':reference/cancellation')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  executeCancellation(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: ExecuteCancellationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200)
      throw new ApplicationException(
        BookingErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'A valid Idempotency-Key header is required.',
        HttpStatus.BAD_REQUEST,
      );
    return this.cancellations.executeRenter(
      principal.userId,
      reference,
      input,
      idempotencyKey,
      requestMetadata(request),
    );
  }

  @Get()
  list(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.bookings.listRenter(principal.userId);
  }

  @Get(':reference')
  detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('reference') reference: string) {
    return this.bookings.renterDetail(principal.userId, reference);
  }

  @Post(':reference/continue')
  continue(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Req() request: Request,
  ) {
    return this.bookings.continueToPayment(principal.userId, reference, requestMetadata(request));
  }

  @Post(':reference/cancel')
  async cancel(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: CancelBookingDto,
    @Req() request: Request,
  ) {
    await this.bookings.cancel(principal.userId, reference, input.reason, requestMetadata(request));
    await this.payments.processPendingForBooking(reference, requestMetadata(request));
    return this.bookings.renterDetail(principal.userId, reference);
  }

  @Get(':reference/handover-cancellation/quote')
  handoverCancellationQuote(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
  ) {
    return this.payments.previewPreCustodyCancellation(principal.userId, reference);
  }

  @Post(':reference/handover-cancellation')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  handoverCancellation(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: PreCustodyCancellationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200)
      throw new ApplicationException(
        BookingErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'A valid Idempotency-Key header is required.',
        HttpStatus.BAD_REQUEST,
      );
    return this.payments.cancelPreCustodyHandover(
      principal.userId,
      reference,
      input.reasonCode,
      input.reasonText,
      {
        ...requestMetadata(request),
        correlationId: requestMetadata(request).correlationId ?? idempotencyKey,
      },
    );
  }
}

@ApiBearerAuth()
@ApiTags('Owner booking requests')
@Controller('owner/bookings')
@RequireRoles(RoleCode.OWNER)
@UseGuards(AccessTokenGuard, PolicyGuard)
export class OwnerBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly payments: PaymentsService,
    private readonly cancellations: CancellationService,
    private readonly amendmentDecisions: AmendmentOwnerDecisionService,
  ) {}

  @Post(':reference/cancellation-preview')
  cancellationPreview(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: CancellationPreviewDto,
  ) {
    return this.cancellations.previewOwner(principal.userId, reference, input.reasonCode);
  }

  @Post(':reference/cancellation')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  executeCancellation(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: ExecuteCancellationDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200)
      throw new ApplicationException(
        BookingErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'A valid Idempotency-Key header is required.',
        HttpStatus.BAD_REQUEST,
      );
    return this.cancellations.executeOwner(
      principal.userId,
      reference,
      input,
      idempotencyKey,
      requestMetadata(request),
    );
  }

  @Get('requests')
  requests(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.bookings.listOwner(principal.userId);
  }

  @Get('amendments/actionable')
  actionableAmendments(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.amendmentDecisions.list(principal.userId);
  }

  @Get(':reference/amendments/:amendmentReference')
  amendmentDetail(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Param('amendmentReference', new ParseUUIDPipe()) amendmentReference: string,
  ) {
    return this.amendmentDecisions.detail(principal.userId, reference, amendmentReference);
  }

  @Post(':reference/amendments/:amendmentReference/accept')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  acceptAmendment(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Param('amendmentReference', new ParseUUIDPipe()) amendmentReference: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    assertIdempotencyKey(idempotencyKey);
    return this.amendmentDecisions.accept(
      principal.userId,
      reference,
      amendmentReference,
      idempotencyKey,
      requestMetadata(request),
    );
  }

  @Post(':reference/amendments/:amendmentReference/decline')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  declineAmendment(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Param('amendmentReference', new ParseUUIDPipe()) amendmentReference: string,
    @Body() input: OwnerAmendmentDeclineDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    assertIdempotencyKey(idempotencyKey);
    return this.amendmentDecisions.decline(
      principal.userId,
      reference,
      amendmentReference,
      idempotencyKey,
      input.reasonCode,
      requestMetadata(request),
    );
  }

  @Get(':reference')
  detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('reference') reference: string) {
    return this.bookings.ownerDetail(principal.userId, reference);
  }

  @Post(':reference/accept')
  async accept(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Req() request: Request,
  ) {
    const metadata = requestMetadata(request);
    await this.bookings.ownerAccept(principal.userId, reference, metadata);
    await this.payments.processPendingForBooking(reference, metadata);
    return this.bookings.ownerDetail(principal.userId, reference);
  }

  @Post(':reference/reject')
  async reject(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: RejectBookingDto,
    @Req() request: Request,
  ) {
    const metadata = requestMetadata(request);
    await this.bookings.ownerReject(principal.userId, reference, input.reason, metadata);
    await this.payments.processPendingForBooking(reference, metadata);
    return this.bookings.ownerDetail(principal.userId, reference);
  }
}

function assertIdempotencyKey(value: string | undefined): asserts value is string {
  if (!value || value.length < 8 || value.length > 200)
    throw new ApplicationException(
      BookingErrorCode.IDEMPOTENCY_KEY_REQUIRED,
      'A valid Idempotency-Key header is required.',
      HttpStatus.BAD_REQUEST,
    );
}

@ApiBearerAuth()
@ApiTags('Admin booking diagnostics')
@Controller('admin/bookings')
@RequirePermissions('vehicles.read')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly amendments: AdminBookingAmendmentsService,
  ) {}

  @Get('amendments')
  @RequirePermissions('rentals.read')
  amendmentList(@Query() query: AdminBookingAmendmentQueryDto) {
    return this.amendments.list(query);
  }

  @Get('amendments/:id')
  @RequirePermissions('rentals.read')
  amendmentDetail(@Param('id') id: string) {
    return this.amendments.detail(id);
  }

  @Get()
  list() {
    return this.bookings.listAdmin();
  }

  @Get(':reference')
  detail(@Param('reference') reference: string) {
    return this.bookings.adminDetail(reference);
  }
}
