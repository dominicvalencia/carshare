import { HttpStatus, Injectable } from '@nestjs/common';
import {
  MarketplacePersona,
  OwnerProfileStatus,
  RoleCode,
  UserStatus,
  type Prisma,
} from '@carrental/database';
import { IdentityErrorCode } from '@carrental/api-contracts';
import { ApplicationException } from '../common/errors/application.exception';
import { DatabaseService } from '../infrastructure/database/database.service';
import type { SelfServicePersona } from './users.dto';

const personaStateSelect = {
  ownerProfile: { select: { status: true } },
  profile: {
    select: {
      initialMarketplacePersona: true,
      ownerOnboardingFirstEnteredAt: true,
      renterOnboardingCompletedAt: true,
    },
  },
  roles: { select: { role: { select: { code: true } } } },
} satisfies Prisma.UserSelect;

type PersonaStateUser = Prisma.UserGetPayload<{ select: typeof personaStateSelect }>;

@Injectable()
export class PersonasService {
  constructor(private readonly database: DatabaseService) {}

  async get(userId: string) {
    const user = await this.database.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: personaStateSelect,
    });
    return this.present(user);
  }

  async enroll(userId: string, persona: SelfServicePersona) {
    return this.database.client.$transaction(async (transaction) => {
      const user = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: { status: true },
      });
      this.assertActive(user.status);

      const roleCode = persona === 'RENTER' ? RoleCode.RENTER : RoleCode.OWNER;
      const role = await transaction.role.findUniqueOrThrow({ where: { code: roleCode } });
      const enrollment = await transaction.userRole.createMany({
        data: [{ roleId: role.id, userId }],
        skipDuplicates: true,
      });
      await transaction.userProfile.updateMany({
        data: { initialMarketplacePersona: MarketplacePersona[persona] },
        where: { initialMarketplacePersona: null, userId },
      });
      if (persona === 'OWNER') {
        await transaction.ownerProfile.createMany({
          data: [{ userId }],
          skipDuplicates: true,
        });
      }
      const state = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: personaStateSelect,
      });
      return { ...this.present(state), newlyEnrolled: enrollment.count === 1 };
    });
  }

  async recordOwnerOnboardingEntry(userId: string) {
    return this.database.client.$transaction(async (transaction) => {
      const user = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          roles: { select: { role: { select: { code: true } } } },
          status: true,
        },
      });
      this.assertActive(user.status);
      if (!user.roles.some(({ role }) => role.code === RoleCode.OWNER)) {
        throw new ApplicationException(
          IdentityErrorCode.PERMISSION_DENIED,
          'Enable the Vehicle Owner capability before entering Owner setup.',
          HttpStatus.FORBIDDEN,
        );
      }
      await transaction.userProfile.updateMany({
        data: { ownerOnboardingFirstEnteredAt: new Date() },
        where: { ownerOnboardingFirstEnteredAt: null, userId },
      });
      return transaction.userProfile.findUniqueOrThrow({
        where: { userId },
        select: { ownerOnboardingFirstEnteredAt: true },
      });
    });
  }

  async completeRenterOnboarding(userId: string) {
    return this.database.client.$transaction(async (transaction) => {
      const user = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          profile: { select: { renterOnboardingCompletedAt: true } },
          roles: { select: { role: { select: { code: true } } } },
          status: true,
        },
      });
      this.assertActive(user.status);
      if (!user.roles.some(({ role }) => role.code === RoleCode.RENTER)) {
        throw new ApplicationException(
          IdentityErrorCode.PERMISSION_DENIED,
          'Enable the Renter capability before completing Renter setup.',
          HttpStatus.FORBIDDEN,
        );
      }
      if (!user.profile?.renterOnboardingCompletedAt) {
        await transaction.userProfile.update({
          data: { renterOnboardingCompletedAt: new Date() },
          where: { userId },
        });
      }
      const state = await transaction.user.findUniqueOrThrow({
        where: { id: userId },
        select: personaStateSelect,
      });
      return this.present(state);
    });
  }

  private present(user: PersonaStateUser) {
    const renterEnabled = user.roles.some(({ role }) => role.code === RoleCode.RENTER);
    const ownerEnabled = user.roles.some(({ role }) => role.code === RoleCode.OWNER);
    return {
      renter: {
        enabled: renterEnabled,
        onboarding: !renterEnabled
          ? ('NOT_ENABLED' as const)
          : user.profile?.renterOnboardingCompletedAt
            ? ('COMPLETE' as const)
            : ('IN_PROGRESS' as const),
      },
      owner: {
        enabled: ownerEnabled,
        onboarding: !ownerEnabled
          ? ('NOT_ENABLED' as const)
          : user.ownerProfile?.status === OwnerProfileStatus.DRAFT ||
              user.ownerProfile?.status === OwnerProfileStatus.REJECTED
            ? ('IN_PROGRESS' as const)
            : ('COMPLETE' as const),
        status: user.ownerProfile?.status ?? null,
      },
    };
  }

  private assertActive(status: UserStatus): void {
    if (status === UserStatus.ACTIVE) return;
    const code = {
      BLOCKED: IdentityErrorCode.ACCOUNT_BLOCKED,
      DEACTIVATED: IdentityErrorCode.ACCOUNT_DEACTIVATED,
      SUSPENDED: IdentityErrorCode.ACCOUNT_SUSPENDED,
    }[status];
    throw new ApplicationException(
      code,
      'Persona enrollment is unavailable.',
      HttpStatus.FORBIDDEN,
    );
  }
}
