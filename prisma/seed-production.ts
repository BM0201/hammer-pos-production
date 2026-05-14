import { PrismaClient, RoleCode } from "@prisma/client";
import { hashPassword } from "../src/modules/auth/password";

const prisma = new PrismaClient();

const PASSWORD_POLICY = {
  minLength: 12,
  uppercase: /[A-Z]/,
  lowercase: /[a-z]/,
  number: /\d/,
  symbol: /[^A-Za-z0-9]/,
};

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = readEnv(name);
    if (value) {
      return value;
    }
  }

  throw new Error(`MISSING_ENV_${names.join("_OR_")}`);
}

function assertStrongPassword(password: string, envName: string): void {
  if (
    password.length < PASSWORD_POLICY.minLength ||
    !PASSWORD_POLICY.uppercase.test(password) ||
    !PASSWORD_POLICY.lowercase.test(password) ||
    !PASSWORD_POLICY.number.test(password) ||
    !PASSWORD_POLICY.symbol.test(password)
  ) {
    throw new Error(`WEAK_${envName}`);
  }
}

async function ensurePrivilegedUser(params: {
  email: string;
  username: string;
  fullName: string;
  password: string;
  globalRole: RoleCode;
}): Promise<{ id: string; email: string; created: boolean }> {
  const existing = await prisma.user.findUnique({
    where: { email: params.email },
    select: { id: true, email: true },
  });

  if (existing) {
    return { ...existing, created: false };
  }

  const created = await prisma.user.create({
    data: {
      email: params.email,
      username: params.username,
      fullName: params.fullName,
      passwordHash: hashPassword(params.password),
      globalRole: params.globalRole,
      mustChangePassword: true,
      isActive: true,
    },
    select: { id: true, email: true },
  });

  return { ...created, created: true };
}

async function ensureBranchRole(userId: string, branchId: string, roleCode: RoleCode): Promise<void> {
  await prisma.userBranchRole.upsert({
    where: {
      userId_branchId_roleCode: {
        userId,
        branchId,
        roleCode,
      },
    },
    update: { isActive: true },
    create: {
      userId,
      branchId,
      roleCode,
      isActive: true,
    },
  });
}

async function main() {
  const ownerEmail = requireEnv("BOOTSTRAP_OWNER_EMAIL", "BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
  const ownerName = requireEnv("BOOTSTRAP_OWNER_NAME", "BOOTSTRAP_ADMIN_NAME");
  const ownerPassword = requireEnv("BOOTSTRAP_OWNER_PASSWORD");

  const sysadminEmail = (readEnv("BOOTSTRAP_SYSADMIN_EMAIL") ?? `${ownerEmail.split("@")[0]}.sysadmin@${ownerEmail.split("@")[1]}`).toLowerCase();
  const sysadminName = readEnv("BOOTSTRAP_SYSADMIN_NAME") ?? `${ownerName} (System Admin)`;
  const sysadminPassword = requireEnv("BOOTSTRAP_SYSADMIN_PASSWORD");

  const branchCode = requireEnv("BOOTSTRAP_BRANCH_CODE").toUpperCase();
  const branchName = requireEnv("BOOTSTRAP_BRANCH_NAME");
  const createCashBox = (process.env.BOOTSTRAP_CREATE_CASH_BOX ?? "false").toLowerCase() === "true";

  assertStrongPassword(ownerPassword, "BOOTSTRAP_OWNER_PASSWORD");
  assertStrongPassword(sysadminPassword, "BOOTSTRAP_SYSADMIN_PASSWORD");

  if (ownerPassword === sysadminPassword) {
    throw new Error("BOOTSTRAP_PASSWORDS_MUST_BE_DIFFERENT");
  }

  const branch = await prisma.branch.upsert({
    where: { code: branchCode },
    update: { name: branchName, isActive: true },
    create: { code: branchCode, name: branchName, isActive: true },
  });

  const ownerUser = await ensurePrivilegedUser({
    email: ownerEmail,
    username: ownerEmail.split("@")[0] || "owner",
    fullName: ownerName,
    password: ownerPassword,
    globalRole: RoleCode.OWNER,
  });

  const systemAdminUser = await ensurePrivilegedUser({
    email: sysadminEmail,
    username: `${sysadminEmail.split("@")[0]}`,
    fullName: sysadminName,
    password: sysadminPassword,
    globalRole: RoleCode.SYSTEM_ADMIN,
  });

  await ensureBranchRole(ownerUser.id, branch.id, RoleCode.BRANCH_ADMIN);
  await ensureBranchRole(systemAdminUser.id, branch.id, RoleCode.BRANCH_ADMIN);

  if (createCashBox) {
    await prisma.physicalCashBox.upsert({
      where: { branchId_code: { branchId: branch.id, code: `CASH-${branch.code}-01` } },
      update: { isActive: true, description: "Caja inicial bootstrap producción" },
      create: {
        branchId: branch.id,
        code: `CASH-${branch.code}-01`,
        description: "Caja inicial bootstrap producción",
        isActive: true,
      },
    });
  }

  await prisma.systemSetting.upsert({
    where: { key: "BOOTSTRAP_COMPLETED_AT" },
    update: { value: new Date().toISOString(), updatedByUserId: systemAdminUser.id },
    create: { key: "BOOTSTRAP_COMPLETED_AT", value: new Date().toISOString(), updatedByUserId: systemAdminUser.id },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: systemAdminUser.id,
      branchId: branch.id,
      module: "seed-production",
      action: "PRODUCTION_BOOTSTRAP_COMPLETED",
      entityType: "Branch",
      entityId: branch.id,
      metadataJson: {
        branchCode: branch.code,
        ownerEmail: ownerUser.email,
        systemAdminEmail: systemAdminUser.email,
        ownerCreated: ownerUser.created,
        systemAdminCreated: systemAdminUser.created,
        createCashBox,
        enabledModules: ["ventas", "pagos", "caja", "despacho", "transporte", "usuarios", "auditoria"],
      },
    },
  });

  console.log("Production bootstrap completed successfully.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "SEED_PRODUCTION_FAILED");
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
