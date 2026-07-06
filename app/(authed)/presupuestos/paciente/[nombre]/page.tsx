// app/(authed)/presupuestos/paciente/[nombre]/page.tsx
//
// Sprint 14a Bloque 1.5 — ruta legacy. Resuelve el nombre al
// recordId del primer paciente match y redirige al hub central
// /pacientes/[id]. Mantiene retrocompat con los links legados
// (Kanban Presupuestos, MaximaView, etc.) sin tener que actualizarlos
// uno a uno.
//
// Si el nombre no resuelve a ningún paciente, intentamos extraer el id
// vía Presupuestos.Paciente (puede haber pacientes "ghost" creados solo
// como linked record desde un presupuesto). Si tampoco, fallback al
// componente legacy con vista por nombre — no rompemos QA antiguo.

import { redirect } from "next/navigation";
import { getSession } from "../../../../lib/auth/session";
import { listPacientes } from "../../../../lib/pacientes/pacientes";
import { base, TABLES, fetchAll, runWithCliente } from "../../../../lib/airtable";
import Paciente360ViewLegacy from "../../../../components/presupuestos/Paciente360View";
import type { UserSession } from "../../../../lib/presupuestos/types";

export const dynamic = "force-dynamic";

async function resolvePacienteId(nombre: string): Promise<string | null> {
  // 1) Match exacto en tabla Pacientes (case-insensitive).
  try {
    const pacs = await listPacientes({ search: nombre });
    const exact = pacs.find((p) => p.nombre.toLowerCase() === nombre.toLowerCase());
    if (exact) return exact.id;
    if (pacs[0]) return pacs[0].id;
  } catch {
    /* fallback */
  }
  // 2) Match desde Presupuestos.Paciente (linked record).
  try {
    const recs = await fetchAll(
      base(TABLES.presupuestos as any).select({
        filterByFormula: `LOWER({Paciente_nombre}) = LOWER("${nombre.replace(/['"\\]/g, "")}")`,
        fields: ["Paciente"],
        maxRecords: 1,
      }),
    );
    const links = ((recs[0]?.fields as any)?.["Paciente"] ?? []) as string[];
    if (links[0]) return links[0];
  } catch {
    /* fallback */
  }
  return null;
}

export default async function PacientePage({
  params,
}: {
  params: Promise<{ nombre: string }>;
}) {
  const s = await getSession();
  if (!s) redirect("/login");

  const { nombre } = await params;
  const decoded = decodeURIComponent(nombre);

  // Sprint B — resolvePacienteId llama a base(); fijar el contexto de cliente.
  const pacienteId = await runWithCliente(s.cliente, () => resolvePacienteId(decoded));
  if (pacienteId) {
    redirect(`/pacientes/${pacienteId}`);
  }

  // Fallback: nombre no resoluble — render legacy view (cero break).
  const user: UserSession = {
    email: "",
    nombre: s.nombre,
    rol: s.rol === "admin" ? "manager_general" : "encargada_ventas",
    clinica: null,
  };
  return <Paciente360ViewLegacy user={user} nombre={decoded} />;
}
