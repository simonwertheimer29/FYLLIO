"use client";

// G3 — AGENDAR DESDE LA FICHA DEL CASO. La pieza que ahorra el viaje: la
// coordinadora tiene la conversación abierta, sabe qué quiere el paciente, y
// cierra la cita AQUÍ — sin irse a la agenda ni al kanban.
//
// PANEL FLOTANTE, no modal (regla del estándar, dictada 31-08): lo que hay
// detrás es el CONTEXTO de la decisión — la conversación se sigue leyendo y
// scrolleando mientras se elige hueco. Por eso no oscurece ni se cierra al
// clicar fuera; oscurecer queda para lo que exige atención exclusiva.
//
// Decisiones que hereda (todas dictadas en la serie G):
//  · Los huecos se ENSEÑAN también en nivel 1, con el AVISO PEGADO a ellos
//    (AVISO_HUECOS) — Fyllio calcula sobre su configuración, no sobre el
//    software real de la clínica.
//  · La duración sale del CATÁLOGO (tipo de cita). Sin tipo elegido no hay
//    slots: sin duración no se afirman huecos (motor, §4).
//  · `libres: null` (una cita sin duración ese día) se dice con su motivo,
//    jamás se pinta un hueco inventado.
//  · Escribir pasa por PATCH /api/leads/[id] — el MISMO camino que el kanban:
//    mueve el lead a Citado y upsertea la cita real (única por lead_id).
//    Cero rutas nuevas de escritura.
//
// Reutiliza el payload de /api/agenda/semana entero (doctores, franjas,
// citas, libres, catálogo): un fetch por semana visible, el troceo en slots
// es del motor puro en cliente.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cargarJSON, mensajeDeError } from "../../lib/fetch-json";
import { hoyISO, sumaDias } from "../../lib/time";
import { deMin, diaSemanaISO, trocearEnSlots, type IntervaloMin, type FranjaDia } from "../../lib/agenda/disponibilidad";
import { AVISO_HUECOS } from "../../lib/agenda/avisos";
import { fechaCorta, diaMesCorto } from "../../lib/agenda/fechas";
import { nombreCortoDoctor } from "../../lib/agenda/nombres";
import { ErrorState } from "../ui/Feedback";
import { AlertTriangle, ChevronLeft, ChevronRight, X, ICON_STROKE } from "../icons";

type LeadDeFicha = {
  id: string;
  nombre: string;
  estado: string;
  fechaCita: string | null;
  horaCita: string | null;
  doctorAsignadoId: string | null;
};

// Espejo mínimo del payload de /api/agenda/semana (el servidor manda más;
// aquí solo la forma que este modal lee).
type Semana = {
  desde: string;
  doctores: Array<{ id: string; nombre: string; clinicaNombre: string | null; sinHorario: boolean }>;
  dias: Array<{
    fecha: string;
    porDoctor: Array<{
      staffId: string;
      franjas: FranjaDia[];
      libres: IntervaloMin[] | null;
    }>;
  }>;
  tratamientos: Array<{ id: string; nombre: string; duracionMin: number | null }>;
};

/** Lunes de la semana de `fecha` — el API de semana pagina de 7 en 7. */
function lunesDe(fecha: string): string {
  return sumaDias(fecha, 1 - diaSemanaISO(fecha));
}

