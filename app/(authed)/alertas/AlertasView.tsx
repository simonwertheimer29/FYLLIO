"use client";

// Sprint 8 D.7 — Alertas: lista de clínicas con situaciones pendientes
// agrupadas por tipo. Admin puede disparar alerta WA por clínica+tipo
// con cooldown 2h. Respeta ClinicContext (filtra por clínica del header).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useClinic } from "../../lib/context/ClinicContext";

type Tipo = "leads" | "presupuestos" | "citados" | "automatizaciones";

type Card = {
  clinicaId: string;
  clinicaNombre: string;
  counts: Record<Tipo, number>;
  cooldowns: Partial<Record<Tipo, { untilMs: number } | null>>;
};

const TIPO_LABEL: Record<Tipo, string> = {
  leads: "Leads sin gestionar",
  presupuestos: "Presupuestos sin seguimiento",
  citados: "Citados no asistidos",
  automatizaciones: "Automatizaciones con error",
};

const TIPO_SUBTITLE: Record<Tipo, (n: number) => string> = {
  leads: (n) => `${n} lead${n === 1 ? "" : "s"} nuevo${n === 1 ? "" : "s"} sin gestionar`,
  presupuestos: (n) =>
    `${n} presupuesto${n === 1 ? "" : "s"} sin seguimiento desde hace >48h`,
  citados: (n) => `${n} cita${n === 1 ? "" : "s"} pasada${n === 1 ? "" : "s"} sin marcar asistido`,
  automatizaciones: (n) => `${n} envío${n === 1 ? "" : "s"} con estado Fallido`,
};

type SubTab = "todos" | Tipo;

export function AlertasView() {
  const { selectedClinicaId } = useClinic();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null); // clinicaId:tipo
  const [tab, setTab] = useState<SubTab>("todos");
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/alertas");
      if (!res.ok) throw new Error("fetch failed");
      const d = await res.json();
      setCards(d.alertas ?? []);
      setError(null);
    } catch (e) {
      setError("No se pudieron cargar las alertas");
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
    return byClinic.filter((c) => c.counts[tab] > 0);
  }, [cards, selectedClinicaId, tab]);

  const totalPendientes = useMemo(() => {
    const all = cards ?? [];
    const scope = selectedClinicaId
      ? all.filter((c) => c.clinicaId === selectedClinicaId)
      : all;
    return scope.reduce(
      (s, c) =>
        s + c.counts.leads + c.counts.presupuestos + c.counts.citados + c.counts.automatizaciones,
      0
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
      setToast("Alerta enviada");
      setTimeout(() => setToast(null), 2500);
      await load();
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-auto bg-slate-50">
      <div className="max-w-5xl mx-auto p-4 lg:p-6 space-y-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">Alertas</h1>
            <p className="text-xs text-slate-500">
              Situaciones que requieren acción por parte de coordinación
            </p>
          </div>
          {totalPendientes > 0 && (
            <span className="inline-flex rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-3 py-1 text-xs font-bold">
              {totalPendientes} alerta{totalPendientes === 1 ? "" : "s"} activa
              {totalPendientes === 1 ? "" : "s"}
            </span>
          )}
        </header>

        {/* Tabs secundarios */}
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["todos", "Todos"],
              ["leads", "Leads sin gestionar"],
              ["presupuestos", "Presupuestos sin seguimiento"],
              ["citados", "Citados no asistidos"],
              ["automatizaciones", "Automatizaciones con error"],
            ] as Array<[SubTab, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                tab === key
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
            {error}{" "}
            {error.includes("teléfono") && (
              <Link href="/ajustes/clinica-equipo" className="underline font-semibold">
                Ir a Ajustes
              </Link>
            )}
          </p>
        )}

        {toast && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
            {toast}
          </p>
        )}

        {loading && !cards && (
          <p className="text-xs text-slate-400">Cargando alertas…</p>
        )}

        {!loading && filtered.length === 0 && (
          <div className="rounded-3xl bg-white border border-slate-200 p-8 text-center">
            <p className="text-sm text-slate-800 font-semibold">Sin situaciones pendientes 🎉</p>
            <p className="text-xs text-slate-500 mt-1">
              {selectedClinicaId
                ? "Esta clínica no tiene alertas en este filtro."
                : "Ninguna clínica tiene alertas en el filtro seleccionado."}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {filtered.map((card) => {
            const tipos: Tipo[] =
              tab === "todos"
                ? (Object.keys(card.counts) as Tipo[]).filter((t) => card.counts[t] > 0)
                : [tab as Tipo];
            if (tipos.length === 0) return null;
            return (
              <div
                key={card.clinicaId}
                className="rounded-2xl bg-white border border-slate-200 p-4"
              >
                <p className="text-sm font-extrabold text-slate-900 mb-2">
                  {card.clinicaNombre}
                </p>
                <div className="space-y-2">
                  {tipos.map((tipo) => {
                    const n = card.counts[tipo];
                    if (n === 0) return null;
                    const cooldown = card.cooldowns?.[tipo] ?? null;
                    const isOnCooldown = !!cooldown;
                    const busy = sending === `${card.clinicaId}:${tipo}`;
                    const urgenciaBg =
                      n > 5
                        ? "bg-rose-50 text-rose-700"
                        : n >= 3
                        ? "bg-orange-50 text-orange-700"
                        : "bg-amber-50 text-amber-700";
                    return (
                      <div
                        key={tipo}
                        className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2"
                      >
                        <span
                          className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 ${urgenciaBg}`}
                          aria-hidden="true"
                        >
                          🔔
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-[11px] font-semibold text-slate-700">
                            {TIPO_LABEL[tipo]}
                          </p>
                          <p className="text-xs text-slate-500">{TIPO_SUBTITLE[tipo](n)}</p>
                          {isOnCooldown && (
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Alerta enviada hace {minutesAgo(cooldown!.untilMs - 2 * 60 * 60 * 1000)}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => enviar(card.clinicaId, tipo)}
                          disabled={busy || isOnCooldown}
                          className="shrink-0 rounded-full bg-orange-500 text-white text-xs font-bold px-3 py-1.5 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
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
