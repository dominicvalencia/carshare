import { createHash } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DeliveryReceipt, LocalEmailCertificationProvider } from './delivery.provider';

export interface PostmarkCertificationResult {
  readonly sent: true;
  readonly receipt: DeliveryReceipt;
}

export async function certifyPostmarkOnce(input: {
  readonly provider: LocalEmailCertificationProvider;
  readonly recipient: string;
  readonly markerPath: string;
}): Promise<PostmarkCertificationResult> {
  await mkdir(dirname(input.markerPath), { recursive: true });
  let marker;
  try {
    marker = await open(input.markerPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('POSTMARK_CERTIFICATION_ALREADY_COMPLETED');
    throw error;
  }

  const idempotencyKey = createHash('sha256')
    .update(`postmark-local-certification:${input.recipient}`)
    .digest('hex');
  let accepted = false;
  try {
    const receipt = await input.provider.sendCertification(input.recipient, idempotencyKey);
    accepted = true;
    await marker.writeFile(
      JSON.stringify({ provider: receipt.provider, status: receipt.status, completed: true }),
    );
    return { sent: true, receipt };
  } catch (error) {
    await marker.close();
    if (!accepted) await unlink(input.markerPath);
    throw error;
  } finally {
    await marker.close().catch(() => undefined);
  }
}
