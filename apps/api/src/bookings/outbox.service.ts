import { Injectable } from '@nestjs/common';
import type { Prisma } from '@carrental/database';

@Injectable()
export class OutboxService {
  write(
    transaction: Prisma.TransactionClient,
    input: {
      aggregateId: string;
      eventType: string;
      payload: Prisma.InputJsonValue;
    },
  ) {
    return transaction.outboxEvent.create({
      data: {
        aggregateId: input.aggregateId,
        aggregateType: 'BOOKING',
        eventType: input.eventType,
        payload: input.payload,
      },
    });
  }
}
