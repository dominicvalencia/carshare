import { Module } from '@nestjs/common';
import {
  AdminReviewsController,
  BookingReviewsController,
  PublicReviewsController,
} from './reviews.controller';
import { ReviewsService } from './reviews.service';
@Module({
  controllers: [BookingReviewsController, PublicReviewsController, AdminReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
