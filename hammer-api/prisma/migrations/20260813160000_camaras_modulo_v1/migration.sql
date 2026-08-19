-- Módulo Cámaras (prompt-modulo-camaras.md + camaras-adenda-agente.md):
-- ver cámaras en vivo + avisar salud, sin grabar/almacenar video nunca.
-- Camera.credentialsCiphertext se cifra en la app (AES-256-GCM,
-- credentials-crypto.ts) antes de llegar acá — nunca texto plano.
-- CameraHealthState incluye UNKNOWN: "no tengo información", nunca se
-- deriva de la ausencia de datos hacia OFFLINE (adenda §3).

-- CreateEnum
CREATE TYPE "CameraLocation" AS ENUM ('CAJA', 'DESPACHO', 'PATIO', 'PASILLO', 'OTRO');

-- CreateEnum
CREATE TYPE "CameraHealthState" AS ENUM ('OFFLINE', 'NO_STREAM', 'NO_FRAMES', 'FROZEN', 'BLACK', 'BLURRY', 'MOVED', 'DEGRADED', 'OK', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CameraStatusSource" AS ENUM ('AGENT_REPORT', 'AGENT_UNREACHABLE', 'NVR_UNREACHABLE');

-- CreateEnum
CREATE TYPE "BranchCameraAgentStatus" AS ENUM ('ONLINE', 'STALE', 'OFFLINE');

-- CreateTable
CREATE TABLE "Camera" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" "CameraLocation" NOT NULL DEFAULT 'OTRO',
    "networkSegment" TEXT,
    "ipAddress" TEXT NOT NULL,
    "onvifPort" INTEGER NOT NULL DEFAULT 80,
    "rtspChannel" TEXT,
    "manufacturer" TEXT,
    "model" TEXT,
    "credentialsCiphertext" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Camera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchCameraAgent" (
    "branchId" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "targetAgentVersion" TEXT NOT NULL DEFAULT '0.1.0',
    "lastHeartbeatAt" TIMESTAMP(3),
    "nvrReachable" BOOLEAN NOT NULL DEFAULT false,
    "lastNvrCheckAt" TIMESTAMP(3),
    "status" "BranchCameraAgentStatus" NOT NULL DEFAULT 'OFFLINE',
    "agentTokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchCameraAgent_pkey" PRIMARY KEY ("branchId")
);

-- CreateTable
CREATE TABLE "CameraStatusHistory" (
    "id" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "status" "CameraHealthState" NOT NULL,
    "source" "CameraStatusSource" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "CameraStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraHealthSnapshot" (
    "branchId" TEXT NOT NULL,
    "failingCount" INTEGER NOT NULL DEFAULT 0,
    "unknownCount" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraHealthSnapshot_pkey" PRIMARY KEY ("branchId")
);

-- CreateIndex
CREATE INDEX "Camera_branchId_isActive_idx" ON "Camera"("branchId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Camera_branchId_ipAddress_rtspChannel_key" ON "Camera"("branchId", "ipAddress", "rtspChannel");

-- CreateIndex
CREATE INDEX "CameraStatusHistory_cameraId_changedAt_idx" ON "CameraStatusHistory"("cameraId", "changedAt");

-- AddForeignKey
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchCameraAgent" ADD CONSTRAINT "BranchCameraAgent_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraStatusHistory" ADD CONSTRAINT "CameraStatusHistory_cameraId_fkey" FOREIGN KEY ("cameraId") REFERENCES "Camera"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraHealthSnapshot" ADD CONSTRAINT "CameraHealthSnapshot_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
