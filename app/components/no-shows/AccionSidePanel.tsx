"use client";

import { useState } from "react";
import type { RiskyAppt, GapSlot, RecallAlert, NoShowsUserSession, AccionTask } from "../../lib/no-shows/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type ToneType = "urgente" | "cordial" | "motivacional";

export type HistorialItem = {
  id: string;
  paciente: string;
  tratamiento: string;
  dayIso: string;
  hora: string;
  tipo: string;
  nota: string;
  registradoEn: string; // ISO
};

type UnifiedItem =
  | { type: "appt"; id: string; scoreAccion: number; hoursUntil: number; data: RiskyAppt; task: AccionTask }
  | { type: "gap"; id: string; scoreAccion: number; hoursUntil: number; data: GapSlot; task: AccionTask; overbooking: boolean; recalls: RecallAlert[] };

interface Props {
  item: UnifiedItem;
  recalls: RecallAlert[];
  user: NoShowsUserSession;
  onClose: () => void;
  onMarkDone: (id: string) => void;
  onRefresh: () => void;
  onHistorialAction: (item: HistorialItem) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildWA(phone: string, msg: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`;
}

function formatFechaEs(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  const days   = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const months = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} de ${months[d.getUTCMonth()]}`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "#ef4444";
  if (score >= 60) return "#f97316";
  if (score >= 40) return "#3b82f6";
  return "#94a3b8";
}

function calcFaseLabel(hoursUntil: number): string {
  if (hoursUntil <= 0) return "CRÍTICO";
  if (hoursUntil < 24) return "24h";
  if (hoursUntil < 48) return "48h";
  return "72h";
}

function faseStyle(fase: string): string {
  if (fase === "CRÍTICO") return "bg-red-100 text-red-700 border border-red-200";
  if (fase === "24h")    return "bg-red-50  text-red-600 border border-red-100";
  if (fase === "48h")    return "bg-amber-50 text-amber-700 border border-amber-200";
  return "bg-yellow-50 text-yellow-700 border border-yellow-200";
}

function confianzaInfo(c: number | undefined): { text: string; color: string; barColor: string } {
  if (c === undefined) return { text: "Sin historial", color: "text-slate-400", barColor: "bg-slate-200" };
  if (c > 0.8)  return { text: "✓ Paciente fiable",        color: "text-green-600",  barColor: "bg-green-500"  };
  if (c >= 0.5) return { text: "⚠ Historial mixto",        color: "text-orange-500", barColor: "bg-orange-500" };
  return              { text: "✗ Alto riesgo histórico",    color: "text-red-600",    barColor: "bg-red-500"    };
}

function contextualRec(hoursUntil: number, confianza: number | undefined): string {
  const fase = calcFaseLabel(hoursUntil);
  const baja = confianza !== undefined && confianza < 0.5;
  const alta = confianza !== undefined && confianza > 0.8;
  if (fase === "CRÍTICO" && baja) return "Llama ahora. Alta probabilidad de no-show. Si no contesta, envía mensaje de urgencia.";
  if (fase === "CRÍTICO" && alta) return "Envía recordatorio. Este paciente suele cumplir. Un WA es suficiente.";
  if (fase === "CRÍTICO")         return "Llama o envía mensaje urgente. La cita es inminente.";
  if (fase === "24h" && baja)     return "Mensaje personalizado + llama si no responde en 2h.";
  if (fase === "24h" && alta)     return "Un WA cordial es suficiente. Este paciente suele confirmar.";
  if (fase === "24h")             return "Envía WA recordatorio y monitoriza respuesta.";
  if (fase === "48h")             return "Mensaje empático recordando la cita. Monitoriza respuesta.";
  return "Recordatorio estándar. Monitoriza respuesta en las próximas 24h.";
}

function horasDesde(fechaIso: string): number {
  return (Date.now() - new Date(fechaIso).getTime()) / 3600000;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AccionSidePanel({ item, recalls, onClose, onMarkDone, onRefresh, onHistorialAction }: Props) {
  // IA message
  const [tone, setTone] = useState<ToneType>("cordial");
  const [genLoading, setGenLoading] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [msgError, setMsgError] = useState("");

  // Registrar acción
  const [tipoAccion, setTipoAccion] = useState("WA enviado");
  const [notaAccion, setNotaAccion] = useState("");
  const [saving, setSaving] = useState(false);
  const [actualizando, setActualizando] = useState(false);

  // Reagendar
  const [showReagendar, setShowReagendar] = useState(false);
  const [reagDate, setReagDate] = useState("");
  const [reagTime, setReagTime] = useState("");
  const [reagSaving, setReagSaving] = useState(false);

  // Panel toast
  const [panelToast, setPanelToast] = useState<{ msg: string; ok: boolean } | null>(null);

  function showPanelToast(msg: string, ok = true) {
    setPanelToast({ msg, ok });
    setTimeout(() => setPanelToast(null), 3000);
  }

  // ── IA message generation ─────────────────────────────────────────────────

  async function generateMensaje() {
    if (item.type !== "appt") return;
    const a = item.data;
    setGenLoading(true);
    setMsgError("");
    try {
      const res = await fetch("/api/no-shows/acciones/generar-mensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName: a.patientName,
          treatmentName: a.treatmentName,
          riskScore: a.riskScore,
          riskLevel: a.riskLevel,
          category: "NO_SHOW",
          hora: a.startDisplay,
          fecha: a.dayIso ? formatFechaEs(a.dayIso) : undefined,
          doctorNombre: a.doctorNombre ?? a.doctor ?? undefined,
          tone,
        }),
      });
      const d = await res.json();
      if (d.error) { setMsgError(d.error); return; }
      setMensaje(d.mensaje ?? "");
    } catch (e: any) {
      setMsgError(e?.message ?? "Error generando mensaje");
    } finally {
      setGenLoading(false);
    }
  }

  async function generateRecallMensaje(recall: RecallAlert) {
    setGenLoading(true);
    setMsgError("");
    try {
      const res = await fetch("/api/no-shows/acciones/generar-mensaje", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientName: recall.patientName,
          treatmentName: recall.treatmentName,
          category: "RECALL",
          tone: "motivacional",
        }),
      });
      const d = await res.json();
      setMensaje(d.mensaje ?? "");
    } catch { /* ignore */ } finally {
      setGenLoading(false);
    }
  }

  // ── Registrar acción ──────────────────────────────────────────────────────

  async function handleGuardarAccion() {
    if (item.type !== "appt") return;
    const apptId = item.data.id;
    setSaving(true);
    try {
      // 1. Registrar en Airtable
      const res = await fetch("/api/no-shows/acciones/registrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: apptId, tipo: tipoAccion, fase: calcFaseLabel(item.hoursUntil), notas: notaAccion }),
      });
      if (!res.ok) throw new Error("Error al registrar");

      // 2. Si Confirmado o Cancelado → actualizar Estado
      if (tipoAccion === "Confirmado" || tipoAccion === "Cancelado") {
        await fetch("/api/no-shows/acciones/actualizar-estado", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recordId: apptId, estado: tipoAccion }),
        });
        onMarkDone(item.id);
      }

      // 3. Guardar en localStorage historial
      onHistorialAction({
        id: item.id,
        paciente: item.data.patientName,
        tratamiento: item.data.treatmentName,
        dayIso: item.data.dayIso,
        hora: item.data.startDisplay,
        tipo: tipoAccion,
        nota: notaAccion,
        registradoEn: new Date().toISOString(),
      });

      setNotaAccion("");
      showPanelToast("Acción guardada");
      if (tipoAccion === "Confirmado" || tipoAccion === "Cancelado") {
        setTimeout(() => onClose(), 800);
      }
    } catch (e: any) {
      showPanelToast(e?.message ?? "Error al guardar", false);
    } finally {
      setSaving(false);
    }
  }

  // ── Actualizar estado directo ─────────────────────────────────────────────

  async function handleActualizarEstado(estado: "Confirmado" | "Cancelado") {
    if (item.type !== "appt") return;
    setActualizando(true);
    try {
      const res = await fetch("/api/no-shows/acciones/actualizar-estado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: item.data.id, estado }),
      });
      if (!res.ok) throw new Error("Error al actualizar");
      onMarkDone(item.id);
      onHistorialAction({
        id: item.id,
        paciente: item.data.patientName,
        tratamiento: item.data.treatmentName,
        dayIso: item.data.dayIso,
        hora: item.data.startDisplay,
        tipo: estado,
        nota: "",
        registradoEn: new Date().toISOString(),
      });
      showPanelToast(`Cita ${estado.toLowerCase()}`);
      setTimeout(() => { onRefresh(); onClose(); }, 800);
    } catch (e: any) {
      showPanelToast(e?.message ?? "Error", false);
    } finally {
      setActualizando(false);
    }
  }

  // ── Reagendar ─────────────────────────────────────────────────────────────

  async function handleReagendar() {
    if (item.type !== "appt" || !reagDate || !reagTime) return;
    setReagSaving(true);
    try {
      // Build Madrid ISO from date + time inputs
      const newStart = `${reagDate}T${reagTime}:00`;
      // Assume 60-min duration if not available
      const durMin = item.data.end && item.data.start
        ? Math.round((new Date(item.data.end).getTime() - new Date(item.data.start).getTime()) / 60000)
        : 60;
      const endDt = new Date(new Date(newStart).getTime() + durMin * 60000);
      const newEnd = endDt.toISOString().slice(0, 16);

      const res = await fetch(`/api/no-shows/agenda/${item.data.id}/mover`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startIso: newStart, endIso: newEnd }),
      });
      if (!res.ok) throw new Error("Error al reagendar");
      showPanelToast("Cita reagendada");
      setShowReagendar(false);
      setTimeout(() => { onRefresh(); onClose(); }, 800);
    } catch (e: any) {
      showPanelToast(e?.message ?? "Error al reagendar", false);
    } finally {
      setReagSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-[400px] z-50 bg-white border-l border-slate-200 shadow-2xl flex flex-col overflow-hidden">
        {/* Header fijo */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <h2 className="text-sm font-bold text-slate-800">
            {item.type === "appt" ? "Detalle paciente" : "Hueco disponible"}
          </h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 text-lg leading-none">×</button>
        </div>

        {/* Scroll body */}
        <div className="flex-1 overflow-y-auto">
          {item.type === "appt" ? (
            <PatientPanel
              item={item}
              tone={tone} setTone={setTone}
              genLoading={genLoading} mensaje={mensaje} setMensaje={setMensaje} msgError={msgError}
              onGenerateMensaje={generateMensaje}
              tipoAccion={tipoAccion} setTipoAccion={setTipoAccion}
              notaAccion={notaAccion} setNotaAccion={setNotaAccion}
              saving={saving} onGuardarAccion={handleGuardarAccion}
              actualizando={actualizando} onActualizarEstado={handleActualizarEstado}
              showReagendar={showReagendar} setShowReagendar={setShowReagendar}
              reagDate={reagDate} setReagDate={setReagDate}
              reagTime={reagTime} setReagTime={setReagTime}
              reagSaving={reagSaving} onReagendar={handleReagendar}
            />
          ) : (
            <GapPanel
              item={item}
              recalls={recalls}
              genLoading={genLoading} mensaje={mensaje} setMensaje={setMensaje}
              onGenerateRecallMensaje={generateRecallMensaje}
              onMarkDone={onMarkDone}
              onClose={onClose}
            />
          )}
        </div>

        {/* Panel toast */}
        {panelToast && (
          <div className={`absolute bottom-4 left-4 right-4 rounded-xl px-4 py-3 text-sm font-semibold text-center ${panelToast.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-700"}`}>
            {panelToast.msg}
          </div>
        )}
      </div>
    </>
  );
}

