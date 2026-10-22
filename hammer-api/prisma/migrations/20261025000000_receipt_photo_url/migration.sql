-- prompt-caja-gastos-pos-cobro.md Commit 2 — URL del recibo (foto, Vercel
-- Blob) en el gasto/compra. 100% aditivo, generada sin conexión a ninguna
-- base. Ninguna de las dos columnas es obligatoria: "No hay recibo" sigue
-- siendo una respuesta válida.

-- AlterTable
ALTER TABLE "CashPurchase" ADD COLUMN     "receiptPhotoUrl" TEXT;

-- AlterTable
ALTER TABLE "OperatingExpense" ADD COLUMN     "receiptPhotoUrl" TEXT;

