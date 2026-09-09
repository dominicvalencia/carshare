import {
  type AuthorizePaymentInput,
  type PaymentProvider,
  PaymentProviderError,
  type ProviderOperationResult,
  type ProviderPaymentStatus,
  type ReferencedPaymentInput,
  type RefundPaymentInput,
  type VerifiedWebhookEvent,
  type WebhookVerificationInput,
} from './payment-provider';

export interface XenditPaymentProviderOptions {
  readonly baseUrl?: string;
  readonly secretKey: string;
}
export type XenditSessionInput = AuthorizePaymentInput;
interface SessionResponse {
  payment_session_id?: string;
  payment_link_url?: string | null;
  status?: string;
}
export interface XenditProviderDiagnostics {
  readonly errorCode?: string;
  readonly httpStatus?: number;
  readonly reason?: string;
}

export class XenditPaymentProviderError extends PaymentProviderError {
  constructor(
    message: string,
    category: 'CONFIGURATION' | 'PROVIDER_UNAVAILABLE',
    readonly diagnostics: XenditProviderDiagnostics,
  ) {
    super(message, category);
    this.name = 'XenditPaymentProviderError';
  }
}

export class XenditPaymentProvider implements PaymentProvider {
  readonly code = 'XENDIT' as const;
  readonly capabilities = Object.freeze({
    authorizationHoldDurationSeconds: null,
    supportsAuthorization: false,
    supportsAuthorizationVoid: false,
    supportsAdditionalPaymentAuthorization: false,
    supportsOffSessionAdditionalCharge: false,
    supportsPartialCapture: false,
    supportsPartialRefund: false,
    supportsRefund: false,
    supportsSecurityDeposit: false,
    supportsSecurityDepositUtilization: false,
    supportsWebhooks: false,
  });
  private readonly baseUrl: string;
  constructor(private readonly options: XenditPaymentProviderOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.xendit.co';
  }

  async createSession(input: XenditSessionInput): Promise<ProviderOperationResult> {
    if (
      input.currency !== 'PHP' ||
      input.amountMinor <= 0n ||
      input.amountMinor > BigInt(Number.MAX_SAFE_INTEGER)
    )
      throw new PaymentProviderError(
        'Xendit Payment Session requires a positive PHP amount.',
        'CONFIGURATION',
      );
    const response = await this.request(
      '/sessions',
      {
        reference_id: input.requestReference,
        session_type: 'PAY',
        mode: 'PAYMENT_LINK',
        amount: Number(input.amountMinor) / 100,
        currency: 'PHP',
        country: 'PH',
        capture_method: 'AUTOMATIC',
        description: input.description,
      },
      input.idempotencyKey,
    );
    if (!response.payment_session_id || !response.payment_link_url)
      throw new XenditPaymentProviderError(
        'Xendit returned an incomplete Payment Session.',
        'PROVIDER_UNAVAILABLE',
        { reason: 'Missing session identifier or hosted checkout URL.' },
      );
    return {
      customerActionUrl: response.payment_link_url,
      externalPaymentId: response.payment_session_id,
      kind: 'ACTION_REQUIRED',
      providerState: response.status ?? 'ACTIVE',
    };
  }
  authorize(_input: AuthorizePaymentInput): Promise<ProviderOperationResult> {
    return this.unsupported('authorization');
  }
  capture(_input: ReferencedPaymentInput): Promise<ProviderOperationResult> {
    return this.unsupported('capture');
  }
  voidAuthorization(_input: ReferencedPaymentInput): Promise<ProviderOperationResult> {
    return this.unsupported('authorization void');
  }
  refund(_input: RefundPaymentInput): Promise<ProviderOperationResult> {
    return this.unsupported('refund');
  }
  retrievePayment(_id: string): Promise<ProviderPaymentStatus> {
    return this.unsupported('reconciliation');
  }
  verifyWebhook(_input: WebhookVerificationInput): Promise<VerifiedWebhookEvent> {
    return this.unsupported('webhook verification');
  }
  private unsupported<T>(operation: string): Promise<T> {
    return Promise.reject(
      new PaymentProviderError(`Xendit ${operation} is not enabled.`, 'CONFIGURATION'),
    );
  }

  private async request(
    path: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<SessionResponse> {
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${this.options.secretKey}:`).toString('base64')}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      const diagnostics = safeDiagnostics(response.status, payload);
      if (!response.ok)
        throw new XenditPaymentProviderError(
          'Xendit rejected or could not complete the Payment Session request.',
          [400, 401, 403, 422].includes(response.status) ? 'CONFIGURATION' : 'PROVIDER_UNAVAILABLE',
          diagnostics,
        );
      if (!isRecord(payload))
        throw new XenditPaymentProviderError(
          'Xendit returned a malformed Payment Session response.',
          'PROVIDER_UNAVAILABLE',
          diagnostics,
        );
      return payload as SessionResponse;
    } catch (error) {
      if (error instanceof PaymentProviderError) throw error;
      throw new PaymentProviderError(
        'Xendit could not be reached; the result must be reconciled.',
        'PROVIDER_UNAVAILABLE',
      );
    }
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function safeDiagnostics(httpStatus: number, payload: unknown): XenditProviderDiagnostics {
  if (!isRecord(payload)) return { httpStatus };
  const errorCode =
    typeof payload.error_code === 'string' ? payload.error_code.slice(0, 80) : undefined;
  const raw = typeof payload.message === 'string' ? payload.message : undefined;
  const reason = raw
    ?.replace(/[\r\n\t]/g, ' ')
    .replace(/xnd_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED]')
    .replace(/\b\d{12,19}\b/g, '[REDACTED]')
    .slice(0, 200);
  return { httpStatus, ...(errorCode ? { errorCode } : {}), ...(reason ? { reason } : {}) };
}
