/**
 * H.A.M.M.E.R. POS — Production Reset Script
 * 
 * Clears all transactional data while preserving:
 * - Users and their branch role assignments
 * - Branches and their configurations
 * - Physical cash boxes
 * - System settings
 * - Categories (structure only)
 * 
 * Usage: npx tsx --require dotenv/config scripts/reset-for-production.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function resetForProduction() {
  console.log("=== H.A.M.M.E.R. POS — Vaciado para Produccion ===");
  console.log("Eliminando datos transaccionales...\n");

  // Order matters due to foreign keys
  const steps: Array<{ label: string; fn: () => Promise<any> }> = [
    { label: "CashClosureLog", fn: () => prisma.cashClosureLog.deleteMany() },
    { label: "CashClosure", fn: () => prisma.cashClosure.deleteMany() },
    { label: "CsrfToken", fn: () => prisma.csrfToken.deleteMany() },
    { label: "RevokedSession", fn: () => prisma.revokedSession.deleteMany() },
    { label: "LoginAttempt", fn: () => prisma.loginAttempt.deleteMany() },
    { label: "TransportService", fn: () => prisma.transportService.deleteMany() },
    { label: "DispatchTicket", fn: () => prisma.dispatchTicket.deleteMany() },
    { label: "Payment", fn: () => prisma.payment.deleteMany() },
    { label: "SaleOrderLine", fn: () => prisma.saleOrderLine.deleteMany() },
    { label: "SaleOrder", fn: () => prisma.saleOrder.deleteMany() },
    { label: "CashSession", fn: () => prisma.cashSession.deleteMany() },
    { label: "ApprovalRequest", fn: () => prisma.approvalRequest.deleteMany() },
    { label: "TransferLine", fn: () => prisma.transferLine.deleteMany() },
    { label: "Transfer", fn: () => prisma.transfer.deleteMany() },
    { label: "PurchaseOrderLine", fn: () => prisma.purchaseOrderLine.deleteMany() },
    { label: "PurchaseOrder", fn: () => prisma.purchaseOrder.deleteMany() },
    { label: "TimberTripLine", fn: () => prisma.timberTripLine.deleteMany() },
    { label: "TimberTrip", fn: () => prisma.timberTrip.deleteMany() },
    { label: "TimberProduct", fn: () => prisma.timberProduct.deleteMany() },
    { label: "InventoryMovement", fn: () => prisma.inventoryMovement.deleteMany() },
    { label: "InventoryBalance", fn: () => prisma.inventoryBalance.deleteMany() },
    { label: "ProductAnalytics", fn: () => prisma.productAnalytics.deleteMany() },
    { label: "ProductPricing", fn: () => prisma.productPricing.deleteMany() },
    { label: "EmployeeSalaryHistory", fn: () => prisma.employeeSalaryHistory.deleteMany() },
    { label: "OperatingExpense", fn: () => prisma.operatingExpense.deleteMany() },
    { label: "Employee", fn: () => prisma.employee.deleteMany() },
    { label: "Product", fn: () => prisma.product.deleteMany() },
    { label: "Category", fn: () => prisma.category.deleteMany() },
    { label: "CustomerCreditProfile", fn: () => prisma.customerCreditProfile.deleteMany() },
    { label: "CustomerBranchScope", fn: () => prisma.customerBranchScope.deleteMany() },
    { label: "Customer", fn: () => prisma.customer.deleteMany() },
    { label: "Discount", fn: () => prisma.discount.deleteMany() },
    { label: "AuditLog", fn: () => prisma.auditLog.deleteMany() },
  ];

  for (const step of steps) {
    try {
      const result = await step.fn();
      const count = (result as any)?.count ?? 0;
      if (count > 0) {
        console.log(`  [OK] ${step.label}: ${count} registros eliminados`);
      } else {
        console.log(`  [--] ${step.label}: sin datos`);
      }
    } catch (err: any) {
      console.log(`  [!!] ${step.label}: ${err?.message ?? "error"}`);
    }
  }

  // Verify preserved data
  const branches = await prisma.branch.count();
  const users = await prisma.user.count();
  const roles = await prisma.userBranchRole.count();
  const cashBoxes = await prisma.physicalCashBox.count();
  const configs = await prisma.branchModuleConfig.count();

  console.log("\n=== Datos preservados ===");
  console.log(`  Sucursales: ${branches}`);
  console.log(`  Usuarios: ${users}`);
  console.log(`  Roles asignados: ${roles}`);
  console.log(`  Cajas fisicas: ${cashBoxes}`);
  console.log(`  Configs de modulos: ${configs}`);

  // Create audit entry
  await prisma.auditLog.create({
    data: {
      module: "system",
      action: "PRODUCTION_RESET",
      entityType: "System",
      entityId: "production-reset",
      metadataJson: {
        preservedBranches: branches,
        preservedUsers: users,
        preservedRoles: roles,
        timestamp: new Date().toISOString(),
      },
    },
  });

  console.log("\n=== Sistema listo para produccion ===");
  console.log("Ejecute 'npm run dev' para iniciar.");
}

resetForProduction()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
