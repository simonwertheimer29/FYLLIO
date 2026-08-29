"use client";

// AGENDA H1 (2ª iteración, dictada 28-08) — tres vistas, cada una para un
// trabajo; aquí viven DÍA (carriles por doctor, la de la recepcionista, por
// defecto) y LISTA (la semana en tarjetas; se pliega en H2). SEMANA de un
// doctor llega en H3 y reutiliza estos carriles.
//
// Los niveles, sin ambigüedad (dictado): 1 = sin acceso (Fyllio solo conoce
// SUS citas) · 2 = lectura de la agenda real · 3 = el agente cierra solo.
// MISMO producto en los tres: la rejilla pinta huecos también en nivel 1,
// pero la advertencia va PEGADA A LOS HUECOS, no solo en la cabecera — un
// hueco pintado se lee como libre, y ahí puede haber una revisión que Fyllio
// no conoce. Cada bloque libre dice «según Fyllio» y la frase completa vive
// al pie de la rejilla. (Cuando exista el nivel 2, la API dirá el nivel por
// clínica y esta marca desaparecerá para las conectadas.)
//
// Constantes del producto en TODOS los niveles: el sombreado del horario
// laboral de cada doctor (se ve cuándo trabaja sin ir a su configuración) y
// la lista «cerradas en Fyllio, pendientes de pasar» (no hay escritura hacia
// el software de la clínica — el traspaso es manual siempre).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card } from "../../components/ui/Card";
import { cargarJSON } from "../../lib/fetch-json";
import { hoyISO, sumaDias } from "../../lib/time";
import { aMin, deMin, diaSemanaISO } from "../../lib/agenda/disponibilidad";
import { resumenDeAgendaDia } from "../../lib/agenda/resumen";
import { CitaModal, type CitaEnEdicion } from "./CitaModal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  MessageCircle,
  Check,
  Plus,
  AlertTriangle,
  RefreshCw,
  ICON_STROKE,
} from "../../components/icons";

type DoctorSemana = {
  id: string; nombre: string; clinicaId: string | null; clinicaNombre: string | null;
  especialidadIds: string[]; sinHorario: boolean;
};
type CitaDia = { id: string; inicioMin: number; finMin: number | null; nombre: string | null; estado: string; tratamiento: string | null; tratamientoId: string | null; deLead: boolean; sinPasar: boolean; esFyllio: boolean };
type PorDoctor = {
  staffId: string;
  franjas: Array<{ inicio: string; fin: string }>;
  bloqueos: Array<{ inicio: number; fin: number; motivo: string | null }>;
  citas: CitaDia[];
  libres: Array<{ inicio: number; fin: number }> | null;
};
type Pendiente = {
  id: string; nombre: string | null; fecha: string | null; hora: string | null; estado: string;
  doctorNombre: string | null; clinicaNombre: string | null; telefono: string | null;
};
type Semana = {
  desde: string;
  doctores: DoctorSemana[];
  especialidades: Array<{ id: string; nombre: string }>;
  dias: Array<{ fecha: string; porDoctor: PorDoctor[] }>;
  tratamientos: Array<{ id: string; nombre: string; duracionMin: number | null; clinicaId: string | null }>;
  pendientes: Pendiente[];
};
type Vista = "dia" | "semana" | "lista";

const lunesDe = (fecha: string) => sumaDias(fecha, 1 - diaSemanaISO(fecha));
const LABEL_DIA = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const LABEL_DIA_LARGO = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const ESTILO_ESTADO: Record<string, string> = {
  Confirmada: "border-transparent bg-[var(--color-success-soft)] text-[var(--color-success)]",
  Programada: "border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  Completado: "border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-muted)]",
};

// La frase dictada, una sola y siempre igual — cada «libre» remite a ella.
const AVISO_HUECOS = "Estas horas libres no son reales — la agenda de verdad está en tu software.";

