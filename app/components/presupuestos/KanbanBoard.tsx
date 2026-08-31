"use client";

import { useEffect, useState, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import type { Presupuesto, PresupuestoEstado, MotivoPerdida } from "../../lib/presupuestos/types";
import { Check, Copy, Phone, MessageCircle, Pencil, ICON_STROKE } from "../icons";
import { type RangoKanban } from "../shared/RangoTemporal";
// El rango temporal (2026-07-26) sustituye el corte fijo de 14 días de las
// columnas cerradas. `seVeConRango` vive en lib/pipeline para que la cabecera y
// la Tabla cuenten exactamente lo mismo que pinta el tablero — y desde el
// 2026-07-29 (MEJORAS 75) gobierna SOLO las columnas cerradas: un caso abierto
// se ve siempre, porque es trabajo pendiente venga de cuando venga.
import { seVeConRango } from "../../lib/presupuestos/pipeline";
import { ESTADO_CONFIG, ESTADO_VARIANTE, PIPELINE_ORDEN, ORIGEN_LABEL } from "../../lib/presupuestos/colors";
import { StatePill } from "../ui/StatePill";
import MotivoPerdidaModal from "./MotivoPerdidaModal";
import { eur } from "../shared/Cifra";

// Coherencia de kanban (2026-07-27): la columna se identifica por el color de
// su contador, exactamente como en Leads (que es el canon). Antes era una barra
// superior de 5px sobre un marco gris — otro lenguaje visual para lo mismo.
//
// El color sale de `ESTADO_VARIANTE` + StatePill (2026-07-29): aquí vivían
// amber/orange/emerald/rose a mano, con `orange` como sexto color sin token.

// ------------------------------------------------------------------
// Sprint 13 Bloque 4 — CompactCard al estilo Leads
// Sin border-left rojo (urgencia comunicada en Actuar Hoy, no kanban).
// Tags unificados con StatePill. Acciones aparecen en hover.
// ------------------------------------------------------------------

function CompactCard({
  presupuesto,
  onOpenFicha,
  onEdit,
}: {
  presupuesto: Presupuesto;
  /** Clic en la card / botón WhatsApp → ficha del paciente (canon Leads). */
  onOpenFicha: (p: Presupuesto) => void;
  onEdit: (p: Presupuesto) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: presupuesto.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Canon Leads: la card entera abre la ficha (no un modal de historial).
        if (isDragging) return;
        e.stopPropagation();
        onOpenFicha(presupuesto);
      }}
      className={isDragging ? "opacity-40" : ""}
    >
      <CompactCardBody presupuesto={presupuesto} onOpenFicha={onOpenFicha} onEdit={onEdit} />
    </div>
  );
}

