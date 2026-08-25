import type { PushMessage, PushProvider, PushResult } from './push-provider';

interface ExpoTicket {
  readonly status: 'ok' | 'error';
  readonly id?: string;
  readonly message?: string;
  readonly details?: { readonly error?: string };
}
interface ExpoReceipt {
  readonly status: 'ok' | 'error';
  readonly message?: string;
  readonly details?: { readonly error?: string };
}

export class ExpoPushProvider implements PushProvider {
  readonly code = 'expo';
  constructor(private readonly accessToken?: string) {}

  async send(message: PushMessage): Promise<PushResult> {
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          to: message.token,
          title: message.title,
          body: message.body,
          data: message.data,
          sound: 'default',
        }),
      });
      if (!response.ok) return this.httpFailure(response.status);
      const payload = (await response.json()) as { readonly data?: ExpoTicket };
      return this.mapTicket(payload.data);
    } catch {
      return {
        status: 'RETRYABLE_FAILURE',
        failureCategory: 'NETWORK',
        safeFailureMessage: 'Push provider request failed.',
      };
    }
  }

  async receipts(
    providerReferences: readonly string[],
  ): Promise<Readonly<Record<string, PushResult>>> {
    if (!providerReferences.length) return {};
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ ids: providerReferences }),
      });
      if (!response.ok)
        return Object.fromEntries(
          providerReferences.map((id) => [id, this.httpFailure(response.status)]),
        );
      const payload = (await response.json()) as {
        readonly data?: Readonly<Record<string, ExpoReceipt>>;
      };
      return Object.fromEntries(
        providerReferences.map((id) => [id, this.mapReceipt(payload.data?.[id])]),
      );
    } catch {
      return Object.fromEntries(
        providerReferences.map((id) => [
          id,
          {
            status: 'RETRYABLE_FAILURE',
            failureCategory: 'NETWORK',
            safeFailureMessage: 'Push receipt request failed.',
          } satisfies PushResult,
        ]),
      );
    }
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
    };
  }

  private mapTicket(ticket?: ExpoTicket): PushResult {
    if (ticket?.status === 'ok' && ticket.id)
      return { status: 'ACCEPTED', providerReference: ticket.id };
    return this.providerError(ticket?.details?.error, ticket?.message);
  }

  private mapReceipt(receipt?: ExpoReceipt): PushResult {
    if (!receipt)
      return {
        status: 'RETRYABLE_FAILURE',
        failureCategory: 'RECEIPT_PENDING',
        safeFailureMessage: 'Push receipt is not available yet.',
      };
    if (receipt.status === 'ok') return { status: 'DELIVERED' };
    return this.providerError(receipt.details?.error, receipt.message);
  }

  private providerError(code?: string, message?: string): PushResult {
    const permanent =
      code === 'DeviceNotRegistered' ||
      code === 'InvalidCredentials' ||
      code === 'MessageTooBig' ||
      code === 'MessageRateExceeded';
    return {
      status: permanent ? 'PERMANENT_FAILURE' : 'RETRYABLE_FAILURE',
      failureCategory: code ?? 'PROVIDER_ERROR',
      safeFailureMessage: (message ?? 'Push provider rejected the request.').slice(0, 500),
    };
  }

  private httpFailure(status: number): PushResult {
    return {
      status: status === 429 || status >= 500 ? 'RETRYABLE_FAILURE' : 'PERMANENT_FAILURE',
      failureCategory: `HTTP_${status}`,
      safeFailureMessage: 'Push provider returned an unsuccessful response.',
    };
  }
}
