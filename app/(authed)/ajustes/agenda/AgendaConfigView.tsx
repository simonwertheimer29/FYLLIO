"use client";

// AGENDA G1d — configuración de la agenda (solo admin, guard en el layout).
//
// Cuatro secciones, y una regla dictada que las gobierna: NO hay defaults del
// sector. Un doctor sin horario no tiene huecos; un tratamiento sin duración
// no se puede ofertar. Esta pantalla no rellena nada por su cuenta — enseña
// el hueco y lo dice, porque un horario inventado son citas dobladas.
//
//   1 · Especialidades — y qué doctores atienden cada una (M:N).
//   2 · Horarios por doctor — franjas por día; varias por día = jornada partida.
//   3 · Bloqueos — ausencias y vacaciones, se restan de las franjas.
//   4 · Duración por tratamiento — lo que decide cuántos huecos caben.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card } from "../../../components/ui/Card";
import { cargarJSON } from "../../../lib/fetch-json";
import {
  CalendarDays,
  Clock,
  Plus,
  Stethoscope,
  Trash2,
  Hourglass,
  AlertTriangle,
  RefreshCw,
} from "../../../components/icons";
import { ICON_STROKE } from "../../../components/icons";

type Doctor = { id: string; nombre: string; clinicaId: string | null; clinicaNombre: string | null };
type Especialidad = { id: string; nombre: string; activa: boolean; doctorIds: string[] };
type Franja = { id?: string; staffId: string; diaSemana: number; inicio: string; fin: string };
type Bloqueo = { id: string; staffId: string; inicioISO: string; finISO: string; motivo: string | null };
type Tratamiento = {
  id: string; nombre: string; clinicaId: string | null;
  duracionMin: number | null; bufferAntesMin: number | null; bufferDespuesMin: number | null;
};
type Config = {
  doctores: Doctor[];
  especialidades: Especialidad[];
  horarios: Franja[];
  bloqueos: Bloqueo[];
  tratamientos: Tratamiento[];
};

const DIAS: Array<{ n: number; label: string }> = [
  { n: 1, label: "Lunes" }, { n: 2, label: "Martes" }, { n: 3, label: "Miércoles" },
  { n: 4, label: "Jueves" }, { n: 5, label: "Viernes" }, { n: 6, label: "Sábado" }, { n: 7, label: "Domingo" },
];

const fmtRango = (inicioISO: string, finISO: string) => {
  const f = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
  return `${f.format(new Date(inicioISO))} → ${f.format(new Date(finISO))}`;
};

export default function AgendaConfigView() {
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setError(false);
      const d = await cargarJSON<Config>("/api/agenda/configuracion");
      setConfig(d);
    } catch {
      // caída-declarada: se enseña el error con Reintentar — jamás una config vacía que parezca «sin configurar»
      setError(true);
    }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const guardar = useCallback(async (body: Record<string, unknown>, okMsg: string) => {
    try {
      await cargarJSON("/api/agenda/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast.success(okMsg);
      await cargar();
      return true;
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "No se pudo guardar.");
      return false;
    }
  }, [cargar]);

  if (error) {
    return (
      <Card padding="none" className="mx-auto mt-8 max-w-lg px-6 py-8 text-center">
        <AlertTriangle size={20} strokeWidth={ICON_STROKE} className="mx-auto mb-2 text-[var(--color-danger)]" aria-hidden />
        <p className="text-sm font-semibold text-[var(--color-foreground)]">No se pudo cargar la configuración de agenda</p>
        <button
          type="button"
          onClick={() => void cargar()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-on-accent)] hover:opacity-90"
        >
          <RefreshCw size={14} strokeWidth={ICON_STROKE} aria-hidden /> Reintentar
        </button>
      </Card>
    );
  }

  if (!config) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-[var(--color-surface-muted)]" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-12">
      <header>
        <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">Agenda</h1>
        <p className="mt-0.5 text-xs text-[var(--color-muted)]">
          Especialidades, horarios de cada doctor, ausencias y duración de los tratamientos.
          Lo que no esté configurado aquí, la agenda no lo inventa.
        </p>
      </header>

      <SeccionEspecialidades config={config} guardar={guardar} />
      <SeccionHorarios config={config} guardar={guardar} />
      <SeccionBloqueos config={config} guardar={guardar} />
      <SeccionDuraciones config={config} guardar={guardar} />
    </div>
  );
}

type SeccionProps = {
  config: Config;
  guardar: (body: Record<string, unknown>, okMsg: string) => Promise<boolean>;
};

// ── 1 · Especialidades ───────────────────────────────────────────────────────

