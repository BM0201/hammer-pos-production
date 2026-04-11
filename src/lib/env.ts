import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_SESSION_SECRET: z.string().min(32),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(12),
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_SESSION_SECRET: process.env.AUTH_SESSION_SECRET,
  AUTH_SESSION_TTL_HOURS: process.env.AUTH_SESSION_TTL_HOURS ?? "12",
});
