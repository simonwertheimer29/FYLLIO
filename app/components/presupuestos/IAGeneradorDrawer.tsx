"use client";

import { useState } from "react";
import type { Presupuesto, TonoIA } from "../../lib/presupuestos/types";

const TONOS: { valor: TonoIA; label: string; activeClass: string }[] = [
  { valor: "directo",  label: "Directo",  activeClass: "border-slate-400 bg-slate-100 text-slate-700" },
  { valor: "empatico", label: "Empático", activeClass: "border-violet-500 bg-violet-100 text-violet-700" },
  { valor: "urgencia", label: "Urgencia", activeClass: "border-rose-500 bg-rose-100 text-rose-700" },
];

const TONO_CARD_COLOR: Record<TonoIA, string> = {
  directo:  "text-slate-700 border-slate-300 bg-slate-50",
  empatico: "text-violet-700 border-violet-300 bg-violet-50",
  urgencia: "text-rose-700 border-rose-300 bg-rose-50",
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
      // ignorar, mantener el mensaje anterior
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
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer panel */}
      <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-900 text-base">Mensaje IA</h3>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600">
                ✨ Beta
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{p.patientName}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none shrink-0">
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Tono selector */}
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-medium mb-2">
              Selecciona estilo(s)
            </p>
            <div className="flex gap-2">
              {TONOS.map((t) => {
                const active = selectedTonos.has(t.valor);
                return (
                  <button
                    key={t.valor}
                    onClick={() => toggleTono(t.valor)}
                    className={`flex-1 rounded-xl border-2 py-2.5 text-xs font-bold transition-all ${
                      active ? t.activeClass : "border-slate-200 bg-white text-slate-400"
                    }`}
                  >
                    {active ? "✓ " : ""}{t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Generar / Regenerar global button */}
          <button
            onClick={handleGenerar}
            disabled={generando || selectedCount === 0}
            className="w-full rounded-xl bg-violet-600 text-white text-sm font-bold py-3 hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {generando ? (
              <><Spinner /> Generando…</>
            ) : mensajes ? (
              `↺ Regenerar ${selectedCount} estilo${selectedCount !== 1 ? "s" : ""}`
            ) : (
              `✨ Generar ${selectedCount} estilo${selectedCount !== 1 ? "s" : ""}`
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
                        {regenerando ? <Spinner /> : "↺"} Regenerar
                      </button>
                    </div>
                    <p className="text-sm leading-relaxed">{msg}</p>
                    <button
                      onClick={() => handleEnviar(t.valor, msg)}
                      className="w-full rounded-xl bg-emerald-600 text-white text-xs font-bold py-2 hover:bg-emerald-700"
                    >
                      💬 Enviar por WhatsApp
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
