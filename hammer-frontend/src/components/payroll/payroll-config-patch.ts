/**
 * prompt-nomina-config.md Fase 1 — arma el PATCH de /api/payroll/rates con
 * SOLO los campos que cambiaron (el backend acepta un patch parcial, y
 * mandar todo siempre haría ruido en el audit log de payroll_rates.updated
 * — metadataJson quedaría con campos "cambiados" que en realidad son
 * iguales). {} si no hubo cambios.
 */

export type PayrollConfigFields = {
  inssRegime: "INTEGRAL" | "IVM_RP";
  aguinaldoMode: "ACCRUE_MONTHLY" | "ON_PAYMENT";
  vacacionesMode: "ACCRUE_MONTHLY" | "ON_PAYMENT";
  indemnizacionMode: "ACCRUE_MONTHLY" | "ON_PAYMENT";
  salarioMinimoSectorial: number;
};

export function buildPayrollConfigPatch(
  original: PayrollConfigFields,
  edited: PayrollConfigFields,
): Partial<PayrollConfigFields> {
  const patch: Partial<PayrollConfigFields> = {};
  if (edited.inssRegime !== original.inssRegime) patch.inssRegime = edited.inssRegime;
  if (edited.aguinaldoMode !== original.aguinaldoMode) patch.aguinaldoMode = edited.aguinaldoMode;
  if (edited.vacacionesMode !== original.vacacionesMode) patch.vacacionesMode = edited.vacacionesMode;
  if (edited.indemnizacionMode !== original.indemnizacionMode) patch.indemnizacionMode = edited.indemnizacionMode;
  if (edited.salarioMinimoSectorial !== original.salarioMinimoSectorial) patch.salarioMinimoSectorial = edited.salarioMinimoSectorial;
  return patch;
}
