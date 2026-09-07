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
  scrubSentryEvent,
  sentryTransport,
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
      service: 'workers',
      transport: {
        captureException: () => undefined,
        captureMessage: (_message, context) => events.push(context),
      },
    });
    provider.capture({ name: 'job.failed', environment: 'wrong', release: 'wrong', context: {} });
    expect(events).toEqual([expect.objectContaining({ environment: 'test', release: 'sha-123' })]);
  });

  it('removes identity, credentials, KYC, address, payment and signed URL data', () => {
    const event = scrubSentryEvent({
      user: { email: 'driver@example.com' },
      request: {
        method: 'POST',
        url: 'https://api.example.com/kyc?token=secret',
        headers: { authorization: 'Bearer secret' },
        data: { address: 'private' },
      },
      tags: { service: 'api', accessToken: 'secret' },
      extra: {
        correlationId: 'correlation-1',
        kycPayload: 'secret',
        cardNumber: '4111111111111111',
        signedUrl: 'https://storage.example.com/file?signature=secret',
      },
      breadcrumbs: [{ category: 'request', message: 'private message', data: { password: 'x' } }],
      message: 'Failure for driver@example.com using Bearer private',
    });
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({ method: 'POST', url: 'https://api.example.com/kyc' });
    expect(event.tags).toEqual({ service: 'api' });
    expect(event.extra).toEqual({ correlationId: 'correlation-1' });
    expect(event.breadcrumbs).toEqual([{ category: 'request' }]);
    expect(event.message).not.toContain('driver@example.com');
    expect(JSON.stringify(event)).not.toContain('4111111111111111');
  });

  it('sets only immutable service/environment/release and allowlisted scope context', () => {
    const captured: unknown[] = [];
    const tags: Record<string, string> = {};
    const transport = sentryTransport({
      captureException: () => undefined,
      captureMessage: (message) => captured.push(message),
      withScope: (callback) =>
        callback({
          setContext: (_name, context) => captured.push(context),
          setTag: (key, value) => {
            tags[key] = value;
          },
        }),
    });
    transport.captureMessage('safe', {
      name: 'safe',
      environment: 'staging',
      release: 'sha-1',
      correlationId: 'corr-1',
      context: { service: 'api', token: 'no', route: '/bookings' },
    });
    expect(tags).toEqual({
      correlationId: 'corr-1',
      environment: 'staging',
      release: 'sha-1',
      service: 'api',
    });
    expect(captured).toContainEqual({
      correlationId: 'corr-1',
      route: '/bookings',
      service: 'api',
    });
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
