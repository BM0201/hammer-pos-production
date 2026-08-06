-- Pase de asistencia diario por sucursal (se toma desde el POS antes de
-- abrir caja). Registra QUE se pasó lista y quién; las faltas marcadas se
-- guardan en EmployeeAbsence. Único por sucursal+día.

-- CreateTable
CREATE TABLE "AttendanceRollCall" (
  "id" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "takenByUserId" TEXT,
  "presentCount" INTEGER NOT NULL DEFAULT 0,
  "absentCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AttendanceRollCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRollCall_branchId_date_key" ON "AttendanceRollCall"("branchId", "date");

-- AddForeignKey
ALTER TABLE "AttendanceRollCall"
  ADD CONSTRAINT "AttendanceRollCall_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
