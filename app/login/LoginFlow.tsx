"use client";

// Login email+PIN (rediseño jul 2026, variante C "cálida").
// Flujo: email → PIN → (clínica si tiene varias) → dentro.
// El dispositivo recuerda al usuario (localStorage, solo nombre/email/longitud
// de PIN — nada sensible) para abrir directamente en "Hola de nuevo" → PIN.
// La validación real vive en /api/auth/identify y /api/auth/select-clinica.

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NumericKeypad } from "../components/auth/NumericKeypad";
import {
  ArrowRight,
  Building2,
  ChevronRight,
  LoaderCircle,
  ICON_STROKE,
} from "../components/icons";

const LAST_USER_KEY = "fyllio.lastUser";
const SELECTED_CLINICA_KEY = "fyllio.selectedClinicaId";
const MAX_PIN = 6;
const MIN_PIN = 4;

type LastUser = { nombre: string; email: string; pinLength: 4 | 6 | null };
type Clinica = { id: string; nombre: string };
type Step = "email" | "pin" | "clinica";

type IdentifyOk =
  | {
      step: "done";
      redirect: string;
      selectedClinicaId: string;
      user: { nombre: string; rol: string; pinLength: 4 | 6 | null };
    }
  | {
      step: "clinica";
      identToken: string;
      user: { nombre: string; rol: string; pinLength: 4 | 6 | null };
      clinicas: Clinica[];
      allowAll: boolean;
    };

function readLastUser(): LastUser | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.nombre === "string" && typeof p?.email === "string") {
      return {
        nombre: p.nombre,
        email: p.email,
        pinLength: p.pinLength === 4 || p.pinLength === 6 ? p.pinLength : null,
      };
    }
  } catch {}
  return null;
}

