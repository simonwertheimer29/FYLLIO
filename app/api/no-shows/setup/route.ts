// app/api/no-shows/setup/route.ts
// ENDPOINT TEMPORAL — crear 4 campos en la tabla Citas de Airtable.
// Visitar una sola vez con sesión activa y luego ELIMINAR este archivo.
// Requiere JWT cookie fyllio_noshows_token.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch { return null; }
}

const FIELDS_TO_CREATE = [
  {
    name: "Ultima_accion",
    type: "date",
    options: { dateFormat: { name: "iso" } },
  },
  {
    name: "Tipo_ultima_accion",
    type: "singleSelect",
    options: {
      choices: [
        { name: "WA enviado" },
        { name: "Llamada" },
        { name: "Sin respuesta" },
        { name: "Confirmado" },
        { name: "Cancelado" },
      ],
    },
  },
  {
    name: "Fase_recordatorio",
    type: "singleSelect",
    options: {
      choices: [
        { name: "72h" },
        { name: "48h" },
        { name: "24h" },
        { name: "Mismo día" },
      ],
    },
  },
  {
    name: "Notas_accion",
    type: "multilineText",
  },
];

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!apiKey || !baseId) {
    return NextResponse.json({ error: "Faltan variables AIRTABLE_API_KEY / AIRTABLE_BASE_ID" }, { status: 500 });
  }

  // 1. Encontrar el tableId de "Citas"
  const tablesRes = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!tablesRes.ok) {
    const err = await tablesRes.text();
    return NextResponse.json({ error: `Meta API error: ${err}` }, { status: 500 });
  }
  const tablesData = await tablesRes.json();
  const citasTable = (tablesData.tables ?? []).find(
    (t: any) => t.name === "Citas",
  );
  if (!citasTable) {
    return NextResponse.json({
      error: "Tabla 'Citas' no encontrada",
      tablesAvailable: (tablesData.tables ?? []).map((t: any) => t.name),
    }, { status: 404 });
  }
  const tableId = citasTable.id;

  // 2. Crear los 4 campos
  const results: { field: string; status: string; detail?: string }[] = [];

  for (const field of FIELDS_TO_CREATE) {
    try {
      const res = await fetch(
        `https://api.airtable.com/v0/meta/bases/${baseId}/tables/${tableId}/fields`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(field),
        },
      );
      if (res.ok) {
        results.push({ field: field.name, status: "creado" });
      } else {
        const body = await res.json().catch(() => ({}));
        // 422 = campo ya existe; tratarlo como OK
        const detail = body?.error?.message ?? JSON.stringify(body);
        if (res.status === 422) {
          results.push({ field: field.name, status: "ya existe", detail });
        } else {
          results.push({ field: field.name, status: `error ${res.status}`, detail });
        }
      }
    } catch (e: any) {
      results.push({ field: field.name, status: "excepción", detail: e?.message });
    }
  }

  return NextResponse.json({
    message: "Setup completado. Elimina este archivo (app/api/no-shows/setup/route.ts) para mayor seguridad.",
    tableId,
    tableName: citasTable.name,
    results,
  });
}
