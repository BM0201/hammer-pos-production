import { prisma } from "@/lib/prisma";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Camera, CameraHealthState, CameraLocation } from "@prisma/client";
import { logAuditEvent } from "@/modules/audit/service";
import { persistBrainDecisions } from "@/modules/brain/service";
import { encryptCameraCredentials, decryptCameraCredentials } from "@/modules/cameras/credentials-crypto";
import { deriveBranchSituation, resolveCameraStatuses, groupFailuresForNotification, type ResolvedCameraStatus } from "@/modules/cameras/branch-situation";
import { cameraDecisionFingerprint, branchInfraDecisionFingerprint, branchAgentUnreachableFingerprint } from "@/modules/cameras/fingerprint";
import { severityForCameraLocation } from "@/modules/cameras/severity";
import { dispatchExternalNotification } from "@/modules/cameras/notify-channel";
import { AGENT_PROTOCOL_VERSION } from "@/modules/cameras/heartbeat-contract";

export const AGENT_STALE_AFTER_MS = 3 * 60 * 1000; // adenda §3: heartbeat cada ~60s, 3 fallos seguidos = inalcanzable
export const NOTIFICATION_STABILIZATION_WINDOW_MS = 3 * 60 * 1000; // prompt §4: sostenido antes de avisar

// ─── Registro de cámaras ─────────────────────────────────────────────────

export async function registerCamera(input: {
  branchId: string;
  name: string;
  location: CameraLocation;
  networkSegment?: string | null;
  ipAddress: string;
  onvifPort?: number;
  rtspChannel?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  credentials: { username: string; password: string };
}): Promise<Camera> {
  const credentialsCiphertext = encryptCameraCredentials(JSON.stringify(input.credentials));
  return prisma.camera.create({
    data: {
      branchId: input.branchId,
      name: input.name,
      location: input.location,
      networkSegment: input.networkSegment ?? null,
      ipAddress: input.ipAddress,
      onvifPort: input.onvifPort ?? 80,
      rtspChannel: input.rtspChannel ?? null,
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      credentialsCiphertext,
    },
  });
}

export function decryptCameraCredentialsFor(camera: Pick<Camera, "credentialsCiphertext">): { username: string; password: string } {
  return JSON.parse(decryptCameraCredentials(camera.credentialsCiphertext));
}

export async function listCamerasForBranch(branchId: string) {
  const cameras = await prisma.camera.findMany({
    where: { branchId, isActive: true },
    orderBy: { name: "asc" },
  });
  const latestByCameraId = new Map<string, { status: CameraHealthState; changedAt: Date }>();
  for (const camera of cameras) {
    const latest = await prisma.cameraStatusHistory.findFirst({
      where: { cameraId: camera.id },
      orderBy: { changedAt: "desc" },
      select: { status: true, changedAt: true },
    });
    if (latest) latestByCameraId.set(camera.id, latest);
  }
  return cameras.map((camera) => ({
    ...camera,
    credentialsCiphertext: undefined, // nunca sale del servidor
    currentStatus: latestByCameraId.get(camera.id)?.status ?? "UNKNOWN",
    statusSince: latestByCameraId.get(camera.id)?.changedAt ?? null,
  }));
}

// ─── Aprovisionamiento del agente ─────────────────────────────────────────

function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Genera el token del agente para una sucursal — se hace UNA vez, a mano,
 * desde el panel Master, antes de instalar el agente ahí. El token en
 * texto plano se devuelve una sola vez (para copiar a agent.config); acá
 * solo se guarda su hash, igual que una contraseña.
 */
export async function provisionBranchAgent(branchId: string): Promise<{ token: string }> {
  const token = randomBytes(32).toString("base64url");
  await prisma.branchCameraAgent.upsert({
    where: { branchId },
    create: { branchId, agentVersion: "0.0.0", status: "OFFLINE", agentTokenHash: hashAgentToken(token) },
    update: { agentTokenHash: hashAgentToken(token), status: "OFFLINE" },
  });
  return { token };
}

