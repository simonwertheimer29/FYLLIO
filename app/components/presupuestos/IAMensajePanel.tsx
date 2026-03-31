"use client";

import { useState } from "react";
import type { Presupuesto, TonoIA } from "../../lib/presupuestos/types";

const TONOS: { valor: TonoIA; label: string }[] = [
  { valor: "directo",   label: "Directo" },
  { valor: "empatico",  label: "Empático" },
  { valor: "urgencia",  label: "Urgencia" },
];

export default function IAMensajePanel({
  presupuesto,
  onContactRegistered,
}: {
  presupuesto: Presupuesto;
  onContactRegistered?: () => void;
}) {
  const p = presupuesto;
  const [tono, setTono] = useState<TonoIA>("empatico");
  const [loading, setLoading] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [registrando, setRegistrando] = useState(false);

  async function handleGenerar() {
    setLoading(true);
    setError(null);
    setMensaje(null);
    try {
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
      if (d.error || !d.mensaje) {
        setError("No se pudo generar el mensaje. Inténtalo de nuevo.");
      } else {
        setMensaje(d.mensaje);
      }
    } catch {
      setError("Error de conexión. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopiar() {
    if (!mensaje) return;
    try {
      await navigator.clipboard.writeText(mensaje);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the text area
    }
  }

  async function handleWhatsApp() {
    if (!mensaje || !p.patientPhone) return;
    const cleanPhone = p.patientPhone.replace(/\D/g, "");
    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(mensaje)}`;
    window.open(url, "_blank");

    // Registrar contacto como IA
    setRegistrando(true);
    try {
      await fetch("/api/presupuestos/contactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presupuestoId: p.id,
          tipo: "whatsapp",
          resultado: "contestó",
          mensajeIAUsado: true,
          tonoUsado: tono,
          nota: "Mensaje generado por IA",
        }),
      });
      onContactRegistered?.();
    } catch {
      // ignorar errores secundarios
    } finally {
      setRegistrando(false);
    }
  }

  return (
    <div className="px-5 py-3 border-b border-slate-100">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[10px] text-slate-400 uppercase font-medium">Mensaje IA</p>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-600">
          ✨ Beta
        </span>
      </div>

      {/* Tono selector */}
      <div className="flex gap-1.5 mb-2">
        {TONOS.map((t) => (
          <button
            key={t.valor}
            onClick={() => { setTono(t.valor); setMensaje(null); setError(null); }}
            className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              tono === t.valor
                ? "bg-violet-600 text-white border-violet-600"
                : "border-slate-200 text-slate-500 hover:border-violet-300 hover:text-violet-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Botón generar */}
      <button
        onClick={handleGenerar}
        disabled={loading}
        className="w-full rounded-xl bg-violet-600 text-white text-xs font-bold py-2 hover:bg-violet-700 disabled:opacity-50 mb-2"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-3 w-3 text-white" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Generando…
          </span>
        ) : mensaje ? "Regenerar" : "Generar mensaje"}
      </button>

      {/* Error */}
      {error && (
        <p className="text-[10px] text-rose-500 mb-2">{error}</p>
      )}

      {/* Mensaje preview */}
      {mensaje && (
        <div className="space-y-2">
          <textarea
            readOnly
            value={mensaje}
            rows={4}
            className="w-full rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-slate-700 resize-none focus:outline-none"
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleCopiar}
              className="flex-1 rounded-xl border border-slate-200 text-slate-600 text-[10px] font-semibold py-1.5 hover:bg-slate-50 transition-colors"
            >
              {copied ? "¡Copiado!" : "Copiar"}
            </button>
            {p.patientPhone && (
              <button
                onClick={handleWhatsApp}
                disabled={registrando}
                className="flex-1 rounded-xl bg-emerald-600 text-white text-[10px] font-semibold py-1.5 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {registrando ? "Enviando…" : "💬 WhatsApp"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
