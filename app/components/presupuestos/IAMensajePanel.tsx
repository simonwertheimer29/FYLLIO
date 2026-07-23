"use client";

import { useState } from "react";
import { Sparkles, MessageCircle, ICON_STROKE } from "../icons";
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
        setError(d.error || "No se pudo generar el mensaje. Inténtalo de nuevo.");
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

    // Camino central (enviar-manual): persiste el saliente en el HILO
    // (mensajes_whatsapp) y devuelve la URL wa.me. Antes se abría wa.me a
    // mano y el mensaje no quedaba en el historial de conversación.
    let url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(mensaje)}`;
    try {
      const res = await fetch("/api/presupuestos/intervencion/enviar-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presupuestoId: p.id, telefono: cleanPhone, contenido: mensaje }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.urlWhatsApp) url = d.urlWhatsApp;
      }
    } catch {
      // El envío manual no se bloquea por el registro; el fallo queda en el
      // log del servidor.
    }
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
    <div className="px-5 py-3 border-b border-[var(--color-border)]">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[10px] text-[var(--color-muted)] uppercase font-medium">Sugerencia de mensaje</p>
        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Sparkles size={10} strokeWidth={ICON_STROKE} aria-hidden /> Beta
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
                ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
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
        className="fyllio-ia-gradient w-full rounded-xl text-xs font-bold py-2 hover:opacity-90 transition-opacity disabled:opacity-50 mb-2"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Generando…
          </span>
        ) : (
          <span className="inline-flex items-center justify-center gap-1.5">
            <Sparkles size={12} strokeWidth={ICON_STROKE} aria-hidden />
            {mensaje ? "Regenerar sugerencia" : "Sugerir mensaje"}
          </span>
        )}
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
            className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-3 py-2 text-xs text-[var(--color-foreground)] resize-none focus:outline-none"
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleCopiar}
              className="flex-1 rounded-xl border border-[var(--color-border)] text-[var(--color-muted)] text-[10px] font-semibold py-1.5 hover:bg-[var(--color-surface-muted)] transition-colors"
            >
              {copied ? "¡Copiado!" : "Copiar"}
            </button>
            {p.patientPhone && (
              <button
                onClick={handleWhatsApp}
                disabled={registrando}
                className="flex-1 rounded-xl bg-[var(--fyllio-wa-green)] text-white text-[10px] font-semibold py-1.5 hover:bg-[var(--fyllio-wa-green-hover)] disabled:opacity-50 transition-colors"
              >
                {registrando ? (
                  "Enviando…"
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <MessageCircle size={12} strokeWidth={ICON_STROKE} aria-hidden /> WhatsApp
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
