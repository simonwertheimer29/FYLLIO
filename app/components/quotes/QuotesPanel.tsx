"use client";

import { useEffect, useState } from "react";

type QuoteStatus = "PRESENTADO" | "INTERESADO" | "CONFIRMADO" | "PERDIDO";

type Quote = {
  id: string;
  patientName: string;
  patientPhone?: string;
  treatment: string;
  amount: number;
  status: QuoteStatus;
  presentedAt: string;
  daysSince: number;
  notes?: string;
};

// -------------------------------------------------------------------
// WhatsApp follow-up message
// -------------------------------------------------------------------

function whatsappFollowUp(q: Quote): string {
  const msg = encodeURIComponent(
    `Hola ${q.patientName.split(" ")[0]} 🙂 Queríamos saber si tienes alguna duda sobre el presupuesto de *${q.treatment}* que preparamos. Estamos aquí para ayudarte. ¿Quieres que te llamemos o tienes alguna pregunta? 🦷`
  );
  const clean = (q.patientPhone ?? "").replace(/\s+/g, "").replace("+", "");
  return `https://wa.me/${clean}?text=${msg}`;
}

// -------------------------------------------------------------------
// Status config
// -------------------------------------------------------------------

const STATUS_CONFIG: Record<QuoteStatus, { label: string; color: string; bg: string; border: string }> = {
  PRESENTADO: { label: "Presentado", color: "text-sky-700", bg: "bg-sky-50", border: "border-sky-200" },
  INTERESADO: { label: "Interesado", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  CONFIRMADO: { label: "Confirmado", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  PERDIDO: { label: "Perdido", color: "text-rose-600", bg: "bg-rose-50", border: "border-rose-200" },
};

const PIPELINE_ORDER: QuoteStatus[] = ["PRESENTADO", "INTERESADO", "CONFIRMADO", "PERDIDO"];

// -------------------------------------------------------------------
// QuoteCard
// -------------------------------------------------------------------

function QuoteCard({
  quote,
  onChangeStatus,
  sending,
}: {
  quote: Quote;
  onChangeStatus: (id: string, status: QuoteStatus) => Promise<void>;
  sending: string | null;
}) {
  const cfg = STATUS_CONFIG[quote.status];
  const urgentFollow = quote.status !== "CONFIRMADO" && quote.status !== "PERDIDO" && quote.daysSince >= 14;
  const [localStatus, setLocalStatus] = useState<QuoteStatus>(quote.status);

  async function handleStatus(s: QuoteStatus) {
    setLocalStatus(s);
    await onChangeStatus(quote.id, s);
  }

  return (
    <div className={`rounded-2xl border bg-white p-4 space-y-3 ${urgentFollow ? "border-amber-300 shadow-sm" : "border-slate-200"}`}>
      {urgentFollow && (
        <div className="flex items-center gap-1.5">
          <span className="text-amber-500 text-xs">⚠️</span>
          <span className="text-xs font-semibold text-amber-700">{quote.daysSince} días sin respuesta</span>
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate">{quote.patientName}</p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{quote.treatment}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-base font-extrabold text-slate-900">€{quote.amount.toLocaleString("es-ES")}</p>
          <p className="text-[11px] text-slate-400">hace {quote.daysSince}d</p>
        </div>
      </div>

      {quote.notes && (
        <p className="text-xs text-slate-500 italic border-l-2 border-slate-200 pl-2">{quote.notes}</p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5">
        {quote.patientPhone && localStatus !== "CONFIRMADO" && localStatus !== "PERDIDO" && (
          <a
            href={whatsappFollowUp(quote)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 font-semibold"
          >
            💬 Recordar
          </a>
        )}

        {localStatus === "PRESENTADO" && (
          <button
            onClick={() => handleStatus("INTERESADO")}
            className="text-[11px] px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 font-semibold"
          >
            Interesado →
          </button>
        )}

        {(localStatus === "PRESENTADO" || localStatus === "INTERESADO") && (
          <button
            onClick={() => handleStatus("CONFIRMADO")}
            className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 font-semibold"
          >
            ✓ Aceptado
          </button>
        )}

        {localStatus !== "PERDIDO" && localStatus !== "CONFIRMADO" && (
          <button
            onClick={() => handleStatus("PERDIDO")}
            className="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 font-semibold"
          >
            Perdido
          </button>
        )}

        {localStatus === "PERDIDO" && (
          <button
            onClick={() => handleStatus("PRESENTADO")}
            className="text-[11px] px-2.5 py-1 rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50 font-semibold"
          >
            Reactivar
          </button>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// PipelineColumn
// -------------------------------------------------------------------

function PipelineColumn({
  status,
  quotes,
  onChangeStatus,
  sending,
}: {
  status: QuoteStatus;
  quotes: Quote[];
  onChangeStatus: (id: string, status: QuoteStatus) => Promise<void>;
  sending: string | null;
}) {
  const cfg = STATUS_CONFIG[status];
  const totalAmount = quotes.reduce((s, q) => s + q.amount, 0);

  return (
    <div className="min-w-0 flex-1">
      {/* Column header */}
      <div className={`rounded-2xl border ${cfg.border} ${cfg.bg} px-3 py-2.5 mb-3`}>
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
          <span className={`text-[11px] font-semibold ${cfg.color}`}>{quotes.length}</span>
        </div>
        {quotes.length > 0 && (
          <p className={`text-[11px] font-semibold mt-0.5 ${cfg.color}`}>
            €{totalAmount.toLocaleString("es-ES")}
          </p>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {quotes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-center">
            <p className="text-xs text-slate-400">Sin presupuestos</p>
          </div>
        ) : (
          quotes.map((q) => (
            <QuoteCard key={q.id} quote={q} onChangeStatus={onChangeStatus} sending={sending} />
          ))
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------------
// QuotesPanel (main export)
// -------------------------------------------------------------------

export default function QuotesPanel() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/db/quotes", { cache: "no-store" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setQuotes(json.quotes ?? []);
      setIsDemo(json.isDemo ?? false);
    } catch (e: any) {
      setError(e.message ?? "Error al cargar presupuestos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleChangeStatus(id: string, status: QuoteStatus) {
    setSending(id);
    // Optimistic update
    setQuotes((prev) => prev.map((q) => (q.id === id ? { ...q, status } : q)));
    try {
      await fetch("/api/db/quotes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
    } finally {
      setSending(null);
    }
  }

  // -------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------

  const presentado = quotes.filter((q) => q.status === "PRESENTADO");
  const interesado = quotes.filter((q) => q.status === "INTERESADO");
  const confirmado = quotes.filter((q) => q.status === "CONFIRMADO");
  const perdido = quotes.filter((q) => q.status === "PERDIDO");

  const totalPipeline = [...presentado, ...interesado, ...confirmado].reduce((s, q) => s + q.amount, 0);
  const totalConfirmado = confirmado.reduce((s, q) => s + q.amount, 0);
  const totalPerdido = perdido.reduce((s, q) => s + q.amount, 0);

  const totalClosed = confirmado.length + perdido.length;
  const conversionRate = totalClosed > 0 ? Math.round((confirmado.length / totalClosed) * 100) : 0;

  const needFollow = [...presentado, ...interesado].filter((q) => q.daysSince >= 14).length;

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-3xl bg-slate-100" />
        <div className="h-80 rounded-3xl bg-slate-100" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">{error}</div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Hero stats ─────────────────────────────────────────────── */}
      <div className="rounded-3xl bg-gradient-to-br from-violet-600 to-purple-700 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-violet-200 uppercase tracking-widest">Pipeline de presupuestos</p>
            <h2 className="mt-1 text-2xl font-extrabold">€{totalPipeline.toLocaleString("es-ES")} en juego</h2>
            <p className="text-sm text-violet-100 mt-0.5">{presentado.length + interesado.length} presupuestos activos</p>
          </div>
          <button
            type="button"
            onClick={load}
            className="text-xs px-3 py-1.5 rounded-full bg-white/20 border border-white/25 text-white hover:bg-white/30 shrink-0"
          >
            Refrescar
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-violet-200 font-medium">Presentados</p>
            <p className="text-xl font-extrabold mt-0.5">{presentado.length}</p>
            <p className="text-[11px] text-violet-200 mt-0.5">€{presentado.reduce((s, q) => s + q.amount, 0).toLocaleString("es-ES")}</p>
          </div>
          <div className="rounded-2xl bg-amber-400/20 border border-amber-300/30 p-3">
            <p className="text-xs text-violet-200 font-medium">Interesados</p>
            <p className="text-xl font-extrabold mt-0.5 text-amber-200">{interesado.length}</p>
            <p className="text-[11px] text-violet-200 mt-0.5">€{interesado.reduce((s, q) => s + q.amount, 0).toLocaleString("es-ES")}</p>
          </div>
          <div className="rounded-2xl bg-emerald-400/20 border border-emerald-300/30 p-3">
            <p className="text-xs text-violet-200 font-medium">Confirmados</p>
            <p className="text-xl font-extrabold mt-0.5 text-emerald-200">{confirmado.length}</p>
            <p className="text-[11px] text-violet-200 mt-0.5">€{totalConfirmado.toLocaleString("es-ES")} cerrados</p>
          </div>
          <div className="rounded-2xl bg-white/15 border border-white/20 p-3">
            <p className="text-xs text-violet-200 font-medium">Conversión</p>
            <p className="text-xl font-extrabold mt-0.5">{conversionRate}%</p>
            <p className="text-[11px] text-violet-200 mt-0.5">{totalClosed} cerrados</p>
          </div>
        </div>
      </div>

      {/* ── Urgent follow-up alert ─────────────────────────────────── */}
      {needFollow > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3">
          <span className="text-amber-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {needFollow} {needFollow === 1 ? "presupuesto lleva" : "presupuestos llevan"} más de 14 días sin respuesta
            </p>
            <p className="text-xs text-amber-600 mt-0.5">Envía un recordatorio por WhatsApp para recuperarlos.</p>
          </div>
        </div>
      )}

      {/* ── Pipeline (4 columns) ───────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <PipelineColumn status="PRESENTADO" quotes={presentado} onChangeStatus={handleChangeStatus} sending={sending} />
        <PipelineColumn status="INTERESADO" quotes={interesado} onChangeStatus={handleChangeStatus} sending={sending} />
        <PipelineColumn status="CONFIRMADO" quotes={confirmado} onChangeStatus={handleChangeStatus} sending={sending} />
        <PipelineColumn status="PERDIDO" quotes={perdido} onChangeStatus={handleChangeStatus} sending={sending} />
      </div>

      {/* ── Lost revenue insight ───────────────────────────────────── */}
      {totalPerdido > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-700">📊 Lección de los perdidos</p>
          <p className="text-xs text-slate-500 mt-1">
            Has perdido <span className="font-bold text-rose-600">€{totalPerdido.toLocaleString("es-ES")}</span> en {perdido.length} presupuestos.
            {perdido.some((q) => q.notes) && (
              <> Los motivos habituales: {perdido.filter((q) => q.notes).map((q) => q.notes).join(" · ")}</>
            )}
          </p>
        </div>
      )}

      {/* ── Demo notice ────────────────────────────────────────────── */}
      {isDemo && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-start gap-3">
          <span className="text-slate-400 text-lg shrink-0">ℹ️</span>
          <div>
            <p className="text-sm font-semibold text-slate-700">Datos de demostración</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Para conectar presupuestos reales, crea la tabla <code className="bg-slate-100 px-1 rounded">Presupuestos</code> en Airtable con los campos:
              Paciente (link), Tratamiento (texto), Importe (número), Estado (selección), Fecha, Notas, Teléfono.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
