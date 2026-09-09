import { AdminRole, AdminStatus, RoleCode, type PrismaClient } from '@carrental/database';

const ADMIN_ROLE_CODES = new Set<RoleCode>([
  RoleCode.ADMIN,
  RoleCode.SUPER_ADMIN,
  RoleCode.SUPPORT,
  RoleCode.FINANCE_ADMIN,
]);

export async function attachAdminIdentity(
  database: PrismaClient,
  userId: string,
  email: string,
  displayName: string,
  roles: readonly RoleCode[],
): Promise<void> {
  if (!roles.some((role) => ADMIN_ROLE_CODES.has(role))) return;
  const roleRows = await database.role.findMany({
    where: { code: { in: [...roles] } },
    include: { permissions: { include: { permission: true } } },
  });
  const permissionCodes = [
    ...new Set(
      roleRows.flatMap(({ permissions }) => permissions.map(({ permission }) => permission.code)),
    ),
  ];
  const permissionRows = await database.adminPermission.findMany({
    where: { code: { in: permissionCodes } },
  });
  const admin = await database.adminUser.create({
    data: {
      activatedAt: new Date(),
      credentialUserId: userId,
      displayName,
      email,
      normalizedEmail: email,
      role: roles.includes(RoleCode.SUPER_ADMIN) ? AdminRole.SUPER_ADMIN : AdminRole.STAFF,
      status: AdminStatus.ACTIVE,
    },
  });
  if (permissionRows.length)
    await database.adminUserPermission.createMany({
      data: permissionRows.map(({ id: permissionId }) => ({
        adminUserId: admin.id,
        assignedByAdminId: admin.id,
        permissionId,
      })),
    });
}
