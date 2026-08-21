import { describe, expect, it } from 'vitest';
import { createLoggerOptions } from './index';

describe('logger configuration', () => {
  it('uses structured service metadata and secret redaction', () => {
    const options = createLoggerOptions({
      environment: 'test',
      level: 'silent',
      service: 'test-service',
    });

    expect(options.base).toMatchObject({ environment: 'test', service: 'test-service' });
    expect(options.redact).toMatchObject({ censor: '[REDACTED]' });
  });
});
