"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Sparkles, MessageCircle, X, Check, Star, RefreshCw, ICON_STROKE } from "../icons";
import type { Presupuesto, TonoIA } from "../../lib/presupuestos/types";
import type { TonosStats } from "../../api/presupuestos/tonos-stats/route";

const TONOS: { valor: TonoIA; label: string; activeClass: string }[] = [
  { valor: "directo",  label: "Directo",  activeClass: "border-[var(--color-muted)] bg-[var(--color-surface-muted)] text-[var(--color-foreground)]" },
  { valor: "empatico", label: "Empático", activeClass: "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]" },
  { valor: "urgencia", label: "Urgencia", activeClass: "border-rose-500 bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300" },
];

const TONO_CARD_COLOR: Record<TonoIA, string> = {
  directo:  "text-[var(--color-foreground)] border-[var(--color-border)] bg-[var(--color-surface-muted)]",
  empatico: "text-[var(--color-accent)] border-[var(--color-accent)] bg-[var(--color-accent-soft)]",
  urgencia: "text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10",
};

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5 inline" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export default function IAGeneradorDrawer({
  presupuesto,
  onClose,
}: {
  presupuesto: Presupuesto;
  onClose: () => void;
}) {
  const p = presupuesto;
  const cleanPhone = (p.patientPhone ?? "").replace(/\D/g, "");

  const [selectedTonos, setSelectedTonos] = useState<Set<TonoIA>>(
    new Set(["directo", "empatico", "urgencia"])
  );
  const [mensajes, setMensajes] = useState<Partial<Record<TonoIA, string>> | null>(null);
  const [generando, setGenerando] = useState(false);
  const [regenerandoTono, setRegenerandoTono] = useState<Partial<Record<TonoIA, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [tonosStats, setTonosStats] = useState<TonosStats | null>(null);

  // Fetch A/B stats once on mount
  useEffect(() => {
    const url = new URL("/api/presupuestos/tonos-stats", location.href);
    if (p.clinica) url.searchParams.set("clinica", p.clinica);
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => { if (d.stats) setTonosStats(d.stats); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Best tono by historical tasa (only if tasa is not null)
  const bestTono: TonoIA | null = (() => {
    if (!tonosStats) return null;
    let best: TonoIA | null = null;
    let bestTasa = -1;
    for (const t of ["directo", "empatico", "urgencia"] as TonoIA[]) {
      const tasa = tonosStats[t]?.tasa;
      if (tasa != null && tasa > bestTasa) { bestTasa = tasa; best = t; }
    }
    return best;
  })();

  function toggleTono(tono: TonoIA) {
    setSelectedTonos((prev) => {
      const next = new Set(prev);
      if (next.has(tono)) {
        if (next.size === 1) return prev; // al menos 1 siempre activo
        next.delete(tono);
      } else {
        next.add(tono);
      }
      return next;
    });
    setMensajes(null);
    setError(null);
  }

  async function fetchMensaje(tono: TonoIA): Promise<string> {
    const res = await fetch("/api/presupuestos/ia/mensaje", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patientName: p.patientName,
        treatments: p.treatments,
        estado: p.estado,
        daysSince: p.daysSince,
        lastContactDaysAgo: p.lastContactDaysAgo,
        contactCount: p.contactCount,
        amount: p.amount,
        motivoDuda: p.motivoDuda,
        tono,
      }),
    });
    const d = await res.json();
    return d.mensaje ?? "";
  }

  async function handleGenerar() {
    setGenerando(true);
    setError(null);
    setMensajes(null);
    const tonos = Array.from(selectedTonos);
    try {
      const results = await Promise.all(tonos.map((t) => fetchMensaje(t)));
      const map: Partial<Record<TonoIA, string>> = {};
      tonos.forEach((t, i) => { if (results[i]) map[t] = results[i]; });
      if (Object.keys(map).length === 0) {
        setError("No se pudieron generar los mensajes. Inténtalo de nuevo.");
      } else {
        setMensajes(map);
      }
    } catch {
      setError("Error de conexión. Inténtalo de nuevo.");
    } finally {
      setGenerando(false);
    }
  }

  async function handleRegenerarUno(tono: TonoIA) {
    setRegenerandoTono((prev) => ({ ...prev, [tono]: true }));
    try {
      const msg = await fetchMensaje(tono);
      if (msg) {
        setMensajes((prev) => ({ ...prev, [tono]: msg }));
      }
    } catch {
      toast.error("No se pudo regenerar el mensaje. Se mantiene el anterior.");
    } finally {
      setRegenerandoTono((prev) => ({ ...prev, [tono]: false }));
    }
  }

  function handleEnviar(tono: TonoIA, msg: string) {
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, "_blank");
    fetch("/api/presupuestos/contactos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presupuestoId: p.id,
        tipo: "whatsapp",
        resultado: "contestó",
        mensajeIAUsado: true,
        tonoUsado: tono,
        nota: "Mensaje IA enviado desde Tareas",
      }),
    }).catch(() => {});
  }

  const selectedCount = selectedTonos.size;

  return (
    <div className="fixed inset-0 z-50 flex lg:justify-end items-end lg:items-stretch">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer panel — side on desktop, bottom sheet on mobile/tablet */}
      <div className="relative w-full max-w-md bg-[var(--color-surface)] shadow-2xl flex flex-col lg:h-full h-[78vh] overflow-hidden rounded-t-2xl lg:rounded-none">
        {/* Drag handle — mobile only */}
        <div className="lg:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>

        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between gap-3 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">Mensaje IA</h3>
              <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                <Sparkles size={10} strokeWidth={ICON_STROKE} aria-hidden /> Beta
              </span>
            </div>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">{p.patientName}</p>
          </div>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] shrink-0" aria-label="Cerrar">
            <X size={18} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Tono selector */}
          <div>
            <p className="text-[10px] text-[var(--color-muted)] uppercase font-medium mb-2">
              Selecciona estilo(s)
            </p>
            <div className="flex gap-2">
              {TONOS.map((t) => {
                const active = selectedTonos.has(t.valor);
                const isBest = bestTono === t.valor;
                return (
                  <button
                    key={t.valor}
                    onClick={() => toggleTono(t.valor)}
                    className={`flex-1 inline-flex items-center justify-center gap-1 rounded-xl border-2 py-2.5 text-xs font-bold transition-all ${
                      active ? t.activeClass : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)]"
                    } ${isBest && active ? "ring-2 ring-offset-1 ring-[var(--color-accent)]" : ""}`}
                  >
                    {active && <Check size={12} strokeWidth={ICON_STROKE} aria-hidden />}
                    {t.label}
                    {isBest && <Star size={11} strokeWidth={ICON_STROKE} aria-hidden />}
                  </button>
                );
              })}
            </div>

            {/* A/B historical rates */}
            {tonosStats && (
              <p className="text-[10px] text-[var(--color-muted)] mt-1.5 leading-relaxed">
                Tasa histórica:{" "}
                {(["directo", "empatico", "urgencia"] as const).map((t, i) => {
                  const stat = tonosStats[t];
                  const label = t === "directo" ? "Directo" : t === "empatico" ? "Empático" : "Urgencia";
                  const isBest = bestTono === t;
                  return (
                    <span key={t}>
                      {i > 0 && <span className="mx-1">·</span>}
                      <span className={isBest ? "font-bold text-[var(--color-accent)]" : ""}>
                        {label} {stat.tasa != null ? `${stat.tasa}%` : "—"}
                        {isBest && <Star size={10} strokeWidth={ICON_STROKE} className="inline-block ml-0.5 align-[-1px]" aria-hidden />}
                      </span>
                    </span>
                  );
                })}
              </p>
            )}
          </div>

          {/* Generar / Regenerar global button */}
          <button
            onClick={handleGenerar}
            disabled={generando || selectedCount === 0}
            className="fyllio-ia-gradient w-full rounded-xl text-sm font-bold py-3 hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {generando ? (
              <><Spinner /> Generando…</>
            ) : mensajes ? (
              <span className="inline-flex items-center gap-2">
                <RefreshCw size={14} strokeWidth={ICON_STROKE} aria-hidden />
                {`Regenerar ${selectedCount} estilo${selectedCount !== 1 ? "s" : ""}`}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Sparkles size={14} strokeWidth={ICON_STROKE} aria-hidden />
                {`Generar ${selectedCount} estilo${selectedCount !== 1 ? "s" : ""}`}
              </span>
            )}
          </button>

          {/* Error */}
          {error && (
            <p className="text-xs text-rose-500 text-center">{error}</p>
          )}

          {/* Resultados */}
          {mensajes && (
            <div className="space-y-3">
              {TONOS.filter((t) => mensajes[t.valor]).map((t) => {
                const msg = mensajes[t.valor]!;
                const regenerando = regenerandoTono[t.valor];
                return (
                  <div key={t.valor} className={`rounded-xl border-2 p-4 space-y-2.5 ${TONO_CARD_COLOR[t.valor]}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-wider">{t.label}</p>
                      <button
                        onClick={() => handleRegenerarUno(t.valor)}
                        disabled={regenerando || generando}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-lg border border-current opacity-60 hover:opacity-100 disabled:opacity-30 flex items-center gap-1"
                      >
                        {regenerando ? <Spinner /> : <RefreshCw size={11} strokeWidth={ICON_STROKE} aria-hidden />} Regenerar
                      </button>
                    </div>
                    <p className="text-sm leading-relaxed">{msg}</p>
                    <button
                      onClick={() => handleEnviar(t.valor, msg)}
                      className="w-full rounded-xl bg-[var(--fyllio-wa-green)] text-white text-xs font-bold py-2 hover:bg-[var(--fyllio-wa-green-hover)] inline-flex items-center justify-center gap-1.5"
                    >
                      <MessageCircle size={13} strokeWidth={ICON_STROKE} aria-hidden /> Enviar por WhatsApp
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
