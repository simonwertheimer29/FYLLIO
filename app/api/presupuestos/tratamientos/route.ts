// app/api/presupuestos/tratamientos/route.ts
//
// Catálogo de tratamientos de la clínica para el selector del modal de
// presupuesto (spec 2026-07-29, punto 3). Antes el campo era texto libre
// separado por comas, así que cada coordinadora escribía el mismo tratamiento
// de una manera y no había forma de agregar por tratamiento sin adivinar.
//
// Medido antes de construirlo: el catálogo existe (12 tratamientos con
// categoría) y cubre el 100% de los que aparecen hoy en presupuestos.

import { NextResponse } from "next/server";
import { withAuth } from "../../../lib/auth/session";
import { listTratamientosRaw } from "../../../lib/scheduler/repo/treatmentsRepo";

export const dynamic = "force-dynamic";

export type TratamientoCatalogo = { nombre: string; categoria: string | null };

export const GET = withAuth(async () => {
  try {
    const recs = await listTratamientosRaw();
    const vistos = new Set<string>();
    const tratamientos: TratamientoCatalogo[] = [];
    for (const r of recs) {
      const f = (r as { fields?: Record<string, unknown> }).fields ?? {};
      const nombre = String(f["Nombre"] ?? "").trim();
      if (!nombre || vistos.has(nombre.toLowerCase())) continue;
      vistos.add(nombre.toLowerCase());
      tratamientos.push({
        nombre,
        categoria: f["Categoria"] ? String(f["Categoria"]) : null,
      });
    }
    tratamientos.sort(
      (a, b) =>
        (a.categoria ?? "").localeCompare(b.categoria ?? "", "es") ||
        a.nombre.localeCompare(b.nombre, "es"),
    );
    return NextResponse.json({ tratamientos });
  } catch (err) {
    // Un catálogo vacío por error NO puede pasar por "esta clínica no tiene
    // tratamientos" (§4): el modal enseña el fallo y ofrece reintentar.
    console.error("[presupuestos/tratamientos]", err);
    return NextResponse.json({ error: "No se pudo cargar el catálogo" }, { status: 500 });
  }
});
