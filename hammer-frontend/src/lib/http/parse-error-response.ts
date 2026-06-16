const FALLBACK_MESSAGE = "No se pudo iniciar sesión. Inténtalo de nuevo.";
const INVALID_CREDENTIALS_MESSAGE = "Usuario o contraseña inválidos.";
const FORBIDDEN_MESSAGE = "No tienes permisos para acceder.";

function getFallbackMessageByStatus(status: number): string {
  if (status === 401) {
    return INVALID_CREDENTIALS_MESSAGE;
  }
  if (status === 403) {
    return FORBIDDEN_MESSAGE;
  }
  return FALLBACK_MESSAGE;
}

function parseMessageFromUnknown(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = (value as { message?: unknown }).message;
  if (typeof candidate !== "string") {
    return null;
  }

  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function parseErrorResponse(response: Response): Promise<{ message: string }> {
  const statusFallback = getFallbackMessageByStatus(response.status);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("application/json")) {
    try {
      const payload = await response.json();
      return { message: parseMessageFromUnknown(payload) ?? statusFallback };
    } catch {
      return { message: statusFallback };
    }
  }

  try {
    const raw = await response.text();
    const trimmed = raw.trim();
    if (!trimmed) {
      return { message: statusFallback };
    }

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const payload = JSON.parse(trimmed) as unknown;
        return { message: parseMessageFromUnknown(payload) ?? statusFallback };
      } catch {
        return { message: statusFallback };
      }
    }

    return { message: statusFallback };
  } catch {
    return { message: statusFallback };
  }
}
