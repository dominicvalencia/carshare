import { createHash } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PushProvider, PushResult } from '@carrental/notifications';

export async function certifyPushOnce(input: {
  readonly provider: PushProvider;
  readonly token: string;
  readonly deepLink: string;
  readonly markerPath: string;
}): Promise<PushResult> {
  await mkdir(dirname(input.markerPath), { recursive: true });
  let marker;
  try {
    marker = await open(input.markerPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error('PUSH_CERTIFICATION_ALREADY_COMPLETED');
    throw error;
  }
  let accepted = false;
  try {
    const result = await input.provider.send({
      token: input.token,
      title: 'CarShare push certification',
      body: 'Push notification delivery is configured correctly.',
      data: { deepLink: input.deepLink },
      idempotencyKey: createHash('sha256')
        .update(`push-local-certification:${input.token}`)
        .digest('hex'),
    });
    if (result.status !== 'ACCEPTED' && result.status !== 'DELIVERED')
      throw new Error(result.safeFailureMessage ?? 'PUSH_PROVIDER_REJECTED');
    accepted = true;
    await marker.writeFile(JSON.stringify({ provider: input.provider.code, completed: true }));
    return result;
  } finally {
    await marker.close().catch(() => undefined);
    if (!accepted) await unlink(input.markerPath).catch(() => undefined);
  }
}