export function AgendarLeadPanel({
  lead,
  onClose,
  onHecho,
}: {
  lead: LeadDeFicha;
  onClose: () => void;
  /** Cita cerrada: el caller recarga su ficha/cola. */
  onHecho: () => void;
}) {
  const yaCitado = lead.fechaCita != null;
  const [desde, setDesde] = useState(() => lunesDe(lead.fechaCita ?? hoyISO()));
  const [fecha, setFecha] = useState(() => lead.fechaCita ?? hoyISO());
  const [doctorId, setDoctorId] = useState<string | null>(lead.doctorAsignadoId);
  const [tratamientoId, setTratamientoId] = useState<string | null>(null);
  const [slot, setSlot] = useState<IntervaloMin | null>(null);
  const [semana, setSemana] = useState<Semana | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const d = await cargarJSON<Semana>(`/api/agenda/semana?desde=${desde}`);
      setSemana(d);
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }, [desde]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Cerrar con Escape — el modal tapa la conversación; salir tiene que ser
  // inmediato.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Doctor efectivo: el asignado del lead si sigue existiendo; si no, se
  // exige elegir (no «el primero de la lista» — la cita es de un doctor).
  const doctores = semana?.doctores ?? [];
  const doctor = doctores.find((d) => d.id === doctorId) ?? null;

  const tratamiento = semana?.tratamientos.find((t) => t.id === tratamientoId) ?? null;
  const duracionMin = tratamiento?.duracionMin ?? null;

  const dia = semana?.dias.find((d) => d.fecha === fecha) ?? null;
  const deDoctor = dia && doctor ? dia.porDoctor.find((p) => p.staffId === doctor.id) ?? null : null;

  const slots = useMemo(() => {
    if (!deDoctor || deDoctor.libres === null || duracionMin == null) return null;
    return trocearEnSlots(deDoctor.libres, { duracionMin });
  }, [deDoctor, duracionMin]);

  async function cerrarCita() {
    if (!slot || !doctor || guardando) return;
    setGuardando(true);
    try {
      await cargarJSON(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          estado: "Citado",
          fechaCita: fecha,
          horaCita: deMin(slot.inicio),
          doctorAsignadoId: doctor.id,
          tratamientoAgendaId: tratamientoId,
        }),
      });
      toast.success(
        `${yaCitado ? "Cita movida" : "Cita cerrada"} — ${fechaCorta(fecha)} a las ${deMin(slot.inicio)} con ${nombreCortoDoctor(doctor.nombre)}`,
      );
      onHecho();
      onClose();
    } catch (e) {
      toast.error(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    // Panel FLOTANTE, sin oscurecer (regla del estándar, dictada 31-08): lo
    // que hay detrás es el CONTEXTO de esta decisión — la conversación, la
    // cola de la que salió el caso. Se puede leer y scrollear el hilo
    // mientras se elige hueco; por eso tampoco se cierra al clicar fuera.
    // Oscurecer queda para lo que exige atención exclusiva.
    <div
      className="fixed right-4 top-16 z-50 flex max-h-[calc(100vh-5rem)] w-[30rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
      role="dialog"
      aria-label={`Agendar a ${lead.nombre}`}
    >
        {/* ── Cabecera ── */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
              {yaCitado ? "Mover la cita de" : "Agendar a"} {lead.nombre}
            </h3>
            {yaCitado && lead.fechaCita && (
              <p className="mt-0.5 text-[12.5px] text-[var(--color-muted)]">
                Hoy citado el {fechaCorta(lead.fechaCita)}
                {lead.horaCita ? ` a las ${lead.horaCita}` : ""} — elegir otra hora la mueve.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-lg p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-foreground)]"
          >
            <X size={16} strokeWidth={ICON_STROKE} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && <ErrorState title="No se pudo cargar la agenda" detail={error} onRetry={cargar} />}
          {!error && !semana && (
            <div className="space-y-2.5">
              <div className="fyllio-skeleton h-9" />
              <div className="fyllio-skeleton h-40" />
            </div>
          )}
          {!error && semana && (
            <>
              {/* ── Doctor y tipo de cita ── */}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Doctor</span>
                  <select
                    value={doctorId ?? ""}
                    onChange={(e) => {
                      setDoctorId(e.target.value || null);
                      setSlot(null);
                    }}
                    className="mt-1 h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[13px] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:outline-none"
                  >
                    <option value="">Elige doctor…</option>
                    {doctores.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nombre}
                        {d.clinicaNombre ? ` — ${d.clinicaNombre}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-muted)]">Tipo de cita</span>
                  <select
                    value={tratamientoId ?? ""}
                    onChange={(e) => {
                      setTratamientoId(e.target.value || null);
                      setSlot(null);
                    }}
                    className="mt-1 h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[13px] text-[var(--color-foreground)] focus:border-[var(--color-accent)] focus:outline-none"
                  >
                    <option value="">Elige tipo…</option>
                    {semana.tratamientos.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.nombre}
                        {t.duracionMin != null ? ` · ${t.duracionMin} min` : " · sin duración"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* ── Día: la semana visible, ‹ › pagina ── */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setDesde(sumaDias(desde, -7))}
                  aria-label="Semana anterior"
                  className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
                >
                  <ChevronLeft size={14} strokeWidth={ICON_STROKE} />
                </button>
                <div className="grid min-w-0 flex-1 grid-cols-7 gap-1">
                  {semana.dias.map((d) => (
                    <button
                      key={d.fecha}
                      type="button"
                      onClick={() => {
                        setFecha(d.fecha);
                        setSlot(null);
                      }}
                      className={`rounded-lg px-1 py-1.5 text-center text-[12px] transition-colors ${
                        d.fecha === fecha
                          ? "bg-[var(--color-accent)] font-medium text-[var(--color-on-accent)]"
                          : d.fecha === hoyISO()
                            ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-surface-muted)]"
                            : "text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
                      }`}
                    >
                      {diaMesCorto(d.fecha)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setDesde(sumaDias(desde, 7))}
                  aria-label="Semana siguiente"
                  className="rounded-lg border border-[var(--color-border)] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
                >
                  <ChevronRight size={14} strokeWidth={ICON_STROKE} />
                </button>
              </div>

              {/* ── Los huecos, con el aviso PEGADO (nivel 1, dictado) ── */}
              <div className="rounded-lg border border-[var(--color-border)] p-3">
                <p className="flex items-start gap-1.5 text-[11.5px] text-amber-700 dark:text-amber-300">
                  <AlertTriangle size={13} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0" aria-hidden />
                  {AVISO_HUECOS}
                </p>
                <div className="mt-2.5">
                  {!doctor ? (
                    <p className="py-3 text-center text-[13px] text-[var(--color-muted)]">Elige un doctor para ver sus huecos.</p>
                  ) : doctor.sinHorario ? (
                    <p className="py-3 text-center text-[13px] text-[var(--color-muted)]">
                      {nombreCortoDoctor(doctor.nombre)} no tiene horario configurado — sin él no se calculan huecos. Se configura en Ajustes → Agenda.
                    </p>
                  ) : duracionMin == null ? (
                    <p className="py-3 text-center text-[13px] text-[var(--color-muted)]">
                      {tratamientoId
                        ? "Ese tipo de cita no tiene duración configurada — sin ella no se calculan huecos."
                        : "Elige el tipo de cita: su duración define los huecos."}
                    </p>
                  ) : deDoctor == null || deDoctor.franjas.length === 0 ? (
                    <p className="py-3 text-center text-[13px] text-[var(--color-muted)]">
                      {nombreCortoDoctor(doctor.nombre)} no trabaja el {fechaCorta(fecha).toLowerCase()}.
                    </p>
                  ) : deDoctor.libres === null ? (
                    <p className="py-3 text-center text-[13px] text-[var(--color-muted)]">
                      Ese día hay una cita sin duración en la agenda — no se pueden afirmar huecos.
                    </p>
                  ) : slots!.length === 0 ? (
                    <p className="py-3 text-center text-[13px] text-[var(--color-muted)]">
                      Sin huecos de {duracionMin} min el {fechaCorta(fecha).toLowerCase()} — prueba otro día.
                    </p>
                  ) : (
                    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                      {slots!.map((s) => (
                        <button
                          key={s.inicio}
                          type="button"
                          onClick={() => setSlot(s)}
                          className={`h-9 rounded-lg border text-[13px] tabular-nums transition-colors ${
                            slot?.inicio === s.inicio
                              ? "border-transparent bg-[var(--color-accent)] font-medium text-[var(--color-on-accent)]"
                              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
                          }`}
                        >
                          {deMin(s.inicio)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Pie: el resumen y la acción ── */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <p className="min-w-0 text-[13px] text-[var(--color-muted)]">
            {slot && doctor ? (
              <span className="font-medium text-[var(--color-foreground)]">
                {fechaCorta(fecha)} · {deMin(slot.inicio)}–{deMin(slot.fin)} · {nombreCortoDoctor(doctor.nombre)}
              </span>
            ) : (
              "Elige un hueco."
            )}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[13px] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={cerrarCita}
              disabled={!slot || !doctor || guardando}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[13px] font-medium text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {guardando ? "Guardando…" : yaCitado ? "Mover la cita" : "Cerrar la cita"}
            </button>
          </div>
        </div>
    </div>
  );
}
