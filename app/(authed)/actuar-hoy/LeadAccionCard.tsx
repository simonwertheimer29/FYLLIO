"use client";

// Sprint 9 Fix 3 — card rica de un lead en Actuar Hoy. Mismo lenguaje
// visual que IntervencionCard (Presupuestos): borde-izq con color de
// urgencia, info del lead, action bar Llamar/WA + generador IA con tonos.
// Reutiliza /api/leads/ia/mensaje y /api/leads/[id] para PATCH inline.

import { useState } from "react";
import type { Lead } from "../leads/types";

type Tono = "directo" | "empatico" | "urgencia";

const TONOS: Array<{ valor: Tono; label: string }> = [
  { valor: "directo", label: "Directo" },
  { valor: "empatico", label: "Empático" },
  { valor: "urgencia", label: "Urgencia" },
];

function formatTimeAgo(isoDate: string): string {
  const diffMin = Math.round((Date.now() - new Date(isoDate).getTime()) / 60000);
  if (diffMin < 1) return "Ahora";
  if (diffMin < 60) return `Hace ${diffMin}min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `Hace ${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  return `Hace ${diffDay}d`;
}

function urgenciaColor(estado: string, diasDesde: number): string {
  if (estado === "Citados Hoy" || estado === "Citado") return "#ef4444"; // hoy/cita = rojo
  if (estado === "Nuevo" && diasDesde >= 1) return "#f97316"; // nuevo sin contactar = naranja
  if (estado === "Contactado" && diasDesde >= 2) return "#fbbf24"; // seguimiento = ámbar
  return "#94a3b8";
}

export function LeadAccionCard({
  lead,
  onChanged,
}: {
  lead: Lead;
  onChanged: (l: Lead) => void;
}) {
  const cleanPhone = (lead.telefono ?? "").replace(/\D/g, "");
  const diasDesde = Math.floor(
    (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  const tiempoDesde = formatTimeAgo(lead.createdAt);

  const [tono, setTono] = useState<Tono>("empatico");
  const [mensajeIA, setMensajeIA] = useState<string | null>(null);
  const [generandoIA, setGenerandoIA] = useState(false);
  const [iaError, setIaError] = useState<string | null>(null);
  const [llamando, setLlamando] = useState(false);
  const [waEnviado, setWaEnviado] = useState(false);
  const [savingEstado, setSavingEstado] = useState(false);

  async function generarMensaje() {
    setGenerandoIA(true);
    setIaError(null);
    setMensajeIA(null);
    try {
      const res = await fetch("/api/leads/ia/mensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadNombre: lead.nombre,
          tratamiento: lead.tratamiento,
          canal: lead.canal,
          estadoPipeline: lead.estado,
          diasDesdeCaptacion: diasDesde,
          tono,
        }),
      });
      const d = await res.json();
      if (d.error || !d.mensaje) {
        setIaError(d.error || "No se pudo generar el mensaje");
      } else {
        setMensajeIA(d.mensaje);
      }
    } catch {
      setIaError("Error de conexión");
    } finally {
      setGenerandoIA(false);
    }
  }

  async function enviarWA() {
    if (!cleanPhone) return;
    const text = mensajeIA ?? "";
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {}
    }
    window.open(
      `https://wa.me/${cleanPhone}${text ? `?text=${encodeURIComponent(text)}` : ""}`,
      "_blank"
    );
    setWaEnviado(true);
    // Marcar contadores en el lead.
    fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        whatsappEnviados: lead.whatsappEnviados + 1,
        ultimaAccion: `WA enviado (${tono})`,
      }),
    })
      .then((r) => r.json())
      .then((d) => d?.lead && onChanged({ ...d.lead, clinicaNombre: lead.clinicaNombre }))
      .catch(() => {});
  }

  function llamar() {
    if (!cleanPhone) return;
    window.open(`tel:${lead.telefono}`, "_self");
    setLlamando(true);
    fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llamado: true, ultimaAccion: "Llamada realizada" }),
    })
      .then((r) => r.json())
      .then((d) => d?.lead && onChanged({ ...d.lead, clinicaNombre: lead.clinicaNombre }))
      .catch(() => {});
  }

  async function cambiarEstado(nuevo: Lead["estado"]) {
    if (nuevo === lead.estado) return;
    setSavingEstado(true);
    const body: Record<string, any> = { estado: nuevo };
    if (nuevo === "No Interesado" && !lead.motivoNoInteres) {
      body.motivoNoInteres = "Rechazo_Producto";
    }
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d?.lead) onChanged({ ...d.lead, clinicaNombre: lead.clinicaNombre });
    } finally {
      setSavingEstado(false);
    }
  }

  const borderColor = urgenciaColor(lead.estado, diasDesde);

  return (
    <div
      className={`rounded-2xl border bg-white transition-opacity ${waEnviado ? "opacity-60" : ""}`}
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm text-slate-900 truncate">{lead.nombre}</span>
              <span className="text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                {lead.estado}
              </span>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {lead.tratamiento && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-100">
                  {lead.tratamiento}
                </span>
              )}
              {lead.canal && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {lead.canal}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] text-slate-500">
              {lead.clinicaNombre && <span>{lead.clinicaNombre}</span>}
              {lead.telefono && <span className="font-mono">· {lead.telefono}</span>}
              <span>· {tiempoDesde}</span>
              {lead.fechaCita && (
                <span>
                  · Cita {lead.fechaCita}
                  {lead.horaCita ? ` ${lead.horaCita}` : ""}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* IA mensaje */}
        <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Mensaje IA
            </span>
            <div className="flex gap-1">
              {TONOS.map((t) => (
                <button
                  key={t.valor}
                  type="button"
                  onClick={() => setTono(t.valor)}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                    tono === t.valor
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={generarMensaje}
              disabled={generandoIA}
              className="ml-auto text-[10px] font-bold px-2 py-1 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {generandoIA ? "Generando…" : mensajeIA ? "Regenerar" : "Generar"}
            </button>
          </div>
          {mensajeIA && (
            <p className="text-xs text-slate-700 whitespace-pre-line">{mensajeIA}</p>
          )}
          {iaError && (
            <p className="text-[10px] text-rose-600">{iaError}</p>
          )}
        </div>

        {/* Cambio de estado inline */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Estado
          </span>
          {(["Nuevo", "Contactado", "No Interesado"] as Lead["estado"][]).map((s) => (
            <button
              key={s}
              type="button"
              disabled={savingEstado || lead.estado === s}
              onClick={() => cambiarEstado(s)}
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                lead.estado === s
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-400"
              } disabled:opacity-50`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
        {cleanPhone && (
          <button
            type="button"
            onClick={enviarWA}
            disabled={waEnviado}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
          >
            {waEnviado ? "WA enviado" : "Enviar WA"}
          </button>
        )}
        {cleanPhone && (
          <button
            type="button"
            onClick={llamar}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            Llamar
          </button>
        )}
        {llamando && (
          <span className="text-[10px] text-slate-500">Llamada registrada</span>
        )}
        <a
          href={`/leads`}
          className="text-[11px] text-sky-700 font-semibold hover:underline ml-auto"
        >
          Ver kanban →
        </a>
      </div>
    </div>
  );
}
