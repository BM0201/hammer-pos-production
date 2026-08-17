import { z } from "zod";

const CAMERA_HEALTH_STATES = [
  "OFFLINE", "NO_STREAM", "NO_FRAMES", "FROZEN", "BLACK", "BLURRY", "MOVED", "DEGRADED", "OK",
] as const; // UNKNOWN nunca lo manda el agente -- lo deriva el servidor

export const heartbeatSchema = z.object({
  protocolVersion: z.number().int().positive(),
  agentVersion: z.string().min(1),
  branchId: z.string().cuid(),
  nvrReachable: z.boolean(),
  cameras: z.array(z.object({
    cameraId: z.string().cuid(),
    state: z.enum(CAMERA_HEALTH_STATES),
  })),
});

export const registerCameraSchema = z.object({
  branchId: z.string().cuid(),
  name: z.string().min(1),
  location: z.enum(["CAJA", "DESPACHO", "PATIO", "PASILLO", "OTRO"]),
  networkSegment: z.string().optional().nullable(),
  ipAddress: z.string().min(1),
  onvifPort: z.number().int().positive().optional(),
  rtspChannel: z.string().optional().nullable(),
  manufacturer: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  credentials: z.object({ username: z.string().min(1), password: z.string().min(1) }),
});

export const openLiveViewSchema = z.object({
  branchId: z.string().cuid(),
});
