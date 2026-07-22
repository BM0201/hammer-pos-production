import { z } from "zod";

// dateFrom/dateTo llegan como "YYYY-MM-DD" desde un <input type="date"> — se
// guardan como texto (no z.coerce.date()) porque interpretarlos como fecha
// aquí los ancla a medianoche UTC, no medianoche Managua. La conversión al
// rango real (día de negocio en America/Managua) se hace en
// resolveReportRequest usando getOperationalWindowForManaguaDate.
const managuaDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha invalida (use YYYY-MM-DD)");

export const reportQuerySchema = z.object({
  dateFrom: managuaDateString.optional(),
  dateTo: managuaDateString.optional(),
  branchId: z.string().cuid().optional(),
  status: z.string().min(1).max(64).optional(),
  actorUsername: z.string().min(1).max(64).optional(),
});
