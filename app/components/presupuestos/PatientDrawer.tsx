"use client";

import { useEffect, useState, type ComponentType } from "react";
import { toast } from "sonner";
import type { Presupuesto, Contacto, PresupuestoEstado, TipoContacto, ResultadoContacto, MotivoPerdida, HistorialAccion, TipoAccion } from "../../lib/presupuestos/types";
import { ESTADO_CONFIG, PIPELINE_ORDEN, ESPECIALIDAD_COLOR, ORIGEN_LABEL } from "../../lib/presupuestos/colors";
import MotivoPerdidaModal from "./MotivoPerdidaModal";
import IAMensajePanel from "./IAMensajePanel";
import { ErrorState } from "../ui/Feedback";
import {
  Sparkles,
  Phone,
  MessageCircle,
  Mail,
  Building2,
  ArrowRight,
  Eye,
  CheckCircle2,
  XCircle,
  X,
  ChevronDown,
  LoaderCircle,
  ICON_STROKE,
} from "../icons";
import { Link as LinkIcon, ChevronUp } from "lucide-react";

type IconType = ComponentType<{ size?: number; strokeWidth?: number; className?: string; "aria-hidden"?: boolean }>;

const TIPO_LABEL: Record<TipoContacto, string> = {
  llamada: "Llamada", whatsapp: "WhatsApp", email: "Email", visita: "Visita",
};
const TIPO_ICON: Record<TipoContacto, IconType> = {
  llamada: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  visita: Building2,
};
const TIPO_DOT_COLOR: Record<TipoContacto, string> = {
  llamada:  "bg-slate-500",
  whatsapp: "bg-emerald-500",
  email:    "bg-[var(--color-accent)]",
  visita:   "bg-amber-500",
};
const RESULTADO_COLOR: Record<ResultadoContacto, string> = {
  "contestó":     "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  "no contestó":  "bg-[var(--color-surface-muted)] text-[var(--color-muted)]",
  "acordó cita":  "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  "rechazó":      "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  "pidió tiempo": "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

const TIPO_ACCION_ICON: Record<TipoAccion, IconType> = {
  cambio_estado:     ArrowRight,
  contacto:          Phone,
  portal_generado:   LinkIcon,
  portal_visto:      Eye,
  portal_aceptado:   CheckCircle2,
  portal_rechazado:  XCircle,
  mensaje_automatico: Sparkles,
};

const TIPO_ACCION_DOT: Record<TipoAccion, string> = {
  cambio_estado:     "bg-slate-400",
  contacto:          "bg-slate-400",
  portal_generado:   "bg-[var(--color-accent)]",
  portal_visto:      "bg-[var(--color-accent)]",
  portal_aceptado:   "bg-emerald-500",
  portal_rechazado:  "bg-rose-500",
  mensaje_automatico: "bg-[var(--color-accent)]",
};

type TimelineItem =
  | { kind: "contacto"; contacto: Contacto; date: string }
  | { kind: "historial"; accion: HistorialAccion; date: string };

export default function PatientDrawer({
  presupuesto,
  onClose,
  onChangeEstado,
  onNewForPatient,
}: {
  presupuesto: Presupuesto;
  onClose: () => void;
  onChangeEstado: (id: string, estado: PresupuestoEstado, extra?: { motivoPerdida?: MotivoPerdida; motivoPerdidaTexto?: string; reactivar?: boolean }) => void;
  onNewForPatient?: () => void;
}) {
  const p = presupuesto;
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [loadingC, setLoadingC] = useState(true);
  const [errorC, setErrorC] = useState(false);
  const [historial, setHistorial] = useState<HistorialAccion[]>([]);
  const [loadingH, setLoadingH] = useState(true);
  const [errorH, setErrorH] = useState(false);
  const [pendingPerdido, setPendingPerdido] = useState(false);

  // Patient history — other presupuestos with the same name
  const [patientHistory, setPatientHistory] = useState<Presupuesto[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Siguiente acción IA
  const [recomendacion, setRecomendacion] = useState<string | null>(null);
  const [loadingRec, setLoadingRec] = useState(false);

  // New contact form
  const [tipo, setTipo] = useState<TipoContacto>("llamada");
  const [resultado, setResultado] = useState<ResultadoContacto>("contestó");
  const [nota, setNota] = useState("");
  const [oferta, setOferta] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadContactos() {
    setLoadingC(true);
    setErrorC(false);
    try {
      const r = await fetch(`/api/presupuestos/contactos?presupuestoId=${p.id}`);
      const d = await r.json();
      setContactos(d.contactos ?? []);
    } catch { setContactos([]); setErrorC(true); }
    finally { setLoadingC(false); }
  }

  async function loadHistorial() {
    setLoadingH(true);
    setErrorH(false);
    try {
      const r = await fetch(`/api/presupuestos/historial?presupuestoId=${p.id}`);
      const d = await r.json();
      setHistorial(Array.isArray(d) ? d : []);
    } catch { setHistorial([]); setErrorH(true); }
    finally { setLoadingH(false); }
  }

  useEffect(() => {
    loadContactos();
    loadHistorial();
  }, [p.id]);

  useEffect(() => {
    const url = new URL("/api/presupuestos/kanban", location.href);
    url.searchParams.set("q", p.patientName);
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => {
        const all: Presupuesto[] = d.presupuestos ?? [];
        setPatientHistory(all.filter((h) => h.id !== p.id));
      })
      .catch(() => {});
  }, [p.id, p.patientName]);

  async function fetchRecomendacion() {
    setLoadingRec(true);
    try {
      const res = await fetch("/api/ai/siguiente-accion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presupuesto: p, contactos }),
      });
      const d = await res.json();
      setRecomendacion(d.accion ?? null);
    } catch {
      setRecomendacion(null);
      toast.error("No se pudo obtener la recomendación. Inténtalo de nuevo.");
    } finally {
      setLoadingRec(false);
    }
  }

  async function handleAddContact() {
    setSaving(true);
    try {
      await fetch("/api/presupuestos/contactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presupuestoId: p.id, tipo, resultado, nota: nota.trim() || undefined, oferta: oferta || undefined }),
      });
      setNota("");
      setOferta(false);
      toast.success("Contacto guardado");
      await Promise.all([loadContactos(), loadHistorial()]);
    } catch {
      toast.error("No se pudo guardar el contacto. Inténtalo de nuevo.");
    } finally { setSaving(false); }
  }

  const cfg = ESTADO_CONFIG[p.estado];
  const targetEstados = PIPELINE_ORDEN.filter((e) => e !== p.estado);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />

      {/* Drawer panel */}
      <div className="relative w-full max-w-md bg-[var(--color-surface)] shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold text-[var(--color-foreground)] truncate">{p.patientName}</h3>
            <p className="text-xs text-[var(--color-muted)] mt-0.5 truncate">
              {p.treatments.join(", ")}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: cfg.hex, color: cfg.textColor }}
              >
                {cfg.label}
              </span>
              {p.tipoPaciente && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)]">
                  {p.tipoPaciente}
                </span>
              )}
              {p.tipoVisita && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                  {p.tipoVisita === "Primera Visita" ? "1ª Visita" : "Historial"}
                </span>
              )}
              {p.origenLead && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-medium">
                  {ORIGEN_LABEL[p.origenLead]}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] leading-none shrink-0"
            aria-label="Cerrar"
          >
            <X size={18} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Key info */}
          <div className="px-5 py-4 grid grid-cols-2 gap-3 border-b border-[var(--color-border)]">
            {p.amount != null && (
              <div>
                <p className="text-[10px] text-[var(--color-muted)] font-medium uppercase tracking-wide">Importe</p>
                <p className="font-display font-bold text-[var(--color-foreground)] tabular-nums">€{p.amount.toLocaleString("es-ES")}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] text-[var(--color-muted)] font-medium uppercase tracking-wide">Días</p>
              <p className="font-bold text-[var(--color-foreground)] tabular-nums">{p.daysSince} días</p>
            </div>
            {p.doctor && (
              <div>
                <p className="text-[10px] text-[var(--color-muted)] font-medium uppercase tracking-wide">Doctor</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {p.doctorEspecialidad && (
                    <span
                      className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                      style={{ background: ESPECIALIDAD_COLOR[p.doctorEspecialidad], color: "#1e293b" }}
                    >
                      {p.doctorEspecialidad}
                    </span>
                  )}
                  <p className="text-xs text-[var(--color-foreground)]">{p.doctor}</p>
                </div>
              </div>
            )}
            {p.clinica && (
              <div>
                <p className="text-[10px] text-[var(--color-muted)] font-medium uppercase tracking-wide">Clínica</p>
                <p className="text-xs text-[var(--color-foreground)]">{p.clinica}</p>
              </div>
            )}
            {p.patientPhone && (
              <div className="col-span-2">
                <p className="text-[10px] text-[var(--color-muted)] font-medium uppercase tracking-wide">Teléfono</p>
                <a href={`tel:${p.patientPhone}`} className="text-xs text-[var(--color-accent)] font-medium">
                  {p.patientPhone}
                </a>
              </div>
            )}
          </div>

          {/* Notes */}
          {p.notes && (() => {
            const notasLimpias = p.notes!.replace(/\[SEED_[A-Z_]+\]/g, "").trim();
            return notasLimpias ? (
              <div className="px-5 py-3 border-b border-[var(--color-border)]">
                <p className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide font-medium mb-1">Notas</p>
                <p className="text-xs text-[var(--color-muted)] italic">{notasLimpias}</p>
              </div>
            ) : null;
          })()}

          {/* Move estado */}
          <div className="px-5 py-3 border-b border-[var(--color-border)]">
            <p className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide font-medium mb-2">Mover a…</p>
            <div className="flex flex-wrap gap-1.5">
              {targetEstados.map((e) => {
                const c = ESTADO_CONFIG[e];
                return (
                  <button
                    key={e}
                    onClick={() => {
                      if (e === "PERDIDO") {
                        setPendingPerdido(true);
                      } else {
                        onChangeEstado(p.id, e);
                        onClose();
                      }
                    }}
                    className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1.5 rounded-full border hover:opacity-80 transition-opacity"
                    style={{ borderColor: c.hex + "66", background: c.hex + "11", color: c.hex }}
                  >
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: c.hex }} />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mensaje IA */}
          {p.patientPhone && (
            <div data-ia-panel>
              <IAMensajePanel presupuesto={p} onContactRegistered={loadContactos} />
            </div>
          )}

          {/* Siguiente acción IA */}
          <div className="px-5 py-3 border-b border-[var(--color-border)]">
            <div className="flex items-center justify-between mb-2">
              <p className="inline-flex items-center gap-1 text-[10px] text-[var(--color-muted)] uppercase tracking-wide font-medium">
                <Sparkles size={12} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
                Siguiente acción
              </p>
              {recomendacion && (
                <button
                  onClick={() => { setRecomendacion(null); }}
                  className="text-[9px] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                >
                  Limpiar
                </button>
              )}
            </div>
            {recomendacion ? (
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-accent-soft)] px-3 py-2.5">
                <p className="text-xs text-[var(--color-foreground)] leading-relaxed">{recomendacion}</p>
                {p.patientPhone && (
                  <button
                    onClick={() => {
                      /* Re-use IAMensajePanel already on screen — just scroll up */
                      document.querySelector("[data-ia-panel]")?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-accent)] hover:underline"
                  >
                    <Sparkles size={12} strokeWidth={ICON_STROKE} aria-hidden />
                    Sugerir mensaje
                    <ArrowRight size={12} strokeWidth={ICON_STROKE} aria-hidden />
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={fetchRecomendacion}
                disabled={loadingRec}
                className="w-full rounded-xl border border-[var(--color-border)] text-[var(--color-accent)] text-xs font-semibold py-2 hover:bg-[var(--color-accent-soft)] disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {loadingRec ? (
                  <><LoaderCircle size={12} strokeWidth={ICON_STROKE} className="animate-spin" aria-hidden /> Analizando…</>
                ) : (
                  <><Sparkles size={12} strokeWidth={ICON_STROKE} aria-hidden /> ¿Qué hacer ahora?</>
                )}
              </button>
            )}
          </div>

          {/* Timeline unificado — contactos + historial de acciones */}
          <div className="px-5 py-3 border-b border-[var(--color-border)]">
            {(() => {
              const items: TimelineItem[] = [
                ...contactos.map((c): TimelineItem => ({ kind: "contacto", contacto: c, date: c.fechaHora })),
                ...historial.map((h): TimelineItem => ({ kind: "historial", accion: h, date: h.fecha })),
              ].sort((a, b) => b.date.localeCompare(a.date));

              const loading = loadingC || loadingH;
              const loadError = errorC || errorH;
              return (
                <>
                  <p className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide font-medium mb-3">
                    Historial de acciones ({loading ? "…" : items.length})
                  </p>
                  {loading ? (
                    <div className="space-y-3">
                      {[1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-[var(--color-surface-muted)] animate-pulse" />)}
                    </div>
                  ) : loadError ? (
                    <ErrorState
                      detail="El historial de acciones no está disponible."
                      onRetry={() => { if (errorC) loadContactos(); if (errorH) loadHistorial(); }}
                    />
                  ) : items.length === 0 ? (
                    <p className="text-xs text-[var(--color-muted)]">Sin acciones aún</p>
                  ) : (
                    <div>
                      {items.map((item, idx) => {
                        const isLast = idx === items.length - 1;
                        if (item.kind === "contacto") {
                          const c = item.contacto;
                          const TipoIcon = TIPO_ICON[c.tipo];
                          return (
                            <div key={`c-${c.id}`} className="flex gap-3">
                              <div className="flex flex-col items-center">
                                <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${TIPO_DOT_COLOR[c.tipo]}`} />
                                {!isLast && <div className="w-0.5 flex-1 bg-[var(--color-border)] my-1 min-h-[12px]" />}
                              </div>
                              <div className={`flex-1 ${isLast ? "pb-1" : "pb-3"}`}>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-foreground)]">
                                    <TipoIcon size={12} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" aria-hidden />
                                    {TIPO_LABEL[c.tipo]}
                                  </span>
                                  {c.mensajeIAUsado && (
                                    <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-semibold">
                                      <Sparkles size={10} strokeWidth={ICON_STROKE} aria-hidden /> IA
                                    </span>
                                  )}
                                  {c.oferta && (
                                    <span className="text-[9px] px-1 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 font-semibold">Oferta</span>
                                  )}
                                  <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${RESULTADO_COLOR[c.resultado]}`}>
                                    {c.resultado}
                                  </span>
                                </div>
                                {c.nota && <p className="text-[10px] text-[var(--color-muted)] mt-0.5 italic">{c.nota}</p>}
                                <p className="text-[9px] text-[var(--color-muted)] mt-0.5">{fmt(c.fechaHora)}</p>
                              </div>
                            </div>
                          );
                        } else {
                          const h = item.accion;
                          // Contactos duplicados del historial (doble escritura) se filtran visualmente
                          if (h.tipo === "contacto") return null;
                          const AccionIcon = TIPO_ACCION_ICON[h.tipo];
                          return (
                            <div key={`h-${h.id}`} className="flex gap-3">
                              <div className="flex flex-col items-center">
                                <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${TIPO_ACCION_DOT[h.tipo]}`} />
                                {!isLast && <div className="w-0.5 flex-1 bg-[var(--color-border)] my-1 min-h-[12px]" />}
                              </div>
                              <div className={`flex-1 ${isLast ? "pb-1" : "pb-3"}`}>
                                <div className="flex items-center gap-1.5">
                                  <AccionIcon size={12} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)] shrink-0" aria-hidden />
                                  <span className="text-[10px] font-semibold text-[var(--color-muted)]">{h.descripcion}</span>
                                </div>
                                {h.registradoPor && (
                                  <p className="text-[9px] text-[var(--color-muted)] mt-0.5">Por {h.registradoPor}</p>
                                )}
                                <p className="text-[9px] text-[var(--color-muted)] mt-0.5">{fmt(h.fecha)}</p>
                              </div>
                            </div>
                          );
                        }
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Patient history accordion */}
          {patientHistory.length > 0 && (
            <div className="px-5 py-3 border-b border-[var(--color-border)]">
              <button
                className="flex items-center justify-between w-full text-left"
                onClick={() => setHistoryOpen((v) => !v)}
              >
                <span className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide font-medium">
                  Historial del paciente ({patientHistory.length})
                </span>
                {historyOpen ? (
                  <ChevronUp size={14} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" aria-hidden />
                ) : (
                  <ChevronDown size={14} strokeWidth={ICON_STROKE} className="text-[var(--color-muted)]" aria-hidden />
                )}
              </button>
              {historyOpen && (
                <div className="mt-2 space-y-1.5">
                  {patientHistory.map((h) => {
                    const c = ESTADO_CONFIG[h.estado];
                    return (
                      <div key={h.id} className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0" style={{ background: c.hex + "22", color: c.hex }}>{c.label}</span>
                        <p className="text-xs text-[var(--color-foreground)] truncate flex-1">{h.treatments[0] ?? "—"}</p>
                        {h.amount != null && <span className="text-[10px] font-bold text-[var(--color-foreground)] shrink-0 tabular-nums">€{h.amount.toLocaleString("es-ES")}</span>}
                        <span className="text-[9px] text-[var(--color-muted)] shrink-0 tabular-nums">{h.fechaPresupuesto.split("-").reverse().join("/")}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Add contact */}
          <div className="px-5 py-4">
            <p className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide font-medium mb-2">Registrar contacto</p>
            <div className="space-y-2">
              <div className="flex gap-2">
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as TipoContacto)}
                  className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  <option value="llamada">Llamada</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="visita">Visita</option>
                </select>
                <select
                  value={resultado}
                  onChange={(e) => setResultado(e.target.value as ResultadoContacto)}
                  className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
                >
                  <option value="contestó">Contestó</option>
                  <option value="no contestó">No contestó</option>
                  <option value="acordó cita">Acordó cita</option>
                  <option value="rechazó">Rechazó</option>
                  <option value="pidió tiempo">Pidió tiempo</option>
                </select>
              </div>
              <textarea
                placeholder="Nota (opcional)…"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
              />
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={oferta}
                  onChange={(e) => setOferta(e.target.checked)}
                  className="w-3.5 h-3.5 accent-amber-500"
                />
                <span className="text-xs text-[var(--color-foreground)]">Oferta realizada</span>
                {oferta && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 font-semibold ml-auto">
                    Se marcará como oferta activa
                  </span>
                )}
              </label>
              <button
                onClick={handleAddContact}
                disabled={saving}
                className="w-full rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-xs font-semibold py-2 hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Guardar contacto"}
              </button>
            </div>
            {onNewForPatient && (
              <button
                onClick={onNewForPatient}
                className="w-full mt-2 rounded-xl border border-[var(--color-border)] text-[var(--color-accent)] text-xs font-semibold py-2 hover:bg-[var(--color-accent-soft)]"
              >
                + Nuevo presupuesto para este paciente
              </button>
            )}
          </div>
        </div>
      </div>

      {pendingPerdido && (
        <MotivoPerdidaModal
          patientName={p.patientName}
          onConfirm={(motivo, texto, reactivar) => {
            onChangeEstado(p.id, "PERDIDO", { motivoPerdida: motivo, motivoPerdidaTexto: texto, reactivar });
            setPendingPerdido(false);
            onClose();
          }}
          onCancel={() => setPendingPerdido(false)}
        />
      )}
    </div>
  );
}
