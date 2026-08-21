import { Injectable } from '@nestjs/common';
import type { Prisma } from '@carrental/database';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { RequestMetadata } from './security-context';

@Injectable()
export class SecurityEventService {
  constructor(private readonly database: DatabaseService) {}

  async record(
    type: string,
    metadata: RequestMetadata & {
      readonly userId?: string;
      readonly sessionId?: string;
      readonly data?: Prisma.InputJsonValue;
    },
  ): Promise<void> {
    await this.database.client.securityEvent.create({
      data: {
        type,
        ...(metadata.userId ? { userId: metadata.userId } : {}),
        ...(metadata.sessionId ? { sessionId: metadata.sessionId } : {}),
        ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress } : {}),
        ...(metadata.userAgent ? { userAgent: metadata.userAgent.slice(0, 500) } : {}),
        ...(metadata.data ? { metadata: metadata.data } : {}),
      },
    });
  }
}
