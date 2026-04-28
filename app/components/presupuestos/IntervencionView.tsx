"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
  UserSession,
  PresupuestoIntervencion,
  IntervencionResponse,
  IntervencionTab,
} from "../../lib/presupuestos/types";
import { URGENCIA_INTERVENCION_COLOR, INTERVENCION_TABS } from "../../lib/presupuestos/colors";
import { useClinic } from "../../lib/context/ClinicContext";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.round(diffMs / 60000);

  if (diffMin < 1) return "Ahora";
  if (diffMin < 60) return `Hace ${diffMin}min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `Hace ${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  return `Hace ${diffDay}d`;
}

function filterByTab(items: PresupuestoIntervencion[], tab: IntervencionTab): PresupuestoIntervencion[] {
  if (tab === "todas") return items;
  if (tab === "actuar") return items.filter((p) => (p.urgenciaBidireccional?.scoreFinal ?? 0) >= 60);
  const tabDef = INTERVENCION_TABS.find((t) => t.id === tab);
  if (!tabDef?.intenciones) return items;
  return items.filter((p) => {
    const intencion = p.intencionDetectada ?? "Sin clasificar";
    return tabDef.intenciones!.includes(intencion);
  });
}

function countForTab(items: PresupuestoIntervencion[], tab: IntervencionTab): number {
  return filterByTab(items, tab).length;
}

function scoreColor(score: number): string {
  if (score >= 70) return "bg-red-500";
  if (score >= 50) return "bg-orange-500";
  if (score >= 30) return "bg-amber-400";
  return "bg-slate-300";
}

// ─── UrgencyBar ──────────────────────────────────────────────────────────────

function UrgencyBar({ score, intencion, resp, cierre }: {
  score: number; intencion: number; resp: number; cierre: number;
}) {
  return (
    <div className="flex items-center gap-2 shrink-0" title={`Intención ${intencion} · Resp. ${resp} · Cierre ${cierre}`}>
      <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${scoreColor(score)}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-[9px] font-bold text-slate-500 tabular-nums">{score}</span>
    </div>
  );
}

// ─── IntervencionCard ────────────────────────────────────────────────────────

