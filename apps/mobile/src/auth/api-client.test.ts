import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from './api-client';

const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });

describe('mobile API authentication lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refreshes an expired access token and retries the protected request exactly once', async () => {
    const client = new ApiClient('https://api.example.test/api/v1');
    client.setAccessToken('expired-access');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json(401, {
          success: false,
          error: { code: 'INVALID_ACCESS_TOKEN', message: 'Authentication is required.' },
        }),
      )
      .mockResolvedValueOnce(json(200, { success: true, data: { status: 'VERIFIED' } }));
    vi.stubGlobal('fetch', fetchMock);
    const refreshAccessToken = vi.fn(async () => 'fresh-access');
    const onAuthenticationExpired = vi.fn();
    client.configureAuthentication({ refreshAccessToken, onAuthenticationExpired });

    await expect(client.request('/owners/me')).resolves.toEqual({ status: 'VERIFIED' });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(onAuthenticationExpired).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).get('Authorization')).toBe(
      'Bearer expired-access',
    );
    expect(new Headers(fetchMock.mock.calls[1]![1]!.headers).get('Authorization')).toBe(
      'Bearer fresh-access',
    );
  });

  it('coordinates concurrent 401 responses through one refresh operation', async () => {
    const client = new ApiClient('https://api.example.test/api/v1');
    client.setAccessToken('expired-access');
    let releaseRefresh: ((token: string) => void) | undefined;
    const refreshAccessToken = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseRefresh = resolve;
        }),
    );
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const authorization = new Headers(init.headers).get('Authorization');
      return authorization === 'Bearer fresh-access'
        ? json(200, { success: true, data: { ok: true } })
        : json(401, {
            success: false,
            error: { code: 'INVALID_ACCESS_TOKEN', message: 'Authentication is required.' },
          });
    });
    vi.stubGlobal('fetch', fetchMock);
    client.configureAuthentication({
      refreshAccessToken,
      onAuthenticationExpired: vi.fn(),
    });

    const first = client.request('/owner/vehicles');
    const second = client.request('/owner/bookings/requests');
    await vi.waitFor(() => expect(refreshAccessToken).toHaveBeenCalledTimes(1));
    releaseRefresh?.('fresh-access');
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('clears the authenticated lifecycle when refresh is no longer valid without looping', async () => {
    const client = new ApiClient('https://api.example.test/api/v1');
    client.setAccessToken('expired-access');
    const fetchMock = vi.fn().mockResolvedValue(
      json(401, {
        success: false,
        error: { code: 'SESSION_REVOKED', message: 'The session is no longer active.' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onAuthenticationExpired = vi.fn();
    client.configureAuthentication({
      refreshAccessToken: vi.fn(async () => null),
      onAuthenticationExpired,
    });

    await expect(client.request('/owners/me')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onAuthenticationExpired).toHaveBeenCalledTimes(1);
  });

  it('surfaces registration and network failures as readable API errors', async () => {
    const client = new ApiClient('https://api.example.test/api/v1');
    client.setAccessToken('unrelated-session');
    const fetchMock = vi.fn().mockResolvedValueOnce(
      json(409, {
        success: false,
        error: { code: 'EMAIL_ALREADY_EXISTS', message: 'This email is already registered.' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(client.register('existing@example.test', 'long-enough-password')).rejects.toEqual(
      new ApiError('This email is already registered.', 'EMAIL_ALREADY_EXISTS', 409),
    );
    expect(new Headers(fetchMock.mock.calls[0]![1]!.headers).get('Authorization')).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network request failed')));
    await expect(client.register('new@example.test', 'long-enough-password')).rejects.toEqual(
      new ApiError(
        'Unable to reach the service. Check your connection and try again.',
        'NETWORK_ERROR',
        0,
      ),
    );
  });

  it('treats a successful no-content response as success', async () => {
    const client = new ApiClient('https://api.example.test/api/v1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(
      client.request('/auth/email-verification/confirmations', { method: 'POST' }),
    ).resolves.toBeUndefined();
  });
});
