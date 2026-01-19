"use client";

import { useMemo, useState } from "react";

import DemoToast, { type ToastKind } from "../../components/ui/DemoToast";
import AgendaTimeline from "../../components/agenda/AgendaTimeline";
import MetricsPanels from "../../components/metrics/MetricsPanels";
import GapModal from "../../components/agenda/GapModal";

import { APPOINTMENTS, DEFAULT_RULES } from "../../lib/demoData";
import type { AgendaItem, AiResult, GapAlternativeType } from "../../lib/types";

import { buildAgendaItems, buildGapItemsFromAi } from "../../lib/agenda/buildAgendaItems";
import { computeMetrics } from "../../lib/agenda/metrics";
import { startContacting, resolveContacting, applyAlternative } from "../../lib/agenda/gapState";

import { parseLocal, addMinutesLocal, minutesBetween } from "../../lib/time";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function applyAdvanceAppointments(items: AgendaItem[], gapId: string) {
  const gap = items.find((x) => x.kind === "GAP" && x.id === gapId);
  if (!gap || gap.kind !== "GAP") return { next: items, moved: 0 };

  const gapStart = gap.start;
  const gapEnd = gap.end;

  const appts = items
    .filter((x) => x.kind === "APPOINTMENT")
    .slice()
    .sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());

  const idx = appts.findIndex((a) => parseLocal(a.start).getTime() >= parseLocal(gapEnd).getTime());
  if (idx < 0) return { next: items, moved: 0 };

  const first = appts[idx];
  const dur1 = Math.max(10, minutesBetween(first.start, first.end));
  const newStart1 = gapStart;
  const newEnd1 = addMinutesLocal(newStart1, dur1);

  if (parseLocal(newEnd1).getTime() > parseLocal(gapEnd).getTime()) {
    return { next: items, moved: 0 };
  }

  const second = appts[idx + 1];
  let moved = 1;

  let newStart2: string | null = null;
  let newEnd2: string | null = null;

  if (second) {
    const dur2 = Math.max(10, minutesBetween(second.start, second.end));
    const candidateStart2 = newEnd1;
    const candidateEnd2 = addMinutesLocal(candidateStart2, dur2);

    if (parseLocal(candidateEnd2).getTime() <= parseLocal(gapEnd).getTime()) {
      newStart2 = candidateStart2;
      newEnd2 = candidateEnd2;
      moved = 2;
    }
  }

  const next = items
    .filter((x) => !(x.kind === "GAP" && x.id === gapId))
    .map((it) => {
      if (it.kind !== "APPOINTMENT") return it;

      if (it.id === first.id) return { ...it, start: newStart1, end: newEnd1, changed: true };
      if (newStart2 && newEnd2 && second && it.id === second.id)
        return { ...it, start: newStart2, end: newEnd2, changed: true };

      return it;
    })
    .sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());

  return { next, moved };
}

