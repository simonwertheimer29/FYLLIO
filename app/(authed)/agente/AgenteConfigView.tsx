"use client";

// FASE D — CONFIGURACIÓN DEL AGENTE. Por ahora, el grupo 2 (QUÉ SABE EL
// AGENTE): es el único que cambia lo que el agente DICE — con esto cargado
// pasa de aplazar a contestar. Los grupos 1, 3, 4 y 5 se añaden aquí, en
// esta misma pantalla, en el orden del onboarding.
//
// TRES REGLAS DE ESTA PANTALLA (dictadas, PLAN §6):
//   · Cada campo enseña su CONSECUENCIA, no una advertencia: la clínica está
//     decidiendo cuánto trabajo hace la máquina y cuánto su coordinadora.
//   · El BARRIDO de arriba se DERIVA de la config (capacidadesDe, código
//     puro) — jamás se le pregunta al modelo qué cree que puede hacer. En
//     positivo y EN NEGATIVO; los límites del producto, aparte.
//   · El PROMPT es visible: el bloque se calcula con LA MISMA función que
//     usa el evaluador (renderConocimiento) sobre lo que hay en el
//     formulario — lo que lees es lo que entra.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useClinic } from "../../lib/context/ClinicContext";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { ErrorState } from "../../components/ui/Feedback";
import {
  Sparkles,
  Check,
  X,
  Plus,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  ICON_STROKE,
} from "../../components/icons";
import {
  capacidadesDe,
  renderConocimiento,
  REGLAS_DURAS,
  type ConocimientoClinica,
} from "../../lib/agente/conocimiento";

type RespuestaConfig = {
  conocimiento: ConocimientoClinica;
  evaluadorActivo: boolean;
  bloquePrompt: string;
  systemPrompt: string;
};

