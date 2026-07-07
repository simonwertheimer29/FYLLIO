"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import type { NoShowsUserSession, InformeNoShow } from "../../lib/no-shows/types";
import { Card } from "../ui/Card";
import { EmptyState, ErrorState } from "../ui/Feedback";
import {
  AlertTriangle, Download, ClipboardList, CalendarDays, ChevronDown, ICON_STROKE,
} from "../icons";
import { ChevronUp } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MESES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function formatPeriod(periodo: string): string {
  const w = periodo.match(/^(\d{4})-W(\d{2})$/);
  if (w) return `Semana ${parseInt(w[2])}, ${w[1]}`;
  const m = periodo.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MESES_ES[parseInt(m[2]) - 1]} ${m[1]}`;
  return periodo;
}

// ─── InformeCard ──────────────────────────────────────────────────────────────

function InformeCard({ informe }: { informe: InformeNoShow }) {
  const [open,        setOpen]        = useState(false);
  const [downloading, setDownloading] = useState(false);

  const json    = informe.contenidoJson;
  const tasaPct = Math.round(json.tasa * 1000) / 10;
  const hasAlerts = json.alertas && json.alertas.length > 0;

  async function downloadPDF() {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch("/api/no-shows/informes/generar-pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          titulo:          informe.titulo,
          periodo:         informe.periodo,
          textoNarrativo:  informe.textoNarrativo,
          metricas:        informe.contenidoJson,
        }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = `informe-${informe.periodo}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success("Informe descargado");
      } else {
        toast.error("No se pudo descargar el informe");
      }
    } catch {
      toast.error("No se pudo descargar el informe. Comprueba tu conexión.");
    }
    finally { setDownloading(false); }
  }

  return (
    <Card padding="none" className="overflow-hidden">
      {/* Header row */}
      <div className="p-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-display text-base font-semibold text-[var(--color-foreground)]">{informe.titulo}</p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">{formatPeriod(informe.periodo)}</p>

          {/* Metric chips */}
          <div className="flex flex-wrap gap-2 mt-2">
            <span className="px-2 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-xs font-semibold text-[var(--color-foreground)]">
              {json.totalCitas} citas
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              json.tasa >= 0.10 ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
              : json.tasa >= 0.07 ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
              : "bg-[var(--color-success-soft)] text-[var(--color-success)]"
            }`}>
              {tasaPct}% no-shows
            </span>
            {hasAlerts && (
              <span className="px-2 py-0.5 rounded-full bg-[var(--color-danger-soft)] text-xs font-semibold text-[var(--color-danger)] inline-flex items-center gap-1">
                <AlertTriangle size={12} strokeWidth={ICON_STROKE} aria-hidden />
                {json.alertas!.length} alerta{json.alertas!.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Per-clinic */}
          {json.porClinica && json.porClinica.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
              {json.porClinica.map((c) => (
                <span key={c.clinica} className="text-[10px] text-[var(--color-muted)]">
                  {c.clinica}: {Math.round(c.tasa * 1000) / 10}%
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
          {/* PDF download */}
          <button
            onClick={downloadPDF}
            disabled={downloading}
            className="text-xs font-semibold text-[var(--color-muted)] hover:text-[var(--color-foreground)] border border-[var(--color-border)] rounded-xl px-2.5 py-1 transition-colors disabled:opacity-40 inline-flex items-center gap-1"
            title="Descargar informe (imprimir como PDF)"
          >
            <Download size={12} strokeWidth={ICON_STROKE} aria-hidden />
            {downloading ? "Descargando…" : "PDF"}
          </button>
          {/* Expand narrative */}
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs font-semibold text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors whitespace-nowrap inline-flex items-center gap-1"
          >
            {open ? "Ocultar" : "Ver resumen"}
            {open
              ? <ChevronUp size={12} strokeWidth={ICON_STROKE} aria-hidden />
              : <ChevronDown size={12} strokeWidth={ICON_STROKE} aria-hidden />}
          </button>
        </div>
      </div>

      {/* Expandable narrative */}
      {open && (
        <div className="border-t border-[var(--color-border)] px-4 pb-4 pt-3 space-y-3">
          {informe.textoNarrativo ? (
            <div className="prose prose-sm max-w-none text-[var(--color-foreground)] leading-relaxed [&_strong]:text-[var(--color-foreground)] [&_p]:my-1.5">
              <ReactMarkdown>{informe.textoNarrativo}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-xs text-[var(--color-muted)] italic">Sin resumen disponible para este informe.</p>
          )}
          {hasAlerts && (
            <div className="space-y-1">
              {json.alertas!.map((a, i) => (
                <p key={i} className="text-xs text-[var(--color-danger)] bg-[var(--color-danger-soft)] rounded-xl px-3 py-1.5 flex items-start gap-1.5">
                  <AlertTriangle size={12} strokeWidth={ICON_STROKE} className="shrink-0 mt-0.5" aria-hidden />
                  {a}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type InformesTab = "semanales" | "mensuales";

export default function InformesView({ user }: { user: NoShowsUserSession }) {
  const [tab,      setTab]      = useState<InformesTab>("semanales");
  const [informes, setInformes] = useState<InformeNoShow[] | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [isDemo,   setIsDemo]   = useState(false);
  const [error,    setError]    = useState(false);
  const [reloadKey, setReload]  = useState(0);

  void user;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch("/api/no-shows/informes/guardados");
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setInformes(data.informes ?? []);
          setIsDemo(data.isDemo === true);
        } else {
          setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [reloadKey]);

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="animate-pulse space-y-3 w-full max-w-2xl">
          {[1, 2].map((i) => <div key={i} className="h-24 bg-[var(--color-surface-muted)] rounded-2xl" />)}
        </div>
      </div>
    );
  }

  if (error && informes === null) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center w-full">
        <ErrorState
          detail="Los informes no están disponibles ahora mismo."
          onRetry={() => setReload((k) => k + 1)}
          className="w-full max-w-2xl"
        />
      </div>
    );
  }

  const semanales = (informes ?? []).filter((i) => i.tipo === "noshow_semanal");
  const mensuales = (informes ?? []).filter((i) => i.tipo === "noshow_mensual");

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 w-full">
      {/* Demo banner */}
      {isDemo && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300 px-4 py-2 text-xs">
          <span className="font-semibold">Esta clínica aún no tiene datos conectados.</span>{" "}
          Contacta con Fyllio para activarlos.
        </div>
      )}

      {/* Header + tab strip */}
      <Card padding="md" className="space-y-3">
        <div>
          <p className="font-display text-base font-semibold text-[var(--color-foreground)]">Informes</p>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            Análisis generado con IA · Se publica automáticamente cada lunes
          </p>
        </div>
        <div className="flex gap-1">
          {(["semanales", "mensuales"] as InformesTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-xs px-3 py-1.5 rounded-xl border font-semibold transition-colors capitalize ${
                tab === t
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </Card>

      {/* ── SEMANALES tab ── */}
      {tab === "semanales" && (
        <>
          {semanales.length === 0 && (
            <EmptyState
              icon={<ClipboardList size={20} strokeWidth={ICON_STROKE} />}
              title="Sin informes semanales"
              hint="Los informes se generan automáticamente cada lunes a las 09:00 y aparecerán aquí."
            />
          )}
          {semanales.map((inf) => (
            <InformeCard key={inf.id} informe={inf} />
          ))}
        </>
      )}

      {/* ── MENSUALES tab ── */}
      {tab === "mensuales" && (
        <>
          {mensuales.length === 0 && (
            <EmptyState
              icon={<CalendarDays size={20} strokeWidth={ICON_STROKE} />}
              title="Sin informes mensuales"
              hint="Los informes mensuales se generan automáticamente el primer día de cada mes."
            />
          )}
          {mensuales.map((inf) => (
            <InformeCard key={inf.id} informe={inf} />
          ))}
        </>
      )}
    </div>
  );
}
