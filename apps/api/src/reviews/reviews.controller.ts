import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessTokenGuard } from '../authorization/access-token.guard';
import { CurrentPrincipal, RequirePermissions } from '../authorization/authorization.decorator';
import { PolicyGuard } from '../authorization/policy.guard';
import type { RequestPrincipal } from '../security/security-context';
import { requestMetadata } from '../auth/auth.controller';
import { CreateReviewDto, ModerateReviewDto, ReviewListQueryDto } from './reviews.dto';
import { ReviewsService } from './reviews.service';

@ApiBearerAuth()
@ApiTags('Booking reviews')
@Controller('bookings')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class BookingReviewsController {
  constructor(private readonly reviews: ReviewsService) {}
  @Get(':reference/review-eligibility') eligibility(
    @CurrentPrincipal() p: RequestPrincipal,
    @Param('reference') reference: string,
  ) {
    return this.reviews.eligibility(p.userId, reference);
  }
  @Post(':reference/reviews') create(
    @CurrentPrincipal() p: RequestPrincipal,
    @Param('reference') reference: string,
    @Body() input: CreateReviewDto,
  ) {
    return this.reviews.create(p.userId, reference, input);
  }
}
@ApiBearerAuth()
@ApiTags('Current user reviews')
@Controller('me/reviews')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class MyReviewsController {
  constructor(private readonly reviews: ReviewsService) {}
  @Get() list(@CurrentPrincipal() principal: RequestPrincipal) {
    return this.reviews.mine(principal.userId);
  }
}
@ApiTags('Public reviews')
@Controller()
export class PublicReviewsController {
  constructor(private readonly reviews: ReviewsService) {}
  @Get('vehicles/:id/reviews') vehicle(
    @Param('id') id: string,
    @Query() query: ReviewListQueryDto,
  ) {
    return this.reviews.vehicle(id, query);
  }
  @Get('owners/:id/reviews') owner(@Param('id') id: string, @Query() query: ReviewListQueryDto) {
    return this.reviews.owner(id, query);
  }
  @Get('hosts/:reference/reviews') host(
    @Param('reference') reference: string,
    @Query() query: ReviewListQueryDto,
  ) {
    return this.reviews.host(reference, query);
  }
  @Get('users/:id/reviews') user(@Param('id') id: string, @Query() query: ReviewListQueryDto) {
    return this.reviews.user(id, query);
  }
}
@ApiBearerAuth()
@ApiTags('Admin review moderation')
@Controller('admin/reviews')
@RequirePermissions('reviews.moderate')
@UseGuards(AccessTokenGuard, PolicyGuard)
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}
  @Post(':id/moderation') moderate(
    @CurrentPrincipal() p: RequestPrincipal,
    @Param('id') id: string,
    @Body() input: ModerateReviewDto,
    @Req() request: Request,
  ) {
    return this.reviews.moderate(
      p.userId,
      id,
      input.status,
      input.reason,
      requestMetadata(request),
    );
  }
}
