"use client";

import { useEffect, useState } from "react";
import { apiFetch, unwrapApiData, type ApiResponse } from "@/lib/client/api";
import {
  ShieldCheck,
  ShieldOff,
  QrCode,
  Copy,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type MfaStatus = {
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  remainingRecoveryCodes: number;
};

type SetupData = {
  secret: string;
  otpauthUri: string;
};

type Step = "idle" | "setup" | "confirm" | "recoveryCodes" | "disable";

export default function MfaSetupPage() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [step, setStep] = useState<Step>("idle");
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadStatus() {
    const res = await apiFetch("/api/account/mfa");
    const json = await res.json();
    if (res.ok) setStatus(unwrapApiData(json as ApiResponse<MfaStatus>));
  }

  useEffect(() => { loadStatus(); }, []);

  async function startSetup() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/account/mfa", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError("No se pudo iniciar la configuración.");
        return;
      }
      setSetupData(unwrapApiData(json as ApiResponse<SetupData>));
      setStep("setup");
    } finally {
      setLoading(false);
    }
  }

  async function confirmSetup() {
    if (!totpCode) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/account/mfa", {
        method: "PUT",
        body: JSON.stringify({ code: totpCode }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = (json as ApiResponse<unknown>);
        setError(
          !msg.ok && "error" in msg && typeof msg.error === "object" && msg.error && "message" in msg.error
            ? (msg.error as { message: string }).message
            : "Código incorrecto.",
        );
        setTotpCode("");
        return;
      }
      const data = unwrapApiData(json as ApiResponse<{ recoveryCodes: string[] }>);
      setRecoveryCodes(data.recoveryCodes);
      setStep("recoveryCodes");
      await loadStatus();
    } finally {
      setLoading(false);
    }
  }

  async function disableMfa() {
    if (!disableCode) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/account/mfa", {
        method: "DELETE",
        body: JSON.stringify({ code: disableCode }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = (json as ApiResponse<unknown>);
        setError(
          !msg.ok && "error" in msg && typeof msg.error === "object" && msg.error && "message" in msg.error
            ? (msg.error as { message: string }).message
            : "Código incorrecto.",
        );
        setDisableCode("");
        return;
      }
      setStep("idle");
      setDisableCode("");
      await loadStatus();
    } finally {
      setLoading(false);
    }
  }

  function copySecret() {
    if (!setupData) return;
    navigator.clipboard.writeText(setupData.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const fmt = (d: string) =>
    new Date(d).toLocaleString("es-NI", { dateStyle: "medium", timeStyle: "short" });

  return (
    <section className="space-y-6 max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-8 w-1 rounded-full bg-violet-500 flex-shrink-0" />
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">
            Autenticación en dos pasos (MFA)
          </h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Protege tu cuenta con un código adicional al iniciar sesión
          </p>
        </div>
      </div>

      {/* Current status */}
      {status && step === "idle" && (
        <div className="erp-card p-5 space-y-4">
          <div className="flex items-center gap-3">
            {status.mfaEnabled ? (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-50 text-green-600">
                <ShieldCheck className="h-5 w-5" />
              </span>
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-50 text-orange-600">
                <ShieldOff className="h-5 w-5" />
              </span>
            )}
            <div>
              <p className="font-semibold text-sm text-[var(--color-text)]">
                {status.mfaEnabled ? "MFA activo" : "MFA desactivado"}
              </p>
              {status.mfaEnabled && status.mfaEnabledAt && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Activado el {fmt(status.mfaEnabledAt)} · {status.remainingRecoveryCodes} código
                  {status.remainingRecoveryCodes !== 1 ? "s" : ""} de recuperación restante
                  {status.remainingRecoveryCodes !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>

          {status.mfaEnabled ? (
            <Button
              variant="danger"
              onClick={() => { setStep("disable"); setError(null); }}
              icon={<ShieldOff className="h-4 w-4" />}
            >
              Desactivar MFA
            </Button>
          ) : (
            <div className="space-y-2">
              {status.remainingRecoveryCodes === 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 text-xs">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <p>
                    <strong>Recomendado:</strong> Los usuarios MASTER, OWNER y SYSTEM_ADMIN deben tener MFA activo para mayor seguridad.
                  </p>
                </div>
              )}
              <Button
                variant="primary"
                onClick={startSetup}
                loading={loading}
                icon={<ShieldCheck className="h-4 w-4" />}
              >
                Activar MFA
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Step: show QR / secret */}
      {step === "setup" && setupData && (
        <div className="erp-card p-5 space-y-5">
          <h2 className="font-semibold text-[var(--color-text)]">1. Escanea o ingresa el secreto</h2>
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text-muted)]">
              Abre tu aplicación de autenticación (Google Authenticator, Authy, etc.) y escanea
              el código QR o ingresa el secreto manualmente.
            </p>
            {/* QR placeholder — show URI link for manual add */}
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 text-center">
              <QrCode className="h-8 w-8 mx-auto mb-2 text-[var(--color-text-muted)]" />
              <p className="text-xs text-[var(--color-text-muted)] mb-2">
                Copia el enlace a tu aplicación de autenticación:
              </p>
              <a
                href={setupData.otpauthUri}
                className="text-xs text-blue-600 underline break-all"
              >
                {setupData.otpauthUri}
              </a>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--color-text-muted)]">O ingresa el secreto manualmente:</p>
              <div className="flex gap-2">
                <code className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-xs font-mono tracking-widest text-[var(--color-text)]">
                  {setupData.secret}
                </code>
                <button
                  onClick={copySecret}
                  className="flex items-center gap-1 rounded border border-[var(--color-border)] px-2 text-xs text-[var(--color-text-soft)] hover:bg-[var(--color-surface-raised)] transition-colors"
                >
                  {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
            </div>
          </div>

          <h2 className="font-semibold text-[var(--color-text)]">2. Confirma con un código</h2>
          <div className="space-y-3">
            <Input
              placeholder="000000"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              maxLength={6}
              inputMode="numeric"
              className="text-center text-lg tracking-widest"
            />
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <div className="flex gap-2">
              <Button variant="primary" onClick={confirmSetup} loading={loading}>
                Confirmar y activar MFA
              </Button>
              <Button variant="ghost" onClick={() => { setStep("idle"); setError(null); }}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Step: recovery codes */}
      {step === "recoveryCodes" && (
        <div className="erp-card p-5 space-y-4">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="h-5 w-5" />
            <h2 className="font-semibold">MFA activado correctamente</h2>
          </div>
          <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-300 text-yellow-800 text-sm">
            <strong>Guarda estos códigos de recuperación en un lugar seguro.</strong>
            <br />
            Úsalos si pierdes acceso a tu aplicación de autenticación. Cada código solo puede usarse una vez.
          </div>
          <div className="grid grid-cols-2 gap-2">
            {recoveryCodes.map((c, i) => (
              <code key={i} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 text-xs font-mono text-center">
                {c}
              </code>
            ))}
          </div>
          <Button variant="primary" onClick={() => setStep("idle")}>
            Ya los guardé, continuar
          </Button>
        </div>
      )}

      {/* Step: disable MFA */}
      {step === "disable" && (
        <div className="erp-card p-5 space-y-4">
          <h2 className="font-semibold text-[var(--color-text)]">Desactivar MFA</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            Ingresa tu código TOTP actual (o un código de recuperación) para confirmar.
          </p>
          <Input
            placeholder="000000"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            maxLength={10}
            inputMode="numeric"
            className="text-center text-lg tracking-widest"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button variant="danger" onClick={disableMfa} loading={loading}>
              Desactivar MFA
            </Button>
            <Button variant="ghost" onClick={() => { setStep("idle"); setError(null); }}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
