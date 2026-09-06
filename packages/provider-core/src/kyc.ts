export type KycSignal = 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'NOT_RUN';

export interface KycAutomationResult {
  readonly provider: string;
  readonly caseId: string;
  readonly status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';
  readonly documentType?: string;
  readonly ocrFields?: Readonly<Record<string, string>>;
  readonly authenticity: KycSignal;
  readonly liveness: KycSignal;
  readonly faceMatch: KycSignal;
  readonly confidence?: number;
  readonly manualReviewRequired: true;
}

export interface KycAutomationProvider {
  evaluate(input: { readonly verificationId: string }): Promise<KycAutomationResult>;
}

export class FakeKycAutomationProvider implements KycAutomationProvider {
  constructor(private readonly result: Omit<KycAutomationResult, 'manualReviewRequired'>) {}

  async evaluate(): Promise<KycAutomationResult> {
    return { ...this.result, manualReviewRequired: true };
  }
}