export async function verifyAgentToken(branchId: string, presentedToken: string): Promise<boolean> {
  const agent = await prisma.branchCameraAgent.findUnique({ where: { branchId }, select: { agentTokenHash: true } });
  if (!agent) return false;
  const expected = Buffer.from(agent.agentTokenHash, "hex");
  const presented = Buffer.from(hashAgentToken(presentedToken), "hex");
  if (expected.length !== presented.length) return false;
  return timingSafeEqual(expected, presented);
}

// ─── Heartbeat (adenda §2/§3) ────────────────────────────────────────────

export async function recordHeartbeat(input: {
  branchId: string;
  agentVersion: string;
  nvrReachable: boolean;
  cameraStates: Array<{ cameraId: string; state: CameraHealthState }>;
}) {
  const now = new Date();

  // La fila ya existe desde provisionBranchAgent -- el heartbeat nunca
  // crea un agente nuevo, solo actualiza uno ya provisionado y autenticado
  // (verifyAgentToken corre antes, en la ruta).
  await prisma.branchCameraAgent.update({
    where: { branchId: input.branchId },
    data: {
      agentVersion: input.agentVersion,
      lastHeartbeatAt: now,
      nvrReachable: input.nvrReachable,
      lastNvrCheckAt: now,
      status: "ONLINE",
    },
  });

  // El heartbeat SÍ llegó -> nunca es AGENT_UNREACHABLE en este punto. Ese
  // estado solo lo detecta sweepStaleAgents(), por ausencia, no por presencia.
  const situation = deriveBranchSituation({ agentHeartbeatReceived: true, nvrReachable: input.nvrReachable });
  const resolved = resolveCameraStatuses(situation, input.cameraStates);

  for (const r of resolved) {
    await writeStatusHistoryIfChanged(r);
  }
  await evaluateNotificationsAndDecisions(input.branchId, resolved, now);
  await recomputeCameraHealthSnapshot(input.branchId);

  const agent = await prisma.branchCameraAgent.findUnique({ where: { branchId: input.branchId }, select: { targetAgentVersion: true } });
  return {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    acknowledgedAt: now.toISOString(),
    targetAgentVersion: agent?.targetAgentVersion ?? input.agentVersion,
  };
}

/** Cron/sweep periódico — detecta agentes sin heartbeat reciente (adenda §3, situación 1). */
export async function sweepStaleAgents(input: { dryRun?: boolean; now?: Date } = {}) {
  const now = input.now ?? new Date();
  const staleThreshold = new Date(now.getTime() - AGENT_STALE_AFTER_MS);
  const staleAgents = await prisma.branchCameraAgent.findMany({
    where: { status: { not: "OFFLINE" }, OR: [{ lastHeartbeatAt: null }, { lastHeartbeatAt: { lt: staleThreshold } }] },
  });

  if (input.dryRun) return { sweptCount: staleAgents.length, branchIds: staleAgents.map((a) => a.branchId) };

  for (const agent of staleAgents) {
    await prisma.branchCameraAgent.update({ where: { branchId: agent.branchId }, data: { status: "OFFLINE" } });

    const cameras = await prisma.camera.findMany({ where: { branchId: agent.branchId, isActive: true }, select: { id: true } });
    const resolved = resolveCameraStatuses("AGENT_UNREACHABLE", cameras.map((c) => ({ cameraId: c.id, state: "OFFLINE" as CameraHealthState })));
    for (const r of resolved) await writeStatusHistoryIfChanged(r);

    await handleBranchLevelIssue({
      branchId: agent.branchId,
      fingerprint: branchAgentUnreachableFingerprint(agent.branchId),
      title: "Sin conexión con la sucursal",
      description: `El agente de cámaras de la sucursal no ha enviado señal en más de ${Math.round(AGENT_STALE_AFTER_MS / 60000)} minutos.`,
      recommendation: "Verificar que el equipo del agente esté encendido y con red — no se puede ver ni monitorear ninguna cámara de esta sucursal hasta que vuelva.",
      referenceSince: agent.lastHeartbeatAt ?? now,
      now,
      webhookEvent: { type: "BRANCH_AGENT_UNREACHABLE", branchId: agent.branchId, at: now.toISOString() },
    });
  }
  return { sweptCount: staleAgents.length };
}

