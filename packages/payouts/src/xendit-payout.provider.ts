import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  CreatePayoutInput,
  CreatePayoutResult,
  NormalizedPayoutWebhook,
  PayoutDestinationValidationResult,
  PayoutFailureCategory,
  PayoutProvider,
  PayoutProviderCapabilities,
  PayoutProviderState,
  PayoutProviderStatus,
  ProviderWebhookInput,
  ValidatePayoutDestinationInput,
} from './payout-provider';
import { PayoutProviderError } from './payout-provider';

interface XenditPayoutObject {
  readonly payout_id: string;
  readonly status: string;
  readonly source_amount: number;
  readonly failure_code?: string;
  readonly created?: string;
  readonly updated?: string;
  readonly metadata?: Record<string, unknown>;
}

interface XenditWebhookEnvelope {
  readonly event?: string;
  readonly created?: string;
  readonly data?: XenditPayoutObject;
  readonly payout_id?: string;
  readonly status?: string;
}

export interface XenditPayoutProviderOptions {
  readonly baseUrl?: string;
  readonly callbackToken: string;
  readonly secretKey: string;
}

export class XenditPayoutProvider implements PayoutProvider {
  readonly code = 'XENDIT' as const;
  private readonly baseUrl: string;

  constructor(private readonly options: XenditPayoutProviderOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.xendit.co';
  }

  getCapabilities(): PayoutProviderCapabilities {
    return {
      country: 'PH',
      currency: 'PHP',
      destinationTypes: ['BANK_ACCOUNT', 'E_WALLET'],
      maximumAmountMinor: null,
      minimumAmountMinor: null,
      supportsDestinationValidation: true,
      supportsIdempotency: true,
      supportsRetrieval: true,
      supportsWebhooks: true,
    };
  }

  async validateDestination(
    input: ValidatePayoutDestinationInput,
  ): Promise<PayoutDestinationValidationResult> {
    const validChannel = /^PH_[A-Z0-9_]{2,40}$/.test(input.destinationChannel);
    const validIdentifier = /^[+0-9A-Za-z-]{6,40}$/.test(input.accountIdentifier);
    return validChannel && validIdentifier
      ? { kind: 'VALID', validationLevel: 'FORMAT_AND_CHANNEL' }
      : {
          kind: 'INVALID',
          safeReason: 'Destination channel or identifier format is invalid.',
          validationLevel: 'FORMAT_AND_CHANNEL',
        };
  }

  async createPayout(input: CreatePayoutInput): Promise<CreatePayoutResult> {
    const routingType = input.type === 'E_WALLET' ? 'WALLET' : 'SWIFT';
    const response = await this.request<XenditPayoutObject>('/v3/payouts', {
      body: JSON.stringify({
        description: input.description.slice(0, 100),
        payout_details: {
          destination_currency: 'PHP',
          source_amount: Number(input.amountMinor),
          source_currency: 'PHP',
        },
        purpose_code: 'OTHER',
        recipient: {
          account_details: {
            account_country: 'PH',
            account_holder_name: input.accountHolderName,
            account_number: input.accountIdentifier,
            currency: 'PHP',
            routing_type_1: routingType,
            routing_value_1: input.destinationChannel,
          },
          business_name: input.accountHolderName,
          relationship: 'SUPPLIER',
          type: 'BUSINESS',
        },
        reference_id: input.referenceId,
        source_of_fund: 'BUSINESS_REVENUE',
      }),
      headers: { 'idempotency-key': input.idempotencyKey },
      method: 'POST',
    });
    const normalized = this.normalizeStatus(response);
    return { ...normalized, kind: normalized.state === 'FAILED' ? 'FAILED' : 'ACCEPTED' };
  }

  async retrievePayout(providerPayoutId: string): Promise<PayoutProviderStatus> {
    return this.normalizeStatus(
      await this.request<XenditPayoutObject>(`/v3/payouts/${encodeURIComponent(providerPayoutId)}`),
    );
  }

  async normalizeWebhook(input: ProviderWebhookInput): Promise<NormalizedPayoutWebhook> {
    if (!this.equalToken(input.callbackToken ?? '', this.options.callbackToken)) {
      throw new PayoutProviderError('Invalid Xendit callback token.', 'INVALID_WEBHOOK');
    }
    const envelope = input.payload as XenditWebhookEnvelope;
    const data = envelope.data ?? {
      payout_id: envelope.payout_id ?? '',
      source_amount: 0,
      status: envelope.status ?? 'UNKNOWN',
    };
    if (!data.payout_id)
      throw new PayoutProviderError('Invalid Xendit payout webhook.', 'INVALID_WEBHOOK');
    return {
      eventType: envelope.event ?? `v3_payout.${data.status.toLowerCase()}`,
      externalEventId: createHash('sha256').update(input.rawBody).digest('hex'),
      providerPayoutId: data.payout_id,
      providerState: data.status,
      redactedPayload: {
        created: envelope.created,
        event: envelope.event,
        payout_id: data.payout_id,
        status: data.status,
      },
      state: this.mapState(data.status),
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.options.secretKey}:`).toString('base64')}`,
          'api-version': '2025-09-01',
          'content-type': 'application/json',
          ...init.headers,
        },
      });
    } catch {
      throw new PayoutProviderError(
        'Xendit payout service is unavailable.',
        'PROVIDER_UNAVAILABLE',
      );
    }
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const code = String(payload.error_code ?? 'XENDIT_ERROR');
      const category = response.status >= 500 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE';
      throw new PayoutProviderError(`Xendit payout request failed (${code}).`, category);
    }
    return payload as T;
  }

  private normalizeStatus(value: XenditPayoutObject): PayoutProviderStatus {
    return {
      amountMinor: BigInt(value.source_amount),
      ...(value.updated ? { authoritativeAt: new Date(value.updated) } : {}),
      externalPayoutId: value.payout_id,
      ...(value.failure_code ? { failureCategory: this.mapFailure(value.failure_code) } : {}),
      providerState: value.status,
      ...(value.failure_code ? { safeFailureCode: value.failure_code } : {}),
      state: this.mapState(value.status),
    };
  }

  private mapState(status: string): PayoutProviderState {
    if (status === 'SUCCEEDED') return 'SUCCEEDED';
    if (['FAILED', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(status)) return 'FAILED';
    if (status === 'REVERSED') return 'REVERSED';
    if (status === 'ACCEPTED') return 'ACCEPTED';
    if (['ROUTING', 'REQUESTED', 'READY', 'LOCKED', 'PENDING_COMPLIANCE_REVIEW'].includes(status))
      return 'PROCESSING';
    return 'UNKNOWN';
  }

  private mapFailure(code: string): PayoutFailureCategory {
    if (['INVALID_DESTINATION', 'ACCOUNT_NAME_MISMATCH', 'REJECTED_BY_CHANNEL'].includes(code))
      return 'INVALID_DESTINATION';
    if (['SLS_SENDER', 'SLS_RECIPIENT'].includes(code)) return 'COMPLIANCE_REJECTED';
    if (code === 'DESTINATION_MAXIMUM_LIMIT') return 'LIMIT_EXCEEDED';
    if (code === 'TEMPORARY_TRANSFER_ERROR') return 'PROVIDER_TEMPORARY';
    if (code === 'TRANSFER_ERROR') return 'RETRYABLE';
    return 'UNKNOWN';
  }

  private equalToken(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
