"use client";

// AGENDA G2 — la ventana de agenda, NIVEL 1.
//
// Tres decisiones dictadas que esta vista encarna:
//   · La agenda de Fyllio NO es la agenda real de la clínica: el aviso es
//     fijo, no un tooltip. Lo libre es libre EN LO QUE FYLLIO CONOCE.
//   · Cada doctor tiene su agenda y se puede ver SOLA (filtro doctor); el
//     filtro por especialidad enseña la disponibilidad CONJUNTA de sus
//     doctores — y cada hueco lleva el nombre del suyo («martes 16:00 con la
//     Dra. Ruiz»), nunca una hora anónima.
//   · «Cerradas en Fyllio, pendientes de pasar a tu software» resuelve un
//     olvido que existe HOY: cerrar aquí y no pasarla. Con enlace a la
//     conversación y marca reversible.
//
// Un día con una cita sin duración no afirma huecos (libres=null del API):
// se dice el motivo, no se pinta un hueco que puede mentir (§4).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card } from "../../components/ui/Card";
import { cargarJSON } from "../../lib/fetch-json";
import { hoyISO, sumaDias } from "../../lib/time";
import { deMin, diaSemanaISO } from "../../lib/agenda/disponibilidad";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Info,
  MessageCircle,
  Check,
  AlertTriangle,
  RefreshCw,
  ICON_STROKE,
} from "../../components/icons";

type DoctorSemana = {
  id: string; nombre: string; clinicaId: string | null; clinicaNombre: string | null;
  especialidadIds: string[]; sinHorario: boolean;
};
type CitaDia = { id: string; inicioMin: number; finMin: number | null; nombre: string | null; estado: string; tratamiento: string | null; deLead: boolean };
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
  pendientes: Pendiente[];
};

const lunesDe = (fecha: string) => sumaDias(fecha, 1 - diaSemanaISO(fecha));
const LABEL_DIA = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const ESTILO_ESTADO: Record<string, string> = {
  Confirmada: "border-transparent bg-[var(--color-success-soft)] text-[var(--color-success)]",
  Programada: "border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  Completado: "border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-muted)]",
};

export function AgendaView() {
  const hoy = hoyISO();
  const [desde, setDesde] = useState(() => lunesDe(hoyISO()));
  const [data, setData] = useState<Semana | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [filtroEsp, setFiltroEsp] = useState("");
  const [filtroDoc, setFiltroDoc] = useState("");

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

  // Doctores visibles: el filtro por doctor manda; el de especialidad enseña
  // la plantilla conjunta de esa especialidad.
  const visibles = useMemo(() => {
    if (!data) return [];
    let ds = data.doctores;
    if (filtroDoc) ds = ds.filter((d) => d.id === filtroDoc);
    else if (filtroEsp) ds = ds.filter((d) => d.especialidadIds.includes(filtroEsp));
    return ds;
  }, [data, filtroDoc, filtroEsp]);

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

  return (
    <div className="p-4 sm:p-6">
      {/* Cabecera + aviso de nivel 1 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={20} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
          <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">Agenda</h1>
        </div>
        <div className="flex items-center gap-1.5 rounded-xl bg-[var(--color-accent-soft)] px-3 py-1.5">
          <Info size={13} strokeWidth={ICON_STROKE} className="shrink-0 text-[var(--color-accent)]" aria-hidden />
          <p className="text-[11.5px] text-[var(--color-foreground)]">
            Lo que tenemos aquí — tu software clínico puede tener más. Un hueco es libre solo en lo que Fyllio conoce.
          </p>
        </div>
      </div>

      {/* Controles: semana + filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
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
        {error && data && (
          <button type="button" onClick={() => void cargar(desde)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-danger)] hover:underline">
            <AlertTriangle size={12} strokeWidth={ICON_STROKE} aria-hidden /> No se pudo actualizar — reintentar
          </button>
        )}
      </div>

      {/* La semana */}
      {!data && cargando ? (
        <div className="grid gap-2 lg:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-2xl bg-[var(--color-surface-muted)]" />
          ))}
        </div>
      ) : data ? (
        <div className={`grid gap-2 lg:grid-cols-7 ${cargando ? "opacity-60" : ""}`}>
          {data.dias.map((dia) => {
            const esHoy = dia.fecha === hoy;
            const bloques = dia.porDoctor.filter((pd) => visibles.some((v) => v.id === pd.staffId));
            const nombreDe = (id: string) => data.doctores.find((d) => d.id === id)?.nombre ?? "—";
            return (
              <Card key={dia.fecha} padding="none" className={`px-2.5 py-2 ${esHoy ? "ring-1 ring-[var(--color-accent)]" : ""}`}>
                <p className={`mb-1.5 text-[11px] font-semibold uppercase tracking-wide ${esHoy ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"}`}>
                  {LABEL_DIA[diaSemanaISO(dia.fecha)]} {dia.fecha.slice(8)}
                  {esHoy && " · hoy"}
                </p>
                <div className="space-y-2">
                  {bloques.map((pd) => {
                    // Una cita CONSTA aunque el doctor no tenga franjas ese
                    // día (agendada fuera de horario, o sin horario aún): se
                    // enseña siempre — «no trabaja» solo cuando no hay nada.
                    const trabaja = pd.franjas.length > 0;
                    const hayAlgo = pd.citas.length > 0 || pd.bloqueos.length > 0;
                    return (
                      <div key={pd.staffId}>
                        {visibles.length > 1 && (
                          <p className="mb-0.5 truncate text-[10.5px] font-semibold text-[var(--color-foreground)]">{nombreDe(pd.staffId)}</p>
                        )}
                        {!trabaja && !hayAlgo ? (
                          <p className="text-[10.5px] text-[var(--color-muted)]">no trabaja</p>
                        ) : (
                          <div className="space-y-1">
                            {pd.citas.map((c) => (
                              <div key={c.id}
                                className={`rounded-lg border px-1.5 py-1 text-[10.5px] leading-tight ${ESTILO_ESTADO[c.estado] ?? "border-[var(--color-border)] text-[var(--color-foreground)]"}`}>
                                <span className="font-semibold [font-variant-numeric:tabular-nums]">
                                  {deMin(c.inicioMin)}{c.finMin !== null ? `–${deMin(c.finMin)}` : ""}
                                </span>{" "}
                                {c.nombre ?? "—"}
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
                                  className="rounded-lg border border-dashed border-[var(--color-accent)] px-1.5 py-1 text-[10.5px] text-[var(--color-accent)]">
                                  <span className="[font-variant-numeric:tabular-nums]">{deMin(l.inicio)}–{deMin(l.fin)}</span> libre
                                  {visibles.length > 1 && <span className="text-[10px]"> · {nombreDe(pd.staffId)}</span>}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {bloques.length === 0 && <p className="text-[10.5px] text-[var(--color-muted)]">—</p>}
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* Avisos de configuración que faltan (sin defaults: se dice, no se rellena) */}
      {data && visibles.some((d) => d.sinHorario) && (
        <p className="mt-2 text-[11px] text-[var(--color-warning)]">
          Sin horario configurado: {visibles.filter((d) => d.sinHorario).map((d) => d.nombre).join(" · ")} —{" "}
          <Link href="/ajustes/agenda" className="font-semibold underline">configurar en Ajustes</Link>.
        </p>
      )}

      {/* Cerradas en Fyllio, pendientes de pasar */}
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
    </div>
  );
}