export function AgendaView() {
  const hoy = hoyISO();
  const [vista, setVista] = useState<Vista>("dia");
  const [fecha, setFecha] = useState(hoy); // día activo de la vista Día
  const [desde, setDesde] = useState(() => lunesDe(hoyISO()));
  const [data, setData] = useState<Semana | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [filtroEsp, setFiltroEsp] = useState("");
  const [filtroDoc, setFiltroDoc] = useState("");
  // Móvil: los carriles no caben — un doctor a la vez.
  const [docMovil, setDocMovil] = useState("");
  // Semana: el doctor elegido EN la vista (local — no pisa el filtro global).
  const [docSemana, setDocSemana] = useState("");
  // G2.4 — crear/mover desde la rejilla.
  const [modalCita, setModalCita] = useState<null | { modo: "crear"; prefill?: { fecha: string; hora?: string; doctorId?: string } } | { modo: "mover"; cita: CitaEnEdicion }>(null);

  const cargar = useCallback(async (semanaDesde: string) => {
    setCargando(true);
    try {
      const d = await cargarJSON<Semana>(`/api/agenda/semana?desde=${semanaDesde}`);
      setData(d);
      setError(false);
    } catch {
      // caída-declarada: se conserva lo último bueno y se enseña el error con Reintentar
      setError(true);
    } finally {
      setCargando(false);
    }
  }, []);
  useEffect(() => { void cargar(desde); }, [desde, cargar]);

  // Cambiar de día puede cruzar de semana: la semana cargada sigue al día.
  const irADia = (f: string) => {
    setFecha(f);
    const lunes = lunesDe(f);
    if (lunes !== desde) setDesde(lunes);
  };

  const marcarTrasladada = useCallback(async (id: string) => {
    try {
      await cargarJSON(`/api/agenda/citas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trasladada: true }),
      });
      toast.success("Marcada como pasada a tu software.");
      await cargar(desde);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "No se pudo guardar.");
    }
  }, [cargar, desde]);

  // G2.5 — arrastre terminado: CONFIRMAR antes de aplicar (dictado).
  const [confirmMover, setConfirmMover] = useState<null | {
    cita: CitaDia; origen: { fecha: string; staffId: string }; destino: DestinoMovimiento; aplicando: boolean;
  }>(null);

  const aplicarMovimiento = useCallback(async () => {
    if (!confirmMover) return;
    setConfirmMover((c) => c && { ...c, aplicando: true });
    try {
      await cargarJSON(`/api/agenda/citas/${confirmMover.cita.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fecha: confirmMover.destino.fecha,
          hora: deMin(confirmMover.destino.horaMin),
          doctorId: confirmMover.destino.staffId,
        }),
      });
      toast.success("Cita movida. Recuerda cambiarla también en tu software.");
      setConfirmMover(null);
      await cargar(desde);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "No se pudo mover.");
      setConfirmMover(null);
    }
  }, [confirmMover, cargar, desde]);

  // G2.4 — clic en una cita nacida en Fyllio → moverla (las importadas se
  // cambian en el software de la clínica; ni se ofrece).
  const abrirMover = useCallback((c: CitaDia, carril: { fecha: string; staffId: string }) => {
    setModalCita({
      modo: "mover",
      cita: {
        id: c.id,
        nombre: c.nombre,
        fecha: carril.fecha,
        hora: deMin(c.inicioMin),
        doctorId: carril.staffId,
        tratamientoId: c.tratamientoId,
      },
    });
  }, []);

  const visibles = useMemo(() => {
    if (!data) return [];
    let ds = data.doctores;
    if (filtroDoc) ds = ds.filter((d) => d.id === filtroDoc);
    else if (filtroEsp) ds = ds.filter((d) => d.especialidadIds.includes(filtroEsp));
    // Carriles agrupados por clínica (con «Todas las clínicas» se ve el orden).
    return [...ds].sort((a, b) =>
      (a.clinicaNombre ?? "").localeCompare(b.clinicaNombre ?? "") || a.nombre.localeCompare(b.nombre));
  }, [data, filtroDoc, filtroEsp]);

  const docMovilEfectivo = visibles.some((d) => d.id === docMovil) ? docMovil : (visibles[0]?.id ?? "");

  // G2.5 — el eje cubre SIEMPRE la jornada completa de los doctores visibles
  // en la semana (dictado): un sábado corto o un doctor sin citas no encogen
  // la rejilla.
  const ejeBase = useMemo(() => {
    if (!data) return null;
    const ids = new Set(visibles.map((v) => v.id));
    let min = Infinity;
    let max = -Infinity;
    for (const dia of data.dias) {
      for (const pd of dia.porDoctor) {
        if (!ids.has(pd.staffId)) continue;
        for (const f of pd.franjas) {
          min = Math.min(min, aMin(f.inicio));
          max = Math.max(max, aMin(f.fin));
        }
      }
    }
    return Number.isFinite(min) ? { min, max } : null;
  }, [data, visibles]);

  if (error && !data) {
    return (
      <div className="p-6">
        <Card padding="none" className="mx-auto mt-8 max-w-lg px-6 py-8 text-center">
          <AlertTriangle size={20} strokeWidth={ICON_STROKE} className="mx-auto mb-2 text-[var(--color-danger)]" aria-hidden />
          <p className="text-sm font-semibold text-[var(--color-foreground)]">No se pudo cargar la agenda</p>
          <button
            type="button"
            onClick={() => void cargar(desde)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-on-accent)] hover:opacity-90"
          >
            <RefreshCw size={14} strokeWidth={ICON_STROKE} aria-hidden /> Reintentar
          </button>
        </Card>
      </div>
    );
  }

  const diaActivo = data?.dias.find((d) => d.fecha === fecha) ?? null;

  return (
    <div className="p-4 sm:p-6">
      {/* Cabecera */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={20} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
          <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">Agenda</h1>
        </div>
        <div className="flex items-center gap-1.5 rounded-xl bg-[var(--color-accent-soft)] px-3 py-1.5">
          <Info size={13} strokeWidth={ICON_STROKE} className="shrink-0 text-[var(--color-accent)]" aria-hidden />
          <p className="text-[11.5px] text-[var(--color-foreground)]">
            Lo que tenemos aquí — tu software clínico puede tener más.
          </p>
        </div>
      </div>

      {/* Controles: vista + navegación + filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-[var(--color-border)] p-0.5" role="tablist" aria-label="Vista">
          {([["dia", "Día"], ["semana", "Semana"], ["lista", "Lista"]] as Array<[Vista, string]>).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={vista === v}
              onClick={() => setVista(v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                vista === v
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {vista === "dia" ? (
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Día anterior" onClick={() => irADia(sumaDias(fecha, -1))}
              className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]">
              <ChevronLeft size={14} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
            <button type="button" onClick={() => irADia(hoyISO())}
              className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]">
              Hoy
            </button>
            <button type="button" aria-label="Día siguiente" onClick={() => irADia(sumaDias(fecha, 1))}
              className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]">
              <ChevronRight size={14} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
            <span className="ml-1 text-xs font-medium text-[var(--color-muted)]">
              {LABEL_DIA_LARGO[diaSemanaISO(fecha)]} {fecha}{fecha === hoy && " · hoy"}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Semana anterior" onClick={() => setDesde(sumaDias(desde, -7))}
              className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]">
              <ChevronLeft size={14} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
            <button type="button" onClick={() => setDesde(lunesDe(hoyISO()))}
              className="rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]">
              Hoy
            </button>
            <button type="button" aria-label="Semana siguiente" onClick={() => setDesde(sumaDias(desde, 7))}
              className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]">
              <ChevronRight size={14} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
            <span className="ml-1 text-xs font-medium text-[var(--color-muted)]">Semana del {desde}</span>
          </div>
        )}

        <select
          value={filtroEsp}
          onChange={(e) => { setFiltroEsp(e.target.value); setFiltroDoc(""); }}
          aria-label="Filtrar por especialidad"
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-foreground)]"
        >
          <option value="">Todas las especialidades</option>
          {data?.especialidades.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <select
          value={filtroDoc}
          onChange={(e) => setFiltroDoc(e.target.value)}
          aria-label="Filtrar por doctor"
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-foreground)]"
        >
          <option value="">Todos los doctores</option>
          {data?.doctores
            .filter((d) => !filtroEsp || d.especialidadIds.includes(filtroEsp))
            .map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setModalCita({ modo: "crear" })}
          disabled={!data}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-on-accent)] hover:opacity-90 disabled:opacity-40"
        >
          <Plus size={13} strokeWidth={ICON_STROKE} aria-hidden /> Nueva cita
        </button>
        {error && data && (
          <button type="button" onClick={() => void cargar(desde)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-danger)] hover:underline">
            <AlertTriangle size={12} strokeWidth={ICON_STROKE} aria-hidden /> No se pudo actualizar — reintentar
          </button>
        )}
      </div>

      {!data && cargando ? (
        <div className="h-[28rem] animate-pulse rounded-2xl bg-[var(--color-surface-muted)]" />
      ) : data ? (
        <div className={cargando ? "opacity-60" : ""}>
          {vista === "dia" ? (
            <VistaDia
              dia={diaActivo}
              visibles={visibles}
              docMovil={docMovilEfectivo}
              onDocMovil={setDocMovil}
              ejeBase={ejeBase}
              onCita={abrirMover}
              onCrearEnHueco={(carril, horaMin) =>
                setModalCita({ modo: "crear", prefill: { fecha: carril.fecha, hora: deMin(horaMin), doctorId: carril.staffId } })}
              onMoverSolicitado={(c, origen, destino) => setConfirmMover({ cita: c, origen, destino, aplicando: false })}
            />
          ) : vista === "semana" ? (
            <VistaSemana
              data={data}
              visibles={visibles}
              hoy={hoy}
              docSemana={docSemana}
              onDocSemana={setDocSemana}
              ejeBase={ejeBase}
              onCita={abrirMover}
              onCrearEnHueco={(carril, horaMin) =>
                setModalCita({ modo: "crear", prefill: { fecha: carril.fecha, hora: deMin(horaMin), doctorId: carril.staffId } })}
              onMoverSolicitado={(c, origen, destino) => setConfirmMover({ cita: c, origen, destino, aplicando: false })}
            />
          ) : (
            <VistaLista data={data} visibles={visibles} hoy={hoy} onCita={abrirMover} />
          )}
        </div>
      ) : null}

      {data && visibles.some((d) => d.sinHorario) && (
        <p className="mt-2 text-[11px] text-[var(--color-warning)]">
          Sin horario configurado: {visibles.filter((d) => d.sinHorario).map((d) => d.nombre).join(" · ")} —{" "}
          <Link href="/ajustes/agenda" className="font-semibold underline">configurar en Ajustes</Link>.
        </p>
      )}

      {/* Cerradas en Fyllio, pendientes de pasar — constante del producto en
          TODOS los niveles: el traspaso al software es manual siempre. */}
      {data && (
        <Card padding="none" className="mt-5 px-5 py-4">
          <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">
            Cerradas en Fyllio, pendientes de pasar a tu software
          </h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">
            Citas que nacieron aquí y aún no están en tu software clínico. Márcalas cuando las pases — es lo que evita el olvido.
          </p>
          {data.pendientes.length === 0 ? (
            <p className="mt-3 text-xs text-[var(--color-muted)]">Nada pendiente de pasar.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {data.pendientes.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[var(--color-foreground)]">
                      <span className="[font-variant-numeric:tabular-nums]">{p.fecha} · {p.hora}</span> — {p.nombre ?? "—"}
                    </p>
                    <p className="text-[11px] text-[var(--color-muted)]">
                      {[p.doctorNombre, p.clinicaNombre].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.telefono && (
                      <Link
                        href={`/mensajeria?telefono=${encodeURIComponent(p.telefono)}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-2 py-1 text-[11px] font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
                      >
                        <MessageCircle size={11} strokeWidth={ICON_STROKE} aria-hidden /> Conversación
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => void marcarTrasladada(p.id)}
                      className="inline-flex items-center gap-1 rounded-lg bg-[var(--color-accent)] px-2 py-1 text-[11px] font-semibold text-[var(--color-on-accent)] hover:opacity-90"
                    >
                      <Check size={11} strokeWidth={ICON_STROKE} aria-hidden /> Ya está en mi software
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* G2.5 — confirmación del arrastre, con el aviso de nivel 1 */}
      {confirmMover && data && (
        <ConfirmDialog
          open
          title="¿Mover la cita?"
          description={`${confirmMover.cita.nombre ?? "La cita"}: ${confirmMover.origen.fecha} · ${deMin(confirmMover.cita.inicioMin)} → ${confirmMover.destino.fecha} · ${deMin(confirmMover.destino.horaMin)}${
            confirmMover.destino.staffId !== confirmMover.origen.staffId
              ? ` con ${data.doctores.find((d) => d.id === confirmMover.destino.staffId)?.nombre ?? "otro doctor"}`
              : ""
          }. Recuerda cambiarla también en tu software clínico.`}
          confirmLabel="Mover cita"
          busy={confirmMover.aplicando}
          onConfirm={() => void aplicarMovimiento()}
          onClose={() => setConfirmMover(null)}
        />
      )}

      {/* G2.4 — crear/mover desde la rejilla */}
      {modalCita && data && (
        <CitaModal
          modo={modalCita.modo}
          inicial={
            modalCita.modo === "crear"
              ? { fecha: vista === "dia" ? fecha : hoy, ...modalCita.prefill }
              : modalCita.cita
          }
          doctores={data.doctores.map((d) => ({ id: d.id, nombre: d.nombre, clinicaId: d.clinicaId }))}
          tratamientos={data.tratamientos}
          onClose={() => setModalCita(null)}
          onSaved={() => {
            setModalCita(null);
            void cargar(desde);
          }}
        />
      )}
    </div>
  );
}

// ─── CARRILES: el renderer compartido de Día y Semana ───────────────────────
//
// Horas a la izquierda (sticky), una columna por CARRIL — en Día el carril es
// un doctor; en Semana (G2.3) es un día del mismo doctor. Con muchos
// carriles: scroll horizontal DENTRO del contenedor (la página nunca
// scrollea en horizontal). El sombreado claro es el horario laboral — se ve
// cuándo trabaja sin ir a su configuración (todos los niveles).

const PX_MIN = 1.1; // 1 minuto ≈ 1.1px → una jornada de 12 h ≈ 790px
const SNAP_MIN = 15; // arrastre y doble clic redondean a cuartos de hora

type Carril = {
  key: string;
  titulo: string;
  subtitulo?: string | null;
  destacado?: boolean; // hoy, en la vista Semana
  ocultaEnMovil?: boolean; // Día: un doctor a la vez en el móvil
  fecha: string; // el día del carril (para mover desde el bloque)
  staffId: string;
  pd: PorDoctor;
};

type DestinoMovimiento = { fecha: string; staffId: string; horaMin: number };

// Leyenda de colores (dictado 30-08): sin ella nadie sabe qué significa qué.
function LeyendaCarriles() {
  const chip = "inline-flex items-center gap-1.5 text-[10px] text-[var(--color-muted)]";
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
      <span className={chip}><span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-success-soft)] border border-[var(--color-success)]/40" /> Confirmada</span>
      <span className={chip}><span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-accent-soft)] border border-[var(--color-accent)]/40" /> Programada</span>
      <span className={chip}><span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-surface-muted)] border border-[var(--color-border)]" /> Completada</span>
      <span className={chip}><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-[var(--color-warning)]" /> Libre según Fyllio</span>
      <span className={chip}>
        <span className="h-2.5 w-2.5 rounded-sm border border-[var(--color-border)]" style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 3px, var(--color-border) 3px 4px)" }} />
        Fuera del horario laboral
      </span>
    </div>
  );
}

function Carriles({
  lanes,
  ejeBase,
  onCita,
  onCrearEnHueco,
  onMoverSolicitado,
}: {
  lanes: Carril[];
  /** El eje SIEMPRE cubre la jornada completa de los doctores visibles en la
   *  semana cargada (dictado 30-08) — no se encoge al día con menos trabajo. */
  ejeBase: { min: number; max: number } | null;
  onCita?: (c: CitaDia, carril: Carril) => void;
  /** Doble clic en un hueco del carril → crear con día/hora/doctor puestos. */
  onCrearEnHueco?: (carril: Carril, horaMin: number) => void;
  /** Fin de un arrastre: el caller CONFIRMA antes de aplicar (dictado). */
  onMoverSolicitado?: (c: CitaDia, origen: Carril, destino: DestinoMovimiento) => void;
}) {
  // Arrastre nativo por pointer events (sin librería): umbral de 6px para
  // distinguirlo del clic; el destino se resuelve con elementFromPoint sobre
  // los data-lane. touch-action se corta solo en los bloques arrastrables.
  const [drag, setDrag] = useState<null | {
    cita: CitaDia; origen: Carril; startX: number; startY: number;
    deltaY: number; overKey: string | null; movio: boolean;
  }>(null);

  let ejeMin = ejeBase?.min ?? Infinity;
  let ejeMax = ejeBase?.max ?? -Infinity;
  for (const { pd } of lanes) {
    for (const f of pd.franjas) { ejeMin = Math.min(ejeMin, aMin(f.inicio)); ejeMax = Math.max(ejeMax, aMin(f.fin)); }
    for (const c of pd.citas) { ejeMin = Math.min(ejeMin, c.inicioMin); ejeMax = Math.max(ejeMax, c.finMin ?? c.inicioMin + 30); }
    for (const b of pd.bloqueos) { ejeMin = Math.min(ejeMin, b.inicio); ejeMax = Math.max(ejeMax, b.fin); }
  }
  if (!Number.isFinite(ejeMin)) { ejeMin = 9 * 60; ejeMax = 20 * 60; }
  ejeMin = Math.floor(ejeMin / 60) * 60;
  ejeMax = Math.min(24 * 60, Math.ceil(ejeMax / 60) * 60);
  const alto = (ejeMax - ejeMin) * PX_MIN;
  const y = (min: number) => (min - ejeMin) * PX_MIN;
  const horas: number[] = [];
  for (let h = ejeMin; h <= ejeMax; h += 60) horas.push(h);

  const hayHuecosPintados = lanes.some(({ pd }) => (pd.libres ?? []).length > 0);

  const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;

  const finDeArrastre = (e: React.PointerEvent) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.movio) {
      onCita?.(d.cita, d.origen);
      return;
    }
    if (!onMoverSolicitado) return;
    const laneEl = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-lane]") as HTMLElement | null;
    const destinoCarril = lanes.find((l) => l.key === (laneEl?.dataset.lane ?? d.origen.key)) ?? d.origen;
    const horaMin = Math.max(ejeMin, Math.min(ejeMax - SNAP_MIN, snap(d.cita.inicioMin + d.deltaY / PX_MIN)));
    if (destinoCarril.key === d.origen.key && horaMin === d.cita.inicioMin) return; // no se movió de sitio
    onMoverSolicitado(d.cita, d.origen, { fecha: destinoCarril.fecha, staffId: destinoCarril.staffId, horaMin });
  };

  return (
    <>
      <LeyendaCarriles />
      <div className="overflow-x-auto">
        <div className="flex min-w-fit pb-3">
          {/* Columna de horas, sticky para que sobreviva al scroll horizontal */}
          <div className="sticky left-0 z-10 w-12 shrink-0 bg-[var(--color-surface)]">
            <div className="h-9" />
            <div className="relative" style={{ height: alto + 8 }}>
              {horas.map((h) => (
                <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-[var(--color-muted)] [font-variant-numeric:tabular-nums]" style={{ top: y(h) }}>
                  {deMin(h)}
                </span>
              ))}
            </div>
          </div>

          {lanes.map((carril) => {
            const { key, titulo, subtitulo, destacado, ocultaEnMovil, pd } = carril;
            const esDestinoDeDrag = drag?.movio && drag.overKey === key;
            return (
            <div
              key={key}
              className={`w-44 min-w-44 flex-1 border-l border-[var(--color-border)] px-1 ${ocultaEnMovil ? "hidden lg:block" : ""}`}
            >
              <div className="flex h-9 flex-col justify-center px-1">
                <p className={`truncate text-[11px] font-semibold ${destacado ? "text-[var(--color-accent)]" : "text-[var(--color-foreground)]"}`}>{titulo}</p>
                {subtitulo && <p className="truncate text-[9.5px] text-[var(--color-muted)]">{subtitulo}</p>}
              </div>
              <div
                data-lane={key}
                onDoubleClick={
                  onCrearEnHueco
                    ? (e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const min = Math.max(ejeMin, Math.min(ejeMax - SNAP_MIN, snap(ejeMin + (e.clientY - rect.top) / PX_MIN)));
                        onCrearEnHueco(carril, min);
                      }
                    : undefined
                }
                onPointerMove={
                  drag
                    ? (e) => {
                        const laneEl = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-lane]") as HTMLElement | null;
                        setDrag((d) => d && {
                          ...d,
                          deltaY: e.clientY - d.startY,
                          overKey: laneEl?.dataset.lane ?? d.overKey,
                          movio: d.movio || Math.abs(e.clientY - d.startY) + Math.abs(e.clientX - d.startX) > 6,
                        });
                      }
                    : undefined
                }
                onPointerUp={drag ? finDeArrastre : undefined}
                title={onCrearEnHueco ? "Doble clic: nueva cita a esa hora" : undefined}
                // FUERA del horario laboral = rayado apagado (contraste
                // invertido, dictado 30-08); la franja de trabajo lo tapa
                // con superficie limpia. Sin otro color nuevo.
                className={`relative rounded-lg bg-[var(--color-surface-muted)] ${esDestinoDeDrag ? "ring-2 ring-[var(--color-accent)]" : ""}`}
                style={{
                  height: alto,
                  backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, var(--color-border) 5px 6px)",
                }}
              >
                {/* Sombreado del HORARIO LABORAL (todos los niveles):
                    superficie limpia = trabaja. */}
                {pd.franjas.map((f, i) => (
                  <div
                    key={`f${i}`}
                    className="absolute inset-x-0 bg-[var(--color-surface)]"
                    style={{ top: y(aMin(f.inicio)), height: (aMin(f.fin) - aMin(f.inicio)) * PX_MIN }}
                  />
                ))}
                {/* Rejilla de horas, por encima del sombreado */}
                {horas.map((h) => (
                  <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-[var(--color-border)] opacity-50" style={{ top: y(h) }} />
                ))}
                {/* Huecos libres — con la advertencia PEGADA (nivel 1) */}
                {(pd.libres ?? []).map((l, i) => (
                  <div
                    key={`l${i}`}
                    className="pointer-events-none absolute inset-x-0.5 rounded-md border border-dashed border-[var(--color-warning)] px-1 py-0.5"
                    style={{ top: y(l.inicio), height: Math.max(18, (l.fin - l.inicio) * PX_MIN) }}
                    title={AVISO_HUECOS}
                  >
                    <p className="text-[9.5px] font-medium leading-tight text-[var(--color-warning)]">
                      <span className="[font-variant-numeric:tabular-nums]">{deMin(l.inicio)}–{deMin(l.fin)}</span> libre según Fyllio
                    </p>
                  </div>
                ))}
                {pd.libres === null && pd.franjas.length > 0 && (
                  <p className="absolute inset-x-1 top-1 text-[9.5px] text-[var(--color-warning)]">
                    Cita sin duración: los huecos no se pueden afirmar.
                  </p>
                )}
                {/* Bloqueos */}
                {pd.bloqueos.map((b, i) => (
                  <div
                    key={`b${i}`}
                    className="absolute inset-x-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1 py-0.5"
                    style={{ top: y(b.inicio), height: Math.max(18, (b.fin - b.inicio) * PX_MIN) }}
                  >
                    <p className="truncate text-[9.5px] text-[var(--color-muted)]">
                      <span className="[font-variant-numeric:tabular-nums]">{deMin(b.inicio)}–{deMin(b.fin)}</span> {b.motivo ?? "bloqueado"}
                    </p>
                  </div>
                ))}
                {/* Citas: clic = detalle/mover · arrastre = mover sobre la
                    rejilla (solo lo nacido en Fyllio). */}
                {pd.citas.map((c) => {
                  const arrastrable = c.esFyllio && Boolean(onMoverSolicitado);
                  const enDrag = drag?.cita.id === c.id && drag.movio;
                  return (
                  <div
                    key={c.id}
                    role={c.esFyllio && onCita ? "button" : undefined}
                    tabIndex={c.esFyllio && onCita ? 0 : undefined}
                    onClick={
                      // Con arrastre activo el clic lo resuelve pointerup;
                      // sin él (Lista no arrastra), clic directo.
                      c.esFyllio && onCita && !arrastrable ? () => onCita(c, carril) : undefined
                    }
                    onPointerDown={
                      arrastrable
                        ? (e) => {
                            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                            setDrag({ cita: c, origen: carril, startX: e.clientX, startY: e.clientY, deltaY: 0, overKey: key, movio: false });
                          }
                        : undefined
                    }
                    onPointerMove={
                      arrastrable && drag?.cita.id === c.id
                        ? (e) => {
                            const laneEl = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-lane]") as HTMLElement | null;
                            setDrag((d) => d && {
                              ...d,
                              deltaY: e.clientY - d.startY,
                              overKey: laneEl?.dataset.lane ?? d.overKey,
                              movio: d.movio || Math.abs(e.clientY - d.startY) + Math.abs(e.clientX - d.startX) > 6,
                            });
                          }
                        : undefined
                    }
                    onPointerUp={arrastrable && drag?.cita.id === c.id ? finDeArrastre : undefined}
                    title={c.esFyllio ? "Clic: mover · arrastra a otra hora o doctor" : "Esta cita vive en tu software clínico — se cambia allí"}
                    className={`absolute inset-x-0.5 overflow-hidden rounded-md border px-1 py-0.5 ${c.esFyllio && (onCita || arrastrable) ? "cursor-pointer hover:ring-1 hover:ring-[var(--color-accent)]" : ""} ${enDrag ? "z-20 opacity-80 ring-2 ring-[var(--color-accent)]" : ""} ${ESTILO_ESTADO[c.estado] ?? "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)]"}`}
                    style={{
                      top: y(c.inicioMin),
                      height: Math.max(22, ((c.finMin ?? c.inicioMin + 30) - c.inicioMin) * PX_MIN),
                      ...(arrastrable ? { touchAction: "none" as const } : {}),
                      ...(enDrag ? { transform: `translateY(${drag!.deltaY}px)` } : {}),
                    }}
                  >
                    <p className="truncate text-[10px] font-semibold leading-tight">
                      <span className="[font-variant-numeric:tabular-nums]">{deMin(c.inicioMin)}{c.finMin !== null ? `–${deMin(c.finMin)}` : ""}</span> {c.nombre ?? "—"}
                    </p>
                    {c.tratamiento && <p className="truncate text-[9px] leading-tight opacity-80">{c.tratamiento}</p>}
                    {c.finMin === null && <p className="text-[9px] leading-tight text-[var(--color-warning)]">sin duración</p>}
                  </div>
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* La frase completa, pegada a la rejilla donde viven los huecos. */}
      {hayHuecosPintados && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--color-warning)]">
          <AlertTriangle size={12} strokeWidth={ICON_STROKE} className="shrink-0" aria-hidden />
          {AVISO_HUECOS} Aquí, libre = libre solo en lo que Fyllio conoce.
        </p>
      )}
    </>
  );
}

// ─── DÍA: un carril por doctor ──────────────────────────────────────────────

function VistaDia({
  dia,
  visibles,
  docMovil,
  onDocMovil,
  ejeBase,
  onCita,
  onCrearEnHueco,
  onMoverSolicitado,
}: {
  dia: { fecha: string; porDoctor: PorDoctor[] } | null;
  visibles: DoctorSemana[];
  docMovil: string;
  onDocMovil: (id: string) => void;
  ejeBase: { min: number; max: number } | null;
  onCita?: (c: CitaDia, carril: Carril) => void;
  onCrearEnHueco?: (carril: Carril, horaMin: number) => void;
  onMoverSolicitado?: (c: CitaDia, origen: Carril, destino: DestinoMovimiento) => void;
}) {
  if (!dia) {
    // El día activo cayó fuera de la semana cargada (transición de fetch).
    return <div className="h-[28rem] animate-pulse rounded-2xl bg-[var(--color-surface-muted)]" />;
  }
  const lanes: Carril[] = visibles
    .map((doc) => ({ doc, pd: dia.porDoctor.find((p) => p.staffId === doc.id) }))
    .filter((l): l is { doc: DoctorSemana; pd: PorDoctor } => l.pd !== undefined)
    .map(({ doc, pd }) => ({
      key: doc.id,
      titulo: doc.nombre,
      subtitulo: doc.clinicaNombre,
      ocultaEnMovil: doc.id !== docMovil,
      fecha: dia.fecha,
      staffId: doc.id,
      pd,
    }));

  if (lanes.length === 0) {
    return (
      <Card padding="none" className="px-5 py-8 text-center">
        <p className="text-xs text-[var(--color-muted)]">No hay doctores que enseñar con este filtro.</p>
      </Card>
    );
  }

  return (
    <Card padding="none" className="px-3 py-3">
      {/* Móvil: un doctor a la vez — los carriles no caben en una mano. */}
      {lanes.length > 1 && (
        <select
          value={docMovil}
          onChange={(e) => onDocMovil(e.target.value)}
          aria-label="Doctor visible en móvil"
          className="mb-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-foreground)] lg:hidden"
        >
          {visibles.map((doc) => <option key={doc.id} value={doc.id}>{doc.nombre}</option>)}
        </select>
      )}
      <Carriles lanes={lanes} ejeBase={ejeBase} onCita={onCita} onCrearEnHueco={onCrearEnHueco} onMoverSolicitado={onMoverSolicitado} />
    </Card>
  );
}

// ─── SEMANA: los siete días de UN doctor (G2.3) ─────────────────────────────
//
// Con varios doctores la semana no cabe y se vuelve ilegible (dictado): si no
// hay doctor filtrado se AUTO-SELECCIONA el primero visible y la vista lo
// DICE en su propio selector prominente — forzar con declaración, no caer a
// Lista ni pedir deberes. El selector es local: no pisa el filtro global.

function VistaSemana({
  data,
  visibles,
  hoy,
  docSemana,
  onDocSemana,
  ejeBase,
  onCita,
  onCrearEnHueco,
  onMoverSolicitado,
}: {
  data: Semana;
  visibles: DoctorSemana[];
  hoy: string;
  docSemana: string;
  onDocSemana: (id: string) => void;
  ejeBase: { min: number; max: number } | null;
  onCita?: (c: CitaDia, carril: Carril) => void;
  onCrearEnHueco?: (carril: Carril, horaMin: number) => void;
  onMoverSolicitado?: (c: CitaDia, origen: Carril, destino: DestinoMovimiento) => void;
}) {
  const doc = visibles.find((d) => d.id === docSemana) ?? visibles[0] ?? null;
  if (!doc) {
    return (
      <Card padding="none" className="px-5 py-8 text-center">
        <p className="text-xs text-[var(--color-muted)]">No hay doctores que enseñar con este filtro.</p>
      </Card>
    );
  }
  const lanes: Carril[] = data.dias
    .map((dia) => ({ dia, pd: dia.porDoctor.find((p) => p.staffId === doc.id) }))
    .filter((l): l is { dia: Semana["dias"][number]; pd: PorDoctor } => l.pd !== undefined)
    .map(({ dia, pd }) => ({
      key: dia.fecha,
      titulo: `${LABEL_DIA[diaSemanaISO(dia.fecha)]} ${dia.fecha.slice(8)}`,
      subtitulo: dia.fecha === hoy ? "hoy" : null,
      destacado: dia.fecha === hoy,
      fecha: dia.fecha,
      staffId: doc.id,
      pd,
    }));

  return (
    <Card padding="none" className="px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold text-[var(--color-foreground)]">Semana de:</span>
        <select
          value={doc.id}
          onChange={(e) => onDocSemana(e.target.value)}
          aria-label="Doctor de la semana"
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-accent)]"
        >
          {visibles.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </select>
        {doc.clinicaNombre && <span className="text-[11px] text-[var(--color-muted)]">{doc.clinicaNombre}</span>}
      </div>
      <Carriles lanes={lanes} ejeBase={ejeBase} onCita={onCita} onCrearEnHueco={onCrearEnHueco} onMoverSolicitado={onMoverSolicitado} />
    </Card>
  );
}

// ─── LISTA: la semana plegada — un recuadro por doctor y día (G2.2) ─────────
//
// El resumen no repite el detalle: es para escanear una semana de cinco
// doctores sin abrir nada («2 h libres según Fyllio: 16:00 y 18:30» · «sin
// horas libres» · «no trabaja»), con la marca «sin pasar» donde toque. Al
// desplegar, el detalle de siempre.

function VistaLista({
  data,
  visibles,
  hoy,
  onCita,
}: {
  data: Semana;
  visibles: DoctorSemana[];
  hoy: string;
  onCita?: (c: CitaDia, carril: { fecha: string; staffId: string }) => void;
}) {
  const nombreDe = (id: string) => data.doctores.find((d) => d.id === id)?.nombre ?? "—";
  const hayHuecos = data.dias.some((dia) =>
    dia.porDoctor.some((pd) => visibles.some((v) => v.id === pd.staffId) && (pd.libres ?? []).length > 0));
  return (
    <>
      {hayHuecos && (
        <p className="mb-2 flex items-center gap-1.5 text-[11px] text-[var(--color-warning)]">
          <AlertTriangle size={12} strokeWidth={ICON_STROKE} className="shrink-0" aria-hidden />
          {AVISO_HUECOS}
        </p>
      )}
      <div className="grid gap-2 lg:grid-cols-7">
        {data.dias.map((dia) => {
          const esHoy = dia.fecha === hoy;
          const bloques = dia.porDoctor.filter((pd) => visibles.some((v) => v.id === pd.staffId));
          return (
            <Card key={dia.fecha} padding="none" className={`px-2 py-2 ${esHoy ? "ring-1 ring-[var(--color-accent)]" : ""}`}>
              <p className={`mb-1.5 px-0.5 text-[11px] font-semibold uppercase tracking-wide ${esHoy ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"}`}>
                {LABEL_DIA[diaSemanaISO(dia.fecha)]} {dia.fecha.slice(8)}
                {esHoy && " · hoy"}
              </p>
              <div className="space-y-1.5">
                {bloques.map((pd) => (
                  <RecuadroDoctorDia key={pd.staffId} pd={pd} nombre={nombreDe(pd.staffId)} fecha={dia.fecha} onCita={onCita} />
                ))}
                {bloques.length === 0 && <p className="text-[10.5px] text-[var(--color-muted)]">—</p>}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function RecuadroDoctorDia({
  pd,
  nombre,
  fecha,
  onCita,
}: {
  pd: PorDoctor;
  nombre: string;
  fecha: string;
  onCita?: (c: CitaDia, carril: { fecha: string; staffId: string }) => void;
}) {
  const trabaja = pd.franjas.length > 0;
  const sinPasar = pd.citas.filter((c) => c.sinPasar).length;
  const resumen = resumenDeAgendaDia({ trabaja, nCitas: pd.citas.length, libres: pd.libres });
  const vacio = !trabaja && pd.citas.length === 0 && pd.bloqueos.length === 0;

  // Un día sin nada no tiene detalle que desplegar: el resumen ES todo.
  if (vacio) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] px-2 py-1.5">
        <p className="truncate text-[10.5px] font-semibold text-[var(--color-foreground)]">{nombre}</p>
        <p className="text-[10px] text-[var(--color-muted)]">{resumen.nota}</p>
      </div>
    );
  }

  // Jerarquía dictada (30-08): lo esencial — y las horas LIBRES destacan
  // sobre el resto. Las horas concretas viven en el detalle, no aquí.
  const ESTILO_LIBRES = {
    destacado: "text-[11px] font-semibold text-[var(--color-foreground)]",
    apagado: "text-[10px] text-[var(--color-muted)]",
    aviso: "text-[10px] font-medium text-[var(--color-warning)]",
  } as const;

  return (
    <details className="group rounded-xl border border-[var(--color-border)]">
      <summary className="cursor-pointer list-none px-2 py-1.5 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-1">
          <p className="truncate text-[10.5px] font-semibold text-[var(--color-foreground)]">{nombre}</p>
          <ChevronDown size={11} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-muted)] transition-transform group-open:rotate-180" aria-hidden />
        </div>
        {resumen.libres && (
          <p className={ESTILO_LIBRES[resumen.libres.enfasis]} title={resumen.libres.enfasis === "destacado" ? AVISO_HUECOS : undefined}>
            {resumen.libres.texto}
            {resumen.libres.enfasis === "destacado" && <span className="ml-1 text-[9px] font-normal text-[var(--color-muted)]">según Fyllio</span>}
          </p>
        )}
        <p className="text-[10px] leading-snug text-[var(--color-muted)]">
          {resumen.citas}
          {resumen.fueraDeHorario && " · fuera de su horario"}
        </p>
        {sinPasar > 0 && (
          <p className="mt-0.5 inline-flex rounded-full bg-[var(--color-warning)]/15 px-1.5 py-px text-[9.5px] font-semibold text-[var(--color-warning)]">
            {sinPasar === 1 ? "1 sin pasar a tu software" : `${sinPasar} sin pasar a tu software`}
          </p>
        )}
      </summary>
      <div className="space-y-1 border-t border-[var(--color-border)] px-2 py-1.5">
        {pd.citas.map((c) => (
          <div key={c.id}
            role={c.esFyllio && onCita ? "button" : undefined}
            onClick={c.esFyllio && onCita ? () => onCita(c, { fecha, staffId: pd.staffId }) : undefined}
            title={c.esFyllio ? "Mover o reagendar" : "Esta cita vive en tu software clínico — se cambia allí"}
            className={`rounded-lg border px-1.5 py-1 text-[10.5px] leading-tight ${c.esFyllio && onCita ? "cursor-pointer hover:ring-1 hover:ring-[var(--color-accent)]" : ""} ${ESTILO_ESTADO[c.estado] ?? "border-[var(--color-border)] text-[var(--color-foreground)]"}`}>
            <span className="font-semibold [font-variant-numeric:tabular-nums]">
              {deMin(c.inicioMin)}{c.finMin !== null ? `–${deMin(c.finMin)}` : ""}
            </span>{" "}
            {c.nombre ?? "—"}
            {c.sinPasar && <span className="text-[var(--color-warning)]"> · sin pasar</span>}
            {c.finMin === null && <span className="text-[var(--color-warning)]"> · sin duración</span>}
          </div>
        ))}
        {pd.bloqueos.map((b, i) => (
          <div key={`b${i}`} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-1 text-[10.5px] text-[var(--color-muted)]">
            <span className="[font-variant-numeric:tabular-nums]">{deMin(b.inicio)}–{deMin(b.fin)}</span> {b.motivo ?? "bloqueado"}
          </div>
        ))}
        {pd.libres === null ? (
          <p className="text-[10px] text-[var(--color-warning)]">
            Hay una cita sin duración: los huecos de este día no se pueden afirmar.
          </p>
        ) : (
          pd.libres.map((l, i) => (
            <div key={`l${i}`}
              title={AVISO_HUECOS}
              className="rounded-lg border border-dashed border-[var(--color-warning)] px-1.5 py-1 text-[10.5px] text-[var(--color-warning)]">
              <span className="[font-variant-numeric:tabular-nums]">{deMin(l.inicio)}–{deMin(l.fin)}</span> libre según Fyllio
            </div>
          ))
        )}
      </div>
    </details>
  );
}
