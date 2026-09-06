import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FakeKycAutomationProvider,
  MemoryReplayStore,
  NoopTelemetryProvider,
  parseVerifiedJsonWebhook,
  classifyHttpFailure,
  retryDelayMs,
  simulateProvider,
  scrubTelemetryContext,
  telemetryProvider,
  verifyHmacWebhook,
} from './index';

describe('provider operations', () => {
  it('bounds exponential retries and separates ambiguous financial outcomes', () => {
    expect(retryDelayMs(20)).toBe(30_000);
    expect(classifyHttpFailure(429).kind).toBe('RETRYABLE');
    expect(classifyHttpFailure(undefined, true).kind).toBe('RECONCILE');
    expect(classifyHttpFailure(401).kind).toBe('NON_RETRYABLE');
  });

  it('offers deterministic outage, validation, rate-limit, timeout and unknown simulations', async () => {
    await expect(simulateProvider('SUCCESS', 'ok')).resolves.toBe('ok');
    await expect(simulateProvider('VALIDATION_FAILURE', 'ok')).rejects.toMatchObject({
      kind: 'NON_RETRYABLE',
    });
    await expect(simulateProvider('RATE_LIMITED', 'ok')).rejects.toMatchObject({
      kind: 'RETRYABLE',
    });
    await expect(simulateProvider('TIMEOUT', 'ok')).rejects.toMatchObject({ kind: 'RECONCILE' });
  });
});

describe('webhook security', () => {
  it('accepts a signed event once and rejects replay, stale, missing, and malformed inputs', async () => {
    const body = Buffer.from('{"type":"delivered"}');
    const now = new Date();
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const signature = createHmac('sha256', 'secret')
      .update(`${timestamp}.`)
      .update(body)
      .digest('hex');
    const replayStore = new MemoryReplayStore();
    const valid = {
      provider: 'test',
      eventId: 'evt-1',
      rawBody: body,
      contentType: 'application/json',
      signature,
      timestamp,
      secret: 'secret',
      replayStore,
      now,
      maxAgeSeconds: 60,
    };
    await expect(verifyHmacWebhook(valid)).resolves.toEqual({ accepted: true });
    await expect(verifyHmacWebhook(valid)).resolves.toEqual({
      accepted: false,
      code: 'EVENT_REPLAYED',
    });
    await expect(
      verifyHmacWebhook({ ...valid, eventId: 'evt-2', timestamp: '1' }),
    ).resolves.toEqual({ accepted: false, code: 'EVENT_STALE' });
    await expect(
      verifyHmacWebhook({ ...valid, eventId: 'evt-3', signature: undefined }),
    ).resolves.toEqual({ accepted: false, code: 'SIGNATURE_MISSING' });
    await expect(
      verifyHmacWebhook({ ...valid, eventId: 'evt-4', contentType: 'text/plain' }),
    ).resolves.toEqual({ accepted: false, code: 'CONTENT_TYPE_INVALID' });
    expect(parseVerifiedJsonWebhook(Buffer.from('{broken'), ['delivered'])).toEqual({
      accepted: false,
      code: 'PAYLOAD_MALFORMED',
    });
    expect(parseVerifiedJsonWebhook(Buffer.from('{"type":"unknown"}'), ['delivered'])).toEqual({
      accepted: false,
      code: 'EVENT_UNSUPPORTED',
    });
  });
});

describe('privacy and KYC authority', () => {
  it('keeps only allowlisted non-sensitive telemetry and supports disabled mode', () => {
    expect(
      scrubTelemetryContext({ route: '/bookings', token: 'secret', nested: {} }, [
        'route',
        'token',
        'nested',
      ]),
    ).toEqual({ route: '/bookings' });
    expect(() =>
      new NoopTelemetryProvider().capture({
        name: 'failure',
        environment: 'local',
        release: 'test',
        context: {},
      }),
    ).not.toThrow();
  });

  it('applies immutable environment and release tags through the Sentry boundary', () => {
    const events: unknown[] = [];
    const provider = telemetryProvider({
      enabled: true,
      environment: 'test',
      release: 'sha-123',
      transport: {
        captureException: () => undefined,
        captureMessage: (_message, context) => events.push(context),
      },
    });
    provider.capture({ name: 'job.failed', environment: 'wrong', release: 'wrong', context: {} });
    expect(events).toEqual([expect.objectContaining({ environment: 'test', release: 'sha-123' })]);
  });

  it('always requires manual review for automation signals', async () => {
    const provider = new FakeKycAutomationProvider({
      provider: 'fake',
      caseId: 'case-1',
      status: 'COMPLETED',
      authenticity: 'PASS',
      liveness: 'PASS',
      faceMatch: 'PASS',
    });
    await expect(provider.evaluate({ verificationId: 'verification-1' })).resolves.toMatchObject({
      manualReviewRequired: true,
    });
  });
});