function SeccionEspecialidades({ config, guardar }: SeccionProps) {
  const [nueva, setNueva] = useState("");
  const nombreDoc = useMemo(() => new Map(config.doctores.map((d) => [d.id, d.nombre])), [config.doctores]);

  return (
    <Card padding="none" className="px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Stethoscope size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
        <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">Especialidades</h2>
      </div>

      {config.especialidades.length === 0 && (
        <p className="mb-3 text-xs text-[var(--color-muted)]">
          Aún no hay especialidades — crea la primera y asígnale sus doctores.
        </p>
      )}

      <div className="space-y-3">
        {config.especialidades.map((e) => (
          <div key={e.id} className="rounded-xl border border-[var(--color-border)] px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className={`text-sm font-semibold ${e.activa ? "text-[var(--color-foreground)]" : "text-[var(--color-muted)] line-through"}`}>
                {e.nombre}
              </p>
              <button
                type="button"
                onClick={() => void guardar({ seccion: "especialidad_activa", id: e.id, activa: !e.activa }, e.activa ? "Especialidad desactivada." : "Especialidad activada.")}
                className="text-[11px] font-semibold text-[var(--color-accent)] hover:underline"
              >
                {e.activa ? "Desactivar" : "Activar"}
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {config.doctores.map((d) => {
                const asignado = e.doctorIds.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      const doctorIds = asignado ? e.doctorIds.filter((x) => x !== d.id) : [...e.doctorIds, d.id];
                      void guardar({ seccion: "especialidad_doctores", id: e.id, doctorIds }, "Doctores actualizados.");
                    }}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      asignado
                        ? "border-transparent bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                        : "border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-muted)]"
                    }`}
                  >
                    {d.nombre}
                  </button>
                );
              })}
            </div>
            {e.doctorIds.length === 0 && (
              <p className="mt-1.5 text-[11px] text-[var(--color-warning)]">
                Sin doctores asignados: esta especialidad no tendrá disponibilidad en la agenda.
              </p>
            )}
            {e.doctorIds.length > 0 && (
              <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">
                Atienden: {e.doctorIds.map((id) => nombreDoc.get(id) ?? "—").join(" · ")}
              </p>
            )}
          </div>
        ))}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (!nueva.trim()) return;
          void guardar({ seccion: "especialidad_crear", nombre: nueva.trim() }, "Especialidad creada.").then((ok) => {
            if (ok) setNueva("");
          });
        }}
      >
        <input
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          placeholder="Nueva especialidad (p. ej. Ortodoncia)"
          maxLength={60}
          className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted)]"
        />
        <button
          type="submit"
          disabled={!nueva.trim()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-[var(--color-on-accent)] hover:opacity-90 disabled:opacity-40"
        >
          <Plus size={14} strokeWidth={ICON_STROKE} aria-hidden /> Crear
        </button>
      </form>
    </Card>
  );
}

// ── 2 · Horarios por doctor ──────────────────────────────────────────────────

function SeccionHorarios({ config, guardar }: SeccionProps) {
  const [staffId, setStaffId] = useState<string>(config.doctores[0]?.id ?? "");
  // Borrador local de la semana del doctor elegido; guardar reemplaza la
  // semana ENTERA (transaccional en la API).
  const [borrador, setBorrador] = useState<Array<{ diaSemana: number; inicio: string; fin: string }> | null>(null);
  const [guardando, setGuardando] = useState(false);

  const delDoctor = useMemo(
    () => config.horarios.filter((h) => h.staffId === staffId).map((h) => ({ diaSemana: h.diaSemana, inicio: h.inicio, fin: h.fin })),
    [config.horarios, staffId],
  );
  const franjas = borrador ?? delDoctor;
  const tocado = borrador !== null;

  const doctor = config.doctores.find((d) => d.id === staffId) ?? null;

  return (
    <Card padding="none" className="px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <Clock size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
        <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">Horarios por doctor</h2>
      </div>

      {config.doctores.length === 0 ? (
        <p className="text-xs text-[var(--color-muted)]">No hay doctores dados de alta en el equipo.</p>
      ) : (
        <>
          <select
            value={staffId}
            onChange={(e) => { setStaffId(e.target.value); setBorrador(null); }}
            className="mb-3 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] sm:w-72"
          >
            {config.doctores.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nombre}{d.clinicaNombre ? ` — ${d.clinicaNombre}` : ""}
              </option>
            ))}
          </select>

          <div className="space-y-2">
            {DIAS.map((dia) => {
              const delDia = franjas
                .map((f, idx) => ({ ...f, idx }))
                .filter((f) => f.diaSemana === dia.n)
                .sort((a, b) => a.inicio.localeCompare(b.inicio));
              return (
                <div key={dia.n} className="flex flex-wrap items-center gap-2">
                  <span className="w-20 shrink-0 text-xs font-medium text-[var(--color-foreground)]">{dia.label}</span>
                  {delDia.length === 0 && (
                    <span className="text-[11px] text-[var(--color-muted)]">no trabaja</span>
                  )}
                  {delDia.map((f) => (
                    <span key={f.idx} className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border)] px-1.5 py-1">
                      <input
                        type="time"
                        value={f.inicio}
                        onChange={(e) => {
                          const nx = [...franjas];
                          nx[f.idx] = { ...nx[f.idx], inicio: e.target.value };
                          setBorrador(nx);
                        }}
                        className="bg-transparent text-xs text-[var(--color-foreground)]"
                      />
                      <span className="text-[10px] text-[var(--color-muted)]">–</span>
                      <input
                        type="time"
                        value={f.fin}
                        onChange={(e) => {
                          const nx = [...franjas];
                          nx[f.idx] = { ...nx[f.idx], fin: e.target.value };
                          setBorrador(nx);
                        }}
                        className="bg-transparent text-xs text-[var(--color-foreground)]"
                      />
                      <button
                        type="button"
                        aria-label={`Quitar franja del ${dia.label.toLowerCase()}`}
                        onClick={() => setBorrador(franjas.filter((_, i) => i !== f.idx))}
                        className="text-[var(--color-muted)] hover:text-[var(--color-danger)]"
                      >
                        <Trash2 size={12} strokeWidth={ICON_STROKE} aria-hidden />
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setBorrador([...franjas, { diaSemana: dia.n, inicio: "09:00", fin: "14:00" }])}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--color-accent)] hover:underline"
                  >
                    <Plus size={11} strokeWidth={ICON_STROKE} aria-hidden /> franja
                  </button>
                </div>
              );
            })}
          </div>

          {delDoctor.length === 0 && !tocado && (
            <p className="mt-2 text-[11px] text-[var(--color-warning)]">
              {doctor?.nombre ?? "Este doctor"} no tiene horario configurado: sin franjas no hay huecos en la agenda.
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={!tocado || guardando}
              onClick={() => {
                setGuardando(true);
                void guardar({ seccion: "horarios_doctor", staffId, franjas }, "Horario guardado.")
                  .then((ok) => { if (ok) setBorrador(null); })
                  .finally(() => setGuardando(false));
              }}
              className="rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-on-accent)] hover:opacity-90 disabled:opacity-40"
            >
              Guardar horario
            </button>
            {tocado && (
              <button
                type="button"
                onClick={() => setBorrador(null)}
                className="text-xs font-semibold text-[var(--color-muted)] hover:underline"
              >
                Descartar cambios
              </button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ── 3 · Bloqueos ─────────────────────────────────────────────────────────────

function SeccionBloqueos({ config, guardar }: SeccionProps) {
  const [staffId, setStaffId] = useState<string>(config.doctores[0]?.id ?? "");
  const [inicio, setInicio] = useState("");
  const [fin, setFin] = useState("");
  const [motivo, setMotivo] = useState("");
  const nombreDoc = useMemo(() => new Map(config.doctores.map((d) => [d.id, d.nombre])), [config.doctores]);

  return (
    <Card padding="none" className="px-5 py-4">
      <div className="mb-3 flex items-center gap-2">
        <CalendarDays size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
        <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">Ausencias y bloqueos</h2>
      </div>

      {config.bloqueos.length === 0 ? (
        <p className="mb-3 text-xs text-[var(--color-muted)]">Sin bloqueos próximos. Vacaciones, congresos o tardes libres se añaden aquí y se restan de la agenda.</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {config.bloqueos.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--color-foreground)]">
                  {nombreDoc.get(b.staffId) ?? "—"} · {fmtRango(b.inicioISO, b.finISO)}
                </p>
                {b.motivo && <p className="truncate text-[11px] text-[var(--color-muted)]">{b.motivo}</p>}
              </div>
              <button
                type="button"
                aria-label="Borrar bloqueo"
                onClick={() => void guardar({ seccion: "bloqueo_borrar", id: b.id }, "Bloqueo borrado.")}
                className="shrink-0 text-[var(--color-muted)] hover:text-[var(--color-danger)]"
              >
                <Trash2 size={14} strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {config.doctores.length > 0 && (
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!inicio || !fin) return;
            void guardar(
              {
                seccion: "bloqueo_crear",
                staffId,
                inicioISO: new Date(inicio).toISOString(),
                finISO: new Date(fin).toISOString(),
                motivo: motivo || null,
              },
              "Bloqueo creado.",
            ).then((ok) => { if (ok) { setInicio(""); setFin(""); setMotivo(""); } });
          }}
        >
          <select
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] sm:col-span-2"
          >
            {config.doctores.map((d) => (
              <option key={d.id} value={d.id}>{d.nombre}</option>
            ))}
          </select>
          <label className="text-[11px] font-medium text-[var(--color-muted)]">
            Desde
            <input type="datetime-local" required value={inicio} onChange={(e) => setInicio(e.target.value)}
              className="mt-0.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)]" />
          </label>
          <label className="text-[11px] font-medium text-[var(--color-muted)]">
            Hasta
            <input type="datetime-local" required value={fin} onChange={(e) => setFin(e.target.value)}
              className="mt-0.5 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)]" />
          </label>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo (opcional): vacaciones, congreso…"
            maxLength={200}
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted)] sm:col-span-2"
          />
          <button
            type="submit"
            disabled={!inicio || !fin}
            className="inline-flex w-fit items-center gap-1.5 rounded-xl bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[var(--color-on-accent)] hover:opacity-90 disabled:opacity-40"
          >
            <Plus size={14} strokeWidth={ICON_STROKE} aria-hidden /> Añadir bloqueo
          </button>
        </form>
      )}
    </Card>
  );
}

// ── 4 · Duración por tratamiento ─────────────────────────────────────────────

function SeccionDuraciones({ config, guardar }: SeccionProps) {
  // Borrador por fila: solo se envía la fila tocada.
  const [filas, setFilas] = useState<Record<string, { duracionMin: string; bufferAntesMin: string; bufferDespuesMin: string }>>({});

  const valorDe = (t: Tratamiento) =>
    filas[t.id] ?? {
      duracionMin: t.duracionMin == null ? "" : String(t.duracionMin),
      bufferAntesMin: t.bufferAntesMin == null ? "" : String(t.bufferAntesMin),
      bufferDespuesMin: t.bufferDespuesMin == null ? "" : String(t.bufferDespuesMin),
    };

  const sinDuracion = config.tratamientos.filter((t) => t.duracionMin == null).length;

  return (
    <Card padding="none" className="px-5 py-4">
      <div className="mb-1 flex items-center gap-2">
        <Hourglass size={16} strokeWidth={ICON_STROKE} className="text-[var(--color-accent)]" aria-hidden />
        <h2 className="font-display text-base font-semibold text-[var(--color-foreground)]">Duración por tratamiento</h2>
      </div>
      <p className="mb-3 text-xs text-[var(--color-muted)]">
        Una primera visita no dura lo que un implante. Sin duración, ese tratamiento no puede ofrecer huecos.
        {sinDuracion > 0 && (
          <span className="font-semibold text-[var(--color-warning)]"> {sinDuracion} tratamiento(s) sin duración.</span>
        )}
      </p>

      {config.tratamientos.length === 0 ? (
        <p className="text-xs text-[var(--color-muted)]">No hay tratamientos en el catálogo.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
                <th className="py-1.5 pr-2">Tratamiento</th>
                <th className="py-1.5 pr-2">Duración (min)</th>
                <th className="py-1.5 pr-2">Antes (min)</th>
                <th className="py-1.5 pr-2">Después (min)</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {config.tratamientos.map((t) => {
                const v = valorDe(t);
                const tocada = filas[t.id] !== undefined;
                return (
                  <tr key={t.id} className="border-t border-[var(--color-border)]">
                    <td className="py-2 pr-2 font-medium text-[var(--color-foreground)]">{t.nombre}</td>
                    {(["duracionMin", "bufferAntesMin", "bufferDespuesMin"] as const).map((campo) => (
                      <td key={campo} className="py-1.5 pr-2">
                        <input
                          type="number"
                          min={campo === "duracionMin" ? 5 : 0}
                          max={campo === "duracionMin" ? 480 : 60}
                          value={v[campo]}
                          placeholder="—"
                          onChange={(e) => setFilas((prev) => ({ ...prev, [t.id]: { ...valorDe(t), ...prev[t.id], [campo]: e.target.value } }))}
                          className="w-20 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-foreground)] [font-variant-numeric:tabular-nums]"
                        />
                      </td>
                    ))}
                    <td className="py-1.5">
                      <button
                        type="button"
                        disabled={!tocada}
                        onClick={() => {
                          const parse = (s: string) => (s.trim() === "" ? null : Number(s));
                          void guardar(
                            {
                              seccion: "tratamiento_duracion",
                              id: t.id,
                              duracionMin: parse(v.duracionMin),
                              bufferAntesMin: parse(v.bufferAntesMin),
                              bufferDespuesMin: parse(v.bufferDespuesMin),
                            },
                            "Duración guardada.",
                          ).then((ok) => {
                            if (ok) setFilas((prev) => { const nx = { ...prev }; delete nx[t.id]; return nx; });
                          });
                        }}
                        className="text-[11px] font-semibold text-[var(--color-accent)] hover:underline disabled:opacity-30"
                      >
                        Guardar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
