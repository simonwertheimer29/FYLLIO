"use client";

// Sprint 8 Bloque C — tabla de Pacientes con KPIs + filtros + edición inline.

import { useMemo, useState } from "react";
import { useClinic } from "../../lib/context/ClinicContext";

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
  financiado: number | null;
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
  const [error, setError] = useState<string | null>(null);

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

  // KPIs
  const total = filtered.length;
  const aceptados = filtered.filter((p) => p.aceptado === "Si").length;
  const noAceptados = filtered.filter((p) => p.aceptado === "No").length;
  const facturado = filtered.reduce((s, p) => s + (p.pagado ?? 0), 0);
  const pendienteTotal = filtered.reduce((s, p) => s + (p.pendiente ?? 0), 0);
  const pctAceptados = total ? Math.round((aceptados / total) * 100) : 0;
  const pctNoAceptados = total ? Math.round((noAceptados / total) * 100) : 0;

  async function patch(id: string, body: Record<string, any>) {
    setError(null);
    const res = await fetch(`/api/pacientes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d?.error ?? "No se pudo actualizar");
      return;
    }
    const doctorName = d.paciente.doctorLinkId
      ? doctores.find((x) => x.id === d.paciente.doctorLinkId)?.nombre ?? null
      : null;
    const clinicaName = d.paciente.clinicaId
      ? clinicas.find((c) => c.id === d.paciente.clinicaId)?.nombre ?? null
      : null;
    setPacientes((prev) =>
      prev.map((p) =>
        p.id === id ? { ...d.paciente, doctorNombre: doctorName, clinicaNombre: clinicaName } : p
      )
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-slate-50 p-6 gap-4 overflow-auto">
      <header>
        <h1 className="text-xl font-extrabold text-slate-900">Pacientes asistidos</h1>
        <p className="text-xs text-slate-500">
          {total} paciente{total === 1 ? "" : "s"} en el periodo seleccionado
        </p>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total pacientes"
          value={total.toString()}
          icon="👥"
          accent="bg-slate-100 text-slate-800"
        />
        <KpiCard
          label="Aceptados"
          value={aceptados.toString()}
          subline={`${pctAceptados}% del total`}
          icon="✓"
          accent="bg-emerald-50 text-emerald-700"
        />
        <KpiCard
          label="No aceptados"
          value={noAceptados.toString()}
          subline={`${pctNoAceptados}% del total`}
          icon="✕"
          accent="bg-rose-50 text-rose-700"
        />
        <KpiCard
          label="Facturado"
          value={facturado.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
          subline={`pendiente ${pendienteTotal.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}`}
          icon="€"
          accent="bg-sky-50 text-sky-700"
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
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
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
          className="flex-1 min-w-[180px] max-w-sm rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-300"
        />
      </div>

      {error && (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      {/* Tabla */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 text-[10px] uppercase tracking-wider">
              <tr>
                <Th>Paciente</Th>
                <Th>Tratamientos</Th>
                <Th>Doctor</Th>
                <Th>Fecha cita</Th>
                <Th>Presupuesto</Th>
                <Th>Aceptado</Th>
                <Th>Pagado</Th>
                <Th>Pendiente</Th>
                <Th>Financiado</Th>
                <Th>Notas</Th>
                <Th>Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const doctoresDeClinica = p.clinicaId
                  ? doctores.filter((d) => d.clinicaId === p.clinicaId)
                  : doctores;
                return (
                  <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/40">
                    <Td>
                      <p className="font-semibold text-slate-900">{p.nombre}</p>
                      {p.telefono && (
                        <p className="text-[10px] text-slate-500 font-mono">{p.telefono}</p>
                      )}
                      {p.canalOrigen && (
                        <span className="mt-1 inline-flex rounded-full bg-sky-50 text-sky-700 border border-sky-100 px-2 py-0.5 text-[9px] font-semibold">
                          {p.canalOrigen}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {p.tratamientos.map((t) => (
                          <span
                            key={t}
                            className="inline-flex rounded-full bg-violet-50 text-violet-700 border border-violet-100 px-2 py-0.5 text-[10px] font-semibold"
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
                            await patch(p.id, { doctorLinkId: id });
                            setEditingDoctor(null);
                          }}
                          onBlur={() => setEditingDoctor(null)}
                          className="rounded border border-slate-200 px-2 py-1 text-xs"
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
                          className="text-slate-700 hover:underline"
                        >
                          {p.doctorNombre ?? "—"}
                        </button>
                      )}
                    </Td>
                    <Td>{p.fechaCita ?? "—"}</Td>
                    <Td>{p.presupuestoTotal != null ? `€${p.presupuestoTotal.toFixed(0)}` : "—"}</Td>
                    <Td>
                      <select
                        value={p.aceptado ?? ""}
                        onChange={(e) =>
                          patch(p.id, { aceptado: e.target.value || null })
                        }
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold focus:outline-none ${
                          p.aceptado === "Si"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : p.aceptado === "No"
                            ? "bg-rose-50 text-rose-700 border-rose-200"
                            : p.aceptado === "Pendiente"
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-white text-slate-500 border-slate-200"
                        }`}
                      >
                        <option value="">—</option>
                        <option value="Si">Sí</option>
                        <option value="No">No</option>
                        <option value="Pendiente">Pendiente</option>
                      </select>
                    </Td>
                    <Td>{p.pagado != null ? `€${p.pagado.toFixed(0)}` : "—"}</Td>
                    <Td>{p.pendiente != null ? `€${p.pendiente.toFixed(0)}` : "—"}</Td>
                    <Td>{p.financiado ? `€${p.financiado.toFixed(0)}` : "—"}</Td>
                    <Td>
                      {editingNotas === p.id ? (
                        <textarea
                          autoFocus
                          defaultValue={p.notas ?? ""}
                          onBlur={async (e) => {
                            const v = e.target.value;
                            setEditingNotas(null);
                            if (v !== (p.notas ?? "")) await patch(p.id, { notas: v });
                          }}
                          className="w-48 min-h-[50px] text-xs rounded border border-slate-200 px-2 py-1"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEditingNotas(p.id)}
                          className="text-slate-600 text-left line-clamp-2 max-w-[180px] hover:underline"
                        >
                          {p.notas || "—"}
                        </button>
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        {p.telefono && (
                          <a
                            href={`https://wa.me/${p.telefono.replace(/\D/g, "")}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-600 hover:underline"
                            title="WhatsApp"
                          >
                            💬
                          </a>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                    Sin pacientes en el filtro actual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  subline,
  icon,
  accent,
}: {
  label: string;
  value: string;
  subline?: string;
  icon: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 flex items-start gap-3">
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-base ${accent}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">{label}</p>
        <p className="text-xl font-extrabold text-slate-900">{value}</p>
        {subline && <p className="text-[10px] text-slate-400">{subline}</p>}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left font-semibold px-3 py-2 whitespace-nowrap">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 align-top">{children}</td>;
}
