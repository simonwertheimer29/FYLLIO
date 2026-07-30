"use client";

// Modal de presupuesto (reescrito 2026-07-29, spec "presupuestos sobre
// pacientes con historial").
//
// LO QUE CAMBIA Y POR QUÉ: el nombre del paciente era un <input type="text">.
// Se tecleaba a mano, no buscaba sobre nada —solo avisaba de presupuestos
// duplicados, no de personas— y el POST no lo guardaba: el presupuesto nacía
// sin `paciente_id` y al recargar se llamaba literalmente "Paciente".
//
// Ahora se BUSCA a la persona y el presupuesto cuelga de su id. Y si no
// aparece como paciente, se busca entre los leads citados para decir qué
// falta: casi siempre, marcar la asistencia de alguien que está hoy en la
// clínica.
//
// El modal NUNCA crea el paciente. Sería un segundo camino al mismo resultado,
// sin asistencia registrada ni trazabilidad de origen (principio de producto
// del 2026-07-29).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, X, Search, Check, ArrowRight, ICON_STROKE,
} from "../icons";
import type {
  Doctor, Presupuesto, PresupuestoEstado, UserSession,
} from "../../lib/presupuestos/types";
import { hoyISO } from "../../lib/time";
import { cargarJSON, traeLista, mensajeDeError } from "../../lib/fetch-json";

const ESTADOS_INICIALES: { value: PresupuestoEstado; label: string }[] = [
  { value: "PRESENTADO", label: "Presentado" },
  { value: "INTERESADO", label: "Interesado" },
  { value: "EN_DUDA", label: "En duda" },
  { value: "EN_NEGOCIACION", label: "En negociación" },
];

type PacienteEncontrado = {
  id: string;
  nombre: string;
  telefono: string | null;
  clinicaId: string | null;
  clinicaNombre: string | null;
};

type LeadCitadoEncontrado = {
  id: string;
  nombre: string;
  telefono: string | null;
  clinicaNombre: string | null;
  fechaCita: string | null;
  horaCita: string | null;
  esDeHoySinAsistencia: boolean;
};

type Tratamiento = { nombre: string; categoria: string | null };

/** "hoy" · "mañana" · "mié 5 ago" — la misma gramática de fechas que /leads. */
function fechaHumana(iso: string, hoy: string): string {
  if (iso === hoy) return "hoy";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const dias = Math.round((d.getTime() - new Date(`${hoy}T12:00:00`).getTime()) / 86_400_000);
  if (dias === 1) return "mañana";
  if (dias === -1) return "ayer";
  return d
    .toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })
    .replace(",", "");
}

const INPUT =
  "w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";
const LABEL = "block text-xs font-medium text-[var(--color-muted)] mb-1";

