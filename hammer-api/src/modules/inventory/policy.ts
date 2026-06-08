import type { InventoryMovementType, RoleCode } from "@prisma/client";

const roleAllowedMovements: Record<RoleCode, InventoryMovementType[]> = {
  SYSTEM_ADMIN: [
    "PURCHASE_IN",
    "RETURN_IN",
    "RETURN_OUT",
    "ADJUSTMENT_IN",
    "ADJUSTMENT_OUT",
    "TRANSFER_OUT",
    "TRANSFER_IN",
  ],
  OWNER: [
    "PURCHASE_IN",
    "RETURN_IN",
    "RETURN_OUT",
    "ADJUSTMENT_IN",
    "ADJUSTMENT_OUT",
    "TRANSFER_OUT",
    "TRANSFER_IN",
  ],
  MASTER: [
    "PURCHASE_IN",
    "RETURN_IN",
    "RETURN_OUT",
    "ADJUSTMENT_IN",
    "ADJUSTMENT_OUT",
    "TRANSFER_OUT",
    "TRANSFER_IN",
  ],
  BRANCH_ADMIN: [],
  WAREHOUSE: ["RETURN_IN", "RETURN_OUT", "TRANSFER_OUT", "TRANSFER_IN"],
  CASHIER: [],
  SALES: [],
};

export function canPostMovement(roleCode: RoleCode, movementType: InventoryMovementType): boolean {
  if (movementType === "TIMBER_INTAKE_IN" || movementType === "SALE_OUT") {
    return false;
  }

  return roleAllowedMovements[roleCode]?.includes(movementType) ?? false;
}

export function canRequestStockAdjustment(roleCode: RoleCode): boolean {
  return roleCode === "SYSTEM_ADMIN" || roleCode === "OWNER" || roleCode === "MASTER" || roleCode === "BRANCH_ADMIN";
}

export function canExecuteDirectStockAdjustment(roleCode: RoleCode): boolean {
  return roleCode === "SYSTEM_ADMIN" || roleCode === "OWNER" || roleCode === "MASTER";
}
