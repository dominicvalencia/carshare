import { createReadStream, ReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiEnvironment } from '@carrental/config';

export abstract class ObjectStorageProvider {
  abstract put(objectKey: string, content: Buffer): Promise<void>;
  abstract open(objectKey: string): ReadStream;
  abstract delete(objectKey: string): Promise<void>;
}

@Injectable()
export class LocalObjectStorageProvider extends ObjectStorageProvider {
  private readonly root: string;

  constructor(@Inject(ConfigService) configuration: ConfigService<ApiEnvironment, true>) {
    super();
    this.root = resolve(
      process.cwd(),
      configuration.getOrThrow('OBJECT_STORAGE_ROOT', { infer: true }),
    );
  }

  async put(objectKey: string, content: Buffer): Promise<void> {
    const path = this.pathFor(objectKey);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, content, { mode: 0o600 });
  }

  open(objectKey: string): ReadStream {
    return createReadStream(this.pathFor(objectKey));
  }

  async delete(objectKey: string): Promise<void> {
    await rm(this.pathFor(objectKey), { force: true });
  }

  private pathFor(objectKey: string): string {
    if (!/^[a-f0-9-]+\/[a-f0-9-]+$/.test(objectKey)) throw new Error('Invalid object key.');
    return resolve(this.root, objectKey);
  }
}