async function writeStatusHistoryIfChanged(resolved: ResolvedCameraStatus): Promise<boolean> {
  const latest = await prisma.cameraStatusHistory.findFirst({
    where: { cameraId: resolved.cameraId },
    orderBy: { changedAt: "desc" },
  });
  if (latest && latest.status === resolved.status && latest.source === resolved.source) return false;
  await prisma.cameraStatusHistory.create({
    data: { cameraId: resolved.cameraId, status: resolved.status, source: resolved.source },
  });
  return true;
}

async function evaluateNotificationsAndDecisions(branchId: string, resolved: ResolvedCameraStatus[], now: Date) {
  const cameras = await prisma.camera.findMany({ where: { id: { in: resolved.map((r) => r.cameraId) } } });
  const cameraById = new Map(cameras.map((c) => [c.id, c]));
  const segmentOf = (cameraId: string) => cameraById.get(cameraId)?.networkSegment ?? null;

  // La recuperación (OK) se procesa por cámara, aparte del agrupado de fallas
  // -- un episodio de infraestructura puede terminar con las cámaras
  // volviendo en momentos distintos.
  for (const r of resolved) {
    if (r.status === "OK") await resolveCameraDecisionIfOpen(r, now);
  }

  const events = groupFailuresForNotification(resolved, segmentOf);
  for (const event of events) {
    if (event.kind === "CAMERA") {
      const camera = cameraById.get(event.cameraId);
      if (!camera) continue;
      const latest = await prisma.cameraStatusHistory.findFirst({ where: { cameraId: event.cameraId }, orderBy: { changedAt: "desc" } });
      if (!latest || now.getTime() - latest.changedAt.getTime() < NOTIFICATION_STABILIZATION_WINDOW_MS) continue; // blip, no sostenido todavía

      const wasOpen = await isDecisionOpen(cameraDecisionFingerprint(event.cameraId));
      await persistBrainDecisions([{
        category: "SECURITY",
        severity: severityForCameraLocation(camera.location),
        title: `Cámara con falla: ${camera.name}`,
        description: `Estado ${event.state} desde ${latest.changedAt.toISOString()}.`,
        recommendation: "Revisar la cámara y, si hace falta, avisar al proveedor del equipo o abrir la app del fabricante para confirmar que no se está perdiendo grabación.",
        branchId,
        evidenceJson: { cameraId: event.cameraId, state: event.state, since: latest.changedAt.toISOString() },
        fingerprintParts: ["camera", "health", event.cameraId],
      }]);
      if (!wasOpen) {
        await prisma.cameraStatusHistory.update({ where: { id: latest.id }, data: { notifiedAt: now } });
        await dispatchExternalNotification({ type: "CAMERA_DOWN", branchId, cameraId: event.cameraId, cameraName: camera.name, state: event.state, at: now.toISOString() });
      }
    } else {
      // BRANCH_INFRA: colapsa en UNA decisión/aviso -- el estado individual
      // de cada cámara ya quedó en su propio historial arriba.
      const oldestChangedAt = await oldestChangeAmong(event.affectedCameraIds);
      if (!oldestChangedAt || now.getTime() - oldestChangedAt.getTime() < NOTIFICATION_STABILIZATION_WINDOW_MS) continue;

      const fp = branchInfraDecisionFingerprint(branchId);
      const wasOpen = await isDecisionOpen(fp);
      await persistBrainDecisions([{
        category: "SECURITY",
        severity: "HIGH",
        title: "Caída de infraestructura de cámaras",
        description: `${event.affectedCameraIds.length} cámaras cayeron juntas en el mismo ciclo — probablemente un switch o segmento de red, no las cámaras individuales.`,
        recommendation: "Revisar el switch/segmento de red que alimenta estas cámaras antes de revisar cámara por cámara.",
        branchId,
        evidenceJson: { affectedCameraIds: event.affectedCameraIds, reason: event.reason },
        fingerprintParts: ["camera", "infra", branchId],
      }]);
      if (!wasOpen) {
        await dispatchExternalNotification({ type: "BRANCH_INFRA_DOWN", branchId, reason: event.reason, affectedCameraCount: event.affectedCameraIds.length, at: now.toISOString() });
      }
    }
  }
}

async function oldestChangeAmong(cameraIds: string[]): Promise<Date | null> {
  let oldest: Date | null = null;
  for (const cameraId of cameraIds) {
    const latest = await prisma.cameraStatusHistory.findFirst({ where: { cameraId }, orderBy: { changedAt: "desc" } });
    if (latest && (!oldest || latest.changedAt < oldest)) oldest = latest.changedAt;
  }
  return oldest;
}

