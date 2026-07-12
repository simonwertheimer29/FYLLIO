"use client";

// Demo visual — 3 variantes del NUEVO flujo de login para elegir una.
// Flujo simulado (sin lógica real): (1) identificación email+PIN,
// (2) selección de clínica si el usuario tiene varias, (3) vuelta
// "Hola de nuevo, [nombre]" → PIN → clínica.
// Todo acepta cualquier PIN y no llama a ningún API. La versión real
// añadirá bloqueo persistente tras intentos fallidos (fail-closed).

import Image from "next/image";
import { useEffect, useState } from "react";
import { NumericKeypad } from "../../components/auth/NumericKeypad";
import { ThemeToggle } from "../../components/layout/ThemeToggle";
import {
  ArrowRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  ICON_STROKE,
} from "../../components/icons";

// ─── Datos ficticios de la demo ──────────────────────────────────────────

const DEMO_USER = { nombre: "Lucía", apellido: "Fernández", email: "lucia@rbclinicas.es" };
const DEMO_CLINICS = [
  { id: "melilla", nombre: "RB Melilla" },
  { id: "madrid", nombre: "RB Madrid" },
];

type Variant = "a" | "b" | "c";
type Step = "id" | "pin" | "clinicas" | "dentro";

// ─── Página ──────────────────────────────────────────────────────────────

export function VariantesDemo() {
  const [variant, setVariant] = useState<Variant>("a");
  const [recordada, setRecordada] = useState(true);
  const [multiClinica, setMultiClinica] = useState(true);
  const [runKey, setRunKey] = useState(0);

  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)]">
      {/* Barra de control de la demo */}
      <div className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-[var(--color-muted)]">
            Demo visual — nada funciona de verdad
          </span>
          <div className="ml-auto flex items-center gap-1">
            {(["a", "b", "c"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setVariant(v); setRunKey((k) => k + 1); }}
                className={`h-7 w-7 rounded-md text-xs font-bold transition-colors ${
                  variant === v
                    ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                    : "border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                }`}
              >
                {v.toUpperCase()}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
            <ThemeToggle />
          </div>
          <div className="flex w-full flex-wrap items-center gap-3 text-[11px] text-[var(--color-muted)]">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={recordada}
                onChange={(e) => { setRecordada(e.target.checked); setRunKey((k) => k + 1); }}
                className="accent-[var(--color-accent)]"
              />
              Usuaria recordada en este dispositivo ("Hola de nuevo")
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={multiClinica}
                onChange={(e) => { setMultiClinica(e.target.checked); setRunKey((k) => k + 1); }}
                className="accent-[var(--color-accent)]"
              />
              Tiene 2 clínicas (sin marcar: entra directo a la única)
            </label>
            <button
              type="button"
              onClick={() => setRunKey((k) => k + 1)}
              className="ml-auto font-semibold text-[var(--color-accent)] hover:underline"
            >
              Reiniciar demo
            </button>
          </div>
        </div>
      </div>

      <Flow key={`${variant}-${runKey}`} variant={variant} recordada={recordada} multiClinica={multiClinica} />
    </div>
  );
}

// ─── Flujo simulado (compartido por las 3 variantes) ─────────────────────

function Flow({ variant, recordada, multiClinica }: { variant: Variant; recordada: boolean; multiClinica: boolean }) {
  const [step, setStep] = useState<Step>(recordada ? "pin" : "id");
  const [pin, setPin] = useState("");
  const clinics = multiClinica ? DEMO_CLINICS : DEMO_CLINICS.slice(0, 1);

  // Con 4 dígitos: si tiene varias clínicas → elegir; si una → dentro.
  useEffect(() => {
    if (pin.length === 4) {
      const t = setTimeout(() => setStep(clinics.length > 1 ? "clinicas" : "dentro"), 250);
      return () => clearTimeout(t);
    }
  }, [pin, clinics.length]);

  const stepNode =
    step === "id" ? (
      <IdStep variant={variant} onNext={() => setStep("pin")} />
    ) : step === "pin" ? (
      <PinStep variant={variant} recordada={recordada} pin={pin} setPin={setPin} onBack={() => { setPin(""); setStep("id"); }} />
    ) : step === "clinicas" ? (
      <ClinicStep variant={variant} clinics={clinics} onPick={() => setStep("dentro")} />
    ) : (
      <DoneStep clinics={clinics} multiClinica={multiClinica} />
    );

  if (variant === "b") return <ShellB>{stepNode}</ShellB>;
  if (variant === "c") return <ShellC>{stepNode}</ShellC>;
  return <ShellA>{stepNode}</ShellA>;
}

