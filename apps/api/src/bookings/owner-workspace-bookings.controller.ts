import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { requestMetadata } from '../auth/auth.controller';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal } from '../authorization/authorization.decorator';
import { OwnerAccessGuard } from '../owner-access/owner-access.guard';
import { RequireOwnerPermission } from '../owner-access/owner-access.decorator';
import { OwnerAccessService } from '../owner-access/owner-access.service';
import type { RequestPrincipal } from '../security/security-context';
import { PaymentsService } from '../payments/payments.service';
import { RejectBookingDto } from './bookings.dto';
import { BookingsService } from './bookings.service';

@Controller('owner/workspaces/:ownerProfileId/bookings')
@UseGuards(AccessTokenGuard, OwnerAccessGuard)
export class OwnerWorkspaceBookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly payments: PaymentsService,
    private readonly ownerAccess: OwnerAccessService,
  ) {}

  @Get('requests')
  @RequireOwnerPermission('bookings.view')
  list(@CurrentPrincipal() principal: RequestPrincipal) {
    this.ownerAccess.requireRequestManagement(principal.ownerAccess!);
    return this.bookings.listForOwnerAccess(principal.ownerAccess!);
  }

  @Get(':reference')
  @RequireOwnerPermission('bookings.view')
  detail(@CurrentPrincipal() principal: RequestPrincipal, @Param('reference') reference: string) {
    this.ownerAccess.requireRequestManagement(principal.ownerAccess!);
    return this.bookings.ownerDetailForAccess(principal.ownerAccess!, reference);
  }

  @Post(':reference/accept')
  @RequireOwnerPermission('bookings.accept')
  async accept(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Req() request: Request,
  ) {
    const context = principal.ownerAccess!;
    this.ownerAccess.requireRequestManagement(context);
    const metadata = requestMetadata(request);
    await this.bookings.ownerAcceptForAccess(context, principal.userId, reference, metadata);
    await this.audit(principal, request, reference, 'bookings.accept', 'OWNER_BOOKING_ACCEPTED');
    await this.payments.processPendingForBooking(reference, metadata);
    return this.bookings.ownerDetailForAccess(context, reference);
  }

  @Post(':reference/reject')
  @RequireOwnerPermission('bookings.reject')
  async reject(
    @CurrentPrincipal() principal: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: RejectBookingDto,
    @Req() request: Request,
  ) {
    const context = principal.ownerAccess!;
    this.ownerAccess.requireRequestManagement(context);
    const metadata = requestMetadata(request);
    await this.bookings.ownerRejectForAccess(
      context,
      principal.userId,
      reference,
      input.reason,
      metadata,
    );
    await this.audit(principal, request, reference, 'bookings.reject', 'OWNER_BOOKING_REJECTED');
    await this.payments.processPendingForBooking(reference, metadata);
    return this.bookings.ownerDetailForAccess(context, reference);
  }

  private audit(
    principal: RequestPrincipal,
    request: Request,
    reference: string,
    permission: 'bookings.accept' | 'bookings.reject',
    action: string,
  ) {
    return this.ownerAccess.auditDelegatedAction({
      action,
      actorUserId: principal.userId,
      context: principal.ownerAccess!,
      permission,
      request: requestMetadata(request),
      targetId: reference,
      targetType: 'BOOKING',
    });
  }
}
