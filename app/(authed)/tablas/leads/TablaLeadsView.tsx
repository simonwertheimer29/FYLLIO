"use client";

// F4b (fase F) — la tabla de leads: la base consultable. El criterio dictado:
// no se pierde ningún dato del recorrido, y sobre todo se ve el RESULTADO
// FINAL Y SU MOTIVO. Un lead sin motivo registrado lo dice («sin motivo
// registrado»), no lo tapa — esa celda honesta es la que F7 vendrá a rellenar
// con lo que el agente ya recogió en el log.
//
// Server-loaded (los datos llegan por props): sin skeleton ni estado de
// carga; el error de render lo ataja el error.tsx de la sección.

import { useMemo, useState } from "react";
import { useClinic } from "../../../lib/context/ClinicContext";
import { AvisoFiltroClinica } from "../../../components/shared/AvisoFiltroClinica";
import { Card } from "../../../components/ui/Card";
import { labelMotivo, MOTIVOS_ORDENADOS, MOTIVO_LEGACY } from "../../../lib/leads/motivos";
import type { Lead } from "../../pipeline/leads/types";

type Resultado = "en_curso" | "convertido" | "no_interesado";

function resultadoDe(l: Lead): Resultado {
  if (l.estado === "Convertido") return "convertido";
  if (l.estado === "No Interesado") return "no_interesado";
  return "en_curso";
}

const FILTROS: Array<{ id: "todos" | Resultado; label: string }> = [
  { id: "todos", label: "Todos" },
  { id: "en_curso", label: "En curso" },
  { id: "convertido", label: "Convertidos" },
  { id: "no_interesado", label: "No interesados" },
];

