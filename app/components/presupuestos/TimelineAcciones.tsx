"use client";

// Timeline de contactos + historial de acciones de un presupuesto.
//
// Unificación de fichas (2026-07-27): rescatado del difunto PatientDrawer,
// que era la única ficha que enseñaba "qué se hizo con este caso". Ahora vive
// como sección PLEGABLE del panel de acción (IntervencionSidePanel), debajo
// de la recomendación y encima de la conversación: la conversación sigue
// siendo la protagonista y la auditoría está a un clic.
//
// Carga perezosa: los dos fetch solo salen cuando se despliega — abrir una
// ficha no debe pagar dos peticiones que casi nadie mira.

import { useState } from "react";
import type {
  Contacto,
  HistorialAccion,
  TipoContacto,
  ResultadoContacto,
  TipoAccion,
} from "../../lib/presupuestos/types";
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
  ChevronDown,
  ICON_STROKE,
} from "../icons";
import { Link as LinkIcon } from "lucide-react";
import { cargarJSON, traeLista } from "../../lib/fetch-json";

type IconType = React.ComponentType<{
  size?: number;
  strokeWidth?: number;
  className?: string;
  "aria-hidden"?: boolean;
}>;

const TIPO_LABEL: Record<TipoContacto, string> = {
  llamada: "Llamada",
  whatsapp: "WhatsApp",
  email: "Email",
  visita: "Visita",
};

const TIPO_ICON: Record<TipoContacto, IconType> = {
  llamada: Phone,
  whatsapp: MessageCircle,
  email: Mail,
  visita: Building2,
};

const TIPO_DOT_COLOR: Record<TipoContacto, string> = {
  llamada: "bg-slate-500",
  whatsapp: "bg-emerald-500",
  email: "bg-[var(--color-accent)]",
  visita: "bg-amber-500",
};

const RESULTADO_COLOR: Record<ResultadoContacto, string> = {
  "contestó": "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  "no contestó": "bg-[var(--color-surface-muted)] text-[var(--color-muted)]",
  "acordó cita": "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  "rechazó": "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  "pidió tiempo": "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
};

const TIPO_ACCION_ICON: Record<TipoAccion, IconType> = {
  cambio_estado: ArrowRight,
  contacto: Phone,
  portal_generado: LinkIcon,
  portal_visto: Eye,
  portal_aceptado: CheckCircle2,
  portal_rechazado: XCircle,
  mensaje_automatico: Sparkles,
};

const TIPO_ACCION_DOT: Record<TipoAccion, string> = {
  cambio_estado: "bg-slate-400",
  contacto: "bg-slate-400",
  portal_generado: "bg-[var(--color-accent)]",
  portal_visto: "bg-[var(--color-accent)]",
  portal_aceptado: "bg-emerald-500",
  portal_rechazado: "bg-rose-500",
  mensaje_automatico: "bg-[var(--color-accent)]",
};

