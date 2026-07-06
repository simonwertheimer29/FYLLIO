// app/api/presupuestos/plantillas/route.ts
// CRUD para plantillas de mensaje

import { NextResponse } from "next/server";
import { base, TABLES } from "../../../lib/airtable";
import { DateTime } from "luxon";
import type { PlantillaMensaje } from "../../../lib/presupuestos/types";
import { withPresupuestosAuth } from "@/lib/auth/legacy-presupuestos";

const ZONE = "Europe/Madrid";

function recordToPlantilla(r: any): PlantillaMensaje {
  const f = r.fields as any;
  return {
    id: r.id,
    nombre: String(f["Nombre"] ?? ""),
    tipo: f["Tipo"] ?? "Primer contacto",
    clinica: String(f["Clinica"] ?? "Todas"),
    doctor: String(f["Doctor"] ?? ""),
    tratamiento: String(f["Tratamiento"] ?? ""),
    contenido: String(f["Contenido"] ?? ""),
    activa: f["Activa"] === true,
    fechaCreacion: f["Fecha_creacion"] ? String(f["Fecha_creacion"]) : "",
  };
}

// GET — lista plantillas
export const GET = withPresupuestosAuth(async (session, req: Request) => {
  try {
    const url = new URL(req.url);
    const clinicaFilter = url.searchParams.get("clinica") || "";
    const tipoFilter = url.searchParams.get("tipo") || "";

    let filterParts: string[] = [];
    if (clinicaFilter) {
      filterParts.push(`OR({Clinica}='${clinicaFilter}', {Clinica}='Todas')`);
    }
    if (tipoFilter) {
      filterParts.push(`{Tipo}='${tipoFilter}'`);
    }

    const selectOpts: any = {
      fields: ["Nombre", "Tipo", "Clinica", "Doctor", "Tratamiento", "Contenido", "Activa", "Fecha_creacion"],
      sort: [{ field: "Tipo", direction: "asc" }, { field: "Nombre", direction: "asc" }],
    };
    if (filterParts.length > 0) {
      selectOpts.filterByFormula = filterParts.length === 1
        ? filterParts[0]
        : `AND(${filterParts.join(", ")})`;
    }

    const recs = await base(TABLES.plantillasMensaje as any).select(selectOpts).all();
    const plantillas = recs.map(recordToPlantilla);

    return NextResponse.json({ plantillas });
  } catch (err) {
    console.error("[plantillas] GET error:", err);
    return NextResponse.json({ plantillas: [], error: "Error al cargar plantillas" });
  }
});

// POST — crear plantilla
export const POST = withPresupuestosAuth(async (session, req: Request) => {
  try {
    const body = await req.json();
    const { nombre, tipo, clinica, doctor, tratamiento, contenido } = body as {
      nombre: string;
      tipo: string;
      clinica?: string;
      doctor?: string;
      tratamiento?: string;
      contenido: string;
    };

    if (!nombre || !tipo || !contenido) {
      return NextResponse.json({ error: "nombre, tipo y contenido son requeridos" }, { status: 400 });
    }

    const now = DateTime.now().setZone(ZONE).toISO() ?? new Date().toISOString();

    const rec = await (base(TABLES.plantillasMensaje as any).create as any)({
      Nombre: nombre,
      Tipo: tipo,
      Clinica: clinica || "Todas",
      Doctor: doctor || "",
      Tratamiento: tratamiento || "",
      Contenido: contenido,
      Activa: true,
      Fecha_creacion: now,
    });

    return NextResponse.json({ ok: true, plantilla: recordToPlantilla(rec) });
  } catch (err) {
    console.error("[plantillas] POST error:", err);
    return NextResponse.json({ error: "Error al crear plantilla" }, { status: 500 });
  }
});

// PUT — actualizar plantilla
export const PUT = withPresupuestosAuth(async (session, req: Request) => {
  try {
    const body = await req.json();
    const { id, nombre, tipo, clinica, doctor, tratamiento, contenido, activa } = body as {
      id: string;
      nombre?: string;
      tipo?: string;
      clinica?: string;
      doctor?: string;
      tratamiento?: string;
      contenido?: string;
      activa?: boolean;
    };

    if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

    const update: Record<string, any> = {};
    if (nombre !== undefined) update.Nombre = nombre;
    if (tipo !== undefined) update.Tipo = tipo;
    if (clinica !== undefined) update.Clinica = clinica;
    if (doctor !== undefined) update.Doctor = doctor;
    if (tratamiento !== undefined) update.Tratamiento = tratamiento;
    if (contenido !== undefined) update.Contenido = contenido;
    if (activa !== undefined) update.Activa = activa;

    await base(TABLES.plantillasMensaje as any).update(id, update as any);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[plantillas] PUT error:", err);
    return NextResponse.json({ error: "Error al actualizar plantilla" }, { status: 500 });
  }
});

// DELETE — eliminar plantilla
export const DELETE = withPresupuestosAuth(async (session, req: Request) => {
  try {
    const body = await req.json();
    const { id } = body as { id: string };

    if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });

    await base(TABLES.plantillasMensaje as any).destroy(id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[plantillas] DELETE error:", err);
    return NextResponse.json({ error: "Error al eliminar plantilla" }, { status: 500 });
  }
});