// Cuerpo visual: lo comparten la card del tablero y el fantasma que se
// arrastra (canon Leads — se arrastra la tarjeta entera, no una miniatura).
function CompactCardBody({
  presupuesto,
  onOpenFicha,
  onEdit,
}: {
  presupuesto: Presupuesto;
  onOpenFicha: (p: Presupuesto) => void;
  onEdit: (p: Presupuesto) => void;
}) {
  const p = presupuesto;
  const [copied, setCopied] = useState(false);

  async function copyPhone(e: React.MouseEvent) {
    e.stopPropagation();
    if (!p.patientPhone) return;
    try {
      await navigator.clipboard.writeText(p.patientPhone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) {
      // El check no aparece y nadie decía por qué. Sigue siendo accesorio, pero
      // el fallo se ve (§9): el portapapeles falla sin permiso o sin HTTPS.
      console.error("[kanban] no se pudo copiar el teléfono:", e);
    }
  }

  return (
    <article
      style={{
        borderColor: "var(--card-border)",
        boxShadow: "var(--card-shadow-rest)",
      }}
      className="rounded-xl border bg-[var(--color-surface)] p-3 text-xs cursor-pointer select-none transition-[box-shadow,border-color] duration-150 hover:[border-color:var(--card-border-hover)] hover:[box-shadow:var(--card-shadow-hover)]"
    >
      {/* Nombre — misma jerarquía que la card de Leads */}
      <p className="font-display font-medium text-[var(--color-foreground)] truncate tracking-tight">
        {p.patientName}
      </p>

      {/* Tags: tratamiento principal (acento) + origen (neutral). Fuera
          TipoPaciente/TipoVisita: ruido que no cambia ninguna decisión. */}
      <div className="flex flex-wrap gap-1 mt-1.5">
        {p.treatments[0] && (
          <span className="inline-flex rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-transparent px-1.5 py-0.5 text-[10px] font-medium">
            {p.treatments[0]}
            {p.treatments.length > 1 ? ` +${p.treatments.length - 1}` : ""}
          </span>
        )}
        {p.origenLead && (
          <span className="inline-flex rounded-md bg-[var(--color-surface-muted)] text-[var(--color-muted)] border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-medium">
            {ORIGEN_LABEL[p.origenLead]}
          </span>
        )}
      </div>

      {p.patientPhone && (
        <div className="flex items-center gap-1 mt-2">
          <span className="text-[var(--color-muted)] text-[11px] font-mono truncate tabular-nums">
            {p.patientPhone}
          </span>
          <button
            type="button"
            onClick={copyPhone}
            onPointerDown={(e) => e.stopPropagation()}
            className="text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
            title="Copiar"
            aria-label="Copiar teléfono"
          >
            {copied ? (
              <Check size={12} strokeWidth={ICON_STROKE} className="text-[var(--color-success)]" aria-hidden />
            ) : (
              <Copy size={12} strokeWidth={ICON_STROKE} aria-hidden />
            )}
          </button>
        </div>
      )}

      {/* Importe + días parados: los dos datos que deciden la prioridad —
          el MISMO criterio que ordena la columna, legible en la card. */}
      <div className="flex items-center gap-2 mt-2 text-[10px] text-[var(--color-muted)]">
        {p.amount != null && (
          <span className="font-display text-sm font-semibold text-[var(--color-foreground)] tabular-nums">
            {eur(p.amount)}
          </span>
        )}
        <span className="ml-auto tabular-nums">hace {p.daysSince}d</span>
      </div>

      {/* Acciones: mismo tratamiento que la card de Leads (el canon) —
          neutro de bajo contraste con icono lucide, no un bloque verde.
          El verde de WhatsApp se repetía una vez por card: en una columna de 25
          era el color dominante de la pantalla y arrastraba el ojo a la acción
          menos importante. El acento se reserva para lo que decide algo.

          Y el botón se llama "Escribir", no "WhatsApp": NO envía nada, abre la
          ficha con el hilo y el mensaje precargado. Prometer un envío en la
          etiqueta y entregar un panel es la misma clase de mentira pequeña que
          un "hecho" sin guardar. */}
      <div className="flex gap-1.5 mt-2.5" onPointerDown={(e) => e.stopPropagation()}>
        {p.patientPhone && (
          <>
            <a
              href={`tel:${p.patientPhone}`}
              onClick={(e) => e.stopPropagation()}
              draggable={false}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] text-[11px] font-medium py-1.5 hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] transition-colors"
            >
              <Phone size={12} strokeWidth={ICON_STROKE} aria-hidden />
              Llamar
            </a>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenFicha(p);
              }}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] text-[11px] font-medium py-1.5 hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] transition-colors"
            >
              <MessageCircle size={12} strokeWidth={ICON_STROKE} aria-hidden />
              Escribir
            </button>
          </>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(p);
          }}
          className="inline-flex items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] text-[11px] font-medium px-2.5 py-1.5 hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)] transition-colors"
          aria-label={`Editar presupuesto de ${p.patientName}`}
        >
          <Pencil size={12} strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      </div>
    </article>
  );
}

// ------------------------------------------------------------------
// DroppableColumn
// ------------------------------------------------------------------

