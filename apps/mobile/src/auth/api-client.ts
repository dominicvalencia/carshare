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

export class ApiClient {
  private accessToken: string | null = null;

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
        ...init.headers,
      },
    });
    const envelope = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
    if (!response.ok || !envelope.success)
      throw new Error(envelope.error?.message ?? 'Request failed.');
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
    const response = await fetch(`${API_URL}${path}`, {
      body: form,
      headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {},
      method: 'POST',
    });
    const envelope = (await response.json().catch(() => ({}))) as ApiEnvelope<T>;
    if (!response.ok || !envelope.success)
      throw new Error(envelope.error?.message ?? 'Upload failed.');
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
}

function devicePlatform(): 'IOS' | 'ANDROID' | 'UNKNOWN' {
  const platform = process.env.EXPO_OS;
  return platform === 'ios' ? 'IOS' : platform === 'android' ? 'ANDROID' : 'UNKNOWN';
}

export const apiClient = new ApiClient();
