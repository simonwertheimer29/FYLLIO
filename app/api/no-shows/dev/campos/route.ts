// app/api/no-shows/dev/campos/route.ts
// TEMPORAL — diagnóstico de campos reales en Airtable.
// Eliminar después de confirmar nombres de campos.
// GET /api/no-shows/dev/campos

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../../lib/airtable";

export async function GET() {
  const result: Record<string, unknown> = {};

  // ── Tabla Citas ───────────────────────────────────────────────────────────
  try {
    const citas = await (base(TABLES.appointments as any).select({ maxRecords: 3 }).firstPage() as any);
    if (citas.length > 0) {
      result.citas_campos = Object.keys(citas[0].fields).sort();
      result.citas_ejemplo = citas[0].fields;
      // Recopilar valores únicos de "Estado" entre los registros
      const estados = [...new Set(citas.map((r: any) => r.fields["Estado"]).filter(Boolean))];
      result.citas_estados_encontrados = estados;
    } else {
      result.citas_campos = "tabla vacía";
    }
  } catch (e: any) {
    result.citas_error = e?.message;
  }

  // ── Tabla Pacientes ───────────────────────────────────────────────────────
  try {
    const pacs = await (base(TABLES.patients as any).select({ maxRecords: 2 }).firstPage() as any);
    if (pacs.length > 0) {
      result.pacientes_campos = Object.keys(pacs[0].fields).sort();
      result.pacientes_ejemplo = pacs[0].fields;
    } else {
      result.pacientes_campos = "tabla vacía";
    }
  } catch (e: any) {
    result.pacientes_error = e?.message;
  }

  // ── Tabla Usuarios_Presupuestos ───────────────────────────────────────────
  try {
    const users = await (base(TABLES.usuariosPresupuestos as any).select({ maxRecords: 2 }).firstPage() as any);
    if (users.length > 0) {
      result.usuarios_campos = Object.keys(users[0].fields).sort();
    } else {
      result.usuarios_campos = "tabla vacía";
    }
  } catch (e: any) {
    result.usuarios_error = e?.message;
  }

  return NextResponse.json(result, { status: 200 });
}
