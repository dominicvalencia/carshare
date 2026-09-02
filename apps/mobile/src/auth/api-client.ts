import type { AuthTokens } from './auth.types';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { code: string; message: string };
}

interface UploadAsset {
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string;
}

interface AuthenticationLifecycle {
  readonly refreshAccessToken: () => Promise<string | null>;
  readonly onAuthenticationExpired: () => Promise<void> | void;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private accessToken: string | null = null;
  private authentication: AuthenticationLifecycle | null = null;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(private readonly apiUrl = API_URL) {}

  configureAuthentication(lifecycle: AuthenticationLifecycle | null): void {
    this.authentication = lifecycle;
  }

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  assetUrl(contentPath: string): string {
    if (/^https?:\/\//.test(contentPath)) return contentPath;
    return `${this.apiUrl.replace(/\/api\/v1\/?$/, '')}${contentPath}`;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const anonymousAuthenticationRoute = [
      '/auth/login',
      '/auth/register',
      '/auth/refresh',
    ].includes(path);
    const allowsAuthenticationRefresh = !anonymousAuthenticationRoute;
    let response = await this.fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(!anonymousAuthenticationRoute && this.accessToken
          ? { Authorization: `Bearer ${this.accessToken}` }
          : {}),
        ...init.headers,
      },
    });
    if (response.status === 401 && allowsAuthenticationRefresh && (await this.refreshOnce())) {
      response = await this.fetch(`${this.apiUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          ...init.headers,
        },
      });
    }
    if (response.ok && response.status === 204) return undefined as T;
    const envelope = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
    if (!response.ok || !envelope.success)
      throw new ApiError(
        envelope.error?.message ?? 'Request failed. Please try again.',
        envelope.error?.code ?? 'REQUEST_FAILED',
        response.status,
      );
    return envelope.data as T;
  }

  async upload<T>(path: string, classification: 'PRIVATE' | 'SENSITIVE', file: UploadAsset) {
    const form = new FormData();
    form.append('classification', classification);
    form.append('file', {
      name: file.name,
      type: file.mimeType,
      uri: file.uri,
    } as unknown as Blob);
    let response = await this.fetch(`${this.apiUrl}${path}`, {
      body: form,
      headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {},
      method: 'POST',
    });
    if (response.status === 401 && (await this.refreshOnce())) {
      response = await this.fetch(`${this.apiUrl}${path}`, {
        body: form,
        headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {},
        method: 'POST',
      });
    }
    const envelope = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
    if (!response.ok || !envelope.success)
      throw new ApiError(
        envelope.error?.message ?? 'Upload failed. Please try again.',
        envelope.error?.code ?? 'UPLOAD_FAILED',
        response.status,
      );
    return envelope.data as T;
  }

  login(identifier: string, password: string): Promise<AuthTokens> {
    return this.request('/auth/login', {
      body: JSON.stringify({ identifier, password, platform: devicePlatform() }),
      method: 'POST',
    });
  }

  register(email: string, password: string): Promise<AuthTokens> {
    return this.request('/auth/register', {
      body: JSON.stringify({ email, password, platform: devicePlatform() }),
      method: 'POST',
    });
  }

  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.request('/auth/refresh', {
      body: JSON.stringify({ refreshToken }),
      method: 'POST',
    });
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch {
      throw new ApiError(
        'Unable to reach the service. Check your connection and try again.',
        'NETWORK_ERROR',
        0,
      );
    }
  }

  private async refreshOnce(): Promise<boolean> {
    if (!this.authentication || !this.accessToken) return false;
    this.refreshInFlight ??= this.authentication.refreshAccessToken().finally(() => {
      this.refreshInFlight = null;
    });
    try {
      const token = await this.refreshInFlight;
      if (!token) {
        await this.expireAuthentication();
        return false;
      }
      this.accessToken = token;
      return true;
    } catch {
      await this.expireAuthentication();
      return false;
    }
  }

  private async expireAuthentication(): Promise<void> {
    try {
      await this.authentication?.onAuthenticationExpired();
    } catch {
      this.accessToken = null;
    }
  }
}

function devicePlatform(): 'IOS' | 'ANDROID' | 'UNKNOWN' {
  const platform = process.env.EXPO_OS;
  return platform === 'ios' ? 'IOS' : platform === 'android' ? 'ANDROID' : 'UNKNOWN';
}

export const apiClient = new ApiClient();