// ─── Shells: el "chrome" visual de cada variante ─────────────────────────

/** A · Banca médica: columna sobria, señal de seguridad, hairlines. */
function ShellA({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-[calc(100vh-88px)] items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <Image src="/isotipo.png" alt="" width={36} height={36} className="h-9 w-9" />
          <span className="font-display text-lg font-extrabold tracking-tight">fyllio</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
            <ShieldCheck size={13} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
            Conexión segura
          </span>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
          {children}
        </div>
        <p className="mt-6 text-center text-[11px] text-[var(--color-muted)]">
          Acceso restringido al equipo de las clínicas.
        </p>
      </div>
    </main>
  );
}

/** B · Marca: panel/banda con degradado IA + isotipo + tagline. */
function ShellB({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-[calc(100vh-88px)] flex-col lg:flex-row">
      <div className="fyllio-ia-gradient relative flex items-start p-8 lg:w-[42%] lg:items-center lg:p-12">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(220px 220px at 80% 15%, rgb(255 255 255 / .18), transparent 70%)" }}
          aria-hidden
        />
        <div className="relative">
          <Image src="/isotipo.png" alt="" width={72} height={72} className="h-16 w-16 lg:h-[72px] lg:w-[72px] drop-shadow-lg" />
          <p className="font-display mt-4 text-2xl font-extrabold leading-tight tracking-tight lg:text-3xl">
            Tu día, en orden.
          </p>
          <p className="mt-1 text-sm opacity-85">El asistente de tu clínica</p>
        </div>
      </div>
      <div className="flex flex-1 items-start justify-center p-6 lg:items-center">
        <div className="-mt-10 w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl lg:mt-0 lg:shadow-none">
          {children}
        </div>
      </div>
    </main>
  );
}

