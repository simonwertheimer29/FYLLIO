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
import {
  CalendarDays,
  ChevronDown,
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
type CitaDia = { id: string; inicioMin: number; finMin: number | null; nombre: string | null; estado: string; tratamiento: string | null; deLead: boolean; sinPasar: boolean };
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
type Vista = "dia" | "lista";

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
          {([["dia", "Día"], ["lista", "Lista"]] as Array<[Vista, string]>).map(([v, label]) => (
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
            />
          ) : (
            <VistaLista data={data} visibles={visibles} hoy={hoy} />
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
    </div>
  );
}

// ─── DÍA: carriles por doctor ────────────────────────────────────────────────
//
// Horas a la izquierda (sticky), una columna por doctor, agrupadas por
// clínica. Con muchos doctores: scroll horizontal DENTRO del contenedor (la
// página nunca scrollea en horizontal). El sombreado claro es el horario
// laboral del doctor — se ve cuándo trabaja sin ir a su configuración.

const PX_MIN = 1.1; // 1 minuto ≈ 1.1px → una jornada de 12 h ≈ 790px

function VistaDia({
  dia,
  visibles,
  docMovil,
  onDocMovil,
}: {
  dia: { fecha: string; porDoctor: PorDoctor[] } | null;
  visibles: DoctorSemana[];
  docMovil: string;
  onDocMovil: (id: string) => void;
}) {
  if (!dia) {
    // El día activo cayó fuera de la semana cargada (transición de fetch).
    return <div className="h-[28rem] animate-pulse rounded-2xl bg-[var(--color-surface-muted)]" />;
  }
  const lanes = visibles
    .map((doc) => ({ doc, pd: dia.porDoctor.find((p) => p.staffId === doc.id) }))
    .filter((l): l is { doc: DoctorSemana; pd: PorDoctor } => l.pd !== undefined);

  if (lanes.length === 0) {
    return (
      <Card padding="none" className="px-5 py-8 text-center">
        <p className="text-xs text-[var(--color-muted)]">No hay doctores que enseñar con este filtro.</p>
      </Card>
    );
  }

  // Eje vertical: de la primera franja/cita/bloqueo a la última, a horas
  // redondas. Día sin nada: 09:00–20:00 para que el vacío se vea como vacío.
  let ejeMin = Infinity;
  let ejeMax = -Infinity;
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
          {lanes.map(({ doc }) => <option key={doc.id} value={doc.id}>{doc.nombre}</option>)}
        </select>
      )}

      <div className="overflow-x-auto">
        <div className="flex min-w-fit">
          {/* Columna de horas, sticky para que sobreviva al scroll horizontal */}
          <div className="sticky left-0 z-10 w-12 shrink-0 bg-[var(--color-surface)]">
            <div className="h-9" />
            <div className="relative" style={{ height: alto }}>
              {horas.map((h) => (
                <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-[var(--color-muted)] [font-variant-numeric:tabular-nums]" style={{ top: y(h) }}>
                  {deMin(h)}
                </span>
              ))}
            </div>
          </div>

          {lanes.map(({ doc, pd }) => (
            <div
              key={doc.id}
              className={`w-44 min-w-44 flex-1 border-l border-[var(--color-border)] px-1 ${doc.id === docMovil ? "" : "hidden lg:block"}`}
            >
              <div className="flex h-9 flex-col justify-center px-1">
                <p className="truncate text-[11px] font-semibold text-[var(--color-foreground)]">{doc.nombre}</p>
                {doc.clinicaNombre && <p className="truncate text-[9.5px] text-[var(--color-muted)]">{doc.clinicaNombre}</p>}
              </div>
              <div className="relative rounded-lg bg-[var(--color-surface-muted)]" style={{ height: alto }}>
                {/* Rejilla de horas */}
                {horas.map((h) => (
                  <div key={h} className="absolute inset-x-0 border-t border-[var(--color-border)] opacity-50" style={{ top: y(h) }} />
                ))}
                {/* Sombreado del HORARIO LABORAL (todos los niveles): claro =
                    trabaja; el fondo apagado = fuera de su horario. */}
                {pd.franjas.map((f, i) => (
                  <div
                    key={`f${i}`}
                    className="absolute inset-x-0 bg-[var(--color-surface)]"
                    style={{ top: y(aMin(f.inicio)), height: (aMin(f.fin) - aMin(f.inicio)) * PX_MIN }}
                  />
                ))}
                {/* Huecos libres — con la advertencia PEGADA (nivel 1) */}
                {(pd.libres ?? []).map((l, i) => (
                  <div
                    key={`l${i}`}
                    className="absolute inset-x-0.5 rounded-md border border-dashed border-[var(--color-warning)] px-1 py-0.5"
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
                {/* Citas */}
                {pd.citas.map((c) => (
                  <div
                    key={c.id}
                    className={`absolute inset-x-0.5 overflow-hidden rounded-md border px-1 py-0.5 ${ESTILO_ESTADO[c.estado] ?? "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)]"}`}
                    style={{ top: y(c.inicioMin), height: Math.max(22, ((c.finMin ?? c.inicioMin + 30) - c.inicioMin) * PX_MIN) }}
                  >
                    <p className="truncate text-[10px] font-semibold leading-tight">
                      <span className="[font-variant-numeric:tabular-nums]">{deMin(c.inicioMin)}{c.finMin !== null ? `–${deMin(c.finMin)}` : ""}</span> {c.nombre ?? "—"}
                    </p>
                    {c.tratamiento && <p className="truncate text-[9px] leading-tight opacity-80">{c.tratamiento}</p>}
                    {c.finMin === null && <p className="text-[9px] leading-tight text-[var(--color-warning)]">sin duración</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* La frase completa, pegada a la rejilla donde viven los huecos. */}
      {hayHuecosPintados && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--color-warning)]">
          <AlertTriangle size={12} strokeWidth={ICON_STROKE} className="shrink-0" aria-hidden />
          {AVISO_HUECOS} Aquí, libre = libre solo en lo que Fyllio conoce.
        </p>
      )}
    </Card>
  );
}

// ─── LISTA: la semana plegada — un recuadro por doctor y día (G2.2) ─────────
//
// El resumen no repite el detalle: es para escanear una semana de cinco
// doctores sin abrir nada («2 h libres según Fyllio: 16:00 y 18:30» · «sin
// horas libres» · «no trabaja»), con la marca «sin pasar» donde toque. Al
// desplegar, el detalle de siempre.

function VistaLista({ data, visibles, hoy }: { data: Semana; visibles: DoctorSemana[]; hoy: string }) {
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
                  <RecuadroDoctorDia key={pd.staffId} pd={pd} nombre={nombreDe(pd.staffId)} />
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

function RecuadroDoctorDia({ pd, nombre }: { pd: PorDoctor; nombre: string }) {
  const trabaja = pd.franjas.length > 0;
  const sinPasar = pd.citas.filter((c) => c.sinPasar).length;
  const resumen = resumenDeAgendaDia({ trabaja, nCitas: pd.citas.length, libres: pd.libres });
  const vacio = !trabaja && pd.citas.length === 0 && pd.bloqueos.length === 0;

  // Un día sin nada no tiene detalle que desplegar: el resumen ES todo.
  if (vacio) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] px-2 py-1.5">
        <p className="truncate text-[10.5px] font-semibold text-[var(--color-foreground)]">{nombre}</p>
        <p className="text-[10px] text-[var(--color-muted)]">{resumen}</p>
      </div>
    );
  }

  return (
    <details className="group rounded-xl border border-[var(--color-border)]">
      <summary className="cursor-pointer list-none px-2 py-1.5 [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-1">
          <p className="truncate text-[10.5px] font-semibold text-[var(--color-foreground)]">{nombre}</p>
          <ChevronDown size={11} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-[var(--color-muted)] transition-transform group-open:rotate-180" aria-hidden />
        </div>
        <p className="text-[10px] leading-snug text-[var(--color-muted)]">{resumen}</p>
        {sinPasar > 0 && (
          <p className="mt-0.5 inline-flex rounded-full bg-[var(--color-warning)]/15 px-1.5 py-px text-[9.5px] font-semibold text-[var(--color-warning)]">
            {sinPasar === 1 ? "1 sin pasar a tu software" : `${sinPasar} sin pasar a tu software`}
          </p>
        )}
      </summary>
      <div className="space-y-1 border-t border-[var(--color-border)] px-2 py-1.5">
        {pd.citas.map((c) => (
          <div key={c.id}
            className={`rounded-lg border px-1.5 py-1 text-[10.5px] leading-tight ${ESTILO_ESTADO[c.estado] ?? "border-[var(--color-border)] text-[var(--color-foreground)]"}`}>
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
