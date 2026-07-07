"use client";

// Sprint 8 D.7 — Alertas: lista de clínicas con situaciones pendientes
// agrupadas por tipo. Admin puede disparar alerta WA por clínica+tipo
// con cooldown 2h. Respeta ClinicContext (filtra por clínica del header).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useClinic } from "../../lib/context/ClinicContext";
import { Bell, CheckCircle2, ICON_STROKE } from "../../components/icons";
import { StatePill } from "../../components/ui/StatePill";
import { EmptyState, ErrorState } from "../../components/ui/Feedback";

type Tipo =
  | "leads"
  | "presupuestos"
  | "citados"
  | "asistencias"
  | "automatizaciones"
  // Sprint 14b Bloque 3 — cobros financieros.
  | "cobro_vence_3d"
  | "cobro_vencido_7d"
  | "pendiente_alto_estancado";

type Card = {
  clinicaId: string;
  clinicaNombre: string;
  counts: Record<Tipo, number>;
  cooldowns: Partial<Record<Tipo, { untilMs: number } | null>>;
};

const TIPO_LABEL: Record<Tipo, string> = {
  leads: "Leads sin gestionar",
  presupuestos: "Presupuestos sin seguimiento",
  // Sprint 9 G.6: el nuevo tipo "asistencias" reemplaza semánticamente a
  // "citados". "citados" se mantiene por compatibilidad con históricos.
  citados: "Citados no asistidos",
  asistencias: "Asistencias sin cerrar",
  automatizaciones: "Automatizaciones con error",
  cobro_vence_3d: "Liquidaciones a vencer",
  cobro_vencido_7d: "Liquidaciones vencidas",
  pendiente_alto_estancado: "Presupuestos altos estancados",
};

const TIPO_SUBTITLE: Record<Tipo, (n: number) => string> = {
  leads: (n) => `${n} lead${n === 1 ? "" : "s"} nuevo${n === 1 ? "" : "s"} sin gestionar`,
  presupuestos: (n) =>
    `${n} presupuesto${n === 1 ? "" : "s"} sin seguimiento desde hace >48h`,
  citados: (n) => `${n} cita${n === 1 ? "" : "s"} pasada${n === 1 ? "" : "s"} sin marcar asistido`,
  asistencias: (n) =>
    `${n} cita${n === 1 ? "" : "s"} sin cerrar (asistió/no asistió pendiente)`,
  automatizaciones: (n) => `${n} envío${n === 1 ? "" : "s"} con estado Fallido`,
  cobro_vence_3d: (n) =>
    `${n} liquidación${n === 1 ? "" : "es"} vence${n === 1 ? "" : "n"} en los próximos 3 días`,
  cobro_vencido_7d: (n) =>
    `${n} liquidación${n === 1 ? "" : "es"} vencida${n === 1 ? "" : "s"} hace más de 7 días`,
  pendiente_alto_estancado: (n) =>
    `${n} presupuesto${n === 1 ? "" : "s"} >2.000€ aceptado${n === 1 ? "" : "s"} hace >30d sin cobro`,
};

const COBRO_TIPOS: Tipo[] = [
  "cobro_vence_3d",
  "cobro_vencido_7d",
  "pendiente_alto_estancado",
];

type SubTab = "todos" | "cobros" | Tipo;

