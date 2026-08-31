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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card } from "../../components/ui/Card";
import { cargarJSON } from "../../lib/fetch-json";
import { hoyISO, sumaDias, horaClinica } from "../../lib/time";
import { aMin, deMin, diaSemanaISO } from "../../lib/agenda/disponibilidad";
import { AVISO_HUECOS } from "../../lib/agenda/avisos";
import { resumenDeAgendaDia } from "../../lib/agenda/resumen";
import { fechaCorta, fechaLarga, diaMes, diaMesCorto } from "../../lib/agenda/fechas";
import { CitaPanel } from "./CitaPanel";
import { nombreCortoDoctor } from "../../lib/agenda/nombres";
import { EditorCitaFlotante, type BorradorCita } from "./EditorCitaFlotante";
import { MiniCalendario } from "./MiniCalendario";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
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
type CitaDia = {
  id: string; inicioMin: number; finMin: number | null; nombre: string | null; estado: string;
  tratamiento: string | null; tratamientoId: string | null; deLead: boolean; sinPasar: boolean; esFyllio: boolean;
  telefono: string | null; recordatorio: { estado: string; enviadoEnISO: string | null } | null; agenteActivo: boolean;
};
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

// La frase dictada («AVISO_HUECOS») vive en lib/agenda/avisos desde G3 —
// compartida con el modal de agendar.

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
  // G2.7 — el BORRADOR: el bloque vivo de la rejilla + el editor flotante.
  const [borrador, setBorrador] = useState<BorradorCita | null>(null);
  // G2.8 — el mini calendario es un DESPLEGABLE desde el título (no una
  // columna que aplasta la rejilla) y al pulsar un día se VA a ese día.
  const [calAbierto, setCalAbierto] = useState(false);
  // G2.8 — buscador de doctor: directo a su agenda semanal.
  const [busqDoc, setBusqDoc] = useState("");

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

  // G3-panel — clic en una cita: su estado + la ficha del caso.
  const [panelCita, setPanelCita] = useState<null | { cita: CitaDia; carril: { fecha: string; staffId: string } }>(null);

  // G2.5/G2.7 — gesto terminado sobre una cita EXISTENTE (mover o estirar):
  // CONFIRMAR antes de aplicar, con el cambio legible.
  const [confirmar, setConfirmar] = useState<null | {
    titulo: string; descripcion: string; citaId: string; body: Record<string, unknown>; aplicando: boolean;
  }>(null);

  const aplicarConfirmacion = useCallback(async () => {
    if (!confirmar) return;
    setConfirmar((c) => c && { ...c, aplicando: true });
    try {
      await cargarJSON(`/api/agenda/citas/${confirmar.citaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmar.body),
      });
      toast.success("Guardado. Recuerda cambiarla también en tu software.");
      setConfirmar(null);
      await cargar(desde);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "No se pudo guardar.");
      setConfirmar(null);
    }
  }, [confirmar, cargar, desde]);

  // G3-panel — el clic abre el PANEL (estado + ficha); mover vive dentro y
  // en el arrastre. Se abre también para citas importadas: su estado y su
  // conversación importan aunque no se puedan mover desde aquí.
  const abrirPanel = useCallback((c: CitaDia, carril: { fecha: string; staffId: string }) => {
    setPanelCita({ cita: c, carril });
  }, []);

  // G2.7 — mover desde el panel: el editor flotante con el borrador de ESA
  // cita (el bloque se mueve/estira en vivo en la rejilla).
  const abrirMover = useCallback((c: CitaDia, carril: { fecha: string; staffId: string }) => {
    setBorrador({
      modo: "editar",
      citaId: c.id,
      nombre: c.nombre ?? "",
      pacienteId: null,
      tipoCitaId: c.tratamientoId ?? "",
      fecha: carril.fecha,
      staffId: carril.staffId,
      inicioMin: c.inicioMin,
      duracionMin: Math.max(15, (c.finMin ?? c.inicioMin + 30) - c.inicioMin),
    });
  }, []);

  // G2.7 — crear: desde el dibujo sobre la rejilla (con su duración) o desde
  // el botón (30 min a las 10:00 del día activo, primer doctor visible).
  const crearBorrador = useCallback((carril: { fecha: string; staffId: string }, inicioMin: number, duracionMin: number) => {
    setBorrador({
      modo: "crear",
      nombre: "",
      pacienteId: null,
      tipoCitaId: "",
      fecha: carril.fecha,
      staffId: carril.staffId,
      inicioMin,
      duracionMin,
    });
  }, []);

  const irASemanaDoctor = useCallback((staffId: string) => {
    setDocSemana(staffId);
    setFiltroDoc("");
    setVista("semana");
    setBusqDoc("");
  }, []);

  const pedirMover = useCallback((c: CitaDia, origen: { fecha: string; staffId: string }, destino: DestinoMovimiento) => {
    const doc = data?.doctores.find((d) => d.id === destino.staffId)?.nombre;
    setConfirmar({
      titulo: "¿Mover la cita?",
      descripcion: `${c.nombre ?? "La cita"}: ${diaMesCorto(origen.fecha)} · ${deMin(c.inicioMin)} → ${diaMesCorto(destino.fecha)} · ${deMin(destino.horaMin)}${destino.staffId !== origen.staffId ? ` con ${doc ?? "otro doctor"}` : ""}. Recuerda cambiarla también en tu software clínico.`,
      citaId: c.id,
      body: { fecha: destino.fecha, hora: deMin(destino.horaMin), doctorId: destino.staffId },
      aplicando: false,
    });
  }, [data]);

  const pedirResize = useCallback((c: CitaDia, carril: { fecha: string; staffId: string }, inicioMin: number, duracionMin: number) => {
    setConfirmar({
      titulo: "¿Cambiar la duración?",
      descripcion: `${c.nombre ?? "La cita"}: pasa a ${deMin(inicioMin)}–${deMin(inicioMin + duracionMin)} (${duracionMin} min). Recuerda cambiarla también en tu software clínico.`,
      citaId: c.id,
      body: { fecha: carril.fecha, hora: deMin(inicioMin), duracionMin },
      aplicando: false,
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
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-on-accent)] hover:opacity-90"
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
      <div className="mb-2 flex items-center gap-2">
        <CalendarDays size={20} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
        <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">Agenda</h1>
      </div>

      {/* Controles: vista + navegación + filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex h-9 items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5 shadow-sm" role="tablist" aria-label="Vista">
          {([["dia", "Día"], ["semana", "Semana"], ["lista", "Lista"]] as Array<[Vista, string]>).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={vista === v}
              onClick={() => setVista(v)}
              className={`rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
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
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] shadow-sm hover:bg-[var(--color-surface-muted)]">
              <ChevronLeft size={14} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
            <button type="button" onClick={() => irADia(hoyISO())}
              className="h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12.5px] font-semibold text-[var(--color-foreground)] shadow-sm hover:bg-[var(--color-surface-muted)]">
              Hoy
            </button>
            <button type="button" aria-label="Día siguiente" onClick={() => irADia(sumaDias(fecha, 1))}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] shadow-sm hover:bg-[var(--color-surface-muted)]">
              <ChevronRight size={14} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Semana anterior" onClick={() => setDesde(sumaDias(desde, -7))}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] shadow-sm hover:bg-[var(--color-surface-muted)]">
              <ChevronLeft size={14} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
            <button type="button" onClick={() => setDesde(lunesDe(hoyISO()))}
              className="h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[12.5px] font-semibold text-[var(--color-foreground)] shadow-sm hover:bg-[var(--color-surface-muted)]">
              Hoy
            </button>
            <button type="button" aria-label="Semana siguiente" onClick={() => setDesde(sumaDias(desde, 7))}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] shadow-sm hover:bg-[var(--color-surface-muted)]">
              <ChevronRight size={14} strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          </div>
        )}

        {/* G2.8 — el título de fecha ES el mini calendario (como Google) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setCalAbierto((v) => !v)}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 font-display text-[15px] font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
          >
            {vista === "dia" ? fechaLarga(fecha) : `Semana del ${diaMes(desde)}`}
            {vista === "dia" && fecha === hoy && <span className="text-[11px] font-normal text-[var(--color-muted)]"> · hoy</span>}
            <ChevronDown size={14} strokeWidth={ICON_STROKE} className={`text-[var(--color-muted)] transition-transform ${calAbierto ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {calAbierto && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setCalAbierto(false)} />
              <div className="absolute left-0 top-full z-40 mt-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-2xl">
                <MiniCalendario
                  seleccionada={vista === "dia" ? fecha : desde}
                  hoy={hoy}
                  onDia={(f) => {
                    setCalAbierto(false);
                    // Al día PULSADO, no al lunes de su semana: la vista Día.
                    setVista("dia");
                    irADia(f);
                  }}
                />
              </div>
            </>
          )}
        </div>

        <select
          value={filtroEsp}
          onChange={(e) => { setFiltroEsp(e.target.value); setFiltroDoc(""); }}
          aria-label="Filtrar por especialidad"
          className="h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[12.5px] font-medium text-[var(--color-foreground)] shadow-sm"
        >
          <option value="">Todas las especialidades</option>
          {data?.especialidades.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        <select
          value={filtroDoc}
          onChange={(e) => setFiltroDoc(e.target.value)}
          aria-label="Filtrar por doctor"
          className="h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[12.5px] font-medium text-[var(--color-foreground)] shadow-sm"
        >
          <option value="">Todos los doctores</option>
          {data?.doctores
            .filter((d) => !filtroEsp || d.especialidadIds.includes(filtroEsp))
            .map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </select>
        <button
          type="button"
          onClick={() => {
            const f = vista === "dia" ? fecha : hoy;
            const doc = visibles[0];
            if (doc) crearBorrador({ fecha: f, staffId: doc.id }, 10 * 60, 30);
          }}
          disabled={!data}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3.5 text-[12.5px] font-semibold text-[var(--color-on-accent)] shadow-sm hover:opacity-90 disabled:opacity-40"
        >
          <Plus size={13} strokeWidth={ICON_STROKE} aria-hidden /> Nueva cita
        </button>
        {/* G2.8 — buscador de doctor: directo a su semana */}
        <div className="relative">
          <Search size={12} strokeWidth={ICON_STROKE} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-muted)]" aria-hidden />
          <input
            value={busqDoc}
            onChange={(e) => setBusqDoc(e.target.value)}
            placeholder="Buscar doctor…"
            aria-label="Buscar doctor"
            className="h-9 w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-7 pr-2.5 text-[12.5px] font-medium text-[var(--color-foreground)] shadow-sm placeholder:font-normal placeholder:text-[var(--color-muted)]"
          />
          {busqDoc.trim().length >= 2 && data && (
            <div className="absolute left-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
              {(() => {
                const n = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                const hits = data.doctores.filter((d) => n(d.nombre).includes(n(busqDoc.trim()))).slice(0, 6);
                if (!hits.length) return <p className="px-3 py-2 text-xs text-[var(--color-muted)]">Sin coincidencias.</p>;
                return hits.map((d) => (
                  <button key={d.id} type="button" onClick={() => irASemanaDoctor(d.id)}
                    className="block w-full px-3 py-1.5 text-left text-xs text-[var(--color-foreground)] hover:bg-[var(--color-accent-soft)]">
                    {d.nombre}
                    {d.clinicaNombre && <span className="text-[var(--color-muted)]"> · {d.clinicaNombre}</span>}
                  </button>
                ));
              })()}
            </div>
          )}
        </div>
        {error && data && (
          <button type="button" onClick={() => void cargar(desde)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-danger)] hover:underline">
            <AlertTriangle size={12} strokeWidth={ICON_STROKE} aria-hidden /> No se pudo actualizar — reintentar
          </button>
        )}
      </div>

      {/* El aviso de nivel: línea propia — cabe SIEMPRE, envuelve si hace falta */}
      <p data-aviso-nivel className="mb-3 flex items-start gap-1.5 text-[11px] leading-snug text-[var(--color-muted)]">
        <Info size={12} strokeWidth={ICON_STROKE} className="mt-px shrink-0 text-[var(--color-accent)]" aria-hidden />
        <span>Las horas libres son orientativas: dependen del nivel de integración con la agenda real de tu clínica.</span>
      </p>

      {!data && cargando ? (
        <div className="h-[28rem] animate-pulse rounded-xl bg-[var(--color-surface-muted)]" />
      ) : data ? (
        <div className={cargando ? "opacity-60" : ""}>
          {vista === "dia" ? (
            <VistaDia
              dia={diaActivo}
              visibles={visibles}
              docMovil={docMovilEfectivo}
              onDocMovil={setDocMovil}
              onVerSemana={irASemanaDoctor}
              ejeBase={ejeBase}
              hoy={hoy}
              onCita={abrirPanel}
              borrador={borrador}
              onBorradorCambia={(patch) => setBorrador((b) => b && { ...b, ...patch })}
              onCrear={crearBorrador}
              onMoverSolicitado={pedirMover}
              onResizeSolicitado={pedirResize}
            />
          ) : vista === "semana" ? (
            <VistaSemana
              data={data}
              visibles={visibles}
              hoy={hoy}
              docSemana={docSemana}
              onDocSemana={setDocSemana}
              ejeBase={ejeBase}
              onCita={abrirPanel}
              borrador={borrador}
              onBorradorCambia={(patch) => setBorrador((b) => b && { ...b, ...patch })}
              onCrear={crearBorrador}
              onMoverSolicitado={pedirMover}
              onResizeSolicitado={pedirResize}
            />
          ) : (
            <VistaLista data={data} visibles={visibles} hoy={hoy} onCita={abrirPanel} onVerSemana={irASemanaDoctor} />
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
                      <span className="[font-variant-numeric:tabular-nums]">{p.fecha ? diaMesCorto(p.fecha) : "—"} · {p.hora}</span> — {p.nombre ?? "—"}
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

      {/* G3-panel — estado de la cita + la ficha del caso intacta */}
      {panelCita && data && (
        <CitaPanel
          cita={{
            id: panelCita.cita.id,
            nombre: panelCita.cita.nombre,
            estado: panelCita.cita.estado,
            fecha: panelCita.carril.fecha,
            hora: deMin(panelCita.cita.inicioMin),
            doctorNombre: data.doctores.find((d) => d.id === panelCita.carril.staffId)?.nombre ?? "—",
            sinPasar: panelCita.cita.sinPasar,
            esFyllio: panelCita.cita.esFyllio,
            telefono: panelCita.cita.telefono,
            recordatorio: panelCita.cita.recordatorio,
            agenteActivo: panelCita.cita.agenteActivo,
          }}
          onClose={() => setPanelCita(null)}
          onMover={() => {
            const pc = panelCita;
            setPanelCita(null);
            abrirMover(pc.cita, pc.carril);
          }}
          onTrasladada={() => {
            const pc = panelCita;
            setPanelCita(null);
            void marcarTrasladada(pc.cita.id);
          }}
          onCambio={() => void cargar(desde)}
        />
      )}

      {/* G2.5/G2.7 — confirmación de mover/estirar una cita existente */}
      {confirmar && (
        <ConfirmDialog
          open
          title={confirmar.titulo}
          description={confirmar.descripcion}
          confirmLabel="Aplicar"
          busy={confirmar.aplicando}
          onConfirm={() => void aplicarConfirmacion()}
          onClose={() => setConfirmar(null)}
        />
      )}

      {/* G2.7 — el editor flotante: SIN oscurecer, con el borrador vivo en la rejilla */}
      {borrador && data && (
        <EditorCitaFlotante
          borrador={borrador}
          doctores={data.doctores.map((d) => ({ id: d.id, nombre: d.nombre, clinicaId: d.clinicaId }))}
          tratamientos={data.tratamientos}
          onCambia={(patch) => setBorrador((b) => b && { ...b, ...patch })}
          onClose={() => setBorrador(null)}
          onGuardada={() => {
            setBorrador(null);
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

const PX_MIN = 1.4; // 1 minuto ≈ 1.4px → bloques con cuerpo (30 min ≈ 42px)
const SNAP_MIN = 15; // gestos redondean a cuartos de hora

type Carril = {
  key: string;
  titulo: string;
  tituloCompleto?: string; // tooltip cuando el título va abreviado
  subtitulo?: string | null;
  diaNumero?: number; // Semana: cabecera tipo calendario
  destacado?: boolean;
  ocultaEnMovil?: boolean;
  /** G2.8 — el nombre del doctor es un ENLACE a su semana individual. */
  onTitulo?: () => void;
  fecha: string;
  staffId: string;
  pd: PorDoctor;
};

type DestinoMovimiento = { fecha: string; staffId: string; horaMin: number };

// Bloques SÓLIDOS (dictado: colores presentes, contraste real entre
// estructura y contenido) — texto claro sobre el color de estado.
const BLOQUE_ESTADO: Record<string, { bg: string; fg: string; borde?: string }> = {
  Confirmada: { bg: "var(--color-success)", fg: "var(--color-on-accent)" },
  Programada: { bg: "var(--color-accent)", fg: "var(--color-on-accent)" },
  Completado: { bg: "var(--color-surface-muted)", fg: "var(--color-muted)", borde: "var(--color-border)" },
};

function LeyendaCarriles() {
  const chip = "inline-flex items-center gap-1.5 rounded-full bg-[var(--color-surface-muted)] px-2.5 py-1 text-[10.5px] font-medium text-[var(--color-muted)]";
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 px-1">
      <span className={chip}><span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-success)]" /> Confirmada</span>
      <span className={chip}><span className="h-2.5 w-2.5 rounded-sm bg-[var(--color-accent)]" /> Programada</span>
      <span className={chip}><span className="h-2.5 w-2.5 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-muted)]" /> Completada</span>
      <span className={chip}><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-[var(--color-warning)]" /> Hueco libre</span>
      <span className={chip}>
        <span className="h-2.5 w-2.5 rounded-sm border border-[var(--color-border)]" style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 3px, var(--color-border) 3px 4px)" }} />
        Fuera del horario laboral
      </span>
    </div>
  );
}

// ─── La maquinaria de gestos, IMPERATIVA ────────────────────────────────────
//
// La lección que costó tres pasadas (31-08): los handlers condicionados al
// estado de React llegan TARDE — un arrastre rápido (un golpe de ratón real)
// termina antes del re-render y no ve ni un movimiento. Aquí los listeners
// se registran EN el pointerdown sobre window, el estado del gesto vive en
// un ref (siempre fresco), y React solo PINTA.

type Gesto =
  | { tipo: "mover"; cita: CitaDia; origen: Carril; startX: number; startY: number; deltaX: number; deltaY: number; overKey: string; movio: boolean }
  | { tipo: "resize"; cita: CitaDia; carril: Carril; borde: "arriba" | "abajo"; startY: number; nuevoIni: number; nuevoFin: number }
  | { tipo: "dibujo"; carril: Carril; inicioMin: number; actualMin: number }
  | { tipo: "borrador"; accion: "mover" | "arriba" | "abajo"; startX: number; startY: number; inicio0: number; dur0: number };

function Carriles({
  lanes,
  ejeBase,
  hoy,
  borrador,
  onBorradorCambia,
  onCita,
  onCrear,
  onMoverSolicitado,
  onResizeSolicitado,
}: {
  lanes: Carril[];
  ejeBase: { min: number; max: number } | null;
  hoy: string;
  /** El bloque BORRADOR (crear/mover con el editor flotante abierto): vive en
   *  la rejilla, se arrastra y se estira mientras se rellena el panel. */
  borrador: { fecha: string; staffId: string; inicioMin: number; duracionMin: number; nombre: string } | null;
  onBorradorCambia?: (patch: { fecha?: string; staffId?: string; inicioMin?: number; duracionMin?: number }) => void;
  onCita?: (c: CitaDia, carril: Carril) => void;
  /** Dibujo sobre el lienzo (o doble clic = 30 min por defecto). */
  onCrear?: (carril: Carril, inicioMin: number, duracionMin: number) => void;
  onMoverSolicitado?: (c: CitaDia, origen: Carril, destino: DestinoMovimiento) => void;
  /** Estirar un borde de una cita existente (solo fyllio): cambia duración. */
  onResizeSolicitado?: (c: CitaDia, carril: Carril, inicioMin: number, duracionMin: number) => void;
}) {
  const gestoRef = useRef<Gesto | null>(null);
  const [gestoVista, setGestoVista] = useState<Gesto | null>(null);
  const laneEls = useRef<Record<string, HTMLElement | null>>({});

  // La línea de AHORA: viva, cada medio minuto.
  const [ahoraMin, setAhoraMin] = useState<number>(() => aMin(horaClinica(new Date())));
  const [hoyVivo, setHoyVivo] = useState<string>(() => hoyISO());
  useEffect(() => {
    const t = setInterval(() => {
      setAhoraMin(aMin(horaClinica(new Date())));
      setHoyVivo(hoyISO());
    }, 30000);
    return () => clearInterval(t);
  }, []);

  let ejeMin = ejeBase?.min ?? Infinity;
  let ejeMax = ejeBase?.max ?? -Infinity;
  for (const { pd } of lanes) {
    for (const f of pd.franjas) { ejeMin = Math.min(ejeMin, aMin(f.inicio)); ejeMax = Math.max(ejeMax, aMin(f.fin)); }
    for (const c of pd.citas) { ejeMin = Math.min(ejeMin, c.inicioMin); ejeMax = Math.max(ejeMax, c.finMin ?? c.inicioMin + 30); }
    for (const b of pd.bloqueos) { ejeMin = Math.min(ejeMin, b.inicio); ejeMax = Math.max(ejeMax, b.fin); }
  }
  if (!Number.isFinite(ejeMin)) { ejeMin = 9 * 60; ejeMax = 20 * 60; }
  // Si HOY está a la vista, el eje incluye el AHORA: la línea roja no puede
  // «no aparecer» por quedar fuera (revisión 31-08).
  if (lanes.some((l) => l.fecha === hoyVivo)) {
    ejeMin = Math.min(ejeMin, ahoraMin);
    ejeMax = Math.max(ejeMax, ahoraMin + 1);
  }
  ejeMin = Math.floor(ejeMin / 60) * 60;
  ejeMax = Math.min(24 * 60, Math.ceil(ejeMax / 60) * 60);
  const alto = (ejeMax - ejeMin) * PX_MIN;
  const y = (min: number) => (min - ejeMin) * PX_MIN;
  const horas: number[] = [];
  for (let h = ejeMin; h <= ejeMax; h += 60) horas.push(h);

  const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;
  const clampIni = (min: number) => Math.max(ejeMin, Math.min(ejeMax - SNAP_MIN, min));
  const minEnLane = (laneKey: string, clientY: number) => {
    const el = laneEls.current[laneKey];
    if (!el) return ejeMin;
    return clampIni(snap(ejeMin + (clientY - el.getBoundingClientRect().top) / PX_MIN));
  };
  const laneBajo = (x: number, yPx: number): Carril | null => {
    const el = document.elementFromPoint(x, yPx)?.closest("[data-lane]") as HTMLElement | null;
    return lanes.find((l) => l.key === el?.dataset.lane) ?? null;
  };

  const refsGesto = useRef({ borrador, onBorradorCambia, onCita, onCrear, onMoverSolicitado, onResizeSolicitado, lanes, ejeMin, ejeMax });
  refsGesto.current = { borrador, onBorradorCambia, onCita, onCrear, onMoverSolicitado, onResizeSolicitado, lanes, ejeMin, ejeMax };

  function iniciarGesto(g: Gesto, e: React.PointerEvent) {
    e.preventDefault();
    gestoRef.current = g;
    setGestoVista({ ...g });
    const onMove = (ev: PointerEvent) => {
      const cur = gestoRef.current;
      if (!cur) return;
      const R = refsGesto.current;
      if (cur.tipo === "mover") {
        cur.deltaX = ev.clientX - cur.startX;
        cur.deltaY = ev.clientY - cur.startY;
        cur.movio = cur.movio || Math.abs(cur.deltaX) + Math.abs(cur.deltaY) > 6;
        const lane = laneBajo(ev.clientX, ev.clientY);
        if (lane) cur.overKey = lane.key;
      } else if (cur.tipo === "resize") {
        const m = minEnLane(cur.carril.key, ev.clientY);
        // El fin ES el minuto bajo el puntero (snapeado) — sin sumar nada:
        // el mínimo de 15 lo garantiza el max/min, no un offset.
        if (cur.borde === "abajo") cur.nuevoFin = Math.max(cur.nuevoIni + SNAP_MIN, m);
        else cur.nuevoIni = Math.min(m, cur.nuevoFin - SNAP_MIN);
      } else if (cur.tipo === "dibujo") {
        cur.actualMin = minEnLane(cur.carril.key, ev.clientY);
      } else if (cur.tipo === "borrador") {
        const b = R.borrador;
        if (!b || !R.onBorradorCambia) return;
        if (cur.accion === "mover") {
          const nuevoIni = clampIni(snap(cur.inicio0 + (ev.clientY - cur.startY) / PX_MIN));
          const lane = laneBajo(ev.clientX, ev.clientY);
          R.onBorradorCambia({
            inicioMin: nuevoIni,
            ...(lane ? { fecha: lane.fecha, staffId: lane.staffId } : {}),
          });
        } else if (cur.accion === "abajo") {
          const fin = Math.max(cur.inicio0 + SNAP_MIN, snap(cur.inicio0 + cur.dur0 + (ev.clientY - cur.startY) / PX_MIN));
          R.onBorradorCambia({ duracionMin: fin - cur.inicio0 });
        } else {
          const ini = Math.min(clampIni(snap(cur.inicio0 + (ev.clientY - cur.startY) / PX_MIN)), cur.inicio0 + cur.dur0 - SNAP_MIN);
          R.onBorradorCambia({ inicioMin: ini, duracionMin: cur.inicio0 + cur.dur0 - ini });
        }
      }
      setGestoVista({ ...cur });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      const cur = gestoRef.current;
      gestoRef.current = null;
      setGestoVista(null);
      if (!cur) return;
      const R = refsGesto.current;
      if (cur.tipo === "mover") {
        if (!cur.movio) { R.onCita?.(cur.cita, cur.origen); return; }
        if (!R.onMoverSolicitado) return;
        const destino = laneBajo(ev.clientX, ev.clientY) ?? cur.origen;
        const horaMin = clampIni(snap(cur.cita.inicioMin + cur.deltaY / PX_MIN));
        if (destino.key === cur.origen.key && horaMin === cur.cita.inicioMin) return;
        R.onMoverSolicitado(cur.cita, cur.origen, { fecha: destino.fecha, staffId: destino.staffId, horaMin });
      } else if (cur.tipo === "resize") {
        const finViejo = cur.cita.finMin ?? cur.cita.inicioMin + 30;
        if (cur.nuevoIni === cur.cita.inicioMin && cur.nuevoFin === finViejo) return;
        R.onResizeSolicitado?.(cur.cita, cur.carril, cur.nuevoIni, cur.nuevoFin - cur.nuevoIni);
      } else if (cur.tipo === "dibujo") {
        const ini = Math.min(cur.inicioMin, cur.actualMin);
        const dur = Math.max(30, Math.abs(cur.actualMin - cur.inicioMin)); // clic suelto = 30 min
        R.onCrear?.(cur.carril, ini, dur);
      }
      // borrador: los cambios ya se aplicaron en vivo.
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  return (
    <>
      <LeyendaCarriles />
      {/* w-0 min-w-full: el min-content de los carriles NO se propaga al
          shell (su flex item sin min-w-0 no encogería y la agenda se
          pintaría recortada sin scroll — visto a 1280 en Semana). */}
      <div className="w-0 min-w-full overflow-x-auto">
        <div className="flex min-w-fit select-none pb-4">
          {/* Columna de horas (sticky al scroll horizontal) */}
          <div className="sticky left-0 z-10 w-14 shrink-0 bg-[var(--color-surface)]">
            <div className="h-14" />
            <div className="relative" style={{ height: alto + 10 }}>
              {horas.map((h) => (
                <span key={h} className="absolute right-2.5 -translate-y-1/2 text-[10px] text-[var(--color-muted)] opacity-70 [font-variant-numeric:tabular-nums]" style={{ top: y(h) }}>
                  {deMin(h)}
                </span>
              ))}
            </div>
          </div>

          {lanes.map((carril) => {
            const { key, titulo, tituloCompleto, subtitulo, diaNumero, destacado, ocultaEnMovil, onTitulo, pd } = carril;
            const g = gestoVista;
            const esDestinoDeDrag = g?.tipo === "mover" && g.movio && g.overKey === key;
            const esHoyCarril = carril.fecha === hoyVivo;
            const ahoraVisible = esHoyCarril && ahoraMin >= ejeMin && ahoraMin <= ejeMax;
            const borradorAqui = borrador && borrador.staffId === carril.staffId && borrador.fecha === carril.fecha;
            return (
            <div key={key} className={`min-w-[9.5rem] flex-1 basis-[9.5rem] px-1 ${ocultaEnMovil ? "hidden lg:block" : ""}`}>
              {diaNumero !== undefined ? (
                <div className="flex h-14 flex-col items-center justify-center gap-0.5">
                  <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-muted)]">{titulo}</p>
                  <p className={`flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-semibold [font-variant-numeric:tabular-nums] ${
                    destacado ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]" : "text-[var(--color-foreground)]"
                  }`}>
                    {diaNumero}
                  </p>
                </div>
              ) : (
                <div className="flex h-14 flex-col justify-center px-1.5">
                  {onTitulo ? (
                    <button
                      type="button"
                      onClick={onTitulo}
                      title={`Ver la semana de ${tituloCompleto ?? titulo}`}
                      className={`truncate text-left text-[13px] font-semibold hover:text-[var(--color-accent)] hover:underline ${destacado ? "text-[var(--color-accent)]" : "text-[var(--color-foreground)]"}`}
                    >
                      {titulo}
                    </button>
                  ) : (
                    <p title={tituloCompleto ?? undefined} className={`truncate text-[13px] font-semibold ${destacado ? "text-[var(--color-accent)]" : "text-[var(--color-foreground)]"}`}>{titulo}</p>
                  )}
                  {subtitulo && <p className="truncate text-[10px] text-[var(--color-muted)]">{subtitulo}</p>}
                </div>
              )}
              <div
                ref={(el) => { laneEls.current[key] = el; }}
                data-lane={key}
                onPointerDown={
                  onCrear
                    ? (e) => {
                        if ((e.target as HTMLElement).closest("[data-bloque],[data-borrador]")) return;
                        iniciarGesto({ tipo: "dibujo", carril, inicioMin: minEnLane(key, e.clientY), actualMin: minEnLane(key, e.clientY) }, e);
                      }
                    : undefined
                }
                title={onCrear ? "Arrastra o haz clic para crear una cita" : undefined}
                className={`relative rounded-lg bg-[var(--color-surface-muted)] ${esDestinoDeDrag ? "ring-2 ring-[var(--color-accent)]" : ""}`}
                style={{
                  height: alto,
                  backgroundImage: "repeating-linear-gradient(135deg, transparent 0 7px, var(--color-border) 7px 8px)",
                }}
              >
                {/* Horario laboral: superficie limpia = trabaja */}
                {pd.franjas.map((f, i) => (
                  <div key={`f${i}`} className="absolute inset-x-0 bg-[var(--color-surface)]"
                    style={{ top: y(aMin(f.inicio)), height: (aMin(f.fin) - aMin(f.inicio)) * PX_MIN }} />
                ))}
                {/* Estructura: horas nítidas, medias horas sutiles */}
                {horas.map((h) => (
                  <div key={h}>
                    <div className="pointer-events-none absolute inset-x-0 border-t border-[var(--color-border)] opacity-70" style={{ top: y(h) }} />
                    {h + 30 < ejeMax && (
                      <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--color-border)] opacity-30" style={{ top: y(h + 30) }} />
                    )}
                  </div>
                ))}
                {/* Huecos libres — sin coletilla por bloque: el aviso es ÚNICO, arriba */}
                {(pd.libres ?? []).map((l, i) => (
                  <div key={`l${i}`}
                    className="pointer-events-none absolute inset-x-1 rounded border border-dashed border-[var(--color-warning)]/70 px-1.5 py-1"
                    style={{ top: y(l.inicio) + 1, height: Math.max(20, (l.fin - l.inicio) * PX_MIN - 2) }}>
                    <p className="text-[10px] font-medium leading-tight text-[var(--color-warning)] [font-variant-numeric:tabular-nums]">
                      {deMin(l.inicio)}–{deMin(l.fin)} libre
                    </p>
                  </div>
                ))}
                {pd.libres === null && pd.franjas.length > 0 && (
                  <p className="absolute inset-x-1.5 top-1 text-[9.5px] text-[var(--color-warning)]">
                    Cita sin duración: los huecos no se pueden afirmar.
                  </p>
                )}
                {/* Bloqueos */}
                {pd.bloqueos.map((b, i) => (
                  <div key={`b${i}`} data-bloque
                    className="absolute inset-x-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-1"
                    style={{ top: y(b.inicio) + 1, height: Math.max(20, (b.fin - b.inicio) * PX_MIN - 2) }}>
                    <p className="truncate text-[10px] text-[var(--color-muted)]">
                      <span className="[font-variant-numeric:tabular-nums]">{deMin(b.inicio)}–{deMin(b.fin)}</span> {b.motivo ?? "bloqueado"}
                    </p>
                  </div>
                ))}
                {/* El bloque que se está DIBUJANDO */}
                {g?.tipo === "dibujo" && g.carril.key === key && (
                  <div className="pointer-events-none absolute inset-x-1 z-20 rounded border-2 border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-1.5 py-1"
                    style={{
                      top: y(Math.min(g.inicioMin, g.actualMin)),
                      height: Math.max(SNAP_MIN * PX_MIN, Math.abs(g.actualMin - g.inicioMin) * PX_MIN),
                    }}>
                    <p className="text-[10.5px] font-semibold leading-tight text-[var(--color-accent)] [font-variant-numeric:tabular-nums]">
                      {deMin(Math.min(g.inicioMin, g.actualMin))}–{deMin(Math.max(g.inicioMin, g.actualMin, Math.min(g.inicioMin, g.actualMin) + 30))}
                    </p>
                    <p className="text-[9.5px] leading-tight text-[var(--color-accent)] opacity-80">Nueva cita…</p>
                  </div>
                )}
                {/* EL BORRADOR: el bloque del editor flotante — arrastrable y estirable */}
                {borradorAqui && (
                  <div
                    data-borrador
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      iniciarGesto({ tipo: "borrador", accion: "mover", startX: e.clientX, startY: e.clientY, inicio0: borrador!.inicioMin, dur0: borrador!.duracionMin }, e);
                    }}
                    className={`absolute inset-x-1 z-30 cursor-grab rounded border-2 border-[var(--color-accent)] bg-[var(--color-accent)] px-1.5 py-1 shadow-lg active:cursor-grabbing ${g?.tipo === "borrador" ? "opacity-90" : ""}`}
                    style={{ top: y(borrador!.inicioMin), height: Math.max(26, borrador!.duracionMin * PX_MIN), touchAction: "none", ...(g?.tipo === "borrador" && g.accion === "mover" ? { pointerEvents: "none" as const } : {}) }}
                  >
                    <div
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        iniciarGesto({ tipo: "borrador", accion: "arriba", startX: e.clientX, startY: e.clientY, inicio0: borrador!.inicioMin, dur0: borrador!.duracionMin }, e);
                      }}
                      className="absolute inset-x-0 -top-1 h-2.5 cursor-ns-resize"
                    />
                    <p className="truncate text-[11px] font-semibold leading-tight text-[var(--color-on-accent)]">
                      {borrador!.nombre.trim() || "Nueva cita"}
                    </p>
                    <p className="text-[10px] leading-tight text-[var(--color-on-accent)] opacity-90 [font-variant-numeric:tabular-nums]">
                      {deMin(borrador!.inicioMin)}–{deMin(borrador!.inicioMin + borrador!.duracionMin)}
                    </p>
                    <div
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        iniciarGesto({ tipo: "borrador", accion: "abajo", startX: e.clientX, startY: e.clientY, inicio0: borrador!.inicioMin, dur0: borrador!.duracionMin }, e);
                      }}
                      className="absolute inset-x-0 -bottom-1 h-2.5 cursor-ns-resize"
                    />
                  </div>
                )}
                {/* Citas */}
                {pd.citas.map((c) => {
                  const arrastrable = c.esFyllio && Boolean(onMoverSolicitado);
                  const estirable = c.esFyllio && Boolean(onResizeSolicitado);
                  const enMover = g?.tipo === "mover" && g.cita.id === c.id && g.movio;
                  const enResize = g?.tipo === "resize" && g.cita.id === c.id;
                  const iniVis = enResize ? (g as Extract<Gesto, { tipo: "resize" }>).nuevoIni : c.inicioMin;
                  const finVis = enResize
                    ? (g as Extract<Gesto, { tipo: "resize" }>).nuevoFin
                    : (c.finMin ?? c.inicioMin + 30);
                  const altura = Math.max(26, (finVis - iniVis) * PX_MIN - 2);
                  const dosLineas = altura >= 40;
                  const horaVis = enMover
                    ? deMin(clampIni(snap(c.inicioMin + (g as Extract<Gesto, { tipo: "mover" }>).deltaY / PX_MIN)))
                    : deMin(iniVis);
                  const est = BLOQUE_ESTADO[c.estado] ?? { bg: "var(--color-surface)", fg: "var(--color-foreground)", borde: "var(--color-border)" };
                  return (
                  <div
                    key={c.id}
                    data-bloque
                    role={onCita ? "button" : undefined}
                    tabIndex={onCita ? 0 : undefined}
                    onPointerDown={
                      arrastrable
                        ? (e) => {
                            e.stopPropagation();
                            iniciarGesto({ tipo: "mover", cita: c, origen: carril, startX: e.clientX, startY: e.clientY, deltaX: 0, deltaY: 0, overKey: key, movio: false }, e);
                          }
                        : undefined
                    }
                    onClick={onCita && !arrastrable ? () => onCita(c, carril) : undefined}
                    title={c.esFyllio ? "Clic: estado y ficha · arrastra para mover · estira los bordes para cambiar la duración" : "Clic: estado y ficha (se mueve en tu software clínico)"}
                    className={`absolute inset-x-1 overflow-hidden rounded px-2 py-1 shadow-sm ${onCita || arrastrable ? "hover:brightness-[1.06] hover:shadow-md" : ""} ${arrastrable ? "cursor-grab active:cursor-grabbing" : onCita ? "cursor-pointer" : ""} ${enMover || enResize ? "z-30 ring-2 ring-[var(--color-danger)]/0 opacity-90 shadow-lg" : ""}`}
                    style={{
                      top: y(iniVis) + 1,
                      height: altura,
                      background: est.bg,
                      color: est.fg,
                      ...(est.borde ? { border: `1px solid ${est.borde}` } : {}),
                      ...(arrastrable ? { touchAction: "none" as const } : {}),
                      ...(enMover ? { transform: `translate(${(g as Extract<Gesto, { tipo: "mover" }>).deltaX}px, ${(g as Extract<Gesto, { tipo: "mover" }>).deltaY}px)`, pointerEvents: "none" as const } : {}),
                    }}
                  >
                    {estirable && (
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          iniciarGesto({ tipo: "resize", cita: c, carril, borde: "arriba", startY: e.clientY, nuevoIni: c.inicioMin, nuevoFin: c.finMin ?? c.inicioMin + 30 }, e);
                        }}
                        className="absolute inset-x-0 top-0 h-2 cursor-ns-resize"
                        style={{ touchAction: "none" }}
                      />
                    )}
                    <p className="truncate text-[11px] font-semibold leading-tight">
                      {dosLineas ? (c.nombre ?? "—") : (
                        <>
                          <span className="[font-variant-numeric:tabular-nums]">{horaVis}</span> {c.nombre ?? "—"}
                        </>
                      )}
                    </p>
                    {dosLineas && (
                      <p className="truncate text-[10px] leading-tight opacity-85 [font-variant-numeric:tabular-nums]">
                        {horaVis}–{deMin(finVis + (enMover ? snap((g as Extract<Gesto, { tipo: "mover" }>).deltaY / PX_MIN) : 0))}
                        {c.tratamiento ? ` · ${c.tratamiento}` : ""}
                      </p>
                    )}
                    {c.finMin === null && <p className="text-[9.5px] leading-tight opacity-90">sin duración</p>}
                    {estirable && (
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          iniciarGesto({ tipo: "resize", cita: c, carril, borde: "abajo", startY: e.clientY, nuevoIni: c.inicioMin, nuevoFin: c.finMin ?? c.inicioMin + 30 }, e);
                        }}
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                        style={{ touchAction: "none" }}
                      />
                    )}
                  </div>
                  );
                })}
                {/* La línea de AHORA */}
                {ahoraVisible && (
                  <div data-ahora className="pointer-events-none absolute inset-x-0 z-20" style={{ top: y(ahoraMin) }}>
                    <div className="relative border-t-2 border-[var(--color-danger)]">
                      <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-[var(--color-danger)]" />
                    </div>
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ─── DÍA: un carril por doctor ──────────────────────────────────────────────

type PropsCarrilesComunes = {
  ejeBase: { min: number; max: number } | null;
  hoy: string;
  borrador: BorradorCita | null;
  onBorradorCambia?: (patch: Partial<BorradorCita>) => void;
  onCita?: (c: CitaDia, carril: Carril) => void;
  onCrear?: (carril: { fecha: string; staffId: string }, inicioMin: number, duracionMin: number) => void;
  onMoverSolicitado?: (c: CitaDia, origen: Carril, destino: DestinoMovimiento) => void;
  onResizeSolicitado?: (c: CitaDia, carril: Carril, inicioMin: number, duracionMin: number) => void;
};

function VistaDia({
  dia,
  visibles,
  docMovil,
  onDocMovil,
  onVerSemana,
  ejeBase,
  hoy,
  borrador,
  onBorradorCambia,
  onCita,
  onCrear,
  onMoverSolicitado,
  onResizeSolicitado,
}: {
  dia: { fecha: string; porDoctor: PorDoctor[] } | null;
  visibles: DoctorSemana[];
  docMovil: string;
  onDocMovil: (id: string) => void;
  onVerSemana: (staffId: string) => void;
} & PropsCarrilesComunes) {
  if (!dia) {
    // El día activo cayó fuera de la semana cargada (transición de fetch).
    return <div className="h-[28rem] animate-pulse rounded-xl bg-[var(--color-surface-muted)]" />;
  }
  const lanes: Carril[] = visibles
    .map((doc) => ({ doc, pd: dia.porDoctor.find((p) => p.staffId === doc.id) }))
    .filter((l): l is { doc: DoctorSemana; pd: PorDoctor } => l.pd !== undefined)
    .map(({ doc, pd }) => ({
      key: doc.id,
      titulo: nombreCortoDoctor(doc.nombre),
      tituloCompleto: doc.nombre,
      subtitulo: doc.clinicaNombre,
      ocultaEnMovil: doc.id !== docMovil,
      onTitulo: () => onVerSemana(doc.id),
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
          className="mb-2 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-[var(--color-foreground)] lg:hidden"
        >
          {visibles.map((doc) => <option key={doc.id} value={doc.id}>{doc.nombre}</option>)}
        </select>
      )}
      <Carriles lanes={lanes} ejeBase={ejeBase} hoy={hoy} borrador={borrador} onBorradorCambia={onBorradorCambia} onCita={onCita} onCrear={onCrear} onMoverSolicitado={onMoverSolicitado} onResizeSolicitado={onResizeSolicitado} />
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
  borrador,
  onBorradorCambia,
  onCita,
  onCrear,
  onMoverSolicitado,
  onResizeSolicitado,
}: {
  data: Semana;
  visibles: DoctorSemana[];
  docSemana: string;
  onDocSemana: (id: string) => void;
} & PropsCarrilesComunes) {
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
      titulo: LABEL_DIA[diaSemanaISO(dia.fecha)],
      diaNumero: Number(dia.fecha.slice(8)),
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
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-accent)]"
        >
          {visibles.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </select>
        {doc.clinicaNombre && <span className="text-[11px] text-[var(--color-muted)]">{doc.clinicaNombre}</span>}
      </div>
      <Carriles lanes={lanes} ejeBase={ejeBase} hoy={hoy} borrador={borrador} onBorradorCambia={onBorradorCambia} onCita={onCita} onCrear={onCrear} onMoverSolicitado={onMoverSolicitado} onResizeSolicitado={onResizeSolicitado} />
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
  onVerSemana,
}: {
  data: Semana;
  visibles: DoctorSemana[];
  hoy: string;
  onCita?: (c: CitaDia, carril: { fecha: string; staffId: string }) => void;
  onVerSemana: (staffId: string) => void;
}) {
  const nombreDe = (id: string) => data.doctores.find((d) => d.id === id)?.nombre ?? "—";
  return (
    <div className="grid gap-3 lg:grid-cols-7">
      {data.dias.map((dia) => {
        const esHoy = dia.fecha === hoy;
        const bloques = dia.porDoctor.filter((pd) => visibles.some((v) => v.id === pd.staffId));
        return (
          <Card key={dia.fecha} padding="none" className={`px-2 pb-2 pt-1.5 ${esHoy ? "ring-2 ring-[var(--color-accent)]" : ""}`}>
            {/* Cabecera de día como la Semana: estructura pequeña, dato grande */}
            <div className="mb-2 flex flex-col items-center gap-0.5">
              <p className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-muted)]">
                {LABEL_DIA[diaSemanaISO(dia.fecha)]}
              </p>
              <p className={`flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-semibold [font-variant-numeric:tabular-nums] ${
                esHoy ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]" : "text-[var(--color-foreground)]"
              }`}>
                {Number(dia.fecha.slice(8))}
              </p>
            </div>
            <div className="space-y-2">
              {bloques.map((pd) => (
                <RecuadroDoctorDia key={pd.staffId} pd={pd} nombre={nombreDe(pd.staffId)} fecha={dia.fecha} onCita={onCita} onVerSemana={onVerSemana} />
              ))}
              {bloques.length === 0 && <p className="text-center text-[10.5px] text-[var(--color-muted)]">—</p>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function RecuadroDoctorDia({
  pd,
  nombre,
  fecha,
  onCita,
  onVerSemana,
}: {
  pd: PorDoctor;
  nombre: string;
  fecha: string;
  onCita?: (c: CitaDia, carril: { fecha: string; staffId: string }) => void;
  onVerSemana: (staffId: string) => void;
}) {
  const trabaja = pd.franjas.length > 0;
  const sinPasar = pd.citas.filter((c) => c.sinPasar).length;
  const resumen = resumenDeAgendaDia({ trabaja, nCitas: pd.citas.length, libres: pd.libres });
  const vacio = !trabaja && pd.citas.length === 0 && pd.bloqueos.length === 0;

  // Un día sin nada no tiene detalle que desplegar: el resumen ES todo.
  if (vacio) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] px-2.5 py-2">
        <button type="button" onClick={() => onVerSemana(pd.staffId)} title={`Ver la semana de ${nombre}`}
          className="block max-w-full truncate text-[11.5px] font-semibold text-[var(--color-foreground)] hover:text-[var(--color-accent)] hover:underline">
          {nombre}
        </button>
        <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">{resumen.nota}</p>
      </div>
    );
  }

  // Jerarquía dictada (30-08): lo esencial — y las horas LIBRES destacan
  // sobre el resto. Las horas concretas viven en el detalle, no aquí.
  // Jerarquía dictada (30-08, 2ª pasada): el dato libre en COLOR PROPIO (el
  // acento), no en negro — es lo que se busca al escanear. El resto, apagado.
  const ESTILO_LIBRES = {
    destacado: "text-[13px] font-semibold text-[var(--color-accent)]",
    apagado: "text-[10.5px] text-[var(--color-muted)]",
    aviso: "text-[10.5px] font-medium text-[var(--color-warning)]",
  } as const;

  return (
    <details className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] transition-shadow hover:shadow-sm">
      <summary className="cursor-pointer list-none px-2.5 py-2 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-1">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onVerSemana(pd.staffId); }}
            title={`Ver la semana de ${nombre}`}
            className="truncate text-left text-[11.5px] font-semibold text-[var(--color-foreground)] hover:text-[var(--color-accent)] hover:underline"
          >
            {nombre}
          </button>
          <ChevronDown size={11} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-muted)] transition-transform group-open:rotate-180" aria-hidden />
        </div>
        {resumen.libres && (
          <p className={`mt-1 ${ESTILO_LIBRES[resumen.libres.enfasis]}`} title={resumen.libres.enfasis === "destacado" ? AVISO_HUECOS : undefined}>
            {resumen.libres.texto}
          </p>
        )}
        <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-muted)]">
          {resumen.citas}
          {resumen.fueraDeHorario && " · fuera de su horario"}
        </p>
        {sinPasar > 0 && (
          <p className="mt-1 inline-flex rounded-full bg-[var(--color-warning)]/15 px-1.5 py-px text-[9.5px] font-semibold text-[var(--color-warning)]">
            {sinPasar === 1 ? "1 sin pasar a tu software" : `${sinPasar} sin pasar a tu software`}
          </p>
        )}
      </summary>
      <div className="space-y-1 border-t border-[var(--color-border)] px-2 py-1.5">
        {pd.citas.map((c) => {
          const est = BLOQUE_ESTADO[c.estado] ?? { bg: "var(--color-surface)", fg: "var(--color-foreground)", borde: "var(--color-border)" };
          return (
          <div key={c.id}
            role={onCita ? "button" : undefined}
            onClick={onCita ? () => onCita(c, { fecha, staffId: pd.staffId }) : undefined}
            title={c.esFyllio ? "Clic: estado y ficha" : "Clic: estado y ficha (se mueve en tu software clínico)"}
            className={`rounded px-2 py-1 text-[10.5px] leading-tight shadow-sm ${onCita ? "cursor-pointer hover:brightness-[1.06]" : ""}`}
            style={{ background: est.bg, color: est.fg, ...(est.borde ? { border: `1px solid ${est.borde}` } : {}) }}>
            <span className="font-semibold [font-variant-numeric:tabular-nums]">
              {deMin(c.inicioMin)}{c.finMin !== null ? `–${deMin(c.finMin)}` : ""}
            </span>{" "}
            {c.nombre ?? "—"}
            {c.sinPasar && <span className="opacity-90"> · sin pasar</span>}
            {c.finMin === null && <span className="opacity-90"> · sin duración</span>}
          </div>
          );
        })}
        {pd.bloqueos.map((b, i) => (
          <div key={`b${i}`} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-1.5 py-1 text-[10.5px] text-[var(--color-muted)]">
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
              className="rounded border border-dashed border-[var(--color-warning)] px-1.5 py-1 text-[10.5px] text-[var(--color-warning)]">
              <span className="[font-variant-numeric:tabular-nums]">{deMin(l.inicio)}–{deMin(l.fin)}</span> libre
            </div>
          ))
        )}
      </div>
    </details>
  );
}