function IntervencionCard({
  item,
  onOpenPanel,
  onRefresh,
}: {
  item: PresupuestoIntervencion;
  onOpenPanel: (p: PresupuestoIntervencion) => void;
  onRefresh: () => void;
}) {
  const [waEnviado, setWaEnviado] = useState(false);
  const [llamando, setLlamando] = useState(false);
  const [respuestaInput, setRespuestaInput] = useState("");
  const [clasificando, setClasificando] = useState(false);

  const cleanPhone = (item.patientPhone ?? "").replace(/\D/g, "");
  const urgenciaColor = item.urgenciaIntervencion
    ? URGENCIA_INTERVENCION_COLOR[item.urgenciaIntervencion]
    : "bg-slate-100 text-slate-500";

  const ub = item.urgenciaBidireccional;

  async function handleEnviarWA() {
    if (!cleanPhone || !item.mensajeSugerido) return;

    try {
      await navigator.clipboard.writeText(item.mensajeSugerido);
    } catch { /* fallback: user can paste manually */ }

    window.open(
      `https://wa.me/${cleanPhone}?text=${encodeURIComponent(item.mensajeSugerido)}`,
      "_blank"
    );

    setWaEnviado(true);
    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presupuestoId: item.id,
        tipo: "WhatsApp enviado",
      }),
    }).then(() => onRefresh()).catch(() => {});
  }

  async function handleLlamar() {
    window.open(`tel:${item.patientPhone}`, "_self");
    setLlamando(true);

    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presupuestoId: item.id,
        tipo: "Llamada realizada",
      }),
    }).catch(() => {});
  }

  async function handleClasificarRespuesta() {
    if (!respuestaInput.trim()) return;
    setClasificando(true);
    try {
      await fetch("/api/presupuestos/intervencion/registrar-respuesta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presupuestoId: item.id,
          tipo: "Mensaje recibido",
          mensaje: respuestaInput.trim(),
        }),
      });
      setRespuestaInput("");
      setLlamando(false);
      onRefresh();
    } catch {
      // ignore
    } finally {
      setClasificando(false);
    }
  }

  const tiempoResp = item.fechaUltimaRespuesta
    ? formatTimeAgo(item.fechaUltimaRespuesta)
    : item.diasDesdeUltimoContacto != null
      ? `Hace ${item.diasDesdeUltimoContacto}d`
      : "";

  return (
    <div
      className={`rounded-xl border bg-white transition-[box-shadow,border-color] duration-150 hover:[box-shadow:var(--card-shadow-hover)] ${waEnviado ? "opacity-50" : ""}`}
      style={{
        borderColor: "var(--card-border)",
        boxShadow: "var(--card-shadow-rest)",
        borderLeft: `4px solid ${scoreColor(ub?.scoreFinal ?? 0) === "bg-red-500" ? "#ef4444" : ub?.scoreFinal && ub.scoreFinal >= 50 ? "#f97316" : ub?.scoreFinal && ub.scoreFinal >= 30 ? "#fbbf24" : "#94a3b8"}`,
      }}
    >
      {/* Card body — clickable */}
      <div
        className="p-4 cursor-pointer select-none"
        onClick={() => onOpenPanel(item)}
      >
        <div className="flex items-start gap-3">
          <div className="shrink-0 flex flex-col gap-1 items-start">
            {item.urgenciaIntervencion && (
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase ${urgenciaColor}`}>
                {item.urgenciaIntervencion}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <a
                href={`/presupuestos/paciente/${encodeURIComponent(item.patientName)}`}
                className="font-bold text-sm text-slate-900 truncate hover:text-violet-700 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {item.patientName}
              </a>
              {item.amount != null && (
                <span className="text-sm font-extrabold text-slate-700 shrink-0">
                  &euro;{item.amount.toLocaleString("es-ES")}
                </span>
              )}
              {ub && (
                <UrgencyBar
                  score={ub.scoreFinal}
                  intencion={ub.scoreIntencion}
                  resp={ub.scoreRespClinica}
                  cierre={ub.scoreCierre}
                />
              )}
            </div>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {item.treatments.map((t, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{t}</span>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
              {item.doctor && <span>{item.doctor}</span>}
              {item.clinica && <span>· {item.clinica}</span>}
              {tiempoResp && <span>· {tiempoResp}</span>}
            </div>

            {/* Última respuesta del paciente */}
            {item.ultimaRespuestaPaciente && (
              <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
                <p className="text-xs text-slate-700 line-clamp-2">
                  &quot;{item.ultimaRespuestaPaciente}&quot;
                </p>
              </div>
            )}

            {/* Acción sugerida */}
            {item.accionSugerida && (
              <p className="text-[10px] text-violet-600 font-semibold mt-1.5">
                {item.accionSugerida}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 px-4 pb-3 flex-wrap" onClick={(e) => e.stopPropagation()}>
        {cleanPhone && item.mensajeSugerido && (
          <button
            onClick={handleEnviarWA}
            disabled={waEnviado}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
          >
            {waEnviado ? "WA enviado" : "Enviar WA"}
          </button>
        )}
        {cleanPhone && (
          <button
            onClick={handleLlamar}
            className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            Llamar
          </button>
        )}
        <button
          onClick={() => onOpenPanel(item)}
          className="flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-xl bg-violet-600 text-white hover:bg-violet-700 ml-auto"
        >
          Ver ficha
        </button>
      </div>

      {/* Quick input after call */}
      {llamando && (
        <div className="px-4 pb-3" onClick={(e) => e.stopPropagation()}>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Respuesta del paciente</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={respuestaInput}
                onChange={(e) => setRespuestaInput(e.target.value)}
                placeholder="Respuesta del paciente (opcional)"
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleClasificarRespuesta();
                }}
              />
              <button
                onClick={handleClasificarRespuesta}
                disabled={!respuestaInput.trim() || clasificando}
                className="text-xs font-semibold px-3 py-2 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"
              >
                {clasificando ? "..." : "Clasificar"}
              </button>
              <button
                onClick={() => setLlamando(false)}
                className="text-xs px-2 py-2 rounded-lg text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BulkSendModal ───────────────────────────────────────────────────────────

function BulkSendModal({
  items,
  onClose,
  onRefresh,
}: {
  items: PresupuestoIntervencion[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(-1); // -1 = confirmation view
  const [enviados, setEnviados] = useState(0);

  const sendableItems = items.filter((p) => {
    const phone = (p.patientPhone ?? "").replace(/\D/g, "");
    return phone && p.mensajeSugerido;
  });

  function handleConfirm() {
    setCurrentIndex(0);
  }

  async function handleSendCurrent() {
    const item = sendableItems[currentIndex];
    if (!item) return;

    const cleanPhone = (item.patientPhone ?? "").replace(/\D/g, "");
    try {
      await navigator.clipboard.writeText(item.mensajeSugerido!);
    } catch { /* ignore */ }

    window.open(
      `https://wa.me/${cleanPhone}?text=${encodeURIComponent(item.mensajeSugerido!)}`,
      "_blank"
    );

    fetch("/api/presupuestos/intervencion/registrar-respuesta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presupuestoId: item.id,
        tipo: "WhatsApp enviado",
      }),
    }).catch(() => {});

    setEnviados((prev) => prev + 1);
    if (currentIndex < sendableItems.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setCurrentIndex(sendableItems.length); // done
    }
  }

  const isDone = currentIndex >= sendableItems.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              {isDone
                ? `${enviados}/${sendableItems.length} enviados`
                : currentIndex >= 0
                  ? `Enviando ${currentIndex + 1}/${sendableItems.length}...`
                  : `Enviar WA a ${sendableItems.length} pacientes`}
            </h3>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
          </div>
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {currentIndex === -1 && (
            <>
              <p className="text-xs text-slate-500 mb-3">Se enviara WhatsApp a los siguientes pacientes:</p>
              <div className="space-y-2">
                {sendableItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-700">{item.patientName}</span>
                    {item.amount != null && (
                      <span className="text-slate-500">&euro;{item.amount.toLocaleString("es-ES")}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {currentIndex >= 0 && !isDone && (
            <div className="space-y-3">
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${((enviados) / sendableItems.length) * 100}%` }}
                />
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-sm font-bold text-slate-900">{sendableItems[currentIndex].patientName}</p>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                  {sendableItems[currentIndex].mensajeSugerido}
                </p>
              </div>
              <button
                onClick={handleSendCurrent}
                className="w-full text-sm font-semibold py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Enviar a {sendableItems[currentIndex].patientName}
              </button>
            </div>
          )}

          {isDone && (
            <div className="text-center py-4">
              <p className="text-sm font-semibold text-emerald-700">
                {enviados} mensaje{enviados !== 1 ? "s" : ""} enviado{enviados !== 1 ? "s" : ""}
              </p>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          {currentIndex === -1 ? (
            <>
              <button onClick={onClose} className="text-xs font-semibold px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100">
                Cancelar
              </button>
              <button onClick={handleConfirm} className="text-xs font-semibold px-4 py-2 rounded-xl bg-violet-600 text-white hover:bg-violet-700">
                Confirmar y enviar
              </button>
            </>
          ) : (
            <button
              onClick={() => { onClose(); if (enviados > 0) onRefresh(); }}
              className="text-xs font-semibold px-4 py-2 rounded-xl bg-slate-800 text-white hover:bg-slate-700"
            >
              {isDone ? "Cerrar" : "Cancelar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── QuickResponseModal ──────────────────────────────────────────────────────

function QuickResponseModal({
  onClose,
  onRefresh,
}: {
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [presupuestoId, setPresupuestoId] = useState("");
  const [respuesta, setRespuesta] = useState("");
  const [clasificando, setClasificando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    navigator.clipboard.readText()
      .then((text) => {
        if (text.trim()) setRespuesta(text.trim());
      })
      .catch(() => {});
    textareaRef.current?.focus();
  }, []);

  async function handleClasificar() {
    if (!presupuestoId.trim() || !respuesta.trim()) return;
    setClasificando(true);
    try {
      const res = await fetch("/api/presupuestos/intervencion/clasificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presupuestoId: presupuestoId.trim(),
          respuestaPaciente: respuesta.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setResultado(`Clasificado: ${data.clasificacion?.intencion ?? "OK"}`);
        onRefresh();
      } else {
        setResultado("Error al clasificar");
      }
    } catch {
      setResultado("Error de red");
    } finally {
      setClasificando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Respuesta rápida</h3>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded font-mono">Ctrl+Shift+L</span>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">ID Presupuesto</label>
            <input
              type="text"
              value={presupuestoId}
              onChange={(e) => setPresupuestoId(e.target.value)}
              placeholder="rec..."
              className="w-full text-xs px-3 py-2 mt-1 rounded-lg border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Respuesta del paciente</label>
            <textarea
              ref={textareaRef}
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
              rows={4}
              className="w-full text-xs px-3 py-2 mt-1 rounded-lg border border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 outline-none resize-none"
              placeholder="Pega aqui la respuesta del paciente..."
            />
          </div>
          {resultado && (
            <p className="text-xs font-semibold text-emerald-600">{resultado}</p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs font-semibold px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            onClick={handleClasificar}
            disabled={!presupuestoId.trim() || !respuesta.trim() || clasificando}
            className="text-xs font-semibold px-4 py-2 rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40"
          >
            {clasificando ? "Clasificando..." : "Clasificar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main View ───────────────────────────────────────────────────────────────

export default function IntervencionView({
  user,
  onOpenDrawer,
}: {
  user: UserSession;
  onOpenDrawer: (p: PresupuestoIntervencion) => void;
}) {
  const [data, setData] = useState<IntervencionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [completadosOpen, setCompletadosOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sprint 7 Fase 5: filtro de clínica vive en ClinicContext global.
  const { selectedClinicaNombre } = useClinic();

  // Sprint 2 state
  const [subTab, setSubTab] = useState<IntervencionTab>("actuar");
  const [filtroDoctor, setFiltroDoctor] = useState<string>("");
  const [filtroTratamiento, setFiltroTratamiento] = useState<string>("");
  const [quickResponseOpen, setQuickResponseOpen] = useState(false);
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
  const [, setTick] = useState(0); // force re-render for live counter

  // Live second counter
  useEffect(() => {
    const t = setInterval(() => setTick((c) => c + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Keyboard shortcut: Ctrl+Shift+L
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && (e.key === "L" || e.key === "l")) {
        e.preventDefault();
        setQuickResponseOpen(true);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const [tiempoMedioMin, setTiempoMedioMin] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const url = new URL("/api/presupuestos/intervencion", location.href);
      if (user.clinica) url.searchParams.set("clinica", user.clinica);
      const [res, kpiRes] = await Promise.all([
        fetch(url.toString()),
        fetch("/api/presupuestos/kpi-hoy"),
      ]);
      const d: IntervencionResponse = await res.json();
      setData(d);
      const kpi = await kpiRes.json().catch(() => ({}));
      setTiempoMedioMin(typeof kpi?.tiempoMedioMin === "number" ? kpi.tiempoMedioMin : null);
      setLastUpdate(new Date());
    } catch {
      // Keep existing data on error
    } finally {
      setLoading(false);
    }
  }, [user.clinica]);

  useEffect(() => {
    fetchData();
    // Auto-refresh: 15s en horario operativo (9h-20h), 30s fuera de ese rango.
    const hour = new Date().getHours();
    const refreshMs = hour >= 9 && hour < 20 ? 15_000 : 30_000;
    intervalRef.current = setInterval(fetchData, refreshMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  const secondsAgo = Math.round((Date.now() - lastUpdate.getTime()) / 1000);

  // Client-side filtering. El filtro de clínica viene del ClinicContext global.
  const globalFiltered = useMemo(() => {
    let items = data?.allItems ?? [];
    if (selectedClinicaNombre) items = items.filter((p) => p.clinica === selectedClinicaNombre);
    if (filtroDoctor) items = items.filter((p) => p.doctor === filtroDoctor);
    if (filtroTratamiento) items = items.filter((p) => p.treatments.includes(filtroTratamiento));
    return items;
  }, [data, selectedClinicaNombre, filtroDoctor, filtroTratamiento]);

  const filteredItems = useMemo(() => {
    return filterByTab(globalFiltered, subTab).sort(
      (a, b) => (b.urgenciaBidireccional?.scoreFinal ?? 0) - (a.urgenciaBidireccional?.scoreFinal ?? 0)
    );
  }, [globalFiltered, subTab]);

  const bulkSendable = filteredItems.filter((p) => {
    const phone = (p.patientPhone ?? "").replace(/\D/g, "");
    return phone && p.mensajeSugerido;
  });

  if (loading && !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-28 rounded-2xl bg-slate-100" />
        <div className="h-40 rounded-2xl bg-slate-100" />
        <div className="h-40 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  const totalPendientes = data?.totalPendientes ?? 0;
  const completadasHoy = data?.completadasHoy ?? 0;
  const total = totalPendientes + completadasHoy;
  const pct = total > 0 ? Math.round((completadasHoy / total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Sprint 13 Bloque 8 — banner Cola Intervención con paleta
          producto: fondo sky-50, número slate-900, label sky-700. */}
      <div className="rounded-2xl bg-sky-50 border border-sky-100 p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-sky-700 uppercase tracking-wide">
              Cola de intervención · Hoy
            </p>
            <h2 className="font-display text-4xl font-bold mt-2 tracking-tight tabular-nums text-slate-900">
              {totalPendientes} pendiente{totalPendientes !== 1 ? "s" : ""} · {completadasHoy} completada{completadasHoy !== 1 ? "s" : ""}
            </h2>
            {/* Sprint 10 C — KPI tiempo medio respuesta. */}
            <p className="text-sm text-slate-500 mt-1">
              Tiempo medio respuesta:{" "}
              <span className="font-semibold text-slate-900 tabular-nums">
                {tiempoMedioMin == null ? "—" : `${tiempoMedioMin} min`}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-4">
            {total > 0 && (
              <div className="text-center">
                <div className="w-32 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-500 rounded-full transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5 tabular-nums">
                  {pct}% del plan de hoy
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-5 flex-wrap">
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            className="text-xs font-medium px-3 py-1.5 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Actualizar
          </button>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 tabular-nums">
            ✓ Actualizado hace {secondsAgo < 60 ? `${secondsAgo}s` : `${Math.round(secondsAgo / 60)}m`}
          </span>
        </div>
      </div>

      {/* Global filters — el selector de clínica vive en el GlobalHeader
          (Sprint 7 Fase 5). Aquí solo quedan filtros específicos del área. */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Doctor dropdown */}
        <select
          value={filtroDoctor}
          onChange={(e) => setFiltroDoctor(e.target.value)}
          className="text-[10px] font-semibold px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 outline-none focus:border-violet-400"
        >
          <option value="">Todos los doctores</option>
          {(data?.doctores ?? []).map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        {/* Treatment dropdown */}
        <select
          value={filtroTratamiento}
          onChange={(e) => setFiltroTratamiento(e.target.value)}
          className="text-[10px] font-semibold px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 outline-none focus:border-violet-400"
        >
          <option value="">Todos los tratamientos</option>
          {(data?.tratamientos ?? []).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Secondary navbar — 8 pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {INTERVENCION_TABS.map((tab) => {
          const count = countForTab(globalFiltered, tab.id);
          const isActive = subTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                isActive
                  ? "bg-sky-500 text-white"
                  : "bg-white border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-slate-50"
              }`}
            >
              {tab.label} · {count}
            </button>
          );
        })}
      </div>

      {/* Bulk send button */}
      {bulkSendable.length >= 3 && (
        <button
          onClick={() => setBulkSendOpen(true)}
          className="text-xs font-semibold px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"
        >
          Enviar WA a {bulkSendable.length} pacientes
        </button>
      )}

      {/* Empty state */}
      {filteredItems.length === 0 && (
        <div className="rounded-3xl border border-dashed border-slate-200 p-12 text-center">
          <p className="text-sm font-bold text-slate-700">Sin casos en esta vista</p>
          <p className="text-xs text-slate-400 mt-1">
            {subTab === "actuar"
              ? "No hay casos con urgencia alta. Revisa otras pestanas."
              : "Los presupuestos con respuesta del paciente o urgencia asignada apareceran aqui."}
          </p>
        </div>
      )}

      {/* Cards list */}
      <div className="space-y-2">
        {filteredItems.map((item) => (
          <IntervencionCard
            key={item.id}
            item={item}
            onOpenPanel={onOpenDrawer}
            onRefresh={fetchData}
          />
        ))}
      </div>

      {/* Completed today — collapsible */}
      {completadasHoy > 0 && (
        <div>
          <button
            onClick={() => setCompletadosOpen(!completadosOpen)}
            className="flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-slate-700"
          >
            <span className={`transition-transform ${completadosOpen ? "rotate-90" : ""}`}>&#9656;</span>
            Completadas hoy ({completadasHoy})
          </button>
          {completadosOpen && data?.casosCompletados && (
            <div className="mt-2 space-y-2 opacity-60">
              {data.casosCompletados.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border bg-emerald-50 border-emerald-100 p-3 cursor-pointer"
                  onClick={() => onOpenDrawer(item)}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-600">✓ Completado</span>
                    <span className="text-sm font-semibold text-slate-700">{item.patientName}</span>
                    {item.amount != null && (
                      <span className="text-sm font-bold text-slate-500">&euro;{item.amount.toLocaleString("es-ES")}</span>
                    )}
                    <span className="text-[10px] text-slate-400 ml-auto">{item.tipoUltimaAccion}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {bulkSendOpen && (
        <BulkSendModal
          items={filteredItems}
          onClose={() => setBulkSendOpen(false)}
          onRefresh={fetchData}
        />
      )}
      {quickResponseOpen && (
        <QuickResponseModal
          onClose={() => setQuickResponseOpen(false)}
          onRefresh={fetchData}
        />
      )}
    </div>
  );
}