function gapToBlock(it: AgendaItem, alt: GapAlternativeType): AgendaItem | null {
  if (it.kind !== "GAP") return null;

  if (alt === "PERSONAL_TIME") {
    return {
      kind: "AI_BLOCK",
      id: `BLOCK_PERSONAL_${it.id}`,
      start: it.start,
      end: it.end,
      label: "Tiempo personal",
      note: "Reservado (simulación)",
      durationMin: it.durationMin,
      sourceActionId: "ALT",
      blockType: "PERSONAL",
    } as any;
  }

  if (alt === "INTERNAL_MEETING") {
    return {
      kind: "AI_BLOCK",
      id: `BLOCK_INTERNAL_${it.id}`,
      start: it.start,
      end: it.end,
      label: "Reunión interna / tareas",
      note: "Equipo / operativo (simulación)",
      durationMin: it.durationMin,
      sourceActionId: "ALT",
      blockType: "BREAK",
    } as any;
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function DemoAnalyzePage() {
  const [toast, setToast] = useState<{ show: boolean; kind: ToastKind; title: string; message?: string }>({
    show: false,
    kind: "INFO",
    title: "",
  });

  const popToast = (kind: ToastKind, title: string, message?: string) => {
    setToast({ show: true, kind, title, message });
    window.setTimeout(() => setToast((t) => ({ ...t, show: false })), 2400);
  };

  const [rules] = useState(DEFAULT_RULES);

  // ✅ Estado: al entrar NO hay IA ni afterItems. Solo "Antes".
  const [ai, setAi] = useState<AiResult | null>(null);
  const [afterItems, setAfterItems] = useState<AgendaItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);

  // ✅ Modal
  const [openGapId, setOpenGapId] = useState<string | null>(null);

  const openGapMeta = useMemo(() => {
    if (!openGapId) return null;
    const g = (afterItems ?? []).find((x) => x.kind === "GAP" && x.id === openGapId) as any;
    return g?.meta ?? null;
  }, [openGapId, afterItems]);

  // Agenda base (“Antes”)
  const beforeItems: AgendaItem[] = useMemo(() => {
    return APPOINTMENTS.map((a) => ({
      kind: "APPOINTMENT" as const,
      id: String(a.id),
      patientName: a.patientName,
      start: a.start,
      end: a.end,
      type: a.type,
      durationMin: (new Date(a.end).getTime() - new Date(a.start).getTime()) / 60000,
      changed: false,
    }));
  }, []);

  const analyze = async () => {
    setLoading(true);
    popToast("INFO", "Analizando…", "Detectando huecos y preparando acciones.");

    try {
      const res = await fetch("/api/ai-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointments: APPOINTMENTS, rules }),
      });

      const data: AiResult = await res.json();
      setAi(data);

      const baseOptimized = buildAgendaItems({
        baseAppointments: APPOINTMENTS,
        selectedReschedules: [],
        rules,
        includeRuleBlocks: true,
      }).items;

      const gaps = buildGapItemsFromAi(data.actions ?? []);
      setAfterItems([...baseOptimized, ...gaps]);

      setHasAnalyzed(true);
      popToast("SUCCESS", "Listo ✅", "Agenda analizada. Haz click en un hueco para ver acciones.");
    } catch {
      popToast("WARN", "Error", "No se pudo analizar. Revisa la consola / API.");
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- Gap interactions ---------------- */

  const onGapContact = (gapId: string) => {
    if (!afterItems) return;

    popToast("INFO", "Fyllio está contactando pacientes…", "Enviando mensajes automáticos y esperando respuestas.");

    setAfterItems((prev) =>
      (prev ?? []).map((it) => {
        if (it.kind !== "GAP" || it.id !== gapId || !it.meta) return it;
        return { ...it, meta: startContacting(it.meta, new Date().toISOString()) };
      })
    );

    window.setTimeout(() => {
      popToast("INFO", "Respuestas recibidas", "Actualizando probabilidad de llenado y recomendación.");
    }, 900);

    window.setTimeout(() => {
      setAfterItems((prev) => {
        const cur = prev ?? [];
        const resolved = cur.map((it) => {
          if (it.kind !== "GAP" || it.id !== gapId || !it.meta) return it;
          return { ...it, meta: resolveContacting(it.meta) };
        });

        const gap = resolved.find((x) => x.kind === "GAP" && x.id === gapId);
        if (!gap || gap.kind !== "GAP" || !gap.meta) return resolved;

        if (gap.meta.status !== "FILLED") {
          popToast("WARN", "No se llenó a tiempo", "Te muestro alternativas para este hueco.");
          return resolved;
        }

        popToast("SUCCESS", "Hueco llenado ✅", "Agenda actualizada automáticamente (simulación).");

        const newAppt: AgendaItem = {
          kind: "APPOINTMENT",
          id: `SIM_${gap.meta.gapKey}`,
          patientName: "Paciente (recall) · confirmado",
          start: gap.start,
          end: gap.end,
          type: "Cita (simulada)",
          durationMin: gap.durationMin,
          changed: true,
        } as any;

        const withoutGap = resolved.filter((x) => !(x.kind === "GAP" && x.id === gapId));
        return [...withoutGap, newAppt].sort((a, b) => parseLocal(a.start).getTime() - parseLocal(b.start).getTime());
      });
    }, 1800);
  };

  const onGapAlternative = (gapId: string, alt: GapAlternativeType) => {
    if (!afterItems) return;

    if (alt === "ADVANCE_APPOINTMENTS") {
      setAfterItems((prev) => {
        const cur = prev ?? [];
        const { next, moved } = applyAdvanceAppointments(cur, gapId);

        if (moved > 0) popToast("SUCCESS", "Citas adelantadas ✅", `Se adelantaron ${moved} cita(s).`);
        else popToast("WARN", "No se pudo adelantar", "No hay citas que encajen dentro de ese hueco.");

        return next;
      });

      return;
    }

    setAfterItems((prev) =>
      (prev ?? []).map((it) => {
        if (it.kind !== "GAP" || it.id !== gapId) return it;

        const block = gapToBlock(it, alt);
        if (block) return block;

        if (!it.meta) return it;
        return { ...it, meta: applyAlternative(it.meta, alt) };
      })
    );

    if (alt === "PERSONAL_TIME") popToast("SUCCESS", "Bloqueado ✅", "Hueco reservado como tiempo personal.");
    else if (alt === "INTERNAL_MEETING") popToast("SUCCESS", "Bloqueado ✅", "Hueco reservado para tareas internas.");
    else popToast("INFO", "Alternativa aplicada", "Fyllio ajustó el plan para este hueco (simulación).");
  };

  /* ---------------- Metrics ---------------- */

  const metrics = useMemo(() => {
    if (!ai) return null;

    const automaticOpsCount = (ai.actions ?? []).reduce((acc, a: any) => {
      if (a?.type === "CONFIRM" || a?.type === "FILL_GAP") return acc + 1;
      return acc;
    }, 0);

    const optimizedItems = buildAgendaItems({
      baseAppointments: APPOINTMENTS,
      selectedReschedules: [],
      rules,
      includeRuleBlocks: true,
    }).items;

    return computeMetrics({
      baseAppointments: APPOINTMENTS,
      optimizedItems,
      rules,
      acceptedReschedulesCount: 0,
      automaticOpsCount,
    });
  }, [ai, rules]);

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      <DemoToast
        show={toast.show}
        kind={toast.kind}
        title={toast.title}
        message={toast.message}
        onClose={() => setToast((t) => ({ ...t, show: false }))}
      />

      <header className="mb-8">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Analyze · Antes vs Con Fyllio</h1>
            <p className="mt-2 text-slate-600 max-w-3xl">
              Primero mira la agenda “Antes”. Luego pulsa <b>Analizar</b> para ver la versión optimizada + huecos accionables.
            </p>
          </div>

          <button
            onClick={analyze}
            disabled={loading}
            className={
              loading
                ? "text-xs px-4 py-2 rounded-full bg-slate-200 text-slate-500 font-semibold cursor-not-allowed"
                : "text-xs px-4 py-2 rounded-full bg-sky-600 text-white font-semibold hover:bg-sky-700"
            }
          >
            {loading ? "Analizando..." : hasAnalyzed ? "✨ Re-analizar" : "✨ Analizar"}
          </button>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <AgendaTimeline items={beforeItems} dayStartIso="2025-12-11T08:30:00" dayEndIso="2025-12-11T19:00:00" />

        {afterItems ? (
          <AgendaTimeline
            items={afterItems}
            dayStartIso="2025-12-11T08:30:00"
            dayEndIso="2025-12-11T19:00:00"
            onGapOpen={(id) => setOpenGapId(id)}
          />
        ) : (
          <section className="rounded-3xl border border-dashed border-slate-200 bg-white p-6">
            <h2 className="text-xl font-bold text-slate-900">Con Fyllio</h2>
            <p className="mt-1 text-sm text-slate-600">
              Pulsa <b>“Analizar”</b> para generar la agenda optimizada y los huecos accionables.
            </p>

            <div className="mt-6 rounded-3xl bg-slate-50 border border-slate-100 p-6 text-sm text-slate-500">
              Aún no se ha ejecutado el análisis.
            </div>
          </section>
        )}
      </div>

      {ai && metrics ? <MetricsPanels ai={ai} metrics={metrics} workdaysPerMonth={rules.workdaysPerMonth} /> : null}

      {ai ? (
        <section className="mt-8 rounded-3xl bg-white shadow-sm border border-slate-100 p-7">
          <h3 className="text-xl font-bold text-slate-900">Resumen de IA</h3>
          <p className="mt-2 text-sm text-slate-700">{ai.summary}</p>

          {ai.insights?.length ? (
            <ul className="mt-4 list-disc list-inside space-y-2 text-sm text-slate-700">
              {ai.insights.slice(0, 10).map((i, idx) => (
                <li key={idx}>{i}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* ✅ Modal de hueco */}
      <GapModal
        open={!!openGapId}
        onClose={() => setOpenGapId(null)}
        meta={openGapMeta}
        onContact={() => {
          if (!openGapId) return;
          onGapContact(openGapId);
        }}
        onAlternative={(alt) => {
          if (!openGapId) return;
          onGapAlternative(openGapId, alt);
        }}
      />
    </main>
  );
}
