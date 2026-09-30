import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export { Prisma, PrismaClient } from './generated/prisma/client';
export * from './generated/prisma/enums';
export * from './owner-financial-obligations';
export * from './booking-amendment-application';
export * from './booking-amendment-payment';
export * from './booking-amendment-payment-timeout';
export * from './booking-amendment-refund-authority';
export * from './booking-amendment-refund-execution';
export * from './booking-amendment-refund-recovery';
export * from './active-extension-recovery';

export function createDatabaseClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
