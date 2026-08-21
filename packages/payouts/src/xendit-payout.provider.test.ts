import { afterEach, describe, expect, it, vi } from 'vitest';
import { XenditPayoutProvider } from './xendit-payout.provider';

afterEach(() => vi.unstubAllGlobals());

describe('PayoutProvider contract — XenditPayoutProvider', () => {
  it('keeps v3 transport, credentials, API version, and idempotency inside the adapter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          payout_id: 'po-test-123',
          source_amount: 50_000,
          status: 'ACCEPTED',
          updated: '2026-08-21T00:00:00.000Z',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = new XenditPayoutProvider({
      callbackToken: 'callback-secret',
      secretKey: 'xnd_development_server_secret',
    });
    await expect(
      provider.createPayout({
        accountHolderName: 'Maria Santos',
        accountIdentifier: '09171234567',
        amountMinor: 50_000n,
        country: 'PH',
        currency: 'PHP',
        description: 'Owner payout',
        destinationChannel: 'PH_GCASH',
        idempotencyKey: 'payout:test:submit:v1',
        referenceId: 'PO-TEST',
        type: 'E_WALLET',
      }),
    ).resolves.toMatchObject({
      externalPayoutId: 'po-test-123',
      kind: 'ACCEPTED',
      state: 'ACCEPTED',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.xendit.co/v3/payouts');
    expect(request.headers).toMatchObject({
      'api-version': '2025-09-01',
      'idempotency-key': 'payout:test:submit:v1',
    });
    expect(JSON.stringify(request)).not.toContain('callback-secret');
  });

  it('authenticates and redacts webhooks while preserving a stable dedupe identity', async () => {
    const provider = new XenditPayoutProvider({
      callbackToken: 'callback-secret',
      secretKey: 'xnd_development_server_secret',
    });
    const rawBody = Buffer.from(
      JSON.stringify({
        data: {
          payout_id: 'po-test-123',
          recipient: { account_details: { account_number: '09171234567' } },
          source_amount: 50_000,
          status: 'SUCCEEDED',
        },
        event: 'v3_payout.succeeded',
      }),
    );
    await expect(
      provider.normalizeWebhook({
        callbackToken: 'wrong',
        payload: JSON.parse(rawBody.toString()),
        rawBody,
      }),
    ).rejects.toMatchObject({ category: 'INVALID_WEBHOOK' });
    const event = await provider.normalizeWebhook({
      callbackToken: 'callback-secret',
      payload: JSON.parse(rawBody.toString()),
      rawBody,
    });
    expect(event).toMatchObject({
      eventType: 'v3_payout.succeeded',
      providerPayoutId: 'po-test-123',
      state: 'SUCCEEDED',
    });
    expect(JSON.stringify(event.redactedPayload)).not.toContain('09171234567');
  });

  it('normalizes definitive provider failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            failure_code: 'INVALID_DESTINATION',
            payout_id: 'po-failed',
            source_amount: 50_000,
            status: 'FAILED',
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new XenditPayoutProvider({
      callbackToken: 'callback-secret',
      secretKey: 'xnd_development_server_secret',
    });
    await expect(provider.retrievePayout('po-failed')).resolves.toMatchObject({
      failureCategory: 'INVALID_DESTINATION',
      safeFailureCode: 'INVALID_DESTINATION',
      state: 'FAILED',
    });
  });
});
