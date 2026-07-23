"use client";

// Sprint 8 Bloque C — tabla de Pacientes con KPIs + filtros.
// Sprint 14b Bloque 2 — sub-tabs "Asistidos" / "Cobros".
// Bloque 3 (2026-07-23) — tabla EDITABLE con principio "ventana, no base de
// datos": cada dato tiene UN registro origen y editar escribe ahí.
//   - Edición DIRECTA inline (guardado confirmado con toast): nombre,
//     teléfono (con propagación visible a presupuestos abiertos), email,
//     notas, doctor.
//   - Mutaciones de NEGOCIO con el modal existente de su flujo: registrar
//     cobro → PagoModal de la ficha; estado de presupuesto → mismos modales
//     y transiciones del kanban (EstadoPresupuestoFlow).
//   - Derivados (Presupuesto, Aceptado, Cobrado, Pendiente, Tratamientos,
//     Próxima cita) NO se editan: se corrigen en su origen.
//   - El icono de WhatsApp abre la conversación en la ficha, nunca wa.me.

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useClinic } from "../../lib/context/ClinicContext";
import { KpiCard } from "../../components/ui/KpiCard";
import { EmptyState } from "../../components/ui/Feedback";
import { MessageCircle, Users, Euro, Pencil, ICON_STROKE } from "../../components/icons";
import { CobrosTabView } from "./CobrosTabView";
import { PagoModal } from "../../components/pacientes/PagoModal";
import { EstadoPresupuestoFlow, type PresupuestoBrief } from "./EstadoPresupuestoFlow";

type Paciente = {
  id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  tratamientos: string[];
  doctorLinkId: string | null;
  doctorNombre?: string | null;
  fechaCita: string | null;
  presupuestoTotal: number | null;
  aceptado: "Si" | "No" | "Pendiente" | null;
  pagado: number | null;
  pendiente: number | null;
  // Derivados en servidor (una sola verdad): dinero de presupuestos+pagos,
  // tratamientos de sus presupuestos, próxima cita de la agenda real.
  firmado: number;
  cobrado: number;
  pendienteReal: number;
  aceptadoDerivado: "Si" | "No" | "Pendiente" | null;
  tratamientosDerivados: string[];
  proximaCita: string | null;
  notas: string | null;
  canalOrigen: string | null;
  clinicaId: string | null;
  clinicaNombre?: string | null;
  leadOrigenId: string | null;
  activo: boolean;
  createdAt: string;
};

type Doctor = { id: string; nombre: string; clinicaId: string | null };

type DateFilter = "semana" | "mes" | "personalizado" | "todo";
type SubTab = "asistidos" | "cobros";

const fmtEUR = (n: number) =>
  n.toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

function fmtProximaCita(p: Paciente): string {
  const iso = p.proximaCita ?? p.fechaCita;
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  const fecha = d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
  const conHora = iso.length > 10 && !(d.getHours() === 0 && d.getMinutes() === 0);
  return conHora
    ? `${fecha} · ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`
    : fecha;
}

// ─── Celda de texto editable inline (nivel 1: datos no sensibles) ───────
function CeldaEditable({
  valor,
  onSave,
  mono,
  placeholder,
  soloLapiz,
}: {
  valor: string | null;
  onSave: (v: string) => Promise<void>;
  mono?: boolean;
  placeholder?: string;
  /** Solo el lápiz como disparador (cuando el texto ya lo pinta otro, p. ej. el link a la ficha). */
  soloLapiz?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={soloLapiz ? "Editar" : undefined}
        className={`group inline-flex items-center gap-1 text-left hover:underline ${mono ? "font-mono text-[10px] text-[var(--color-muted)]" : ""}`}
      >
        {!soloLapiz && <span>{valor || placeholder || "—"}</span>}
        <Pencil
          size={10}
          strokeWidth={ICON_STROKE}
          className={`shrink-0 ${soloLapiz ? "opacity-40 hover:opacity-80" : "opacity-0 group-hover:opacity-60"}`}
          aria-hidden
        />
      </button>
    );
  }
  return (
    <input
      autoFocus
      defaultValue={valor ?? ""}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
      onBlur={async (e) => {
        const v = e.target.value.trim();
        setEditing(false);
        if (v && v !== (valor ?? "")) await onSave(v);
      }}
      className="w-36 rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
    />
  );
}