type TimelineItem =
  | { kind: "contacto"; contacto: Contacto; date: string }
  | { kind: "historial"; accion: HistorialAccion; date: string };

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function TimelineAcciones({ presupuestoId }: { presupuestoId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [historial, setHistorial] = useState<HistorialAccion[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);

  async function cargar() {
    setCargando(true);
    setError(false);
    try {
      // Un fallo de carga se ve como fallo, nunca como "sin acciones aún".
      // `cargarJSON` comprueba además el campo `error` que varias rutas mandan
      // con 200 — el `?? []` de aquí lo habría convertido en "sin contactos".
      const [dc, dh] = await Promise.all([
        cargarJSON<{ contactos: Contacto[] }>(
          `/api/presupuestos/contactos?presupuestoId=${presupuestoId}`,
          { validar: traeLista("contactos") },
        ),
        cargarJSON<HistorialAccion[]>(
          `/api/presupuestos/historial?presupuestoId=${presupuestoId}`,
        ),
      ]);
      setContactos(dc.contactos);
      setHistorial(Array.isArray(dh) ? dh : []);
    } catch {
      setContactos([]);
      setHistorial([]);
      setError(true);
    } finally {
      setCargando(false);
    }
  }

  function toggle() {
    const abrir = !abierto;
    setAbierto(abrir);
    if (abrir && !cargando && contactos.length === 0 && historial.length === 0) cargar();
  }

  const items: TimelineItem[] = [
    ...contactos.map((c): TimelineItem => ({ kind: "contacto", contacto: c, date: c.fechaHora })),
    ...historial.map((h): TimelineItem => ({ kind: "historial", accion: h, date: h.fecha })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="border-t border-[var(--color-border)] shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={abierto}
        className="w-full flex items-center justify-between gap-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] transition-colors"
      >
        <span>Qué se ha hecho</span>
        <ChevronDown
          size={14}
          strokeWidth={ICON_STROKE}
          aria-hidden
          className={`transition-transform ${abierto ? "rotate-180" : ""}`}
        />
      </button>

      {abierto && (
        <div className="px-4 pb-3 max-h-52 overflow-y-auto">
          {cargando ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-9 rounded-lg bg-[var(--color-surface-muted)] animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <ErrorState detail="El historial de acciones no está disponible." onRetry={cargar} />
          ) : items.length === 0 ? (
            <p className="text-xs text-[var(--color-muted)]">Sin acciones registradas todavía.</p>
          ) : (
            <div>
              {items.map((item, idx) => {
                const isLast = idx === items.length - 1;
                if (item.kind === "contacto") {
                  const c = item.contacto;
                  // Fallback obligatorio: un tipo fuera del mapa (dato viejo o
                  // nuevo) devolvía un componente undefined y reventaba el
                  // panel entero con React #130.
                  const TipoIcon = TIPO_ICON[c.tipo] ?? MessageCircle;
                  return (
                    <div key={`c-${c.id}`} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div
                          className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${TIPO_DOT_COLOR[c.tipo] ?? "bg-slate-400"}`}
                        />
                        {!isLast && <div className="w-0.5 flex-1 bg-[var(--color-border)] my-1 min-h-[12px]" />}
                      </div>
                      <div className={`flex-1 ${isLast ? "pb-1" : "pb-3"}`}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--color-foreground)]">
                            <TipoIcon
                              size={12}
                              strokeWidth={ICON_STROKE}
                              className="text-[var(--color-muted)]"
                              aria-hidden
                            />
                            {TIPO_LABEL[c.tipo] ?? c.tipo}
                          </span>
                          {c.mensajeIAUsado && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-semibold">
                              <Sparkles size={10} strokeWidth={ICON_STROKE} aria-hidden /> IA
                            </span>
                          )}
                          {c.oferta && (
                            <span className="text-[9px] px-1 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300 font-semibold">
                              Oferta
                            </span>
                          )}
                          <span
                            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                              RESULTADO_COLOR[c.resultado] ?? "bg-[var(--color-surface-muted)] text-[var(--color-muted)]"
                            }`}
                          >
                            {c.resultado}
                          </span>
                        </div>
                        {c.nota && <p className="text-[10px] text-[var(--color-muted)] mt-0.5 italic">{c.nota}</p>}
                        <p className="text-[9px] text-[var(--color-muted)] mt-0.5">{fmt(c.fechaHora)}</p>
                      </div>
                    </div>
                  );
                }
                const h = item.accion;
                // Los contactos ya viajan por su propia rama (doble escritura).
                if (h.tipo === "contacto") return null;
                const AccionIcon = TIPO_ACCION_ICON[h.tipo] ?? ArrowRight;
                return (
                  <div key={`h-${h.id}`} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${TIPO_ACCION_DOT[h.tipo] ?? "bg-slate-400"}`}
                      />
                      {!isLast && <div className="w-0.5 flex-1 bg-[var(--color-border)] my-1 min-h-[12px]" />}
                    </div>
                    <div className={`flex-1 ${isLast ? "pb-1" : "pb-3"}`}>
                      <div className="flex items-center gap-1.5">
                        <AccionIcon
                          size={12}
                          strokeWidth={ICON_STROKE}
                          className="text-[var(--color-muted)] shrink-0"
                          aria-hidden
                        />
                        <span className="text-[10px] font-semibold text-[var(--color-muted)]">{h.descripcion}</span>
                      </div>
                      {h.registradoPor && (
                        <p className="text-[9px] text-[var(--color-muted)] mt-0.5">Por {h.registradoPor}</p>
                      )}
                      <p className="text-[9px] text-[var(--color-muted)] mt-0.5">{fmt(h.fecha)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