export function LoginFlow() {
  const router = useRouter();

  const [step, setStep] = useState<Step | null>(null); // null hasta leer localStorage
  const [lastUser, setLastUser] = useState<LastUser | null>(null);
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clinicaCtx, setClinicaCtx] = useState<{
    identToken: string;
    nombre: string;
    clinicas: Clinica[];
    allowAll: boolean;
  } | null>(null);
  const pinRef = useRef(pin);
  pinRef.current = pin;

  useEffect(() => {
    const last = readLastUser();
    setLastUser(last);
    if (last) setEmail(last.email);
    setStep(last ? "pin" : "email");
  }, []);

  function rememberUser(nombre: string, mail: string, pinLength: 4 | 6 | null) {
    try {
      localStorage.setItem(
        LAST_USER_KEY,
        JSON.stringify({ nombre, email: mail, pinLength }),
      );
    } catch {}
  }

  function finish(redirect: string, selectedClinicaId: string) {
    try {
      localStorage.setItem(SELECTED_CLINICA_KEY, selectedClinicaId);
    } catch {}
    router.push(redirect);
    router.refresh();
  }

  async function identify(pinValue: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), pin: pinValue }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setPin("");
        setError(data?.error ?? "No se pudo iniciar sesión. Inténtalo de nuevo.");
        return;
      }
      const ok = data as IdentifyOk;
      rememberUser(ok.user.nombre, email.trim().toLowerCase(), ok.user.pinLength);
      if (ok.step === "done") {
        finish(ok.redirect, ok.selectedClinicaId);
        return;
      }
      setClinicaCtx({
        identToken: ok.identToken,
        nombre: ok.user.nombre,
        clinicas: ok.clinicas,
        allowAll: ok.allowAll,
      });
      setStep("clinica");
    } catch {
      setPin("");
      setError("Sin conexión. Comprueba tu red e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function selectClinica(clinicaId: string) {
    if (busy || !clinicaCtx) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/select-clinica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identToken: clinicaCtx.identToken, clinicaId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.expired) {
          // El token efímero (5 min) caducó: se vuelve a pedir el PIN.
          setClinicaCtx(null);
          setPin("");
          setStep("pin");
          setError("La identificación ha caducado. Vuelve a introducir tu PIN.");
          return;
        }
        setError(data?.error ?? "No se pudo entrar en la clínica. Inténtalo de nuevo.");
        return;
      }
      finish(data.redirect, data.selectedClinicaId);
    } catch {
      setError("Sin conexión. Comprueba tu red e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  function onDigit(d: string) {
    if (busy) return;
    const next = (pinRef.current + d).slice(0, MAX_PIN);
    setPin(next);
    setError(null);
    // Auto-envío cuando conocemos la longitud del PIN de este usuario
    // (guardada tras un login correcto en este dispositivo).
    if (lastUser?.pinLength && next.length === lastUser.pinLength) {
      void identify(next);
    }
  }

  function switchUser() {
    try {
      localStorage.removeItem(LAST_USER_KEY);
    } catch {}
    setLastUser(null);
    setEmail("");
    setPin("");
    setError(null);
    setStep("email");
  }

  if (step === null) {
    // Evita el parpadeo email→hola mientras se lee localStorage.
    return <Shell><div className="h-64" aria-hidden /></Shell>;
  }

  return (
    <Shell>
      {step === "email" && (
        <div className="fyllio-fade-in">
          <h1 className="font-display text-2xl font-semibold text-[var(--color-foreground)]">
            Inicia sesión
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Tu email del equipo y tu PIN personal.
          </p>
          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setPin("");
              setError(null);
              setStep("pin");
            }}
          >
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@clinica.es"
              aria-label="Email"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-center text-sm text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
            />
            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2.5 text-sm font-semibold text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)]"
            >
              Continuar
              <ArrowRight size={15} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          </form>
        </div>
      )}

      {step === "pin" && (
        <div className="fyllio-fade-in">
          {lastUser ? (
            <>
              <div
                className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-accent)] text-base font-bold text-[var(--color-on-accent)]"
                aria-hidden
              >
                {initials(lastUser.nombre)}
              </div>
              <h1 className="font-display mt-3 text-2xl font-semibold text-[var(--color-foreground)]">
                Hola de nuevo, {firstName(lastUser.nombre)}
              </h1>
              <p className="mt-1 text-sm text-[var(--color-muted)]">Introduce tu PIN</p>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-semibold text-[var(--color-foreground)]">
                Tu PIN
              </h1>
              <p className="mt-1 text-sm text-[var(--color-muted)]">{email.trim()}</p>
            </>
          )}

          <PinDots length={Math.max(pin.length, MIN_PIN)} filled={pin.length} />

          <div className="mx-auto max-w-[250px]">
            <NumericKeypad
              onDigit={onDigit}
              onBackspace={() => {
                if (!busy) {
                  setPin(pinRef.current.slice(0, -1));
                  setError(null);
                }
              }}
              disabled={busy}
            />
          </div>

          {/* Sin longitud conocida (primer login aquí): botón Entrar. */}
          {!lastUser?.pinLength && (
            <button
              type="button"
              disabled={busy || pin.length < MIN_PIN}
              onClick={() => void identify(pin)}
              className="mt-4 inline-flex w-full max-w-[250px] items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2.5 text-sm font-semibold text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
            >
              {busy ? (
                <LoaderCircle size={15} strokeWidth={ICON_STROKE} className="animate-spin" aria-hidden />
              ) : (
                "Entrar"
              )}
            </button>
          )}
          {busy && lastUser?.pinLength && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
              <LoaderCircle size={13} strokeWidth={ICON_STROKE} className="animate-spin" aria-hidden />
              Comprobando…
            </p>
          )}

          {error && (
            <p role="alert" className="mt-3 text-xs font-medium text-[var(--color-danger)]">
              {error}
            </p>
          )}

          <p className="mt-5 text-[11px] text-[var(--color-muted)]">
            {lastUser ? (
              <>
                ¿No eres {firstName(lastUser.nombre)}?{" "}
                <button
                  type="button"
                  onClick={switchUser}
                  className="font-semibold text-[var(--color-accent)] hover:underline"
                >
                  Entrar con otro email
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => { setPin(""); setError(null); setStep("email"); }}
                className="font-semibold text-[var(--color-accent)] hover:underline"
              >
                Cambiar de email
              </button>
            )}
          </p>
        </div>
      )}

      {step === "clinica" && clinicaCtx && (
        <div className="fyllio-fade-in">
          <h1 className="font-display text-2xl font-semibold text-[var(--color-foreground)]">
            ¿Dónde trabajas hoy?
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">Tus clínicas</p>
          <div className="mt-5 space-y-2 text-left">
            {clinicaCtx.allowAll && (
              <ClinicaBtn
                nombre="Todas las clínicas"
                onClick={() => void selectClinica("__all__")}
                disabled={busy}
              />
            )}
            {clinicaCtx.clinicas.map((c) => (
              <ClinicaBtn
                key={c.id}
                nombre={c.nombre}
                onClick={() => void selectClinica(c.id)}
                disabled={busy}
              />
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-3 text-xs font-medium text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}

// ─── Piezas visuales (variante C) ────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[var(--color-background)] p-6 text-[var(--color-foreground)]"
      style={{
        background:
          "radial-gradient(640px 400px at 50% 0%, var(--color-accent-soft), transparent 75%) var(--color-background)",
      }}
    >
      <div className="w-full max-w-sm text-center">
        <Image src="/isotipo.png" alt="Fyllio" width={48} height={48} priority className="mx-auto h-12 w-12" />
        <div className="mt-6">{children}</div>
        <p className="mt-10 text-[11px] text-[var(--color-muted)]">
          <Link href="/login/clasico" className="hover:underline">
            Acceso clásico por clínica
          </Link>
        </p>
      </div>
    </main>
  );
}

function PinDots({ length, filled }: { length: number; filled: number }) {
  return (
    <div className="my-5 flex justify-center gap-2.5" aria-label={`PIN: ${filled} dígitos introducidos`}>
      {Array.from({ length }, (_, i) => (
        <span
          key={i}
          className={`h-3 w-3 rounded-full border transition-colors ${
            i < filled
              ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
              : "border-[var(--color-border)]"
          }`}
        />
      ))}
    </div>
  );
}

function ClinicaBtn({
  nombre,
  onClick,
  disabled,
}: {
  nombre: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:opacity-50"
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
        aria-hidden
      >
        <Building2 size={16} strokeWidth={ICON_STROKE} />
      </span>
      <span className="flex-1 text-sm font-semibold text-[var(--color-foreground)]">{nombre}</span>
      <ChevronRight size={15} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" aria-hidden />
    </button>
  );
}

function firstName(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? nombre;
}

function initials(nombre: string): string {
  const parts = nombre.trim().split(/\s+/);
  const first = parts[0]?.charAt(0) ?? "";
  const second = parts[1]?.charAt(0) ?? "";
  return (first + second).toUpperCase() || "F";
}
