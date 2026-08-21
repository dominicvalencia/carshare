import { describe, expect, it } from 'vitest';
import { API_PREFIX, CORRELATION_ID_HEADER, SystemErrorCode } from './index';

describe('API contracts', () => {
  it('keeps the public API foundation stable', () => {
    expect(API_PREFIX).toBe('api/v1');
    expect(CORRELATION_ID_HEADER).toBe('x-correlation-id');
    expect(SystemErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });
});
