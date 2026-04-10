// app/api/no-shows/informes/guardados/route.ts
// GET: informes noshow_semanal guardados en Airtable
// Requiere JWT cookie fyllio_noshows_token

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { base, TABLES } from "../../../../lib/airtable";
import type { NoShowsUserSession, InformeNoShow } from "../../../../lib/no-shows/types";

const COOKIE = "fyllio_noshows_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function getSession(): Promise<NoShowsUserSession | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as NoShowsUserSession;
  } catch { return null; }
}

function safeParseJson(raw: unknown): InformeNoShow["contenidoJson"] {
  if (!raw) return { totalCitas: 0, totalNoShows: 0, tasa: 0 };
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as InformeNoShow["contenidoJson"];
  try { return JSON.parse(String(raw)); } catch { return { totalCitas: 0, totalNoShows: 0, tasa: 0 }; }
}

function mapRecord(r: { id: string; fields: Record<string, unknown> }): InformeNoShow {
  const f = r.fields;
  return {
    id: r.id,
    tipo: "noshow_semanal",
    clinica: String(f["clinica"] ?? ""),
    periodo: String(f["periodo"] ?? ""),
    titulo: String(f["titulo"] ?? ""),
    contenidoJson: safeParseJson(f["contenido_json"]),
    textoNarrativo: f["texto_narrativo"] ? String(f["texto_narrativo"]) : undefined,
    generadoEn: String(f["generado_en"] ?? ""),
    generadoPor: String(f["generado_por"] ?? ""),
  };
}

// ─── Demo fallback ─────────────────────────────────────────────────────────────

const DEMO_INFORMES: InformeNoShow[] = [
  {
    id: "demo-noshow-w14",
    tipo: "noshow_semanal",
    clinica: "Todas",
    periodo: "2026-W14",
    titulo: "No-shows semana 14 · 31 mar – 4 abr 2026",
    contenidoJson: {
      totalCitas: 147,
      totalNoShows: 12,
      tasa: 0.082,
      porClinica: [
        { clinica: "Clínica Madrid Centro", tasa: 0.071 },
        { clinica: "Clínica Pozuelo", tasa: 0.095 },
      ],
      alertas: ["Tasa en Clínica Pozuelo por encima del umbral (9.5%)"],
    },
    textoNarrativo: `La semana 14 cerró con una **tasa de no-show del 8,2%**, por debajo de la media del sector (12%). Se registraron **12 no-shows** sobre un total de **147 citas**, lo que representa una mejora respecto a la semana anterior (+2.7 p.p.).

**Clínica Madrid Centro** mantuvo su nivel de excelencia con un 7,1% de ausencias, mientras que **Clínica Pozuelo** presentó una tasa del 9,5%, ligeramente por encima del umbral de alerta. Los martes y viernes concentraron el mayor número de no-shows. Los tratamientos de ortodoncia acumularon el 41% de las ausencias, consistente con el perfil de alta duración.

**Acciones recomendadas para la semana 15:** Reforzar recordatorios en Clínica Pozuelo los lunes. Revisar protocolo de confirmación para ortodoncia. Aprovechar los huecos generados para reubicar pacientes en lista de espera.`,
    generadoEn: "2026-04-07T09:03:00.000Z",
    generadoPor: "sistema",
  },
  {
    id: "demo-noshow-w13",
    tipo: "noshow_semanal",
    clinica: "Todas",
    periodo: "2026-W13",
    titulo: "No-shows semana 13 · 24–28 mar 2026",
    contenidoJson: {
      totalCitas: 138,
      totalNoShows: 15,
      tasa: 0.109,
      porClinica: [
        { clinica: "Clínica Madrid Centro", tasa: 0.103 },
        { clinica: "Clínica Pozuelo", tasa: 0.118 },
      ],
      alertas: [
        "Tasa total por encima del umbral de alerta (10.9%)",
        "Tasa en Clínica Pozuelo al borde del nivel crítico (11.8%)",
      ],
    },
    textoNarrativo: `La semana 13 registró una **tasa de no-show del 10,9%**, superando el umbral de alerta del 10%. Se produjeron **15 no-shows** en **138 citas**, el peor resultado en las últimas 4 semanas.

**Clínica Pozuelo** alcanzó un 11,8% de ausencias, cerca del nivel crítico. **Clínica Madrid Centro** mostró una tasa del 10,3%, también elevada. La semana coincidió con Semana Santa, lo que puede explicar parcialmente el aumento. Sin embargo, el incremento en pacientes de primera visita que no se presentaron (+3 respecto a la media) sugiere reforzar el proceso de confirmación para nuevos pacientes.

**⚠️ Esta semana activó el protocolo de alerta: se recomienda revisión inmediata del flujo de confirmaciones para nuevos pacientes.**`,
    generadoEn: "2026-03-31T09:05:00.000Z",
    generadoPor: "sistema",
  },
];

// ─── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const clinicaFilter =
    session.rol === "manager_general"
      ? null
      : session.clinica;

  try {
    const filters = [`{tipo}='noshow_semanal'`];
    if (clinicaFilter) filters.push(`OR({clinica}='${clinicaFilter}',{clinica}='Todas')`);

    const formula = `AND(${filters.join(",")})`;
    const recs = await base(TABLES.informesGuardados as any)
      .select({
        filterByFormula: formula,
        fields: ["tipo", "clinica", "periodo", "titulo", "contenido_json", "texto_narrativo", "generado_en", "generado_por"],
        sort: [{ field: "generado_en", direction: "desc" }],
        maxRecords: 20,
      })
      .all();

    if (recs.length === 0) {
      return NextResponse.json({ informes: DEMO_INFORMES, isDemo: true });
    }

    return NextResponse.json({
      informes: recs.map((r: { id: string; fields: Record<string, unknown> }) => mapRecord({ id: r.id, fields: r.fields })),
    });
  } catch {
    return NextResponse.json({ informes: DEMO_INFORMES, isDemo: true });
  }
}
