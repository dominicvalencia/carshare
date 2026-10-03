import { describe, expect, it } from 'vitest';
import {
  API_PREFIX,
  CORRELATION_ID_HEADER,
  OwnerPayoutMethodStatus,
  PayoutMethodErrorCode,
  SystemErrorCode,
} from './index';

describe('API contracts', () => {
  it('keeps the public API foundation stable', () => {
    expect(API_PREFIX).toBe('api/v1');
    expect(CORRELATION_ID_HEADER).toBe('x-correlation-id');
    expect(SystemErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });

  it('keeps Owner payout-method statuses and errors provider-neutral', () => {
    expect(OwnerPayoutMethodStatus.READY).toBe('READY');
    expect(OwnerPayoutMethodStatus.NEEDS_ATTENTION).toBe('NEEDS_ATTENTION');
    expect(PayoutMethodErrorCode.DUPLICATE).toBe('PAYOUT_METHOD_DUPLICATE');
    expect(PayoutMethodErrorCode.UNSUPPORTED).toBe('PAYOUT_METHOD_UNSUPPORTED');
  });
});
