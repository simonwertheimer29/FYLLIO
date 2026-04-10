"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import type { NoShowsUserSession, InformeNoShow } from "../../lib/no-shows/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPeriod(periodo: string): string {
  const m = periodo.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return periodo;
  return `Semana ${parseInt(m[2])}, ${m[1]}`;
}

// ─── InformeCard ──────────────────────────────────────────────────────────────

function InformeCard({ informe }: { informe: InformeNoShow }) {
  const [open, setOpen] = useState(false);
  const json = informe.contenidoJson;
  const tasaPct = Math.round(json.tasa * 1000) / 10;
  const hasAlerts = json.alertas && json.alertas.length > 0;

  return (
    <div className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
      {/* Header row */}
      <div className="p-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800">{informe.titulo}</p>
          <p className="text-xs text-slate-400 mt-0.5">{formatPeriod(informe.periodo)}</p>

          {/* Metrics chips */}
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
              {json.totalCitas} citas
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              json.tasa >= 0.10
                ? "bg-red-100 text-red-700"
                : json.tasa >= 0.07
                ? "bg-amber-100 text-amber-700"
                : "bg-green-100 text-green-700"
            }`}>
              {tasaPct}% no-shows
            </span>
            {hasAlerts && (
              <span className="px-2 py-0.5 rounded-full bg-red-50 text-xs font-semibold text-red-600">
                ⚠️ {json.alertas!.length} alerta{json.alertas!.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Per-clinic breakdown */}
          {json.porClinica && json.porClinica.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
              {json.porClinica.map((c) => (
                <span key={c.clinica} className="text-[10px] text-slate-400">
                  {c.clinica}: {Math.round(c.tasa * 1000) / 10}%
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          className="shrink-0 text-xs font-semibold text-cyan-600 hover:text-cyan-800 transition-colors pt-0.5 whitespace-nowrap"
        >
          {open ? "Ocultar ▴" : "Ver resumen ▾"}
        </button>
      </div>

      {/* Expandable narrative */}
      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
          {informe.textoNarrativo ? (
            <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed [&_strong]:text-slate-900 [&_p]:my-1.5">
              <ReactMarkdown>{informe.textoNarrativo}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">Sin narrativo disponible para este informe.</p>
          )}

          {/* Alerts */}
          {hasAlerts && (
            <div className="space-y-1">
              {json.alertas!.map((a, i) => (
                <p key={i} className="text-xs text-red-700 bg-red-50 rounded-xl px-3 py-1.5">
                  ⚠️ {a}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function InformesView({ user }: { user: NoShowsUserSession }) {
  const [informes, setInformes] = useState<InformeNoShow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  // user is passed but not used directly (future: clinic filter for managers)
  void user;

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/no-shows/informes/guardados");
        if (res.ok) {
          const data = await res.json();
          setInformes(data.informes ?? []);
          setIsDemo(data.isDemo === true);
        }
      } catch { /* silent */ }
      finally { setLoading(false); }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full max-w-2xl">
          {[1, 2].map((i) => <div key={i} className="h-24 bg-slate-100 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 max-w-2xl w-full mx-auto">
      {/* Demo banner */}
      {isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="font-semibold">Datos de demostración.</span>{" "}
          Conecta Airtable para ver informes reales.
        </div>
      )}

      {/* Header */}
      <div className="rounded-2xl bg-white border border-slate-200 p-4">
        <p className="text-sm font-bold text-slate-800">Informes semanales</p>
        <p className="text-xs text-slate-400 mt-0.5">
          Generados automáticamente cada lunes · Análisis IA de no-shows
        </p>
      </div>

      {/* Empty state */}
      {informes !== null && informes.length === 0 && (
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center">
          <p className="text-2xl mb-2">📋</p>
          <p className="text-sm font-bold text-slate-700">Sin informes todavía</p>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed max-w-xs mx-auto">
            Los informes se generan automáticamente cada lunes a las 09:00.
            El primero aparecerá el próximo lunes.
          </p>
        </div>
      )}

      {/* Informe list */}
      {informes && informes.map((inf) => (
        <InformeCard key={inf.id} informe={inf} />
      ))}
    </div>
  );
}