// ── PatientPanel ──────────────────────────────────────────────────────────────

function PatientPanel({
  item, tone, setTone, genLoading, mensaje, setMensaje, msgError, onGenerateMensaje,
  tipoAccion, setTipoAccion, notaAccion, setNotaAccion,
  saving, onGuardarAccion, actualizando, onActualizarEstado,
  showReagendar, setShowReagendar, reagDate, setReagDate, reagTime, setReagTime, reagSaving, onReagendar,
}: {
  item: Extract<Parameters<typeof AccionSidePanel>[0]["item"], { type: "appt" }>;
  tone: ToneType; setTone: (t: ToneType) => void;
  genLoading: boolean; mensaje: string; setMensaje: (m: string) => void; msgError: string;
  onGenerateMensaje: () => void;
  tipoAccion: string; setTipoAccion: (t: string) => void;
  notaAccion: string; setNotaAccion: (n: string) => void;
  saving: boolean; onGuardarAccion: () => void;
  actualizando: boolean; onActualizarEstado: (e: "Confirmado" | "Cancelado") => void;
  showReagendar: boolean; setShowReagendar: (v: boolean) => void;
  reagDate: string; setReagDate: (v: string) => void;
  reagTime: string; setReagTime: (v: string) => void;
  reagSaving: boolean; onReagendar: () => void;
}) {
  const a = item.data;
  const fase = calcFaseLabel(item.hoursUntil);
  const ci = confianzaInfo(a.confianza);
  const sc = scoreColor(item.scoreAccion);
  const waLink = buildWA(a.patientPhone, "");
  const pct = a.confianza !== undefined ? Math.round(a.confianza * 100) : 0;

  // Estado de contacto
  const horasDesdeUltima = a.ultimaAccion ? horasDesde(a.ultimaAccion) : null;
  const esWaSinRespuesta = a.tipoUltimaAccion === "WA enviado" && horasDesdeUltima !== null;
  const escalate = esWaSinRespuesta && horasDesdeUltima! > 8;
  const warn     = esWaSinRespuesta && horasDesdeUltima! > 4 && !escalate;

  return (
    <div className="divide-y divide-slate-100">

      {/* SECCIÓN 1: Header */}
      <div className="px-5 py-4 space-y-3">
        <div className="flex items-start gap-3">
          {/* Score circle */}
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold border-2 shrink-0"
               style={{ borderColor: sc, color: sc }}>
            {item.scoreAccion}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-bold text-slate-800 truncate">{a.patientName}</p>
            <a href={`tel:${a.patientPhone}`} className="text-xs text-cyan-600 hover:underline">{a.patientPhone}</a>
          </div>
        </div>
        {/* Badges */}
        <div className="flex flex-wrap gap-2">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${faseStyle(fase)} ${fase === "CRÍTICO" ? "animate-pulse" : ""}`}>
            {fase}
          </span>
          <span className={`text-xs font-semibold ${ci.color}`}>{ci.text}</span>
        </div>
        {/* Detalles */}
        <div className="space-y-1">
          <p className="text-sm text-slate-700 font-medium">{a.treatmentName}</p>
          <p className="text-xs text-slate-500">{a.startDisplay} · {a.doctorNombre ?? a.doctor ?? "—"} · {a.clinicaNombre ?? a.clinica ?? "—"}</p>
        </div>
      </div>

      {/* SECCIÓN 2: Historial */}
      <div className="px-5 py-4 space-y-3">
        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide">Historial del paciente</h3>
        {(a.histTotal ?? 0) > 0 ? (
          <>
            <div className="flex gap-4 text-xs">
              <span className="text-green-600 font-semibold">{a.histCompletados ?? 0} completadas</span>
              <span className="text-amber-600 font-semibold">{a.histCancels ?? 0} canceladas</span>
              <span className="text-red-600 font-semibold">{a.histNoShows ?? 0} no-shows</span>
            </div>
            {/* Barra de confianza */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Fiabilidad</span>
                <span>{pct}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${ci.barColor}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
            {/* Últimas 3 citas */}
            {(a.ultimasCitas ?? []).length > 0 && (
              <div className="space-y-1">
                {(a.ultimasCitas ?? []).map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={c.resultado === "completado" ? "text-green-500" : "text-red-500"}>
                      {c.resultado === "completado" ? "✓" : "✗"}
                    </span>
                    <span className="text-slate-500">{c.fecha}</span>
                    <span className="text-slate-600 truncate">{c.tratamiento}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-400">Sin historial previo</p>
        )}
      </div>

      {/* SECCIÓN 3: ¿Qué hacer ahora? */}
      <div className="px-5 py-4">
        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">¿Qué hacer ahora?</h3>
        <p className="text-sm text-slate-700 leading-relaxed">{contextualRec(item.hoursUntil, a.confianza)}</p>
      </div>

      {/* SECCIÓN 4: Mensaje IA */}
      <div className="px-5 py-4 space-y-3">
        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide">Mensaje IA</h3>
        {/* Tone selector */}
        <div className="flex gap-2">
          {(["urgente", "cordial", "motivacional"] as ToneType[]).map(t => (
            <button key={t}
              onClick={() => setTone(t)}
              className={`flex-1 text-xs py-1.5 rounded-lg border font-semibold transition-all ${tone === t ? "bg-violet-600 text-white border-violet-600" : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"}`}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <button onClick={onGenerateMensaje} disabled={genLoading}
          className="w-full py-2 rounded-xl bg-violet-50 border border-violet-200 text-violet-700 text-sm font-semibold hover:bg-violet-100 disabled:opacity-50">
          {genLoading ? "Generando…" : "Generar mensaje"}
        </button>
        {msgError && <p className="text-xs text-red-500">{msgError}</p>}
        {mensaje && (
          <div className="space-y-2">
            <textarea
              value={mensaje}
              onChange={e => setMensaje(e.target.value)}
              rows={4}
              className="w-full text-sm text-slate-700 border border-slate-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-violet-200"
            />
            <div className="flex gap-2">
              <button onClick={() => { if (typeof navigator !== "undefined") navigator.clipboard.writeText(mensaje); }}
                className="flex-1 py-1.5 text-xs rounded-lg bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 font-semibold">
                Copiar
              </button>
              <a href={buildWA(a.patientPhone, mensaje)} target="_blank" rel="noopener noreferrer"
                className="flex-1 py-1.5 text-xs rounded-lg bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 font-semibold text-center">
                Abrir WA
              </a>
              <a href={`tel:${a.patientPhone}`}
                className="flex-1 py-1.5 text-xs rounded-lg bg-cyan-50 border border-cyan-200 text-cyan-700 hover:bg-cyan-100 font-semibold text-center">
                Llamar
              </a>
            </div>
          </div>
        )}
      </div>

      {/* SECCIÓN 5: Estado de contacto */}
      {a.ultimaAccion && (
        <div className="px-5 py-4 space-y-2">
          <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide">Estado de contacto</h3>
          <p className="text-xs text-slate-500">
            Último contacto: hace {horasDesdeUltima !== null ? Math.round(horasDesdeUltima) : "?"} h · {a.tipoUltimaAccion}
          </p>
          {escalate && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              <span className="text-xs font-bold text-red-700">Escalar — sin respuesta</span>
            </div>
          )}
          {warn && !escalate && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              <span className="text-xs font-semibold text-amber-700">Sin respuesta registrada</span>
            </div>
          )}
        </div>
      )}

      {/* SECCIÓN 6: Registrar acción */}
      <div className="px-5 py-4 space-y-3">
        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide">Registrar acción</h3>
        <select value={tipoAccion} onChange={e => setTipoAccion(e.target.value)}
          className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-200 bg-white">
          <option>WA enviado</option>
          <option>Llamada</option>
          <option>Sin respuesta</option>
          <option>Confirmado</option>
          <option>Cancelado</option>
        </select>
        <input type="text" placeholder="Nota opcional…" value={notaAccion}
          onChange={e => setNotaAccion(e.target.value)}
          className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-cyan-200" />
        <button onClick={onGuardarAccion} disabled={saving}
          className="w-full py-2.5 rounded-xl bg-cyan-600 text-white text-sm font-bold hover:bg-cyan-700 disabled:opacity-50">
          {saving ? "Guardando…" : "Guardar acción"}
        </button>
      </div>

      {/* SECCIÓN 7: Acciones sobre la cita */}
      <div className="px-5 py-4 space-y-3">
        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide">Acciones sobre la cita</h3>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => onActualizarEstado("Confirmado")} disabled={actualizando}
            className="py-2.5 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm font-semibold hover:bg-green-100 disabled:opacity-50">
            ✓ Confirmar
          </button>
          <button onClick={() => onActualizarEstado("Cancelado")} disabled={actualizando}
            className="py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold hover:bg-rose-100 disabled:opacity-50">
            ✗ Cancelar
          </button>
          <button onClick={() => setShowReagendar(!showReagendar)}
            className="py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm font-semibold hover:bg-amber-100">
            ↻ Reagendar
          </button>
          <a href="/no-shows?tab=agenda"
            className="py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-100 text-center block">
            + Nueva cita
          </a>
        </div>

        {/* Mini reagendar form */}
        {showReagendar && (
          <div className="space-y-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-amber-700">Nueva fecha y hora</p>
            <div className="flex gap-2">
              <input type="date" value={reagDate} onChange={e => setReagDate(e.target.value)}
                className="flex-1 text-sm border border-amber-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none" />
              <input type="time" value={reagTime} onChange={e => setReagTime(e.target.value)}
                className="flex-1 text-sm border border-amber-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none" />
            </div>
            <button onClick={onReagendar} disabled={reagSaving || !reagDate || !reagTime}
              className="w-full py-2 rounded-lg bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 disabled:opacity-50">
              {reagSaving ? "Guardando…" : "Confirmar reagendo"}
            </button>
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="h-16" />
    </div>
  );
}

// ── GapPanel ──────────────────────────────────────────────────────────────────

function GapPanel({
  item, recalls, genLoading, mensaje, setMensaje, onGenerateRecallMensaje, onMarkDone, onClose,
}: {
  item: Extract<Parameters<typeof AccionSidePanel>[0]["item"], { type: "gap" }>;
  recalls: RecallAlert[];
  genLoading: boolean; mensaje: string; setMensaje: (m: string) => void;
  onGenerateRecallMensaje: (r: RecallAlert) => void;
  onMarkDone: (id: string) => void;
  onClose: () => void;
}) {
  const g = item.data;

  // Filter recall candidates by gap's clinic
  const candidates = recalls
    .filter(r => !g.clinica || r.clinica === g.clinica)
    .slice(0, 3);

  const urgenciaLabel = (u: number) =>
    u >= 90 ? "Urgente" : u >= 70 ? "Alta" : "Media";
  const urgenciaClass = (u: number) =>
    u >= 90 ? "bg-red-50 text-red-700 border-red-200" : u >= 70 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-blue-50 text-blue-700 border-blue-200";

  return (
    <div className="divide-y divide-slate-100">

      {/* SECCIÓN 1: Header */}
      <div className="px-5 py-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-bold text-slate-800">Hueco disponible</p>
            <p className="text-sm text-slate-600">{g.startDisplay}–{g.endDisplay} · {g.durationMin} min</p>
          </div>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${urgenciaClass(item.task.urgencia ?? 60)}`}>
            {urgenciaLabel(item.task.urgencia ?? 60)}
          </span>
        </div>
        {g.staffId && <p className="text-xs text-slate-400">{g.staffId} · {g.clinica ?? "—"}</p>}
      </div>

      {/* SECCIÓN 2: Candidatos */}
      <div className="px-5 py-4 space-y-3">
        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide">
          Candidatos sugeridos {candidates.length > 0 ? `(${candidates.length})` : ""}
        </h3>
        {candidates.length === 0 ? (
          <p className="text-xs text-slate-400">Sin candidatos de recall para este hueco</p>
        ) : (
          candidates.map((r, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{r.patientName}</p>
                  <p className="text-xs text-slate-500">{r.treatmentName}</p>
                  <p className="text-xs text-slate-400">En recall · {r.weeksSinceLast} semanas sin cita</p>
                </div>
                <a href={`tel:${r.patientPhone}`} className="text-xs text-cyan-600 hover:underline">{r.patientPhone}</a>
              </div>
              <div className="flex gap-2">
                <a href={`https://wa.me/${r.patientPhone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer"
                  className="flex-1 text-center py-1.5 text-xs rounded-lg bg-green-50 border border-green-200 text-green-700 font-semibold hover:bg-green-100">
                  WA directo
                </a>
                <a href={`tel:${r.patientPhone}`}
                  className="flex-1 text-center py-1.5 text-xs rounded-lg bg-cyan-50 border border-cyan-200 text-cyan-700 font-semibold hover:bg-cyan-100">
                  Llamar
                </a>
                <button onClick={() => onGenerateRecallMensaje(r)} disabled={genLoading}
                  className="flex-1 text-center py-1.5 text-xs rounded-lg bg-violet-50 border border-violet-200 text-violet-700 font-semibold hover:bg-violet-100 disabled:opacity-50">
                  Mensaje IA
                </button>
              </div>
            </div>
          ))
        )}
        {mensaje && (
          <div className="space-y-2">
            <textarea value={mensaje} onChange={e => setMensaje(e.target.value)} rows={3}
              className="w-full text-sm text-slate-700 border border-slate-200 rounded-xl px-3 py-2 resize-none focus:outline-none" />
            <button onClick={() => { if (typeof navigator !== "undefined") navigator.clipboard.writeText(mensaje); }}
              className="w-full py-1.5 text-xs rounded-lg bg-slate-50 border border-slate-200 text-slate-600 font-semibold hover:bg-slate-100">
              Copiar mensaje
            </button>
          </div>
        )}
      </div>

      {/* SECCIÓN 3: Overbooking */}
      {item.overbooking && (
        <div className="px-5 py-4">
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 space-y-2">
            <p className="text-sm font-bold text-amber-800">⚡ Overbooking posible</p>
            <p className="text-xs text-amber-700 leading-relaxed">
              Una cita de alto riesgo fue cancelada en este horario. Puedes ofrecer este hueco de forma segura a otro paciente o contactar al paciente cancelado.
            </p>
          </div>
        </div>
      )}

      {/* SECCIÓN 4: Llenar */}
      <div className="px-5 py-4 space-y-3">
        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wide">Llenar este hueco</h3>
        <div className="grid grid-cols-2 gap-2">
          <a href="/no-shows?tab=agenda"
            className="py-2.5 rounded-xl bg-cyan-50 border border-cyan-200 text-cyan-700 text-sm font-semibold hover:bg-cyan-100 text-center block">
            + Crear cita
          </a>
          <button onClick={() => { onMarkDone(item.id); onClose(); }}
            className="py-2.5 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm font-semibold hover:bg-green-100">
            ✓ Marcar cubierto
          </button>
        </div>
      </div>

      {/* Spacer */}
      <div className="h-8" />
    </div>
  );
}