export function PacientesView({
  initialPacientes,
  clinicas,
  doctores,
}: {
  initialPacientes: Paciente[];
  clinicas: Array<{ id: string; nombre: string }>;
  doctores: Doctor[];
}) {
  const { selectedClinicaId } = useClinic();
  const [pacientes, setPacientes] = useState<Paciente[]>(initialPacientes);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<DateFilter>("todo");
  const [editingNotas, setEditingNotas] = useState<string | null>(null);
  const [editingDoctor, setEditingDoctor] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("asistidos");
  // Flujos con modal (nivel 2: mutaciones de negocio por su flujo origen).
  const [pagoDe, setPagoDe] = useState<{ paciente: Paciente; clinicaId: string | null } | null>(null);
  const [estadoDe, setEstadoDe] = useState<{ paciente: Paciente; abiertos: PresupuestoBrief[] } | null>(null);
  const [cargandoFlujo, setCargandoFlujo] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let out = pacientes;
    if (selectedClinicaId) out = out.filter((p) => p.clinicaId === selectedClinicaId);
    if (dateFilter !== "todo") {
      const now = new Date();
      const from = new Date(now);
      if (dateFilter === "semana") from.setDate(from.getDate() - 7);
      else if (dateFilter === "mes") from.setDate(from.getDate() - 30);
      out = out.filter((p) => new Date(p.createdAt) >= from);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      out = out.filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          (p.telefono ?? "").toLowerCase().includes(q) ||
          (p.email ?? "").toLowerCase().includes(q)
      );
    }
    return out;
  }, [pacientes, selectedClinicaId, dateFilter, search]);

  // KPIs — sobre los DERIVADOS (presupuestos+pagos), no sobre los campos
  // manuales/cache del paciente, que divergían.
  const total = filtered.length;
  const aceptados = filtered.filter((p) => p.aceptadoDerivado === "Si").length;
  const noAceptados = filtered.filter((p) => p.aceptadoDerivado === "No").length;
  const cobrado = filtered.reduce((s, p) => s + (p.cobrado ?? 0), 0);
  const pendienteTotal = filtered.reduce((s, p) => s + (p.pendienteReal ?? 0), 0);
  const pctAceptados = total ? Math.round((aceptados / total) * 100) : 0;
  const pctNoAceptados = total ? Math.round((noAceptados / total) * 100) : 0;

  // PATCH al registro origen (paciente) — solo campos de la whitelist del
  // servidor. Devuelve presupuestosActualizados para nombrar la cascada.
  async function patch(id: string, body: Record<string, any>): Promise<number | null> {
    const res = await fetch(`/api/pacientes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(d?.error ?? "No se pudo guardar — inténtalo de nuevo");
      return null;
    }
    const doctorName = d.paciente.doctorLinkId
      ? doctores.find((x) => x.id === d.paciente.doctorLinkId)?.nombre ?? null
      : null;
    const clinicaName = d.paciente.clinicaId
      ? clinicas.find((c) => c.id === d.paciente.clinicaId)?.nombre ?? null
      : null;
    // Merge sobre la fila existente: el PATCH devuelve el paciente almacenado
    // SIN los derivados (firmado/cobrado/…), que deben sobrevivir al update.
    setPacientes((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, ...d.paciente, doctorNombre: doctorName, clinicaNombre: clinicaName } : p
      )
    );
    return typeof d.presupuestosActualizados === "number" ? d.presupuestosActualizados : 0;
  }

  // Refresca los DERIVADOS de una fila tras una mutación de negocio (cobro,
  // estado): relee la ficha y recalcula con sus presupuestos/pagos reales.
  async function refrescarFila(id: string) {
    try {
      const res = await fetch(`/api/pacientes/${id}`);
      if (!res.ok) return;
      const d = await res.json();
      const presus = (d.presupuestos ?? []) as Array<{ estado: string; tratamiento: string | null }>;
      const nAcept = presus.filter((x) => x.estado === "ACEPTADO").length;
      const nPerd = presus.filter((x) => x.estado === "PERDIDO").length;
      const nVivos = presus.length - nAcept - nPerd;
      const trats = [
        ...new Set(
          presus
            .filter((x) => x.estado !== "PERDIDO")
            .flatMap((x) => (x.tratamiento ?? "").split(/[,+]/).map((t) => t.trim()))
            .filter(Boolean),
        ),
      ];
      setPacientes((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                firmado: d.kpisPagos?.firmado ?? 0,
                cobrado: d.kpisPagos?.totalFacturado ?? 0,
                pendienteReal: d.kpisPagos?.pendiente ?? 0,
                aceptadoDerivado: nAcept > 0 ? "Si" : nVivos > 0 ? "Pendiente" : nPerd > 0 ? "No" : null,
                tratamientosDerivados: trats,
              }
            : p,
        ),
      );
    } catch {
      /* la próxima carga completa reconcilia */
    }
  }

  // Carga la ficha para los flujos de negocio (clinicaId real + presupuestos).
  async function cargarDetalle(id: string) {
    const res = await fetch(`/api/pacientes/${id}`);
    if (!res.ok) {
      toast.error("No se pudo cargar el paciente — inténtalo de nuevo");
      return null;
    }
    const d = await res.json();
    return {
      clinicaId: (d.paciente?.clinicaId as string | null) ?? null,
      presupuestos: (d.presupuestos ?? []) as Array<PresupuestoBrief & { estado: string }>,
    };
  }

  async function abrirRegistrarCobro(p: Paciente) {
    setCargandoFlujo(p.id);
    const det = await cargarDetalle(p.id);
    setCargandoFlujo(null);
    if (!det) return;
    setPagoDe({ paciente: p, clinicaId: det.clinicaId });
  }

  async function abrirEstadoPresupuesto(p: Paciente) {
    setCargandoFlujo(p.id);
    const det = await cargarDetalle(p.id);
    setCargandoFlujo(null);
    if (!det) return;
    const abiertos = det.presupuestos.filter(
      (x) => x.estado !== "ACEPTADO" && x.estado !== "PERDIDO",
    );
    if (det.presupuestos.length === 0) {
      toast.info("Sin presupuestos — créalo desde el módulo de Presupuestos");
      return;
    }
    if (abiertos.length === 0) {
      toast.info("Sin presupuestos abiertos — los cerrados se corrigen desde el kanban o la ficha");
      return;
    }
    setEstadoDe({ paciente: p, abiertos });
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--color-background)] p-6 gap-4 overflow-auto">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">
            {subTab === "asistidos" ? "Pacientes asistidos" : "Cobros"}
          </h1>
          <p className="text-xs text-[var(--color-muted)]">
            {subTab === "asistidos"
              ? `${total} paciente${total === 1 ? "" : "s"} en el periodo seleccionado`
              : "Cola priorizada de pacientes con saldo pendiente"}
          </p>
        </div>
        {/* Sprint 14b Bloque 2 — sub-tabs */}
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setSubTab("asistidos")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
              subTab === "asistidos"
                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-transparent"
                : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
            }`}
          >
            Asistidos
          </button>
          <button
            type="button"
            onClick={() => setSubTab("cobros")}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
              subTab === "cobros"
                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-transparent"
                : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
            }`}
          >
            Cobros
          </button>
        </div>
      </header>

      {subTab === "cobros" && <CobrosTabView />}
      {subTab === "asistidos" && (<>
      {/* Sprint 14b Bloque 2 — contenido legacy de la tab Asistidos */}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Total pacientes" value={total} accent="neutral" />
        <KpiCard
          label="Aceptados"
          value={aceptados}
          subline={`${pctAceptados}% del total`}
          accent="emerald"
        />
        <KpiCard
          label="No aceptados"
          value={noAceptados}
          subline={`${pctNoAceptados}% del total`}
          accent="rose"
        />
        <KpiCard
          label="Cobrado"
          value={cobrado}
          formatter={fmtEUR}
          subline={`pendiente ${fmtEUR(pendienteTotal)}`}
          accent="accent"
        />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {([
            ["todo", "Todo"],
            ["semana", "Esta semana"],
            ["mes", "Este mes"],
            ["personalizado", "Personalizado"],
          ] as Array<[DateFilter, string]>).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setDateFilter(k)}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                dateFilter === k
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-transparent"
                  : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Buscar paciente…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] max-w-sm rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-4 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        />
      </div>

      {/* Tabla */}
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-surface-muted)] text-[var(--color-muted)] text-[10px] uppercase tracking-wider">
              <tr>
                <Th>Paciente</Th>
                <Th>Tratamientos</Th>
                <Th>Doctor</Th>
                <Th>Próxima cita</Th>
                <Th>Presupuesto</Th>
                <Th>Aceptado</Th>
                <Th>Cobrado</Th>
                <Th>Pendiente</Th>
                <Th>Notas</Th>
                <Th>Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const doctoresDeClinica = p.clinicaId
                  ? doctores.filter((d) => d.clinicaId === p.clinicaId)
                  : doctores;
                return (
                  <tr
                    key={p.id}
                    className="border-t border-[var(--color-border)] hover:bg-[var(--color-surface-muted)] fyllio-fade-in"
                    style={{ animationDelay: `${Math.min(i * 30, 600)}ms` }}
                  >
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/pacientes/${p.id}`}
                          className="font-semibold text-[var(--color-foreground)] hover:text-[var(--color-accent)] hover:underline transition-colors"
                        >
                          {p.nombre}
                        </Link>
                        <CeldaEditable
                          valor={p.nombre}
                          soloLapiz
                          onSave={async (v) => {
                            if (await patch(p.id, { nombre: v }) !== null) toast.success("Nombre guardado");
                          }}
                        />
                      </div>
                      <CeldaEditable
                        valor={p.telefono}
                        mono
                        placeholder="añadir teléfono"
                        onSave={async (v) => {
                          const n = await patch(p.id, { telefono: v });
                          if (n !== null) {
                            toast.success(
                              n > 0
                                ? `Teléfono guardado — actualizado en ${n} presupuesto${n === 1 ? "" : "s"} abierto${n === 1 ? "" : "s"}`
                                : "Teléfono guardado",
                            );
                          }
                        }}
                      />
                      <div>
                        <CeldaEditable
                          valor={p.email}
                          mono
                          placeholder="añadir email"
                          onSave={async (v) => {
                            if (await patch(p.id, { email: v }) !== null) toast.success("Email guardado");
                          }}
                        />
                      </div>
                      {p.canalOrigen && (
                        <span className="mt-1 inline-flex rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] px-2 py-0.5 text-[9px] font-semibold">
                          {p.canalOrigen}
                        </span>
                      )}
                    </Td>
                    <Td>
                      {/* DERIVADO de sus presupuestos (no perdidos); la columna
                          propia del paciente es copia a deprecar. */}
                      <div className="flex flex-wrap gap-1">
                        {p.tratamientosDerivados.length === 0 && <span className="text-[var(--color-muted)]">—</span>}
                        {p.tratamientosDerivados.map((t) => (
                          <span
                            key={t}
                            className="inline-flex rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)] px-2 py-0.5 text-[10px] font-semibold"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </Td>
                    <Td>
                      {editingDoctor === p.id ? (
                        <select
                          autoFocus
                          value={p.doctorLinkId ?? ""}
                          onChange={async (e) => {
                            const id = e.target.value || null;
                            setEditingDoctor(null);
                            if (await patch(p.id, { doctorLinkId: id }) !== null) {
                              toast.success(id ? "Doctor asignado" : "Doctor desasignado");
                            }
                          }}
                          onBlur={() => setEditingDoctor(null)}
                          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-2 py-1 text-xs"
                        >
                          <option value="">—</option>
                          {doctoresDeClinica.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.nombre}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingDoctor(p.id)}
                          className="text-[var(--color-foreground)] hover:underline"
                        >
                          {p.doctorNombre ?? "—"}
                        </button>
                      )}
                    </Td>
                    {/* Próxima cita REAL desde la agenda (derivado; el campo
                        suelto del paciente solo queda como respaldo). */}
                    <Td>{fmtProximaCita(p)}</Td>
                    {/* Dinero DERIVADO: presupuesto firmado (Σ ACEPTADO),
                        aceptación según presupuestos reales, cobrado (Σ pagos)
                        y su resta. Se corrigen en su origen, no aquí. */}
                    <Td>{p.firmado > 0 ? `€${p.firmado.toFixed(0)}` : "—"}</Td>
                    <Td>
                      <button
                        type="button"
                        disabled={cargandoFlujo === p.id}
                        onClick={() => abrirEstadoPresupuesto(p)}
                        title="Cambiar el estado del presupuesto origen (mismo flujo que el kanban)"
                        className="group inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                            p.aceptadoDerivado === "Si"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25"
                              : p.aceptadoDerivado === "No"
                              ? "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25"
                              : p.aceptadoDerivado === "Pendiente"
                              ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25"
                              : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)]"
                          }`}
                        >
                          {p.aceptadoDerivado === "Si" ? "Sí" : p.aceptadoDerivado ?? "—"}
                        </span>
                        <Pencil
                          size={10}
                          strokeWidth={ICON_STROKE}
                          className="opacity-0 group-hover:opacity-60"
                          aria-hidden
                        />
                      </button>
                    </Td>
                    <Td>{p.cobrado > 0 ? `€${p.cobrado.toFixed(0)}` : "—"}</Td>
                    <Td>{p.pendienteReal > 0 ? `€${p.pendienteReal.toFixed(0)}` : "—"}</Td>
                    <Td>
                      {editingNotas === p.id ? (
                        <textarea
                          autoFocus
                          defaultValue={p.notas ?? ""}
                          onBlur={async (e) => {
                            const v = e.target.value;
                            setEditingNotas(null);
                            if (v !== (p.notas ?? "")) {
                              if (await patch(p.id, { notas: v }) !== null) toast.success("Notas guardadas");
                            }
                          }}
                          className="w-48 min-h-[50px] text-xs rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-2 py-1"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingNotas(p.id)}
                          className="text-[var(--color-muted)] text-left line-clamp-2 max-w-[180px] hover:underline"
                        >
                          {p.notas || "—"}
                        </button>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={cargandoFlujo === p.id}
                          onClick={() => abrirRegistrarCobro(p)}
                          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[var(--color-accent)] hover:bg-[var(--color-surface-muted)] transition-colors disabled:opacity-50"
                          title="Registrar cobro (modal de pago de la ficha)"
                          aria-label={`Registrar cobro de ${p.nombre}`}
                        >
                          <Euro size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        </button>
                        {/* La conversación vive en la ficha (hilo + registro);
                            nunca wa.me directo desde la tabla. */}
                        <Link
                          href={`/pacientes/${p.id}`}
                          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[var(--fyllio-wa-green)] hover:bg-[var(--color-surface-muted)] transition-colors"
                          title="Abrir conversación en la ficha"
                          aria-label={`Abrir conversación con ${p.nombre}`}
                        >
                          <MessageCircle size={14} strokeWidth={ICON_STROKE} aria-hidden />
                        </Link>
                      </div>
                    </Td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-4">
                    <EmptyState
                      icon={<Users size={24} strokeWidth={ICON_STROKE} />}
                      title="Sin pacientes en el filtro actual"
                      hint="Ajusta los filtros o la búsqueda para ver resultados."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>)}

      {/* Registrar cobro — el MISMO PagoModal de la ficha (registro origen:
          el pago). Al cerrar con éxito se refrescan los derivados de la fila. */}
      {pagoDe && (
        <PagoModal
          mode="create"
          pacienteId={pagoDe.paciente.id}
          clinicaId={pagoDe.clinicaId}
          onClose={() => setPagoDe(null)}
          onDone={() => {
            setPagoDe(null);
            toast.success("Cobro registrado — actualizado en Presupuestos y Cobros");
            void refrescarFila(pagoDe.paciente.id);
          }}
        />
      )}

      {/* Estado de presupuesto — mismos modales y transiciones del kanban. */}
      {estadoDe && (
        <EstadoPresupuestoFlow
          pacienteNombre={estadoDe.paciente.nombre}
          presupuestosAbiertos={estadoDe.abiertos}
          onClose={() => setEstadoDe(null)}
          onMutado={() => void refrescarFila(estadoDe.paciente.id)}
        />
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 align-top text-[var(--color-foreground)]">{children}</td>;
}