/** C · Cálida: tipografía grande, chrome mínimo, lavado suave de acento. */
function ShellC({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="flex min-h-[calc(100vh-88px)] items-center justify-center p-6"
      style={{ background: "radial-gradient(600px 380px at 50% 0%, var(--color-accent-soft), transparent 75%)" }}
    >
      <div className="w-full max-w-sm text-center">
        <Image src="/isotipo.png" alt="" width={48} height={48} className="mx-auto h-12 w-12" />
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

// ─── Pasos del flujo ─────────────────────────────────────────────────────

/** Paso 1 (primera vez): identificarse con email. */
function IdStep({ variant, onNext }: { variant: Variant; onNext: () => void }) {
  const [email, setEmail] = useState("");
  const center = variant === "c";
  return (
    <div className={center ? "text-center" : ""}>
      <h1 className={`font-display font-semibold text-[var(--color-foreground)] ${center ? "text-2xl" : "text-xl"}`}>
        Inicia sesión
      </h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Tu email del equipo y tu PIN personal.
      </p>
      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => { e.preventDefault(); onNext(); }}
      >
        <div className={center ? "" : "space-y-1"}>
          {!center && (
            <label htmlFor="demo-email" className="text-xs font-medium text-[var(--color-muted)]">
              Email
            </label>
          )}
          <input
            id="demo-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="lucia@rbclinicas.es"
            className={`w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm text-[var(--color-foreground)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)] ${center ? "text-center" : ""}`}
          />
        </div>
        <button
          type="submit"
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2.5 text-sm font-semibold text-[var(--color-on-accent)] transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          Continuar
          <ArrowRight size={15} strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      </form>
    </div>
  );
}

/** Paso 2: PIN — con saludo si la usuaria está recordada. */
function PinStep({
  variant,
  recordada,
  pin,
  setPin,
  onBack,
}: {
  variant: Variant;
  recordada: boolean;
  pin: string;
  setPin: (v: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="text-center">
      {recordada ? (
        <>
          <div
            className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-accent)] text-base font-bold text-[var(--color-on-accent)]"
            aria-hidden
          >
            {DEMO_USER.nombre.charAt(0)}
            {DEMO_USER.apellido.charAt(0)}
          </div>
          <h1 className={`font-display mt-3 font-semibold text-[var(--color-foreground)] ${variant === "c" ? "text-2xl" : "text-xl"}`}>
            Hola de nuevo, {DEMO_USER.nombre}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">Introduce tu PIN</p>
        </>
      ) : (
        <>
          <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">Tu PIN</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{DEMO_USER.email}</p>
        </>
      )}

      <div className="my-5 flex justify-center gap-2.5" aria-label={`PIN: ${pin.length} de 4 dígitos`}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-full border ${
              i < pin.length
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                : "border-[var(--color-border)]"
            }`}
          />
        ))}
      </div>

      <div className="mx-auto max-w-[250px]">
        <NumericKeypad
          onDigit={(d) => { if (pin.length < 4) setPin(pin + d); }}
          onBackspace={() => setPin(pin.slice(0, -1))}
          disabled={pin.length >= 4}
        />
      </div>

      <div className="mt-5 text-[11px] text-[var(--color-muted)]">
        {recordada ? (
          <>
            ¿No eres {DEMO_USER.nombre}?{" "}
            <button type="button" onClick={onBack} className="font-semibold text-[var(--color-accent)] hover:underline">
              Entrar con otro email
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 font-semibold text-[var(--color-accent)] hover:underline"
          >
            <ChevronLeft size={12} strokeWidth={ICON_STROKE} aria-hidden />
            Cambiar de email
          </button>
        )}
      </div>
    </div>
  );
}

/** Paso 3: elegir clínica (solo si tiene varias). */
function ClinicStep({
  variant,
  clinics,
  onPick,
}: {
  variant: Variant;
  clinics: typeof DEMO_CLINICS;
  onPick: () => void;
}) {
  return (
    <div className={variant === "c" ? "text-center" : ""}>
      <h1 className={`font-display font-semibold text-[var(--color-foreground)] ${variant === "c" ? "text-2xl" : "text-xl"}`}>
        ¿Dónde trabajas hoy?
      </h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">Tus clínicas</p>
      <div className="mt-4 space-y-2 text-left">
        {clinics.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={onPick}
            className="flex w-full items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)]" aria-hidden>
              <Building2 size={16} strokeWidth={ICON_STROKE} />
            </span>
            <span className="flex-1 text-sm font-semibold text-[var(--color-foreground)]">{c.nombre}</span>
            <ChevronRight size={15} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Estado final de la demo: confirma qué habría pasado. */
function DoneStep({ clinics, multiClinica }: { clinics: typeof DEMO_CLINICS; multiClinica: boolean }) {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)]" aria-hidden>
        <ShieldCheck size={20} strokeWidth={ICON_STROKE} />
      </div>
      <h1 className="font-display mt-3 text-xl font-semibold text-[var(--color-foreground)]">Dentro</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        {multiClinica
          ? `Aquí entrarías en la clínica elegida.`
          : `Con una sola clínica (${clinics[0]!.nombre}) se entra directo, sin elegir.`}
      </p>
      <p className="mt-4 text-[11px] text-[var(--color-muted)]">
        Fin de la demo — usa "Reiniciar demo" arriba para repetir el flujo.
      </p>
    </div>
  );
}
