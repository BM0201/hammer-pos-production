-- Confirmación de asistencia por Master + hora de llegada por trabajador.
--
-- El pase de asistencia lo toma el CAJERO desde el POS; para evitar marcas
-- falsas entre compañeros ("buddy punching"), Master debe CONFIRMAR (o
-- corregir) cada pase. reviewStatus queda PENDING hasta que Master revise.
--
-- AttendanceMark: registro POR TRABAJADOR de cada pase (antes la presencia
-- era implícita — ausencia de fila en EmployeeAbsence). Guarda la hora real
-- de llegada (arrivalAt) para que Master pueda ver y corregir.

-- AlterTable
ALTER TABLE "AttendanceRollCall"
  ADD COLUMN "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "reviewedByUserId" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AttendanceMark" (
  "id" TEXT NOT NULL,
  "rollCallId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "arrivalAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AttendanceMark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceMark_rollCallId_employeeId_key" ON "AttendanceMark"("rollCallId", "employeeId");

-- CreateIndex
CREATE INDEX "AttendanceMark_employeeId_idx" ON "AttendanceMark"("employeeId");

-- AddForeignKey
ALTER TABLE "AttendanceMark"
  ADD CONSTRAINT "AttendanceMark_rollCallId_fkey"
  FOREIGN KEY ("rollCallId") REFERENCES "AttendanceRollCall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceMark"
  ADD CONSTRAINT "AttendanceMark_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
