"use client";

// app/components/pacientes/Paciente360View.tsx
// Bloque 2 P1 — rediseño de la ficha del paciente en 4 zonas verticales,
// móvil primero (apilado; se ensancha en escritorio):
//
//   0. Cabecera fija mínima — quién es y qué hay en juego (iniciales,
//      nombre, tratamiento, importe, prioridad). Siempre visible.
//   1. Qué hacer ahora — recomendación en una frase + su porqué (con
//      datos reales: fechas, intención detectada) + accionables
//      (WhatsApp / Llamar / Agendar) + qué pasa después.
//   2. Conversación — TODO el contacto en orden cronológico: hilo
//      WhatsApp (vía /api/presupuestos/mensajes, ya existente) +
//      llamadas/cambios de estado/notas del registro de acciones.
//   3. Datos del paciente — plegado por defecto, en 4 sub-bloques.
//      Si falta un dato clave (email, teléfono) se muestra como acción
//      ("Falta email — añadir"), no como hueco vacío.
//
// Solo presentación: consume los endpoints que ya existían
// (/api/pacientes/[id], /api/presupuestos/mensajes, PATCH paciente).
// La recomendación se deriva EN CLIENTE de señales reales del payload
// (estado del presupuesto, último mensaje, intención IA, días sin
// respuesta) — cada frase cita el dato que la justifica. No se presenta
// como "IA": la única etiqueta con identidad IA (chispas) es la
// intención detectada, que sí sale del clasificador.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Pago, TipoPago, MetodoPago } from "../../lib/pagos-format";
import { formatTipo } from "../../lib/pagos-format";
import { CardListSkeleton, KpiCardSkeleton } from "../ui/Skeleton";
import { ErrorState, EmptyState } from "../ui/Feedback";
import { StatePill } from "../ui/StatePill";
import {
  ChevronLeft,
  ChevronDown,
  Phone,
  Send,
  Inbox,
  ArrowRight,
  StickyNote,
  ClipboardList,
  CreditCard,
  MessageCircle,
  Calendar,
  Sparkles,
  Plus,
  AlertTriangle,
  ICON_STROKE,
} from "../icons";

// Sprint 14a Bloque 6 — re-scope a 3 hitos comerciales.
const TIPOS_PAGO_OPTS: Array<{ value: TipoPago; label: string; help: string }> = [
  {
    value: "Senal",
    label: "Señal",
    help: "Anticipo al firmar el presupuesto. Inicia el compromiso del paciente.",
  },
  {
    value: "Primer_Pago_Plan",
    label: "Primer pago de plan",
    help: "Primer movimiento del plan de pagos. Arranca el tratamiento.",
  },
  {
    value: "Liquidacion",
    label: "Liquidación",
    help: "Pago final del importe restante.",
  },
];
const METODOS_PAGO_OPTS: MetodoPago[] = [
  "Efectivo",
  "Tarjeta",
  "Transferencia",
  "Bizum",
  "Financiacion",
  "Otro",
];

// ─── Tipos del payload del endpoint ────────────────────────────────────

type PacientePayload = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  clinicaId: string | null;
  tratamientos: string[];
  doctorLinkId: string | null;
  fechaCita: string | null;
  presupuestoTotal: number | null;
  aceptado: "Si" | "No" | "Pendiente" | null;
  pagado: number | null;
  pendienteCache: number | null;
  financiado: number | null;
  notas: string | null;
  canalOrigen: string | null;
  leadOrigenId: string | null;
  activo: boolean;
  optoutAutomatizaciones?: boolean;
  createdAt: string;
};

type LeadPayload = {
  id: string;
  nombre: string;
  estado: string;
  canal: string | null;
  tratamiento: string | null;
  createdAt: string;
  doctorAsignadoId: string | null;
  fechaCita: string | null;
} | null;

type PresupuestoPayload = {
  id: string;
  estado: string;
  importe: number | null;
  fecha: string | null;
  fechaAlta: string | null;
  fechaAceptado: string | null;
  doctor: string | null;
  tratamiento: string | null;
  notas: string | null;
};

type AccionPayload = {
  id: string;
  leadId: string;
  tipo: string;
  timestamp: string;
  usuarioId: string | null;
  detalles: string | null;
};

type Paciente360Payload = {
  paciente: PacientePayload;
  lead: LeadPayload;
  presupuestos: PresupuestoPayload[];
  pagos: Pago[];
  acciones: AccionPayload[];
  usuariosNombres: Record<string, string>;
  kpisPagos: {
    totalFacturado: number;
    pendiente: number | null;
    numPagos: number;
    ultimoPagoHaceDias: number | null;
  };
  proximaCita: string | null;
};

// Mensaje del hilo WhatsApp tal como lo sirve /api/presupuestos/mensajes.
type MensajeHilo = {
  id: string;
  direccion: "Entrante" | "Saliente";
  contenido: string;
  timestamp: string;
  intencionDetectada?: string | null;
};

// ─── Helpers de formato ────────────────────────────────────────────────

function formatFecha(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return String(iso).slice(0, 10);
  }
}

function formatFechaCorta(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return String(iso).slice(0, 10);
  }
}

