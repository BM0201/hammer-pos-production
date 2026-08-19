-- INSS con base cotizable propia + registro contable del pago de facturas.
--
-- 1) Employee.inssSalary: el salario REPORTADO al INSS puede diferir del real
--    (los trabajadores están registrados con C$6,519.58). INSS laboral,
--    patronal e INATEC se calculan sobre esta base para cuadrar con la
--    factura oficial; las prestaciones siguen sobre el salario real.
-- 2) EmployerContributionPayment: el INSS se cobra UNA vez al mes — aquí se
--    marca si la factura del período (INSS / INATEC) ya se pagó. Solo estado
--    contable: el costo ya vive en employerCost (sin doble conteo).

-- AlterTable
ALTER TABLE "Employee"
  ADD COLUMN "inssSalary" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "EmployerContributionPayment" (
  "id" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidByUserId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EmployerContributionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployerContributionPayment_year_month_kind_key"
  ON "EmployerContributionPayment"("year", "month", "kind");

-- CreateIndex
CREATE INDEX "EmployerContributionPayment_year_month_idx"
  ON "EmployerContributionPayment"("year", "month");
