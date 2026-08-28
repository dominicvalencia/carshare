import { Module } from '@nestjs/common';
import {
  AdminReviewsController,
  BookingReviewsController,
  MyReviewsController,
  PublicReviewsController,
} from './reviews.controller';
import { ReviewsService } from './reviews.service';
@Module({
  controllers: [
    BookingReviewsController,
    MyReviewsController,
    PublicReviewsController,
    AdminReviewsController,
  ],
  providers: [ReviewsService],
})
export class ReviewsModule {}