function DroppableColumn({
  estado,
  presupuestos,
  ocultos = 0,
  onVerHistorico,
  verTodos,
  velocidad,
  onOpenFicha,
  onEdit,
}: {
  estado: PresupuestoEstado;
  presupuestos: Presupuesto[];
  /** Casos que el rango temporal deja fuera (no se pintan aquí). */
  ocultos?: number;
  /** "Ver N anteriores" — abre el rango a histórico sin salir del tablero. */
  onVerHistorico: () => void;
  /** Pie "Ver todos →" hacia el archivo real de la columna cerrada. */
  verTodos?: { label: string; onClick: () => void };
  velocidad: { media: number; lenta: boolean } | null;
  onOpenFicha: (p: Presupuesto) => void;
  onEdit: (p: Presupuesto) => void;
}) {
  const cfg = ESTADO_CONFIG[estado];
  const { setNodeRef, isOver } = useDroppable({ id: estado });
  // Carga progresiva — la columna pinta de página en página.
  const [pagina, setPagina] = useState(1);
  useEffect(() => setPagina(1), [presupuestos.length, estado]);
  const pintadas = presupuestos.slice(0, pagina * PAGINA_CARDS);
  const restantes = presupuestos.length - pintadas.length;
  const total = presupuestos.reduce((s, p) => s + (p.amount ?? 0), 0);

  // Sprint 13 Bloque 4 — sub-info condensada a una línea.
  const subInfo = [
    total > 0 ? eur(total) : null,
    velocidad && velocidad.media > 0 ? `media: ${velocidad.media}d` : null,
    cfg.accionable ? cfg.hint : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    // Columna = tarjeta con borde y cabecera, igual que en Leads.
    <div
      className={`flex flex-col min-h-0 rounded-xl bg-[var(--color-surface)] border transition-colors ${
        isOver ? "border-[var(--color-accent)]" : "border-[var(--color-border)]"
      }`}
    >
      <div className="px-3 py-2.5 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-[13px] font-medium text-[var(--color-foreground)] tracking-tight truncate">
            {cfg.label}
          </span>
          <StatePill
            variant={ESTADO_VARIANTE[estado]}
            borderless
            className="rounded-full font-semibold tabular-nums px-2 shrink-0"
          >
            {presupuestos.length}
          </StatePill>
        </div>
        {subInfo && (
          <p className="text-[11px] text-[var(--color-muted)] mt-0.5 truncate" title={subInfo}>
            {subInfo}
          </p>
        )}
      </div>

      {/* Cards — el destino se ilumina al arrastrar por encima (canon de
          Presupuestos, replicado también en Leads). */}
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-[120px] p-2 space-y-2 overflow-y-auto transition-colors ${
          isOver ? "bg-[var(--color-accent-soft)]" : ""
        }`}
      >
        {presupuestos.length === 0 ? (
          <div className="h-full min-h-[80px] flex items-center justify-center text-[11px] text-[var(--color-muted)] italic">
            Sin presupuestos
          </div>
        ) : (
          // El orden lo decide el board (un solo criterio compartido).
          pintadas.map((p) => (
            <CompactCard key={p.id} presupuesto={p} onOpenFicha={onOpenFicha} onEdit={onEdit} />
          ))
        )}
        {restantes > 0 && (
          <button
            type="button"
            onClick={() => setPagina((n) => n + 1)}
            className="w-full text-center text-[11px] font-semibold text-[var(--color-accent)] hover:underline px-1 py-1.5"
          >
            Ver más ({restantes})
          </button>
        )}
        {/* Lo que el rango esconde se DICE, en todas las columnas: antes las
            activas recortaban en silencio y sólo las cerradas avisaban. */}
        {ocultos > 0 && (
          <button
            type="button"
            onClick={onVerHistorico}
            className="w-full text-center text-[11px] font-semibold text-[var(--color-accent)] hover:underline px-1 py-1.5"
          >
            Ver {ocultos} anterior{ocultos === 1 ? "" : "es"} →
          </button>
        )}
        {verTodos && (presupuestos.length > 0 || ocultos > 0) && (
          <button
            type="button"
            onClick={verTodos.onClick}
            className="w-full text-left text-[11px] font-semibold text-[var(--color-accent)] hover:underline px-1 py-1.5"
          >
            {verTodos.label} →
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// ConfirmMoveModal
// ------------------------------------------------------------------

function ConfirmMoveModal({
  patientName,
  targetEstado,
  onConfirm,
  onCancel,
}: {
  patientName: string;
  targetEstado: PresupuestoEstado;
  onConfirm: (skipFuture: boolean) => void;
  onCancel: () => void;
}) {
  const [skipFuture, setSkipFuture] = useState(false);
  const cfg = ESTADO_CONFIG[targetEstado];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
        <p className="font-display text-base font-semibold text-[var(--color-foreground)] mb-1">Confirmar cambio de estado</p>
        <p className="text-xs text-[var(--color-muted)] mb-4">
          Mover <span className="font-semibold">{patientName}</span> a{" "}
          {/* El nombre del estado iba pintado con `cfg.hex` — un hex a mano que
              en modo oscuro quedaba ilegible sobre la superficie del modal. */}
          <span className="font-semibold text-[var(--color-foreground)]">{cfg.label}</span>
        </p>

        <label className="flex items-center gap-2 text-xs text-[var(--color-muted)] mb-5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={skipFuture}
            onChange={(e) => setSkipFuture(e.target.checked)}
            className="rounded"
          />
          No volver a mostrar esta confirmación
        </label>

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] text-sm font-semibold py-2 hover:bg-[var(--color-surface-muted)]"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(skipFuture)}
            className="flex-1 rounded-lg bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-semibold py-2 hover:bg-[var(--color-accent-hover)]"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// KanbanBoard (main export)
// ------------------------------------------------------------------

const SKIP_CONFIRM_KEY = "kanban_skip_confirm";

// Carga progresiva: con "Histórico" una columna puede traer cientos de
// cards. Se pintan de PAGINA en PAGINA con un "Ver más" honesto que dice
// cuántas quedan — la vista nunca revienta y nada queda oculto en silencio.
const PAGINA_CARDS = 25;

export default function KanbanBoard({
  presupuestos,
  onChangeEstado,
  onOpenFicha,
  onEdit,
  onVerTodosCerrados,
  rango,
  onVerHistorico,
}: {
  presupuestos: Presupuesto[];
  onChangeEstado: (id: string, estado: PresupuestoEstado, extra?: { motivoPerdida?: MotivoPerdida; motivoPerdidaTexto?: string; reactivar?: boolean }) => void;
  /** Clic en card o WhatsApp → ficha del paciente (canon Leads). */
  onOpenFicha: (p: Presupuesto) => void;
  onEdit: (p: Presupuesto) => void;
  /** "Ver todos →" de las columnas cerradas: navega al archivo real
   *  (ACEPTADO → Registro de Cobros; PERDIDO → la Tabla). */
  onVerTodosCerrados: (estado: "ACEPTADO" | "PERDIDO") => void;
  /** Rango temporal activo — control único compartido con el kanban de Leads. */
  rango: RangoKanban;
  /** Abrir el rango a histórico desde el pie de una columna recortada. */
  onVerHistorico: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<{ id: string; targetEstado: PresupuestoEstado } | null>(null);
  const [pendingPerdido, setPendingPerdido] = useState<{ id: string } | null>(null);
  const [skipConfirm, setSkipConfirm] = useState(false);

  // Orden ÚNICO de las columnas (tanda de coherencia 2026-07-26): días
  // parados desc, importe desempata — el MISMO criterio conceptual que las
  // cohortes de Seguimiento ("quién lleva más esperando, a igualdad el que
  // más vale") y legible en la card, que muestra ambos. Murieron los tres
  // scores paralelos: computeUrgencyScore (ordenaba aquí), scoreFinal (las
  // cards de Seguimiento) y la probabilidad "71%" — esta última se sostenía
  // sobre pools de ≥3 cerrados similares, ruido estadístico con el volumen
  // real de una clínica.
  const ordenarColumna = (items: Presupuesto[]) =>
    [...items].sort((a, b) => (b.daysSince - a.daysSince) || ((b.amount ?? 0) - (a.amount ?? 0)));


  useEffect(() => {
    setSkipConfirm(localStorage.getItem(SKIP_CONFIRM_KEY) === "true");
  }, []);

  const activePresupuesto = presupuestos.find((p) => p.id === activeId) ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const targetEstado = over.id as PresupuestoEstado;
    const card = presupuestos.find((p) => p.id === active.id);
    if (!card || card.estado === targetEstado) return;

    if (targetEstado === "PERDIDO") {
      setPendingPerdido({ id: String(active.id) });
    } else if (targetEstado === "ACEPTADO" || skipConfirm) {
      // ACEPTADO: el modal de pago del cierre (en el shell) hace de
      // confirmación — gemelo del MotivoPerdidaModal de PERDIDO. No se
      // apila el confirm genérico encima.
      onChangeEstado(String(active.id), targetEstado);
    } else {
      setPendingChange({ id: String(active.id), targetEstado });
    }
  }

  function handleConfirm(skipFuture: boolean) {
    if (!pendingChange) return;
    if (skipFuture) {
      localStorage.setItem(SKIP_CONFIRM_KEY, "true");
      setSkipConfirm(true);
    }
    onChangeEstado(pendingChange.id, pendingChange.targetEstado);
    setPendingChange(null);
  }

  function handleConfirmPerdido(motivo: MotivoPerdida, texto?: string, reactivar?: boolean) {
    if (!pendingPerdido) return;
    onChangeEstado(pendingPerdido.id, "PERDIDO", { motivoPerdida: motivo, motivoPerdidaTexto: texto, reactivar });
    setPendingPerdido(null);
  }

  // Velocidad de pipeline: media de daysSince por columna vs. media de ACEPTADOS
  const velocidadMap = useMemo(() => {
    const map = new Map<PresupuestoEstado, { media: number; lenta: boolean }>();
    const aceptados = presupuestos.filter((p) => p.estado === "ACEPTADO");
    const mediaHistorica = aceptados.length >= 3
      ? aceptados.reduce((s, p) => s + p.daysSince, 0) / aceptados.length
      : null;
    for (const estado of PIPELINE_ORDEN) {
      if (estado === "ACEPTADO" || estado === "PERDIDO") continue;
      const enEstado = presupuestos.filter((p) => p.estado === estado);
      if (enEstado.length === 0) { map.set(estado, { media: 0, lenta: false }); continue; }
      const media = Math.round(enEstado.reduce((s, p) => s + p.daysSince, 0) / enEstado.length);
      const lenta = mediaHistorica != null && media > 1.5 * mediaHistorica;
      map.set(estado, { media, lenta });
    }
    return map;
  }, [presupuestos]);

  const pendingCard = pendingChange ? presupuestos.find((p) => p.id === pendingChange.id) : null;
  const pendingPerdidoCard = pendingPerdido ? presupuestos.find((p) => p.id === pendingPerdido.id) : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Rejilla responsive como en Leads: en móvil las columnas se apilan
            en vez de exigir scroll horizontal sobre columnas de 260px. */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          {PIPELINE_ORDEN.map((estado) => {
              const items = presupuestos.filter((p) => p.estado === estado);
              const cerrada = estado === "ACEPTADO" || estado === "PERDIDO";
              const visibles = items.filter((p) => seVeConRango(p, rango));
              return (
                <DroppableColumn
                  key={estado}
                  estado={estado}
                  presupuestos={ordenarColumna(visibles)}
                  ocultos={items.length - visibles.length}
                  onVerHistorico={onVerHistorico}
                  verTodos={
                    cerrada
                      ? {
                          label:
                            estado === "ACEPTADO"
                              ? "Ver todos en Cobros"
                              : "Ver todos en la Tabla",
                          onClick: () => onVerTodosCerrados(estado as "ACEPTADO" | "PERDIDO"),
                        }
                      : undefined
                  }
                  velocidad={velocidadMap.get(estado) ?? null}
                  onOpenFicha={onOpenFicha}
                  onEdit={onEdit}
                />
              );
            })}
        </div>

        <DragOverlay>
          {activePresupuesto && (
            <div className="rotate-1 opacity-90">
              <CompactCardBody
                presupuesto={activePresupuesto}
                onOpenFicha={onOpenFicha}
                onEdit={onEdit}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {pendingChange && pendingCard && (
        <ConfirmMoveModal
          patientName={pendingCard.patientName}
          targetEstado={pendingChange.targetEstado}
          onConfirm={handleConfirm}
          onCancel={() => setPendingChange(null)}
        />
      )}

      {pendingPerdido && pendingPerdidoCard && (
        <MotivoPerdidaModal
          patientName={pendingPerdidoCard.patientName}
          presupuestoId={pendingPerdido.id}
          onConfirm={handleConfirmPerdido}
          onCancel={() => setPendingPerdido(null)}
        />
      )}
    </>
  );
}