function fecha(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function TablaLeadsView({ leads }: { leads: Lead[] }) {
  const { selectedClinicaId, selectedClinicaNombre, setSelectedClinicaId } = useClinic();
  const clinicaFiltrada = !!selectedClinicaId && !!selectedClinicaNombre;
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState<"todos" | Resultado>("todos");
  // F7 — Tablas filtra por la COLUMNA de motivo (el log queda para la ficha).
  const [filtroMotivo, setFiltroMotivo] = useState<string>("todos");

  const visibles = useMemo(() => {
    let out = leads;
    if (selectedClinicaId) out = out.filter((l) => l.clinicaId === selectedClinicaId);
    if (filtro !== "todos") out = out.filter((l) => resultadoDe(l) === filtro);
    if (filtroMotivo !== "todos") {
      out = out.filter((l) =>
        filtroMotivo === "sin_motivo"
          ? resultadoDe(l) === "no_interesado" && !l.motivoNoInteres
          : l.motivoNoInteres === filtroMotivo,
      );
    }
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((l) =>
        [l.nombre, l.telefono, l.tratamiento, l.canal]
          .some((v) => v?.toLowerCase().includes(q)),
      );
    }
    // Auditoría: lo más reciente primero, orden estable.
    return [...out].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  }, [leads, selectedClinicaId, filtro, filtroMotivo, search]);

  const totales = useMemo(() => {
    const base = selectedClinicaId
      ? leads.filter((l) => l.clinicaId === selectedClinicaId)
      : leads;
    let conv = 0, noInt = 0;
    for (const l of base) {
      const r = resultadoDe(l);
      if (r === "convertido") conv++;
      else if (r === "no_interesado") noInt++;
    }
    return { total: base.length, conv, noInt, curso: base.length - conv - noInt };
  }, [leads, selectedClinicaId]);

  return (
    <div className="flex flex-col bg-[var(--color-background)] p-6 gap-4">
      <header>
        <h1 className="font-display text-xl font-semibold text-[var(--color-foreground)]">
          Leads
        </h1>
        <p className="text-[13px] text-[var(--color-muted)] mt-0.5">
          Todos los que entraron, con su recorrido y su resultado.
        </p>
      </header>

      {clinicaFiltrada && (
        <AvisoFiltroClinica
          nombre={selectedClinicaNombre!}
          onVerTodas={() => setSelectedClinicaId(null)}
        />
      )}

      <Card padding="none" className="px-5 py-3.5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] font-medium">Leads</p>
            <p className="font-display text-xl font-bold tabular-nums text-[var(--color-foreground)]">{totales.total}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] font-medium">En curso</p>
            <p className="font-display text-xl font-bold tabular-nums text-[var(--color-foreground)]">{totales.curso}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] font-medium">Convertidos</p>
            <p className="font-display text-xl font-bold tabular-nums text-[var(--color-success)]">{totales.conv}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-[var(--color-muted)] font-medium">No interesados</p>
            <p className="font-display text-xl font-bold tabular-nums text-[var(--color-foreground)]">{totales.noInt}</p>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFiltro(f.id)}
              className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                filtro === f.id
                  ? "bg-[var(--color-accent)] text-[var(--color-on-accent)] border-transparent"
                  : "bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-muted)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={filtroMotivo}
          onChange={(e) => setFiltroMotivo(e.target.value)}
          aria-label="Filtrar por motivo"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        >
          <option value="todos">Motivo: todos</option>
          {MOTIVOS_ORDENADOS.map((m) => (
            <option key={m} value={m}>{labelMotivo(m)}</option>
          ))}
          <option value={MOTIVO_LEGACY}>{labelMotivo(MOTIVO_LEGACY)}</option>
          <option value="sin_motivo">Sin motivo registrado</option>
        </select>
        <input
          type="search"
          placeholder="Buscar por nombre, teléfono o tratamiento…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-foreground)] px-4 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        />
      </div>

      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-[var(--color-surface-muted)] text-[var(--color-muted)] text-[10px] uppercase tracking-wider">
              <tr>
                <th className="text-left font-medium px-4 py-2.5">Alta</th>
                <th className="text-left font-medium px-4 py-2.5">Lead</th>
                <th className="text-left font-medium px-4 py-2.5">Clínica</th>
                <th className="text-left font-medium px-4 py-2.5">Canal</th>
                <th className="text-left font-medium px-4 py-2.5">Tratamiento</th>
                <th className="text-left font-medium px-4 py-2.5">Estado</th>
                <th className="text-left font-medium px-4 py-2.5">Cita</th>
                <th className="text-left font-medium px-4 py-2.5">Resultado</th>
                <th className="text-left font-medium px-4 py-2.5">Motivo</th>
                <th className="text-left font-medium px-4 py-2.5">Cerrado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {visibles.map((l) => {
                const r = resultadoDe(l);
                return (
                  <tr key={l.id} className="hover:bg-[var(--color-surface-muted)]">
                    <td className="px-4 py-2.5 tabular-nums text-[var(--color-muted)] whitespace-nowrap">
                      {fecha(l.createdAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-[var(--color-foreground)]">{l.nombre}</p>
                      {l.telefono && (
                        <p className="text-[11px] text-[var(--color-muted)] tabular-nums">{l.telefono}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-muted)]">{l.clinicaNombre ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[var(--color-muted)]">{l.canal ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[var(--color-foreground)]">{l.tratamiento ?? "—"}</td>
                    <td className="px-4 py-2.5 text-[var(--color-muted)] whitespace-nowrap">{l.estado}</td>
                    <td className="px-4 py-2.5 tabular-nums text-[var(--color-muted)] whitespace-nowrap">
                      {l.fechaCita ? `${fecha(l.fechaCita)}${l.horaCita ? ` ${l.horaCita}` : ""}` : "—"}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {r === "convertido" && (
                        <span className="font-semibold text-[var(--color-success)]">Paciente</span>
                      )}
                      {r === "no_interesado" && (
                        <span className="font-semibold text-[var(--color-danger)]">No interesado</span>
                      )}
                      {r === "en_curso" && <span className="text-[var(--color-muted)]">En curso</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      {r === "no_interesado" ? (
                        l.motivoNoInteres ? (
                          <span className="text-[var(--color-foreground)]">{labelMotivo(l.motivoNoInteres)}</span>
                        ) : (
                          <span className="text-[var(--color-muted)] italic">sin motivo registrado</span>
                        )
                      ) : (
                        <span className="text-[var(--color-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-[var(--color-muted)] whitespace-nowrap">
                      {fecha(l.fechaCierre)}
                    </td>
                  </tr>
                );
              })}
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-[var(--color-muted)]">
                    {leads.length === 0
                      ? "Aún no hay leads — entrarán aquí según lleguen."
                      : "Ningún lead coincide con el filtro."}
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
