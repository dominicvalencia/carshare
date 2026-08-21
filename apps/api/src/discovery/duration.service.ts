import { HttpStatus, Injectable } from '@nestjs/common';
import { DiscoveryErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';

export const PRICING_ENGINE_VERSION = 'PHP_DAILY_24H_CEILING_V1';
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class RentalDurationService {
  calculate(startInput: string | Date, endInput: string | Date) {
    const start = startInput instanceof Date ? startInput : new Date(startInput);
    const end = endInput instanceof Date ? endInput : new Date(endInput);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      start >= end ||
      (typeof startInput === 'string' && !this.hasTimezone(startInput)) ||
      (typeof endInput === 'string' && !this.hasTimezone(endInput))
    ) {
      this.invalid('Rental timestamps must be timezone-qualified and start before end.');
    }
    if (start.getTime() < Date.now() - 5 * 60 * 1000) {
      this.invalid('Rental start cannot be in the past.');
    }
    const chargeableDays = Math.ceil((end.getTime() - start.getTime()) / DAY_MS);
    if (chargeableDays > 365) this.invalid('Rental period cannot exceed 365 chargeable days.');
    return { chargeableDays, end, start };
  }

  touchedWeekdays(start: Date, end: Date, timezone: string): Set<string> {
    const format = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' });
    const weekdays = new Set<string>();
    const finalInstant = new Date(end.getTime() - 1);
    weekdays.add(format.format(start).toLowerCase());
    weekdays.add(format.format(finalInstant).toLowerCase());
    for (
      let instant = start.getTime() + 6 * 60 * 60 * 1000;
      instant < end.getTime();
      instant += 6 * 60 * 60 * 1000
    ) {
      weekdays.add(format.format(new Date(instant)).toLowerCase());
    }
    return weekdays;
  }

  private hasTimezone(value: string): boolean {
    return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  }

  private invalid(message: string): never {
    throw new ApplicationException(
      DiscoveryErrorCode.INVALID_RENTAL_PERIOD,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