export default function NewPresupuestoModal({
  user,
  presupuesto,
  pacienteInicial,
  onClose,
  onCreated,
}: {
  /** Solo se usan `rol` y `clinica`: pedir la sesión entera obligaba a los
   *  callers que no la tienen (la tabla de Pacientes) a fabricar una falsa. */
  user: Pick<UserSession, "rol" | "clinica">;
  presupuesto?: Presupuesto;
  /** Preselección al abrir desde la tabla de Pacientes: mismo modal, sin
   *  variantes — solo se salta el paso de buscar a quien ya se eligió. */
  pacienteInicial?: PacienteEncontrado;
  onClose: () => void;
  onCreated: () => void;
}) {
  const isEdit = !!presupuesto;
  const hoy = hoyISO();

  const [doctores, setDoctores] = useState<Doctor[]>([]);
  const [catalogo, setCatalogo] = useState<Tratamiento[]>([]);
  const [errorCatalogo, setErrorCatalogo] = useState(false);

  // ── Paciente ─────────────────────────────────────────────────────────
  const [paciente, setPaciente] = useState<PacienteEncontrado | null>(
    pacienteInicial ?? null,
  );
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<PacienteEncontrado[]>([]);
  const [leads, setLeads] = useState<LeadCitadoEncontrado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  // Un fallo de la búsqueda NO puede leerse como "esta persona no existe": es la
  // forma más caras del §10, porque no vacía una lista, DICTA una acción
  // equivocada ("entra por Leads" sobre un paciente que sí está).
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [errorDoctores, setErrorDoctores] = useState(false);

  // ── Presupuesto ──────────────────────────────────────────────────────
  const [tratamientos, setTratamientos] = useState<string[]>(presupuesto?.treatments ?? []);
  const [doctor, setDoctor] = useState(presupuesto?.doctor ?? "");
  const [amount, setAmount] = useState(presupuesto?.amount != null ? String(presupuesto.amount) : "");
  const [fechaPresupuesto, setFechaPresupuesto] = useState(presupuesto?.fechaPresupuesto ?? hoy);
  const [notes, setNotes] = useState((presupuesto?.notes ?? "").replace(/\[SEED_[A-Z_]+\]/g, "").trim());
  const [estadoInicial, setEstadoInicial] = useState<PresupuestoEstado>("PRESENTADO");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargarDoctores = useCallback(() => {
    const url = new URL("/api/presupuestos/doctores", location.href);
    if (user.rol === "encargada_ventas" && user.clinica) url.searchParams.set("clinica", user.clinica);
    setErrorDoctores(false);
    // Antes: `.then((d) => setDoctores(d.doctores ?? [])).catch(() => {})`. Un
    // fallo dejaba el desplegable con solo "Sin asignar", indistinguible de una
    // clínica sin doctores dados de alta.
    cargarJSON<{ doctores: Doctor[] }>(url.toString(), { validar: traeLista("doctores") })
      .then((d) => setDoctores(d.doctores))
      .catch(() => setErrorDoctores(true));
  }, [user.rol, user.clinica]);
  useEffect(cargarDoctores, [cargarDoctores]);

  const cargarCatalogo = useCallback(() => {
    setErrorCatalogo(false);
    cargarJSON<{ tratamientos: Tratamiento[] }>("/api/presupuestos/tratamientos", {
      validar: traeLista("tratamientos"),
    })
      .then((d) => setCatalogo(d.tratamientos))
      .catch(() => setErrorCatalogo(true));
  }, []);
  useEffect(cargarCatalogo, [cargarCatalogo]);

  // Búsqueda con freno: se consulta cuando la coordinadora deja de teclear.
  function alBuscar(valor: string) {
    setBusqueda(valor);
    setBuscado(false);
    setErrorBusqueda(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (valor.trim().length < 2) {
      setResultados([]);
      setLeads([]);
      return;
    }
    setBuscando(true);
    timerRef.current = setTimeout(async () => {
      try {
        const d = await cargarJSON<{
          pacientes: PacienteEncontrado[];
          leads: LeadCitadoEncontrado[];
        }>(`/api/pacientes/buscar?q=${encodeURIComponent(valor.trim())}`, {
          validar: traeLista("pacientes"),
        });
        setResultados(d.pacientes);
        setLeads(d.leads);  // la ruta manda siempre el array (vacío si hay pacientes)
        setBuscado(true);
      } catch (e) {
        // Cero resultados + error: la pantalla NO puede decir "no está ni como
        // paciente ni como lead". No sabemos si está.
        setResultados([]);
        setLeads([]);
        setBuscado(false);
        setErrorBusqueda(mensajeDeError(e));
      } finally {
        setBuscando(false);
      }
    }, 350);
  }

  function alternarTratamiento(nombre: string) {
    setTratamientos((prev) =>
      prev.includes(nombre) ? prev.filter((t) => t !== nombre) : [...prev, nombre],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isEdit && !paciente) { setError("Elige primero al paciente"); return; }
    if (tratamientos.length === 0) { setError("Elige al menos un tratamiento"); return; }

    setSaving(true);
    try {
      const body = {
        pacienteId: paciente?.id,
        treatments: tratamientos,
        doctor: doctor || undefined,
        amount: amount ? Number(amount) : undefined,
        fechaPresupuesto,
        notes: notes.trim() || undefined,
        clinica: paciente?.clinicaNombre ?? user.clinica,
        ...(!isEdit && { estadoInicial }),
      };
      const res = isEdit
        ? await fetch(`/api/presupuestos/kanban/${presupuesto!.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          })
        : await fetch("/api/presupuestos/kanban", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Error al guardar");
        return;
      }
      onCreated();
      onClose();
    } catch {
      setError("Error de red");
    } finally {
      setSaving(false);
    }
  }

  const puedeGuardar = (isEdit || !!paciente) && tratamientos.length > 0 && !saving;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg sm:rounded-3xl rounded-t-2xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl overflow-y-auto max-h-[95vh] sm:max-h-[90vh]">
        <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 className="font-display text-base font-semibold text-[var(--color-foreground)]">
            {isEdit ? "Editar presupuesto" : "Nuevo presupuesto"}
          </h3>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-foreground)]" aria-label="Cerrar">
            <X size={16} strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* ── Paciente ─────────────────────────────────────────────── */}
          {!isEdit && (
            <div>
              <label className={LABEL}>Paciente *</label>

              {paciente ? (
                <div className="flex items-center gap-3 rounded-xl border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3 py-2.5">
                  <Check size={16} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 text-[var(--color-accent)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--color-foreground)] truncate">{paciente.nombre}</p>
                    <p className="text-[11px] text-[var(--color-muted)] truncate tabular-nums">
                      {[paciente.telefono, paciente.clinicaNombre].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setPaciente(null); setBusqueda(""); setResultados([]); setLeads([]); setBuscado(false); }}
                    className="shrink-0 text-[11px] font-semibold text-[var(--color-accent)] hover:underline"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search
                      size={15}
                      strokeWidth={ICON_STROKE}
                      aria-hidden
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
                    />
                    <input
                      type="text"
                      value={busqueda}
                      onChange={(e) => alBuscar(e.target.value)}
                      placeholder="Busca por nombre o teléfono…"
                      autoFocus
                      className={`${INPUT} pl-9`}
                    />
                  </div>

                  {buscando && (
                    <p className="mt-1.5 text-[11px] text-[var(--color-muted)] px-1">Buscando…</p>
                  )}

                  {errorBusqueda && !buscando && (
                    <div className="mt-1.5 rounded-xl border border-[var(--color-danger)]/25 bg-[var(--color-danger-soft)] px-3 py-2">
                      <p className="text-[11px] text-[var(--color-danger)]">
                        No se pudo buscar. No sabemos si esta persona está o no —
                        no la des de alta por Leads sin comprobarlo.
                      </p>
                      <button
                        type="button"
                        onClick={() => alBuscar(busqueda)}
                        className="text-[11px] font-semibold text-[var(--color-accent)] hover:underline mt-0.5"
                      >
                        Reintentar
                      </button>
                    </div>
                  )}

                  {!buscando && resultados.length > 0 && (
                    <ul className="mt-1.5 rounded-xl border border-[var(--color-border)] divide-y divide-[var(--color-border)] overflow-hidden">
                      {resultados.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => setPaciente(p)}
                            className="w-full text-left px-3 py-2 hover:bg-[var(--color-surface-muted)] transition-colors"
                          >
                            <p className="text-sm font-medium text-[var(--color-foreground)] truncate">{p.nombre}</p>
                            <p className="text-[11px] text-[var(--color-muted)] truncate tabular-nums">
                              {[p.telefono, p.clinicaNombre].filter(Boolean).join(" · ")}
                            </p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* No es paciente todavía, pero existe: falta marcar su
                      asistencia. El enlace va al LEAD concreto — mandar al
                      tablero a buscarlo entre 27 cards no es ayudar. */}
                  {buscado && !buscando && resultados.length === 0 && leads.length > 0 && (
                    <div className="mt-1.5 space-y-1.5">
                      {leads.map((l) => (
                        <div
                          key={l.id}
                          className="rounded-xl border px-3 py-2.5"
                          style={{
                            borderColor: l.esDeHoySinAsistencia
                              ? "var(--color-danger)"
                              : "var(--color-border)",
                            background: l.esDeHoySinAsistencia
                              ? "var(--color-danger-soft)"
                              : "var(--color-surface-muted)",
                          }}
                        >
                          <p className="text-sm font-semibold text-[var(--color-foreground)]">{l.nombre}</p>
                          <p className="text-[11px] text-[var(--color-foreground)] mt-0.5">
                            {l.esDeHoySinAsistencia
                              ? "Está citado hoy y aún no has marcado su asistencia. Márcala para registrarlo como paciente y poder crear su presupuesto."
                              : `Todavía no es paciente: tiene cita ${l.fechaCita ? fechaHumana(l.fechaCita, hoy) : "pendiente"}${l.horaCita ? ` a las ${l.horaCita}` : ""} y falta marcar su asistencia.`}
                          </p>
                          <a
                            href={`/leads?lead=${encodeURIComponent(l.id)}`}
                            className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-semibold text-[var(--color-accent)] hover:underline"
                          >
                            Ir a su ficha en Leads
                            <ArrowRight size={12} strokeWidth={ICON_STROKE} aria-hidden />
                          </a>
                        </div>
                      ))}
                    </div>
                  )}

                  {buscado && !buscando && resultados.length === 0 && leads.length === 0 && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-[var(--color-muted)] px-1">
                      <AlertTriangle size={13} strokeWidth={ICON_STROKE} aria-hidden className="shrink-0 mt-px" />
                      <span>
                        No está ni como paciente ni como lead citado. Si es alguien nuevo,
                        entra por Leads: se registra como paciente al marcar su asistencia.
                      </span>
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Tratamientos ─────────────────────────────────────────── */}
          <div>
            <label className={LABEL}>Tratamiento(s) *</label>
            {errorCatalogo ? (
              <div className="rounded-xl border border-[var(--color-danger)]/25 bg-[var(--color-danger-soft)] px-3 py-2">
                <p className="text-[11px] text-[var(--color-danger)]">
                  No se pudo cargar el catálogo de tratamientos.
                </p>
                <button type="button" onClick={cargarCatalogo} className="text-[11px] font-semibold text-[var(--color-accent)] hover:underline mt-0.5">
                  Reintentar
                </button>
              </div>
            ) : catalogo.length === 0 ? (
              <p className="text-[11px] text-[var(--color-muted)] px-1">Cargando…</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {catalogo.map((t) => {
                  const activo = tratamientos.includes(t.nombre);
                  return (
                    <button
                      key={t.nombre}
                      type="button"
                      onClick={() => alternarTratamiento(t.nombre)}
                      aria-pressed={activo}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        activo
                          ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                          : "bg-[var(--color-surface-muted)] text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                      }`}
                    >
                      {t.nombre}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Doctor · importe ─────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Doctor</label>
              <select value={doctor} onChange={(e) => setDoctor(e.target.value)} className={INPUT}>
                <option value="">Sin asignar</option>
                {doctores.map((d) => (
                  <option key={d.id} value={d.nombre}>{d.nombre}</option>
                ))}
              </select>
              {errorDoctores && (
                <p className="mt-1 text-[11px] text-[var(--color-danger)]">
                  No se pudo cargar la lista de doctores.{" "}
                  <button type="button" onClick={cargarDoctores} className="font-semibold underline">
                    Reintentar
                  </button>
                </p>
              )}
            </div>
            <div>
              <label className={LABEL}>Importe (€)</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" min={0} className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Fecha</label>
              <input type="date" value={fechaPresupuesto} onChange={(e) => setFechaPresupuesto(e.target.value)} className={INPUT} />
            </div>
            {!isEdit && (
              <div>
                <label className={LABEL}>Estado inicial</label>
                <select value={estadoInicial} onChange={(e) => setEstadoInicial(e.target.value as PresupuestoEstado)} className={INPUT}>
                  {ESTADOS_INICIALES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className={LABEL}>Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observaciones…"
              rows={2}
              className={`${INPUT} resize-none`}
            />
          </div>

          {error && (
            <p className="text-xs text-[var(--color-danger)] bg-[var(--color-danger-soft)] border border-[var(--color-danger)]/25 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-[var(--color-border)] text-[var(--color-foreground)] text-sm font-semibold py-2.5 hover:bg-[var(--color-surface-muted)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!puedeGuardar}
              className="flex-1 rounded-xl bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-semibold py-2.5 hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
            >
              {saving ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear presupuesto"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