function diasDesde(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function hace(dias: number): string {
  if (dias <= 0) return "hoy";
  if (dias === 1) return "ayer";
  return `hace ${dias} días`;
}

const fmtEUR = (n: number) => `€${n.toLocaleString("es-ES")}`;

function iniciales(nombre: string): string {
  const parts = nombre.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const TIPO_PAGO_DOT: Record<string, string> = {
  Pago_Unico: "bg-[var(--color-accent)]",
  Cuota: "bg-amber-500",
  Senal: "bg-[var(--color-accent)]",
  Liquidacion: "bg-emerald-500",
};

const ESTADO_PRESUPUESTO_COLOR: Record<string, string> = {
  ACEPTADO:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  PRESENTADO: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  INTERESADO: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  EN_DUDA: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  PERDIDO: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
  REACTIVADO: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
};

function TipoAccionIcon({ tipo }: { tipo: string }) {
  const common = { size: 14, strokeWidth: ICON_STROKE, "aria-hidden": true } as const;
  switch (tipo) {
    case "Llamada":
      return <Phone {...common} />;
    case "WhatsApp_Saliente":
      return <Send {...common} />;
    case "WhatsApp_Entrante":
      return <Inbox {...common} />;
    case "Cambio_Estado":
      return <ArrowRight {...common} />;
    case "Nota":
      return <StickyNote {...common} />;
    default:
      return <span aria-hidden>·</span>;
  }
}

function resolveUsuario(
  id: string | null | undefined,
  map: Record<string, string>,
): string {
  if (!id) return "Coordinación";
  return map[id] ?? "Usuario eliminado";
}

// ─── Derivación de la situación (recomendación con porqué) ─────────────
//
// Regla-based sobre señales REALES ya cargadas: estado del presupuesto,
// último mensaje del hilo, intención detectada por el clasificador y
// días sin respuesta. Cada `porque` cita el dato que lo justifica —
// una recomendación sin porqué es promesa falsa de inteligencia.

const INTENCION_LABEL: Record<string, string> = {
  duda_precio: "Objeción: precio",
  objecion: "Objeción: tratamiento",
  interesado: "Interesado",
  listo_para_agendar: "Listo para agendar",
  no_interesado: "No interesado",
};

function labelIntencion(i: string | null | undefined): string | null {
  if (!i) return null;
  return INTENCION_LABEL[i] ?? i.replace(/_/g, " ");
}

const ESTADOS_ABIERTOS = ["PRESENTADO", "INTERESADO", "EN_DUDA", "EN_NEGOCIACION", "REACTIVADO"];

type Situacion = {
  prioridad: "alta" | "media" | "baja";
  titulo: string;
  porque: string;
  /** Etiqueta de la intención detectada en el último mensaje entrante (IA). */
  objecion: string | null;
  /** Qué pasa después de ejecutar la acción recomendada. */
  despues: string;
  primaria: "whatsapp" | "llamar" | "agendar";
  /** Presupuesto en juego (para cabecera: tratamiento · importe). */
  presupuestoRef: PresupuestoPayload | null;
};

function derivarSituacion(data: Paciente360Payload, mensajes: MensajeHilo[]): Situacion {
  const { paciente, presupuestos, kpisPagos, proximaCita } = data;

  const abiertos = presupuestos
    .filter((p) => ESTADOS_ABIERTOS.includes(p.estado))
    .sort((a, b) => String(b.fechaAlta ?? "").localeCompare(String(a.fechaAlta ?? "")));
  const aceptados = presupuestos
    .filter((p) => p.estado === "ACEPTADO")
    .sort((a, b) => String(b.fechaAceptado ?? "").localeCompare(String(a.fechaAceptado ?? "")));
  const presupuestoRef = abiertos[0] ?? aceptados[0] ?? presupuestos[0] ?? null;

  const orden = [...mensajes].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const ultimo = orden[orden.length - 1] ?? null;
  const entrantes = orden.filter((m) => m.direccion === "Entrante");
  const ultimoEntrante = entrantes[entrantes.length - 1] ?? null;
  const intencion = ultimoEntrante?.intencionDetectada ?? null;
  const objecion = labelIntencion(intencion);
  const esperando = ultimo?.direccion === "Entrante";
  const dEnt = ultimoEntrante ? diasDesde(ultimoEntrante.timestamp) : null;

  const base = { objecion, presupuestoRef };
  const colaLinea =
    "Si después no responde, este paciente volverá a subir en tu cola de seguimiento.";

  // Sin teléfono no hay contacto posible: ese es EL bloqueo.
  if (!paciente.telefono) {
    return {
      ...base,
      prioridad: abiertos.length > 0 ? "alta" : "media",
      titulo: "Añade su teléfono para poder contactarle",
      porque: "Sin teléfono no se le puede escribir ni llamar; cualquier seguimiento queda parado.",
      despues: "En cuanto lo guardes podrás escribirle y llamarle desde aquí.",
      primaria: "whatsapp",
    };
  }

  // Está esperando respuesta nuestra (su mensaje es el último del hilo).
  if (esperando && ultimoEntrante) {
    if (intencion === "listo_para_agendar" && !proximaCita) {
      return {
        ...base,
        prioridad: "alta",
        titulo: "Agéndale la cita",
        porque: `Dijo que estaba listo para agendar ${hace(dEnt ?? 0)} y todavía no tiene cita.`,
        despues: "La cita aparecerá en la agenda y este paciente dejará de estar pendiente.",
        primaria: "agendar",
      };
    }
    return {
      ...base,
      prioridad: "alta",
      titulo: "Responde a su último mensaje",
      porque: `Te escribió ${hace(dEnt ?? 0)} y sigue sin respuesta.`,
      despues: colaLinea,
      primaria: "whatsapp",
    };
  }

  // Objetó y la conversación se quedó parada tras nuestra respuesta.
  if (!esperando && ultimoEntrante && dEnt != null && dEnt >= 2 && abiertos.length > 0) {
    if (intencion === "duda_precio") {
      return {
        ...base,
        prioridad: dEnt >= 4 ? "alta" : "media",
        titulo: "Reactívalo con la financiación",
        porque: `Objetó el precio ${hace(dEnt)} y no ha vuelto a responder.`,
        despues: colaLinea,
        primaria: "whatsapp",
      };
    }
    if (intencion === "objecion") {
      return {
        ...base,
        prioridad: dEnt >= 5 ? "alta" : "media",
        titulo: "Llámale para resolver sus dudas",
        porque: `Mostró dudas del tratamiento ${hace(dEnt)} y la conversación se quedó parada.`,
        despues: "Si no contesta la llamada, mándale un WhatsApp para que le quede el aviso.",
        primaria: "llamar",
      };
    }
  }

  // Presupuesto abierto sin conversación pendiente: seguimiento por antigüedad.
  if (abiertos[0]) {
    const p = abiertos[0];
    const dAlta = diasDesde(p.fechaAlta ?? p.fecha);
    const nombre = p.tratamiento ?? "el presupuesto";
    if (dAlta >= 7) {
      return {
        ...base,
        prioridad: "alta",
        titulo: "Rescata este presupuesto",
        porque: `${nombre} lleva ${dAlta} días presentado sin respuesta registrada.`,
        despues: colaLinea,
        primaria: "whatsapp",
      };
    }
    if (dAlta >= 3) {
      return {
        ...base,
        prioridad: "media",
        titulo: "Haz seguimiento del presupuesto",
        porque: `${nombre} se presentó hace ${dAlta} días y aún no hay respuesta.`,
        despues: colaLinea,
        primaria: "whatsapp",
      };
    }
    if (dAlta >= 1) {
      return {
        ...base,
        prioridad: "media",
        titulo: "Confirma que le llegó el presupuesto",
        porque: `${nombre} se presentó ${hace(dAlta)}; un toque temprano evita que se enfríe.`,
        despues: colaLinea,
        primaria: "whatsapp",
      };
    }
    return {
      ...base,
      prioridad: "baja",
      titulo: "Presupuesto presentado hoy",
      porque: "Se le ha presentado hoy; dale margen para responder.",
      despues: "Si en unos días no contesta, te lo volverá a poner delante la cola de seguimiento.",
      primaria: "whatsapp",
    };
  }

  // Aceptado con pendiente de cobro y sin cita programada.
  if (aceptados[0] && (kpisPagos.pendiente ?? 0) > 0 && !proximaCita) {
    const p = aceptados[0];
    return {
      ...base,
      prioridad: "media",
      titulo: "Agenda el inicio del tratamiento",
      porque: `Aceptó ${p.tratamiento ?? "el tratamiento"} y quedan ${fmtEUR(kpisPagos.pendiente!)} por cobrar; no tiene próxima cita.`,
      despues: "La cita aparecerá en la agenda; los pagos se registran desde esta ficha.",
      primaria: "agendar",
    };
  }

  if (proximaCita) {
    return {
      ...base,
      prioridad: "baja",
      titulo: "Sin acción urgente",
      porque: `Tiene próxima cita el ${formatFecha(proximaCita)}.`,
      despues: "",
      primaria: "whatsapp",
    };
  }

  return {
    ...base,
    prioridad: "baja",
    titulo: "Sin acción pendiente",
    porque: "No hay presupuesto abierto ni mensajes esperando respuesta.",
    despues: "",
    primaria: "whatsapp",
  };
}

const PRIORIDAD_PILL: Record<Situacion["prioridad"], { label: string; variant: "danger" | "warning" | "neutral" }> = {
  alta: { label: "Prioridad alta", variant: "danger" },
  media: { label: "Prioridad media", variant: "warning" },
  baja: { label: "Al día", variant: "neutral" },
};

// ─── Componente principal ──────────────────────────────────────────────

export default function Paciente360View({ pacienteId }: { pacienteId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Paciente360Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pagoModal, setPagoModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; pago: Pago }
    | { mode: "delete"; pago: Pago }
    | null
  >(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Hilo WhatsApp (null = cargando). Se pide por presupuesto porque el
  // endpoint existente scope-a por presupuesto permitido (IDOR-safe).
  const [mensajes, setMensajes] = useState<MensajeHilo[] | null>(null);
  const [hiloError, setHiloError] = useState(false);
  const [hiloKey, setHiloKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/pacientes/${pacienteId}`);
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 80)}` : ""}`);
        }
        const json = (await res.json()) as Paciente360Payload;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Error al cargar paciente");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [pacienteId, reloadKey]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    const ps = data.presupuestos;
    if (ps.length === 0) {
      setMensajes([]);
      setHiloError(false);
      return;
    }
    setMensajes(null);
    setHiloError(false);
    let fallos = 0;
    Promise.all(
      ps.map((p) =>
        fetch(`/api/presupuestos/mensajes?presupuestoId=${p.id}`)
          .then((r) => {
            if (r.status === 404) return { mensajes: [] };
            if (!r.ok) throw new Error();
            return r.json();
          })
          .then((j) => (j.mensajes ?? []) as MensajeHilo[])
          .catch(() => {
            fallos++;
            return [] as MensajeHilo[];
          }),
      ),
    ).then((all) => {
      if (cancelled) return;
      setMensajes(all.flat().sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
      setHiloError(fallos > 0);
    });
    return () => {
      cancelled = true;
    };
  }, [data, hiloKey]);

  const situacion = useMemo(
    () => (data && mensajes ? derivarSituacion(data, mensajes) : null),
    [data, mensajes],
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] px-4 py-6 max-w-3xl mx-auto space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
          <KpiCardSkeleton />
        </div>
        <CardListSkeleton rows={4} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[var(--color-background)] flex flex-col items-center justify-center gap-4 px-4">
        <ErrorState
          title="No se pudo cargar el paciente"
          detail={error ?? undefined}
          onRetry={() => setReloadKey((k) => k + 1)}
          className="max-w-md w-full"
        />
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)] underline hover:text-[var(--color-foreground)]"
        >
          <ChevronLeft size={14} strokeWidth={ICON_STROKE} aria-hidden />
          Volver
        </button>
      </div>
    );
  }

  const { paciente, lead, presupuestos, pagos, acciones, usuariosNombres, kpisPagos, proximaCita } =
    data;
  const pRef = situacion?.presupuestoRef ?? null;
  const tratCabecera = pRef?.tratamiento ?? paciente.tratamientos[0] ?? null;
  const importeCabecera = pRef?.importe ?? paciente.presupuestoTotal ?? null;
  const pill = situacion ? PRIORIDAD_PILL[situacion.prioridad] : null;

  const scrollAConversacion = () => {
    document.getElementById("conversacion")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* ── Zona 0: cabecera fija mínima — quién es y qué hay en juego ── */}
      <div className="bg-[var(--color-surface)] border-b border-[var(--color-border)] px-3 sm:px-4 py-2.5 flex items-center gap-2.5 sticky top-0 z-10">
        <button
          onClick={() => router.back()}
          aria-label="Volver"
          className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] p-1 -ml-1 rounded-md transition-colors"
        >
          <ChevronLeft size={18} strokeWidth={ICON_STROKE} aria-hidden />
        </button>
        <div className="h-8 w-8 rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] text-[11px] font-semibold flex items-center justify-center shrink-0">
          {iniciales(paciente.nombre)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-[var(--color-foreground)] text-sm leading-tight truncate">
            {paciente.nombre}
          </p>
          <p className="text-[11px] text-[var(--color-muted)] truncate tabular-nums">
            {tratCabecera ?? "Sin tratamiento activo"}
            {importeCabecera != null && ` · ${fmtEUR(importeCabecera)}`}
          </p>
        </div>
        {pill ? (
          <StatePill variant={pill.variant} title={situacion?.porque}>
            {pill.label}
          </StatePill>
        ) : (
          <span className="h-5 w-16 rounded-md bg-[var(--color-surface-muted)] animate-pulse" aria-hidden />
        )}
      </div>

      <div className="max-w-3xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4">
        {/* ── Zona 1: qué hacer ahora ── */}
        <ZonaAccion
          situacion={situacion}
          telefono={paciente.telefono}
          pacienteId={paciente.id}
          onWhatsApp={scrollAConversacion}
          onAgendar={() => router.push("/no-shows?tab=agenda")}
          onDatoGuardado={() => setReloadKey((k) => k + 1)}
        />

        {/* ── Zona 2: conversación (todo el contacto, cronológico) ── */}
        <ZonaConversacion
          mensajes={mensajes}
          hiloError={hiloError}
          onRetryHilo={() => setHiloKey((k) => k + 1)}
          acciones={acciones}
          usuariosNombres={usuariosNombres}
        />

        {/* ── Zona 3: datos del paciente (plegado por defecto) ── */}
        <ZonaDatos
          paciente={paciente}
          lead={lead}
          presupuestos={presupuestos}
          pagos={pagos}
          kpisPagos={kpisPagos}
          proximaCita={proximaCita}
          usuariosNombres={usuariosNombres}
          onCreatePago={() => setPagoModal({ mode: "create" })}
          onEditPago={(p) => setPagoModal({ mode: "edit", pago: p })}
          onDeletePago={(p) => setPagoModal({ mode: "delete", pago: p })}
          onDatoGuardado={() => setReloadKey((k) => k + 1)}
        />
      </div>

      {/* Modales CRUD pago — Sprint 14a Bloque 6 */}
      {pagoModal?.mode === "create" && (
        <PagoModal
          mode="create"
          pacienteId={paciente.id}
          clinicaId={paciente.clinicaId}
          onClose={() => setPagoModal(null)}
          onDone={() => {
            setPagoModal(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {pagoModal?.mode === "edit" && (
        <PagoModal
          mode="edit"
          pacienteId={paciente.id}
          clinicaId={paciente.clinicaId}
          pago={pagoModal.pago}
          onClose={() => setPagoModal(null)}
          onDone={() => {
            setPagoModal(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {pagoModal?.mode === "delete" && (
        <DeletePagoDialog
          pacienteId={paciente.id}
          pago={pagoModal.pago}
          onClose={() => setPagoModal(null)}
          onDone={() => {
            setPagoModal(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

// ─── Zona 1: qué hacer ahora ───────────────────────────────────────────

function ZonaAccion({
  situacion,
  telefono,
  pacienteId,
  onWhatsApp,
  onAgendar,
  onDatoGuardado,
}: {
  situacion: Situacion | null;
  telefono: string | null;
  pacienteId: string;
  onWhatsApp: () => void;
  onAgendar: () => void;
  onDatoGuardado: () => void;
}) {
  if (!situacion) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3 animate-pulse">
        <div className="h-3 w-28 rounded bg-[var(--color-surface-muted)]" />
        <div className="h-5 w-2/3 rounded bg-[var(--color-surface-muted)]" />
        <div className="h-4 w-full rounded bg-[var(--color-surface-muted)]" />
        <div className="grid grid-cols-3 gap-2">
          <div className="h-9 rounded-lg bg-[var(--color-surface-muted)]" />
          <div className="h-9 rounded-lg bg-[var(--color-surface-muted)]" />
          <div className="h-9 rounded-lg bg-[var(--color-surface-muted)]" />
        </div>
      </div>
    );
  }

  const sinTelefono = !telefono;
  const btnBase =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const btnPrimario = `${btnBase} bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)]`;
  const btnSecundario = `${btnBase} bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]`;
  const cls = (accion: Situacion["primaria"]) =>
    situacion.primaria === accion ? btnPrimario : btnSecundario;

  return (
    <div className="rounded-2xl border border-[color-mix(in_srgb,var(--color-accent)_25%,transparent)] bg-[var(--color-accent-soft)] p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-accent)]">
          Qué hacer ahora
        </p>
        {situacion.objecion && (
          <StatePill variant="info" title="Intención detectada en su último mensaje">
            <Sparkles size={10} strokeWidth={ICON_STROKE} aria-hidden />
            {situacion.objecion}
          </StatePill>
        )}
      </div>

      <h2 className="font-display text-base sm:text-lg font-semibold text-[var(--color-foreground)] mt-2 leading-snug">
        {situacion.titulo}
      </h2>
      <p className="text-sm text-[var(--color-foreground)] opacity-80 mt-1 leading-relaxed">
        {situacion.porque}
      </p>

      {sinTelefono ? (
        <div className="mt-3">
          <FaltaDatoAccion pacienteId={pacienteId} campo="telefono" onSaved={onDatoGuardado} />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 mt-3">
          <button type="button" onClick={onWhatsApp} className={cls("whatsapp")}>
            <MessageCircle size={14} strokeWidth={ICON_STROKE} aria-hidden />
            WhatsApp
          </button>
          <a href={`tel:${telefono}`} className={cls("llamar")}>
            <Phone size={14} strokeWidth={ICON_STROKE} aria-hidden />
            Llamar
          </a>
          <button type="button" onClick={onAgendar} className={cls("agendar")}>
            <Calendar size={14} strokeWidth={ICON_STROKE} aria-hidden />
            Agendar
          </button>
        </div>
      )}

      {situacion.despues && (
        <p className="flex items-start gap-1.5 text-[11px] text-[var(--color-muted)] mt-2.5 leading-relaxed">
          <ArrowRight size={12} strokeWidth={ICON_STROKE} aria-hidden className="mt-0.5 shrink-0" />
          {situacion.despues}
        </p>
      )}
    </div>
  );
}

// ─── Zona 2: conversación ──────────────────────────────────────────────

type EventoConv =
  | { kind: "msg"; id: string; ts: string; direccion: "Entrante" | "Saliente"; contenido: string; intencion: string | null }
  | { kind: "sys"; id: string; ts: string; tipo: string; texto: string };

const TIPO_ACCION_LABEL: Record<string, string> = {
  Llamada: "Llamada",
  Cambio_Estado: "Cambio de estado",
  Nota: "Nota",
  WhatsApp_Saliente: "WhatsApp enviado",
  WhatsApp_Entrante: "WhatsApp recibido",
};

function ZonaConversacion({
  mensajes,
  hiloError,
  onRetryHilo,
  acciones,
  usuariosNombres,
}: {
  mensajes: MensajeHilo[] | null;
  hiloError: boolean;
  onRetryHilo: () => void;
  acciones: AccionPayload[];
  usuariosNombres: Record<string, string>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const eventos = useMemo<EventoConv[]>(() => {
    if (!mensajes) return [];
    const out: EventoConv[] = [];
    for (const m of mensajes) {
      out.push({
        kind: "msg",
        id: `m-${m.id}`,
        ts: m.timestamp,
        direccion: m.direccion,
        contenido: m.contenido,
        intencion: m.direccion === "Entrante" ? (m.intencionDetectada ?? null) : null,
      });
    }
    for (const a of acciones) {
      // Con hilo real cargado, los registros WhatsApp del lead duplicarían
      // los mensajes: se omiten. Sin hilo, son el único rastro y se muestran.
      if (mensajes.length > 0 && a.tipo.startsWith("WhatsApp")) continue;
      const label = TIPO_ACCION_LABEL[a.tipo] ?? a.tipo.replace(/_/g, " ");
      out.push({
        kind: "sys",
        id: `a-${a.id}`,
        ts: a.timestamp,
        tipo: a.tipo,
        texto: `${label}${a.detalles ? ` · ${a.detalles}` : ""} — ${resolveUsuario(a.usuarioId, usuariosNombres)}`,
      });
    }
    return out.sort((a, b) => a.ts.localeCompare(b.ts));
  }, [mensajes, acciones, usuariosNombres]);

  // Conversación siempre abierta por el final (lo último es lo relevante).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [eventos.length]);

  return (
    <div id="conversacion" className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] overflow-hidden scroll-mt-16">
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide">
          Conversación
        </p>
        {eventos.length > 0 && (
          <span className="text-[10px] text-[var(--color-muted)] tabular-nums">
            {eventos.length} registro{eventos.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {mensajes === null ? (
        <div className="p-4 space-y-2 animate-pulse">
          <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] mr-10" />
          <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] ml-10" />
          <div className="h-10 rounded-2xl bg-[var(--color-surface-muted)] mr-10" />
        </div>
      ) : (
        <>
          {hiloError && (
            <div className="mx-4 mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-danger-soft)] px-3 py-2 flex items-center justify-between gap-2">
              <p className="text-xs text-[var(--color-danger)]">
                No se pudo cargar parte del historial de WhatsApp.
              </p>
              <button
                onClick={onRetryHilo}
                className="text-xs font-semibold text-[var(--color-danger)] underline shrink-0"
              >
                Reintentar
              </button>
            </div>
          )}
          {eventos.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<MessageCircle size={24} strokeWidth={ICON_STROKE} />}
                title="Sin conversación todavía"
                hint="Los mensajes, llamadas y cambios de estado con este paciente aparecerán aquí."
              />
            </div>
          ) : (
            <div ref={scrollRef} className="p-4 space-y-2 max-h-[26rem] overflow-y-auto">
              {eventos.map((e) =>
                e.kind === "sys" ? (
                  <div key={e.id} className="flex items-center justify-center gap-1.5 py-1">
                    <span className="text-[var(--color-muted)]">
                      <TipoAccionIcon tipo={e.tipo} />
                    </span>
                    <p className="text-[11px] text-[var(--color-muted)] text-center">
                      {e.texto}
                      <span className="opacity-70"> · {formatFechaCorta(e.ts)}</span>
                    </p>
                  </div>
                ) : (
                  <div key={e.id} className={`flex ${e.direccion === "Saliente" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] sm:max-w-[75%] px-3 py-2 ${
                        e.direccion === "Saliente"
                          ? "ml-8 bg-[var(--color-accent)] text-[var(--color-on-accent)] rounded-2xl rounded-br-sm"
                          : "mr-8 bg-[var(--color-surface-muted)] text-[var(--color-foreground)] rounded-2xl rounded-bl-sm"
                      }`}
                    >
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{e.contenido}</p>
                      <div className="flex items-center justify-end gap-1.5 mt-0.5">
                        {e.intencion && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-[var(--color-accent)]">
                            <Sparkles size={9} strokeWidth={ICON_STROKE} aria-hidden />
                            {labelIntencion(e.intencion)}
                          </span>
                        )}
                        <p
                          className={`text-[9px] ${
                            e.direccion === "Saliente"
                              ? "text-[var(--color-on-accent)] opacity-70"
                              : "text-[var(--color-muted)]"
                          }`}
                        >
                          {new Date(e.ts).toLocaleString("es-ES", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Zona 3: datos del paciente (plegado) ──────────────────────────────

function Plegable({
  titulo,
  resumen,
  atencion,
  children,
}: {
  titulo: string;
  resumen?: string;
  /** Punto ámbar en la cabecera (falta un dato clave dentro). */
  atencion?: boolean;
  children: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] overflow-hidden">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-[var(--color-surface-muted)] transition-colors"
      >
        <ChevronDown
          size={14}
          strokeWidth={ICON_STROKE}
          aria-hidden
          className={`text-[var(--color-muted)] transition-transform ${abierto ? "" : "-rotate-90"}`}
        />
        <span className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-wide flex-1">
          {titulo}
          {atencion && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 ml-1.5 align-middle" aria-hidden />
          )}
        </span>
        {resumen && !abierto && (
          <span className="text-[11px] text-[var(--color-muted)] truncate max-w-[45%] tabular-nums">
            {resumen}
          </span>
        )}
      </button>
      {abierto && <div className="px-4 pb-4 border-t border-[var(--color-border)] pt-3">{children}</div>}
    </div>
  );
}

// Dato clave ausente mostrado como acción, no como hueco vacío.
// Guarda vía el PATCH de paciente que ya existe.
function FaltaDatoAccion({
  pacienteId,
  campo,
  onSaved,
}: {
  pacienteId: string;
  campo: "email" | "telefono";
  onSaved: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState("");
  const [saving, setSaving] = useState(false);
  const label = campo === "email" ? "email" : "teléfono";

  async function guardar() {
    const v = valor.trim();
    if (!v) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/pacientes/${pacienteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [campo]: v }),
      });
      if (!res.ok) throw new Error();
      toast.success(campo === "email" ? "Email guardado" : "Teléfono guardado");
      onSaved();
    } catch {
      toast.error("No se pudo guardar. Inténtalo de nuevo.");
      setSaving(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold rounded-md px-2 py-1 bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25 dark:hover:bg-amber-500/20 transition-colors"
      >
        <Plus size={11} strokeWidth={ICON_STROKE} aria-hidden />
        Falta {label} — añadir
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input
        type={campo === "email" ? "email" : "tel"}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && guardar()}
        placeholder={campo === "email" ? "nombre@email.com" : "+34 600 000 000"}
        autoFocus
        className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] text-xs focus:border-[var(--color-accent)] focus:outline-none"
      />
      <button
        type="button"
        onClick={guardar}
        disabled={saving || !valor.trim()}
        className="px-2.5 py-1.5 text-[11px] font-semibold rounded-md bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 shrink-0"
      >
        {saving ? "…" : "Guardar"}
      </button>
    </div>
  );
}

function ZonaDatos({
  paciente,
  lead,
  presupuestos,
  pagos,
  kpisPagos,
  proximaCita,
  usuariosNombres,
  onCreatePago,
  onEditPago,
  onDeletePago,
  onDatoGuardado,
}: {
  paciente: PacientePayload;
  lead: LeadPayload;
  presupuestos: PresupuestoPayload[];
  pagos: Pago[];
  kpisPagos: Paciente360Payload["kpisPagos"];
  proximaCita: string | null;
  usuariosNombres: Record<string, string>;
  onCreatePago: () => void;
  onEditPago: (p: Pago) => void;
  onDeletePago: (p: Pago) => void;
  onDatoGuardado: () => void;
}) {
  const faltaContacto = !paciente.telefono || !paciente.email;
  const resumenEco =
    kpisPagos.pendiente != null && kpisPagos.pendiente > 0
      ? `${fmtEUR(kpisPagos.pendiente)} pendiente`
      : `${fmtEUR(kpisPagos.totalFacturado)} facturado`;

  return (
    <div className="space-y-2.5">
      <p className="text-[11px] font-semibold text-[var(--color-muted)] uppercase tracking-widest px-1 pt-1">
        Datos del paciente
      </p>

      <Plegable
        titulo="Contacto y preferencias"
        resumen={paciente.telefono ?? undefined}
        atencion={faltaContacto}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide">Teléfono</span>
            {paciente.telefono ? (
              <span className="text-[var(--color-foreground)] tabular-nums">{paciente.telefono}</span>
            ) : (
              <FaltaDatoAccion pacienteId={paciente.id} campo="telefono" onSaved={onDatoGuardado} />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide">Email</span>
            {paciente.email ? (
              <span className="text-[var(--color-foreground)] break-all">{paciente.email}</span>
            ) : (
              <FaltaDatoAccion pacienteId={paciente.id} campo="email" onSaved={onDatoGuardado} />
            )}
          </div>
          <KV k="Canal origen" v={paciente.canalOrigen ?? "—"} />
          <KV k="Alta" v={formatFecha(paciente.createdAt)} />
        </div>
        <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
          <OptoutToggle
            pacienteId={paciente.id}
            initialOptout={!!paciente.optoutAutomatizaciones}
          />
        </div>
      </Plegable>

      <Plegable
        titulo="Tratamiento y presupuesto"
        resumen={`${presupuestos.length} presupuesto${presupuestos.length === 1 ? "" : "s"}`}
      >
        {paciente.tratamientos.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {paciente.tratamientos.map((t) => (
              <StatePill key={t} variant="neutral">{t}</StatePill>
            ))}
          </div>
        )}
        {presupuestos.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={24} strokeWidth={ICON_STROKE} />}
            title="Sin presupuestos"
            hint="Este paciente no tiene presupuestos creados."
          />
        ) : (
          <div className="divide-y divide-[var(--color-border)] -mx-4">
            {presupuestos.map((p) => {
              const colorClass =
                ESTADO_PRESUPUESTO_COLOR[p.estado] ??
                "bg-[var(--color-surface-muted)] text-[var(--color-muted)]";
              return (
                <div key={p.id} className="px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colorClass}`}>
                        {p.estado}
                      </span>
                      {p.fechaAceptado && (
                        <span className="text-[10px] text-[var(--color-muted)]">
                          Aceptado {formatFechaCorta(p.fechaAceptado)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-[var(--color-foreground)] mt-1 truncate">
                      {p.tratamiento ?? "Sin tratamiento"}
                    </p>
                    <p className="text-[11px] text-[var(--color-muted)] mt-0.5">
                      {formatFecha(p.fechaAlta ?? p.fecha)}
                      {p.doctor && ` · ${p.doctor}`}
                    </p>
                    {p.notas && (
                      <p className="text-[11px] text-[var(--color-muted)] italic mt-1 line-clamp-2">
                        {p.notas}
                      </p>
                    )}
                  </div>
                  {p.importe != null && (
                    <p className="text-sm font-bold text-[var(--color-foreground)] tabular-nums shrink-0">
                      {fmtEUR(p.importe)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Plegable>

      <Plegable titulo="Económico y pagos" resumen={resumenEco} atencion={(kpisPagos.pendiente ?? 0) > 0}>
        <PagosBloque
          pagos={pagos}
          kpis={kpisPagos}
          usuariosNombres={usuariosNombres}
          paciente={paciente}
          onCreate={onCreatePago}
          onEdit={onEditPago}
          onDelete={onDeletePago}
        />
      </Plegable>

      <Plegable
        titulo="Historial y citas"
        resumen={proximaCita ? `Cita ${formatFechaCorta(proximaCita)}` : undefined}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <KV k="Próxima cita" v={proximaCita ? formatFecha(proximaCita) : "Sin cita programada"} />
          <KV k="Paciente activo" v={paciente.activo ? "Sí" : "No"} />
        </div>
        {lead && (
          <div className="mt-4 pt-3 border-t border-[var(--color-border)] text-sm space-y-1">
            <p className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide">Origen</p>
            <p className="text-[var(--color-foreground)]">
              <span className="font-medium">{lead.canal ?? "Canal desconocido"}</span>
              {lead.tratamiento && ` · interés: ${lead.tratamiento}`}
            </p>
            <p className="text-xs text-[var(--color-muted)]">
              Captado {formatFecha(lead.createdAt)} · estado del lead: {lead.estado}
            </p>
          </div>
        )}
        {paciente.notas && (
          <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
            <p className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide mb-1">Notas</p>
            <p className="text-sm text-[var(--color-foreground)] whitespace-pre-wrap">{paciente.notas}</p>
          </div>
        )}
      </Plegable>
    </div>
  );
}

// Mini-KPI del hub 360 con la anatomía canónica de KpiCard (label badge
// arriba + valor font-display bold tabular). Cuerpo compacto porque van
// 4 en línea y admite valores de texto que KpiCard (numérico) no soporta.
function Card({
  label,
  value,
  sub,
  rose,
  muted,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Valor en tono danger (ej. importe pendiente > 0). */
  rose?: boolean;
  /** Valor atenuado (sin dato, con tooltip explicativo). */
  muted?: boolean;
  /** Tooltip nativo opcional. */
  title?: string;
}) {
  return (
    <div
      className="bg-[var(--color-surface)] rounded-2xl border border-[var(--color-border)] p-4"
      title={title}
    >
      <span className="inline-block text-[10px] uppercase tracking-widest font-semibold rounded-full px-2 py-0.5 bg-[var(--color-surface-muted)] text-[var(--color-muted)]">
        {label}
      </span>
      <p
        className={`font-display text-2xl font-bold tabular-nums leading-tight mt-2 ${
          rose
            ? "text-[var(--color-danger)]"
            : muted
              ? "text-[var(--color-muted)] cursor-help"
              : "text-[var(--color-foreground)]"
        }`}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-[var(--color-muted)] mt-1">{sub}</p>}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-[var(--color-muted)] uppercase tracking-wide">{k}</span>
      <span className="text-[var(--color-foreground)]">{v}</span>
    </div>
  );
}

function OptoutToggle({
  pacienteId,
  initialOptout,
}: {
  pacienteId: string;
  initialOptout: boolean;
}) {
  const [optout, setOptout] = useState(initialOptout);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    setOptout(next);
    setSaving(true);
    try {
      const res = await fetch(`/api/pacientes/${pacienteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optoutAutomatizaciones: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setOptout(!next);
      toast.error("No se pudo guardar el cambio. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        checked={!optout}
        disabled={saving}
        onChange={(e) => toggle(!e.target.checked)}
        className="mt-1 accent-[var(--color-accent)]"
      />
      <div className="flex-1">
        <p className="font-medium text-[var(--color-foreground)]">
          Recibir mensajes automáticos: {optout ? "desactivado" : "activado"}
        </p>
        <p className="text-xs text-[var(--color-muted)] mt-0.5">
          Si está desactivado, este paciente no recibirá ningún mensaje automático
          del sistema (recordatorios, avisos, etc.).
        </p>
      </div>
    </div>
  );
}

// ─── Económico y pagos (contenido del sub-bloque) ──────────────────────

function PagosBloque({
  pagos,
  kpis,
  usuariosNombres,
  paciente,
  onCreate,
  onEdit,
  onDelete,
}: {
  pagos: Pago[];
  kpis: Paciente360Payload["kpisPagos"];
  usuariosNombres: Record<string, string>;
  paciente: PacientePayload;
  onCreate: () => void;
  onEdit: (pago: Pago) => void;
  onDelete: (pago: Pago) => void;
}) {
  const ultimoLabel = (() => {
    if (kpis.ultimoPagoHaceDias == null) return "—";
    if (kpis.ultimoPagoHaceDias === 0) return "hoy";
    if (kpis.ultimoPagoHaceDias === 1) return "hace 1 día";
    return `hace ${kpis.ultimoPagoHaceDias} días`;
  })();
  const pendienteTooltip =
    kpis.pendiente == null
      ? !paciente.presupuestoTotal || paciente.presupuestoTotal === 0
        ? "Sin presupuesto aceptado todavía"
        : "Pendiente de aceptación de presupuesto"
      : undefined;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Card label="Total facturado" value={fmtEUR(kpis.totalFacturado)} />
        <Card
          label="Pendiente"
          value={kpis.pendiente == null ? "—" : fmtEUR(kpis.pendiente)}
          rose={kpis.pendiente != null && kpis.pendiente > 0}
          muted={kpis.pendiente == null}
          title={pendienteTooltip}
        />
        <Card label="Nº pagos" value={String(kpis.numPagos)} />
        <Card label="Último pago" value={ultimoLabel} />
      </div>

      {/* Banner de posicionamiento — Sprint 14a Bloque 6 */}
      <div className="rounded-xl bg-[var(--color-surface-muted)] border border-[var(--color-border)] px-4 py-3 text-[11px] text-[var(--color-muted)] leading-relaxed">
        Fyllio registra los{" "}
        <span className="font-semibold text-[var(--color-foreground)]">hitos comerciales</span> del cobro
        (señal, primer pago de plan, liquidación). Los pagos intermedios del tratamiento
        se gestionan en tu software clínico (Gesden u otro).
      </div>

      <div className="flex justify-end">
        <button
          onClick={onCreate}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Registrar pago
        </button>
      </div>

      {pagos.length === 0 ? (
        <EmptyState
          icon={<CreditCard size={24} strokeWidth={ICON_STROKE} />}
          title="Sin pagos registrados"
          hint="El historial financiero del paciente aparecerá aquí."
          action={
            <button
              onClick={onCreate}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              Registrar primer pago
            </button>
          }
        />
      ) : (
        <div className="divide-y divide-[var(--color-border)] -mx-4 border-t border-[var(--color-border)]">
          {pagos.map((p, i) => {
            const isMigrated = (p.nota ?? "").includes("[MIGRADO Sprint 13.1]");
            return (
              <div
                key={p.id}
                className="px-4 py-3 flex items-start gap-3 group fyllio-fade-in"
                style={{ animationDelay: `${Math.min(i * 30, 450)}ms` }}
              >
                <span
                  className={`mt-1.5 inline-block h-2 w-2 rounded-full shrink-0 ${TIPO_PAGO_DOT[p.tipo] ?? "bg-[var(--color-muted)]"}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="font-display text-base font-bold text-[var(--color-foreground)] tabular-nums">
                      {fmtEUR(p.importe)}
                    </p>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)]">
                      {formatTipo(p.tipo)}
                    </span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--color-surface-muted)] text-[var(--color-muted)] border border-[var(--color-border)]">
                      {p.metodo}
                    </span>
                    {isMigrated && (
                      <span
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25"
                        title="Pago histórico migrado, edita con cuidado."
                      >
                        migrado
                      </span>
                    )}
                  </div>
                  {p.nota && (
                    <p className="text-xs text-[var(--color-muted)] italic mt-1 line-clamp-2">{p.nota}</p>
                  )}
                  <p className="text-[11px] text-[var(--color-muted)] mt-1">
                    Registrado por {resolveUsuario(p.usuarioCreadorId, usuariosNombres)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <p className="text-xs text-[var(--color-muted)] font-medium">
                    {formatFecha(p.fechaPago)}
                  </p>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => onEdit(p)}
                      className="text-[10px] text-[var(--color-muted)] hover:text-[var(--color-foreground)] px-1.5 py-0.5 rounded hover:bg-[var(--color-surface-muted)]"
                      title="Editar pago"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => onDelete(p)}
                      className="text-[10px] text-[var(--color-danger)] hover:opacity-80 px-1.5 py-0.5 rounded hover:bg-[var(--color-danger-soft)]"
                      title="Eliminar pago"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Modales CRUD pago — Sprint 14a Bloque 6 ───────────────────────────

function PagoModal({
  mode,
  pacienteId,
  clinicaId,
  pago,
  onClose,
  onDone,
}: {
  mode: "create" | "edit";
  pacienteId: string;
  /** Sprint 14b Bloque 0 — clínica del paciente para cargar métodos
   *  configurados (con fallback global). Si null, usamos lista hardcoded. */
  clinicaId: string | null;
  pago?: Pago;
  onClose: () => void;
  onDone: () => void;
}) {
  const [importe, setImporte] = useState<string>(
    pago ? String(pago.importe) : "",
  );
  const [fechaPago, setFechaPago] = useState<string>(
    pago?.fechaPago ?? new Date().toISOString().slice(0, 10),
  );
  const [metodo, setMetodo] = useState<string>(pago?.metodo ?? "Tarjeta");
  const [tipo, setTipo] = useState<TipoPago>(pago?.tipo ?? "Senal");
  const [nota, setNota] = useState<string>(pago?.nota ?? "");
  const [submitting, setSubmitting] = useState(false);
  // Sprint 14b Bloque 0 — métodos de pago desde Configuraciones_Clinica
  // (con fallback a global si la clínica no customizó). Mientras carga,
  // usamos METODOS_PAGO_OPTS del enum como respaldo.
  const [metodosDisp, setMetodosDisp] = useState<string[]>(
    METODOS_PAGO_OPTS.slice(),
  );
  useEffect(() => {
    let cancelled = false;
    const target = clinicaId ?? "global";
    fetch(`/api/configuraciones/${target}?categoria=Metodos_Pago`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.opciones) return;
        const valores = (j.opciones as Array<{ valor: string }>).map((o) => o.valor);
        if (valores.length > 0) setMetodosDisp(valores);
      })
      .catch(() => {
        // Fallback al hardcoded; ya está seteado.
      });
    return () => {
      cancelled = true;
    };
  }, [clinicaId]);
  const [error, setError] = useState<string | null>(null);

  const isMigrated = pago && (pago.nota ?? "").includes("[MIGRADO Sprint 13.1]");
  const tipoCfg = TIPOS_PAGO_OPTS.find((t) => t.value === tipo);

  const inputClass =
    "mt-1 w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] text-sm focus:border-[var(--color-accent)] focus:outline-none";
  const labelClass =
    "text-[11px] uppercase font-semibold text-[var(--color-muted)] tracking-wide";

  async function handleSubmit() {
    const importeNum = Number(importe.replace(",", "."));
    if (!Number.isFinite(importeNum) || importeNum <= 0) {
      setError("El importe debe ser un número mayor que 0");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaPago)) {
      setError("Fecha inválida (AAAA-MM-DD)");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const url =
        mode === "create"
          ? `/api/pacientes/${pacienteId}/pagos`
          : `/api/pacientes/${pacienteId}/pagos/${pago!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          importe: importeNum,
          fechaPago,
          metodo,
          tipo,
          nota: nota || undefined,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 100)}` : ""}`);
      }
      toast.success(mode === "create" ? "Pago registrado" : "Pago actualizado");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[var(--color-surface)] rounded-2xl shadow-xl border border-[var(--color-border)] max-w-md w-full">
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
            {mode === "create" ? "Registrar pago" : "Editar pago"}
          </h3>
          {isMigrated && (
            <p className="inline-flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300 mt-1">
              <AlertTriangle size={12} strokeWidth={ICON_STROKE} aria-hidden />
              Pago histórico migrado, edita con cuidado.
            </p>
          )}
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Importe (€)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Fecha</label>
              <input
                type="date"
                value={fechaPago}
                onChange={(e) => setFechaPago(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Método</label>
              <select
                value={metodo}
                onChange={(e) => setMetodo(e.target.value)}
                className={inputClass}
              >
                {/* Sprint 14b Bloque 0 — métodos de pago configurables
                    por clínica via Configuraciones_Clinica. Si el método
                    actual del pago en edición no está en la lista (caso
                    legacy o método deshabilitado), lo añadimos al final
                    para que se vea en lugar de aparentar 'no
                    seleccionado'. */}
                {!metodosDisp.includes(metodo) && metodo && (
                  <option value={metodo}>{metodo}</option>
                )}
                {metodosDisp.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Tipo</label>
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoPago)}
                className={inputClass}
              >
                {TIPOS_PAGO_OPTS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              {tipoCfg && (
                <p className="text-[10px] text-[var(--color-muted)] mt-1 leading-snug">{tipoCfg.help}</p>
              )}
            </div>
          </div>
          <div>
            <label className={labelClass}>Nota (opcional)</label>
            <textarea
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              rows={2}
              className={`${inputClass} resize-none`}
            />
          </div>
          {error && (
            <p className="text-xs text-[var(--color-danger)] bg-[var(--color-danger-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-semibold text-[var(--color-muted)] hover:text-[var(--color-foreground)] rounded-lg disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {submitting
              ? "Guardando…"
              : mode === "create"
              ? "Guardar pago"
              : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeletePagoDialog({
  pacienteId,
  pago,
  onClose,
  onDone,
}: {
  pacienteId: string;
  pago: Pago;
  onClose: () => void;
  onDone: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/pacientes/${pacienteId}/pagos/${pago.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 100)}` : ""}`);
      }
      toast.success("Pago eliminado");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar");
      setSubmitting(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[var(--color-surface)] rounded-2xl shadow-xl border border-[var(--color-border)] max-w-sm w-full p-5">
        <h3 className="font-display font-semibold text-[var(--color-foreground)] text-sm">
          ¿Eliminar este pago?
        </h3>
        <p className="text-xs text-[var(--color-muted)] mt-2">
          Pago de{" "}
          <span className="font-semibold text-[var(--color-foreground)]">
            €{pago.importe.toLocaleString("es-ES")}
          </span>{" "}
          del {formatFecha(pago.fechaPago)} ({formatTipo(pago.tipo)}).
        </p>
        <p className="text-xs text-[var(--color-muted)] mt-2">
          Esta acción ajustará el total pagado del paciente.
        </p>
        {error && (
          <p className="text-xs text-[var(--color-danger)] bg-[var(--color-danger-soft)] border border-[var(--color-border)] rounded-lg px-3 py-2 mt-3">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-semibold text-[var(--color-muted)] hover:text-[var(--color-foreground)] rounded-lg disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleDelete}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--color-danger)] text-[var(--color-on-accent)] hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Eliminando…" : "Eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}