export function AlertasView() {
  const { selectedClinicaId } = useClinic();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null); // error de envío (inline)
  const [loadError, setLoadError] = useState(false); // error de carga → ErrorState
  const [sending, setSending] = useState<string | null>(null); // clinicaId:tipo
  const [tab, setTab] = useState<SubTab>("todos");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/alertas");
      if (!res.ok) throw new Error("fetch failed");
      const d = await res.json();
      setCards(d.alertas ?? []);
      setError(null);
    } catch (e) {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo<Card[]>(() => {
    const all = cards ?? [];
    const byClinic = selectedClinicaId
      ? all.filter((c) => c.clinicaId === selectedClinicaId)
      : all;
    if (tab === "todos") return byClinic;
    if (tab === "cobros") {
      return byClinic.filter((c) =>
        COBRO_TIPOS.some((t) => c.counts[t] > 0),
      );
    }
    return byClinic.filter((c) => c.counts[tab as Tipo] > 0);
  }, [cards, selectedClinicaId, tab]);

  const totalPendientes = useMemo(() => {
    const all = cards ?? [];
    const scope = selectedClinicaId
      ? all.filter((c) => c.clinicaId === selectedClinicaId)
      : all;
    return scope.reduce(
      (s, c) =>
        s +
        c.counts.leads +
        c.counts.presupuestos +
        c.counts.citados +
        c.counts.asistencias +
        c.counts.automatizaciones +
        (c.counts.cobro_vence_3d ?? 0) +
        (c.counts.cobro_vencido_7d ?? 0) +
        (c.counts.pendiente_alto_estancado ?? 0),
      0,
    );
  }, [cards, selectedClinicaId]);

  async function enviar(clinicaId: string, tipo: Tipo) {
    const key = `${clinicaId}:${tipo}`;
    setSending(key);
    setError(null);
    try {
      const res = await fetch("/api/alertas/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicaId, tipoAlerta: tipo }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d?.error ?? "No se pudo enviar la alerta");
        if (res.status === 400 && typeof d?.error === "string" && d.error.includes("Falta teléfono")) {
          // sugerencia UI: link a ajustes
        }
        return;
      }
      toast.success("Alerta enviada");
      await load();
    } catch {
      setError("No se pudo enviar la alerta. Revisa tu conexión.");
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-[var(--color-background)]">
      <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight text-[var(--color-foreground)]">Alertas</h1>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">
              Situaciones que requieren acción por parte de coordinación
            </p>
          </div>
          {totalPendientes > 0 && (
            <StatePill variant="danger" size="md" className="tabular-nums">
              {totalPendientes} alerta{totalPendientes === 1 ? "" : "s"} activa
              {totalPendientes === 1 ? "" : "s"}
            </StatePill>
          )}
        </header>

        {/* Tabs secundarios — estilo Linear: pill accent-soft activa. */}
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["todos", "Todos"],
              ["leads", "Leads sin gestionar"],
              ["presupuestos", "Presupuestos sin seguimiento"],
              ["asistencias", "Asistencias sin cerrar"],
              ["automatizaciones", "Automatizaciones con error"],
              // Sprint 14b Bloque 3 — agrupación cobros (3 sub-tipos).
              ["cobros", "Cobros"],
            ] as Array<[SubTab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`text-[11px] font-medium px-3 py-1.5 rounded-md border transition-colors ${
                tab === key
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]"
                  : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 dark:text-rose-300 dark:bg-rose-500/10 dark:border-rose-500/25 rounded-md px-3 py-2">
            {error}{" "}
            {error.includes("teléfono") && (
              <Link href="/ajustes/clinica-equipo" className="underline font-semibold">
                Ir a Ajustes
              </Link>
            )}
          </p>
        )}

        {loading && !cards && (
          <p className="text-xs text-[var(--color-muted)]">Cargando alertas…</p>
        )}

        {!loading && loadError && (
          <ErrorState
            title="No se pudieron cargar las alertas"
            detail="Las situaciones pendientes no están disponibles ahora mismo."
            onRetry={load}
          />
        )}

        {!loading && !loadError && filtered.length === 0 && (
          <EmptyState
            icon={<CheckCircle2 size={20} strokeWidth={ICON_STROKE} />}
            title="Sin situaciones pendientes"
            hint={
              selectedClinicaId
                ? "Esta clínica no tiene alertas en este filtro."
                : "Ninguna clínica tiene alertas en el filtro seleccionado."
            }
          />
        )}

        <div className="space-y-3">
          {filtered.map((card) => {
            const tipos: Tipo[] =
              tab === "todos"
                ? (Object.keys(card.counts) as Tipo[]).filter((t) => card.counts[t] > 0)
                : tab === "cobros"
                  ? COBRO_TIPOS.filter((t) => card.counts[t] > 0)
                  : [tab as Tipo];
            if (tipos.length === 0) return null;
            return (
              <div
                key={card.clinicaId}
                className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] p-5 hover:border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] transition-colors"
              >
                <p className="font-display text-base font-semibold text-[var(--color-foreground)] mb-3 tracking-tight">
                  {card.clinicaNombre}
                </p>
                <div className="space-y-2">
                  {tipos.map((tipo) => {
                    const n = card.counts[tipo];
                    if (n === 0) return null;
                    const cooldown = card.cooldowns?.[tipo] ?? null;
                    const isOnCooldown = !!cooldown;
                    const busy = sending === `${card.clinicaId}:${tipo}`;
                    // Sprint 12 H.4 — urgencia funcional: rose>5, amber 3-5, neutro <3.
                    const urgenciaBg =
                      n > 5
                        ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
                        : n >= 3
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                        : "bg-[var(--color-surface-muted)] text-[var(--color-muted)]";
                    return (
                      <div
                        key={tipo}
                        className="flex items-center gap-3 rounded-lg bg-[var(--color-surface-muted)] px-3 py-2.5 border border-[var(--color-border)]"
                      >
                        <span
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${urgenciaBg}`}
                          aria-hidden="true"
                        >
                          <Bell size={16} strokeWidth={ICON_STROKE} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-medium text-[var(--color-foreground)]">
                            {TIPO_LABEL[tipo]}
                          </p>
                          <p className="text-xs text-[var(--color-muted)] tabular-nums">{TIPO_SUBTITLE[tipo](n)}</p>
                          {isOnCooldown && (
                            <p className="text-[10px] text-[var(--color-muted)] mt-0.5 tabular-nums">
                              Alerta enviada hace {minutesAgo(cooldown!.untilMs - 2 * 60 * 60 * 1000)}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => enviar(card.clinicaId, tipo)}
                          disabled={busy || isOnCooldown}
                          className="shrink-0 rounded-md bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold px-3 py-1.5 hover:bg-[var(--color-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          {busy
                            ? "Enviando…"
                            : isOnCooldown
                            ? "Enviada"
                            : "Enviar alerta"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function minutesAgo(timestampMs: number): string {
  const mins = Math.floor((Date.now() - timestampMs) / 60000);
  if (mins < 1) return "hace instantes";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `hace ${hrs}h`;
}