export function AgenteConfigView() {
  const { selectedClinicaId, clinicas, session } = useClinic();
  const [config, setConfig] = useState<ConocimientoClinica | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string>("");
  const [evaluadorActivo, setEvaluadorActivo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [verPrompt, setVerPrompt] = useState(false);
  const [verSystem, setVerSystem] = useState(false);

  const nombreClinica =
    clinicas.find((c) => c.id === selectedClinicaId)?.nombre ?? null;

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const params = selectedClinicaId ? `?clinicaId=${encodeURIComponent(selectedClinicaId)}` : "";
      const d = await cargarJSON<RespuestaConfig>(`/api/agente/configuracion${params}`);
      setConfig(d.conocimiento);
      setSystemPrompt(d.systemPrompt);
      setEvaluadorActivo(d.evaluadorActivo);
    } catch (e) {
      // Conservar lo último bueno + error honesto (§10): el formulario no se
      // vacía — vaciarlo y dejar guardar PISARÍA la config que no se pudo leer.
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, [selectedClinicaId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardar() {
    if (!config || guardando) return;
    setGuardando(true);
    try {
      await cargarJSON("/api/agente/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicaId: selectedClinicaId, conocimiento: config }),
      });
      toast.success("Configuración guardada — el agente la usa desde el próximo mensaje");
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  // El barrido y el bloque, EN VIVO sobre el formulario: la lista cambia
  // mientras escribes, que es como la clínica ve la consecuencia.
  const barrido = useMemo(() => (config ? capacidadesDe(config) : null), [config]);
  const bloque = useMemo(() => (config ? renderConocimiento(config).join("\n") : ""), [config]);

  if (session.rol !== "admin") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm text-[var(--color-muted)]">
          La configuración del agente la gestiona la administración de la red.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 lg:px-6">
      <header>
        <h1 className="font-display flex items-center gap-2 text-xl font-semibold text-[var(--color-foreground)]">
          <Sparkles size={18} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
          Configuración del agente
        </h1>
        <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">
          {nombreClinica ? `Para ${nombreClinica}` : "Para toda la red (las clínicas sin configuración propia usan esta)"}
          {" · "}
          {evaluadorActivo ? "el agente está ENCENDIDO aquí" : "el agente está apagado aquí — la configuración se aplica al encenderlo"}
        </p>
      </header>

      {error && (
        <ErrorState detail={`La configuración no se pudo cargar. ${error}`} onRetry={cargar} />
      )}
      {cargando && !config && !error && (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-[var(--color-surface-muted)]" />
          ))}
        </div>
      )}

      {config && barrido && (
        <>
          {/* ── EL BARRIDO: qué puede hacer con ESTA configuración ────── */}
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h2 className="font-display text-[15px] font-semibold text-[var(--color-foreground)]">
              Con esta configuración, tu agente…
            </h2>
            <ul className="mt-2.5 space-y-1.5">
              {barrido.puede.map((p) => (
                <li key={p} className="flex gap-2 text-[13px] text-[var(--color-foreground)]">
                  <Check size={15} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-success)]" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
              {barrido.noPuede.map((p) => (
                <li key={p} className="flex gap-2 text-[13px] text-[var(--color-muted)]">
                  <X size={15} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-danger)]" aria-hidden />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-[var(--color-border)] pt-2.5">
              {barrido.limites.map((l) => (
                <p key={l} className="flex gap-2 text-[12px] text-[var(--color-muted)]">
                  <ShieldCheck size={14} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" aria-hidden />
                  <span>{l}</span>
                </p>
              ))}
            </div>
          </section>

          {/* ── GRUPO 2 · Qué sabe el agente ──────────────────────────── */}
          <Seccion
            titulo="Tratamientos y precios publicados"
            consecuencia="Si cargas tu tabla de precios, el agente contesta cuánto cuesta; si no, lo aplaza y lo resuelve tu equipo. Un tratamiento sin precio se menciona, pero sin cifra."
          >
            {config.tratamientos.map((t, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <input
                  value={t.nombre}
                  onChange={(e) => setConfig(actualizaLista(config, "tratamientos", i, { ...t, nombre: e.target.value }))}
                  placeholder="Tratamiento (p. ej. Ortodoncia invisible)"
                  className={INPUT + " min-w-[12rem] flex-1"}
                />
                <input
                  value={t.precio ?? ""}
                  onChange={(e) => setConfig(actualizaLista(config, "tratamientos", i, { ...t, precio: e.target.value || null }))}
                  placeholder="Precio publicado (desde 35 €/mes)"
                  className={INPUT + " w-56"}
                />
                <input
                  value={t.nota ?? ""}
                  onChange={(e) => setConfig(actualizaLista(config, "tratamientos", i, { ...t, nota: e.target.value || null }))}
                  placeholder="Nota (financiación 24 meses)"
                  className={INPUT + " w-52"}
                />
                <BotonQuitar onClick={() => setConfig(quitaDeLista(config, "tratamientos", i))} />
              </div>
            ))}
            <BotonAnadir
              etiqueta="Añadir tratamiento"
              onClick={() => setConfig({ ...config, tratamientos: [...config.tratamientos, { nombre: "", precio: null, nota: null }] })}
            />
          </Seccion>

          <Seccion
            titulo="Políticas publicadas"
            consecuencia="Vías de pago, seguros con los que trabajáis, cancelaciones… Lo que publiques aquí, el agente lo contesta tal cual. Adaptarlo a una persona concreta (su descuento, su cobertura) siempre lo hace tu equipo."
          >
            {config.politicas.map((p, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <input
                  value={p.titulo}
                  onChange={(e) => setConfig(actualizaLista(config, "politicas", i, { ...p, titulo: e.target.value }))}
                  placeholder="Título (Vías de pago)"
                  className={INPUT + " w-56"}
                />
                <textarea
                  value={p.texto}
                  onChange={(e) => setConfig(actualizaLista(config, "politicas", i, { ...p, texto: e.target.value }))}
                  placeholder="Texto publicado (Efectivo, tarjeta y financiación hasta 24 meses sin intereses)"
                  rows={2}
                  className={INPUT + " min-w-[16rem] flex-1 resize-y"}
                />
                <BotonQuitar onClick={() => setConfig(quitaDeLista(config, "politicas", i))} />
              </div>
            ))}
            <BotonAnadir
              etiqueta="Añadir política"
              onClick={() => setConfig({ ...config, politicas: [...config.politicas, { titulo: "", texto: "" }] })}
            />
          </Seccion>

          <Seccion
            titulo="Horario de atención"
            consecuencia="Si lo publicas, el agente contesta «¿a qué hora abrís?»; si no, lo aplaza. Es el horario que se DICE — el que calcula los plazos de respuesta es el de la ficha de la clínica."
          >
            <input
              value={config.horarios ?? ""}
              onChange={(e) => setConfig({ ...config, horarios: e.target.value || null })}
              placeholder="L-V 9:30–20:00, sábados 10–14"
              className={INPUT + " w-full max-w-xl"}
            />
          </Seccion>

          <Seccion
            titulo="Enlaces"
            consecuencia="Reserva online, web, cómo llegar… El agente los comparte cuando vienen a cuento. Solo direcciones completas (https://…)."
          >
            {config.enlaces.map((e, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <input
                  value={e.etiqueta}
                  onChange={(ev) => setConfig(actualizaLista(config, "enlaces", i, { ...e, etiqueta: ev.target.value }))}
                  placeholder="Etiqueta (Reserva online)"
                  className={INPUT + " w-56"}
                />
                <input
                  value={e.url}
                  onChange={(ev) => setConfig(actualizaLista(config, "enlaces", i, { ...e, url: ev.target.value }))}
                  placeholder="https://tuclinica.es/reserva"
                  className={INPUT + " min-w-[16rem] flex-1"}
                />
                <BotonQuitar onClick={() => setConfig(quitaDeLista(config, "enlaces", i))} />
              </div>
            ))}
            <BotonAnadir
              etiqueta="Añadir enlace"
              onClick={() => setConfig({ ...config, enlaces: [...config.enlaces, { etiqueta: "", url: "" }] })}
            />
          </Seccion>

          {/* ── REGLAS DURAS: se leen, no se editan ───────────────────── */}
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4">
            <h2 className="font-display flex items-center gap-1.5 text-[15px] font-semibold text-[var(--color-foreground)]">
              <ShieldCheck size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
              Lo que el agente no hace nunca
            </h2>
            <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
              Estas reglas no se configuran: las revisa un control independiente antes de cada mensaje.
            </p>
            <ul className="mt-2 space-y-1">
              {REGLAS_DURAS.map((r) => (
                <li key={r} className="text-[13px] text-[var(--color-foreground)]">· {r}</li>
              ))}
            </ul>
          </section>

          {/* ── EL PROMPT, VISIBLE ────────────────────────────────────── */}
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <h2 className="font-display text-[15px] font-semibold text-[var(--color-foreground)]">
              Lo que se le dice al agente
            </h2>
            <button
              type="button"
              onClick={() => setVerPrompt((v) => !v)}
              className="mt-2 flex items-center gap-1 text-[13px] font-semibold text-[var(--color-accent)]"
            >
              {verPrompt ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              Lo publicado que entra en cada conversación
            </button>
            {verPrompt && (
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-surface-muted)] p-3 text-[12px] leading-relaxed text-[var(--color-foreground)]">
                {bloque || "(nada publicado todavía — el agente aplaza precios, horarios y políticas)"}
              </pre>
            )}
            <button
              type="button"
              onClick={() => setVerSystem((v) => !v)}
              className="mt-2 flex items-center gap-1 text-[13px] font-semibold text-[var(--color-accent)]"
            >
              {verSystem ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              Las instrucciones base, completas
            </button>
            {verSystem && (
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-surface-muted)] p-3 text-[12px] leading-relaxed text-[var(--color-foreground)]">
                {systemPrompt}
              </pre>
            )}
          </section>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={guardar}
              disabled={guardando}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar configuración"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const INPUT =
  "rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[13px] text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none";

function Seccion({
  titulo,
  consecuencia,
  children,
}: {
  titulo: string;
  /** LA CONSECUENCIA, no una advertencia: qué hace la máquina si lo
   *  rellenas, y quién lo hace si no. */
  consecuencia: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="font-display text-[15px] font-semibold text-[var(--color-foreground)]">{titulo}</h2>
      <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--color-muted)]">{consecuencia}</p>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function BotonAnadir({ etiqueta, onClick }: { etiqueta: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-[12.5px] font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
    >
      <Plus size={14} strokeWidth={ICON_STROKE} aria-hidden />
      {etiqueta}
    </button>
  );
}

function BotonQuitar({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Quitar"
      aria-label="Quitar"
      className="mt-1.5 shrink-0 rounded-md p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-danger)]"
    >
      <X size={15} strokeWidth={ICON_STROKE} aria-hidden />
    </button>
  );
}

function actualizaLista<K extends "tratamientos" | "politicas" | "enlaces">(
  c: ConocimientoClinica,
  campo: K,
  i: number,
  valor: ConocimientoClinica[K][number],
): ConocimientoClinica {
  const lista = [...c[campo]] as ConocimientoClinica[K];
  (lista as unknown[])[i] = valor;
  return { ...c, [campo]: lista };
}

function quitaDeLista(
  c: ConocimientoClinica,
  campo: "tratamientos" | "politicas" | "enlaces",
  i: number,
): ConocimientoClinica {
  return { ...c, [campo]: c[campo].filter((_, j) => j !== i) as never };
}