async function isDecisionOpen(fingerprint: string): Promise<boolean> {
  const existing = await prisma.brainDecision.findUnique({ where: { fingerprint }, select: { status: true } });
  return !!existing && existing.status === "OPEN";
}

/**
 * La trampa sutil de la adenda §3: UNKNOWN nunca resuelve nada — esta
 * función solo se llama para status === "OK", nunca para UNKNOWN. Una
 * decisión de cámara solo se cierra con un reporte explícito de OK.
 */
async function resolveCameraDecisionIfOpen(resolved: ResolvedCameraStatus, now: Date) {
  const fingerprint = cameraDecisionFingerprint(resolved.cameraId);
  const existing = await prisma.brainDecision.findUnique({ where: { fingerprint } });
  if (!existing || existing.status !== "OPEN") return;

  await prisma.brainDecision.update({
    where: { id: existing.id },
    data: { status: "DISMISSED", resolvedAt: now, actionResultJson: { autoResolvedReason: "CAMERA_RECOVERED" } },
  });
  const camera = await prisma.camera.findUnique({ where: { id: resolved.cameraId } });
  await dispatchExternalNotification({
    type: "CAMERA_RECOVERED",
    branchId: camera?.branchId ?? "",
    cameraId: resolved.cameraId,
    cameraName: camera?.name ?? resolved.cameraId,
    at: now.toISOString(),
  });
}

async function handleBranchLevelIssue(input: {
  branchId: string;
  fingerprint: string;
  title: string;
  description: string;
  recommendation: string;
  referenceSince: Date;
  now: Date;
  webhookEvent: Parameters<typeof dispatchExternalNotification>[0];
}) {
  if (input.now.getTime() - input.referenceSince.getTime() < NOTIFICATION_STABILIZATION_WINDOW_MS) return;
  const wasOpen = await isDecisionOpen(input.fingerprint);
  await persistBrainDecisions([{
    category: "SECURITY",
    severity: "HIGH",
    title: input.title,
    description: input.description,
    recommendation: input.recommendation,
    branchId: input.branchId,
    fingerprintParts: ["camera", "agent-unreachable", input.branchId],
  }]);
  if (!wasOpen) await dispatchExternalNotification(input.webhookEvent);
}

// ─── Sidebar (prompt §4.2) ────────────────────────────────────────────────

export async function recomputeCameraHealthSnapshot(branchId: string) {
  const cameras = await prisma.camera.findMany({ where: { branchId, isActive: true }, select: { id: true } });
  let failingCount = 0;
  let unknownCount = 0;
  for (const camera of cameras) {
    const latest = await prisma.cameraStatusHistory.findFirst({ where: { cameraId: camera.id }, orderBy: { changedAt: "desc" }, select: { status: true } });
    if (!latest || latest.status === "UNKNOWN") unknownCount += 1;
    else if (latest.status !== "OK") failingCount += 1;
  }
  await prisma.cameraHealthSnapshot.upsert({
    where: { branchId },
    create: { branchId, failingCount, unknownCount },
    update: { failingCount, unknownCount, generatedAt: new Date() },
  });
}

/** Suma global para el badge del sidebar — el Master no está anclado a una sola sucursal ahí. */
export async function getCameraHealthGlobalSummary(): Promise<{ failingCount: number; unknownCount: number }> {
  const snapshots = await prisma.cameraHealthSnapshot.findMany({ select: { failingCount: true, unknownCount: true } });
  return {
    failingCount: snapshots.reduce((sum, s) => sum + s.failingCount, 0),
    unknownCount: snapshots.reduce((sum, s) => sum + s.unknownCount, 0),
  };
}

// ─── Vista en vivo — auditoría (prompt §7 / caso de prueba 9) ─────────────

export async function openLiveView(input: { actorUserId: string; branchId: string; cameraId: string }) {
  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "cameras",
    action: "CAMERA_LIVE_VIEW_OPENED",
    entityType: "Camera",
    entityId: input.cameraId,
    metadataJson: { cameraId: input.cameraId },
  });
}
