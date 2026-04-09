// app/api/informes/generar-pdf-semanal/route.tsx
// POST — genera informe semanal en PDF (100% server-side, sin capturas de DOM)
// Body: { periodo, clinica, textoNarrativo, datos: SemanalDatos }

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { renderToBuffer, Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { graficoBarrasH } from "../../../lib/charts/svg-charts";

const COOKIE = "fyllio_presupuestos_token";
const SECRET_RAW = process.env.PRESUPUESTOS_JWT_SECRET ?? "dev-secret-change-me-in-prod";
const secret = new TextEncoder().encode(SECRET_RAW);

async function isAuthed(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE)?.value;
    if (!token) return false;
    await jwtVerify(token, secret);
    return true;
  } catch { return false; }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type SemanalClinica = {
  clinica: string;
  nuevos: number;
  totalSeguimiento: number;
  eurosSeguimiento: number;
  riesgoAlto: number;
  riesgoMuyAlto: number;
  aceptadosEstaSemana: number;
  perdidosEstaSemana: number;
};

type SemanalDatos = {
  clinicas: SemanalClinica[];
  totalNuevos: number;
  totalSeguimiento: number;
  eurosSeguimiento: number;
  riesgoAlto: number;
  riesgoMuyAlto: number;
  semana: number;
  anio: number;
  mesActual?: string;
  objetivos?: Record<string, number>;
  aceptadosMes?: Record<string, number>;
  alertaPrincipal: string;
};

// ─── Styles (same palette/tokens as generar-pdf) ─────────────────────────────

const C = {
  primary: "#7C3AED",
  text: "#1E293B",
  muted: "#64748B",
  border: "#E2E8F0",
  green: "#16A34A",
  red: "#DC2626",
  orange: "#EA580C",
  bg: "#F8FAFC",
  bgPurple: "#F5F3FF",
};

const S = StyleSheet.create({
  page: {
    fontFamily: "Helvetica", fontSize: 10, color: C.text,
    paddingTop: 36, paddingBottom: 50, paddingHorizontal: 48,
  },
  coverPage: {
    fontFamily: "Helvetica", backgroundColor: C.primary,
    paddingTop: 140, paddingHorizontal: 60, paddingBottom: 60,
  },
  coverTitle: { fontSize: 30, fontFamily: "Helvetica-Bold", color: "#FFF", marginBottom: 10 },
  coverDivider: { width: 48, height: 3, backgroundColor: "#A78BFA", marginBottom: 20 },
  coverSubtitle: { fontSize: 17, color: "#EDE9FE", marginBottom: 4 },
  coverMeta: { fontSize: 9.5, color: "#C4B5FD", marginTop: 36 },
  sectionTitle: {
    fontSize: 13, fontFamily: "Helvetica-Bold", color: C.primary,
    marginBottom: 10, borderBottomWidth: 1, borderBottomColor: C.primary, paddingBottom: 3,
  },
  metricsRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  metricCard: {
    flex: 1, backgroundColor: C.bg, borderRadius: 5, padding: 9,
    borderWidth: 1, borderColor: C.border,
  },
  metricCardEmpty: {
    flex: 1, backgroundColor: "white", borderRadius: 5, padding: 9,
    borderWidth: 1, borderColor: "white",
  },
  metricValue: { fontSize: 20, fontFamily: "Helvetica-Bold", color: C.text, marginBottom: 1 },
  metricLabel: { fontSize: 7.5, color: C.muted, textTransform: "uppercase" },
  paragraph: { fontSize: 9.5, lineHeight: 1.65, color: C.text, marginBottom: 8 },
  small: { fontSize: 8.5, lineHeight: 1.5, color: C.muted, marginBottom: 6 },
  tableHeader: {
    flexDirection: "row", backgroundColor: "#F1F5F9",
    paddingVertical: 4, paddingHorizontal: 7, borderRadius: 3, marginBottom: 1,
  },
  tableRow: {
    flexDirection: "row", paddingVertical: 3, paddingHorizontal: 7,
    borderBottomWidth: 1, borderBottomColor: "#F1F5F9",
  },
  th: { flex: 1, fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.muted, textTransform: "uppercase" },
  td: { flex: 1, fontSize: 8.5, color: C.text },
  chartImg: { width: "100%", marginBottom: 10, borderRadius: 3 },
  chartImgHalf: { width: "100%", marginBottom: 8, borderRadius: 3 },
  planBlock: { marginBottom: 12, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: C.primary },
  planNum: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.primary, marginBottom: 2 },
  planBody: { fontSize: 9.5, lineHeight: 1.6, color: C.text },
  footer: { position: "absolute", bottom: 18, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 7.5, color: C.muted },
  analysisBlock: {
    backgroundColor: C.bgPurple, borderRadius: 4, padding: 8,
    borderLeftWidth: 2.5, borderLeftColor: C.primary, marginBottom: 8,
  },
  analysisBody: { fontSize: 8.5, lineHeight: 1.55, color: C.text },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function euro(n: number): string {
  return `€${n.toLocaleString("es-ES")}`;
}

function plainText(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1");
}

/** Extract the 3 lines between ACCIONES_LUNES: and FIN_ACCIONES */
function extractAcciones(texto: string): string[] {
  const start = texto.indexOf("ACCIONES_LUNES:");
  const end = texto.indexOf("FIN_ACCIONES");
  if (start === -1 || end === -1 || end <= start) return [];
  const block = texto.slice(start + "ACCIONES_LUNES:".length, end).trim();
  return block
    .split("\n")
    .map((l) => l.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

/** Return the narrative text without the ACCIONES_LUNES block */
function narrativoSinAcciones(texto: string): string {
  const start = texto.indexOf("ACCIONES_LUNES:");
  if (start === -1) return texto;
  return texto.slice(0, start).trim();
}

function riesgoColor(n: number): string {
  if (n === 0) return C.text;
  if (n >= 5) return C.red;
  return C.orange;
}

// ─── PDF Document ─────────────────────────────────────────────────────────────

function InformeSemanalPDF({
  periodo, clinica, textoNarrativo, datos, generadoEn,
  pngPipeline, pngRiesgo, pngProgreso,
}: {
  periodo: string;
  clinica: string;
  textoNarrativo: string;
  datos: SemanalDatos;
  generadoEn: string;
  pngPipeline: string;
  pngRiesgo: string;
  pngProgreso: string;
}) {
  const acciones = extractAcciones(textoNarrativo);
  const narrativo = narrativoSinAcciones(textoNarrativo);
  const parrafos = narrativo.split("\n\n").filter(Boolean).map((p) => plainText(p.trim()));

  const semana = datos.semana ?? Number((periodo.split("-W")[1] ?? "0"));
  const anio = datos.anio ?? Number((periodo.split("-W")[0] ?? "0"));
  const semanaLabel = `Semana ${semana}, ${anio}`;
  const fecha = new Date(generadoEn).toLocaleDateString("es-ES", {
    day: "2-digit", month: "long", year: "numeric",
  });

  // Pre-compute objetivos table rows to avoid complex JSX
  const objetivosEntries = Object.entries(datos.objetivos ?? {});

  const Footer = () => (
    <View style={S.footer} fixed>
      <Text style={S.footerText}>{clinica} · {semanaLabel}</Text>
      <Text
        style={S.footerText}
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );

  return (
    <Document
      title={`Informe Semanal ${semanaLabel} — ${clinica}`}
      author="Fyllio"
      creator="Fyllio CRM"
    >
      {/* ─── 1. Portada ──────────────────────────────────────────── */}
      <Page size="A4" style={S.coverPage}>
        <Text style={S.coverTitle}>INFORME SEMANAL{"\n"}DE PRESUPUESTOS</Text>
        <View style={S.coverDivider} />
        <Text style={S.coverSubtitle}>{semanaLabel.toUpperCase()}</Text>
        <Text style={{ ...S.coverSubtitle, fontSize: 14 }}>{clinica}</Text>
        <Text style={S.coverMeta}>
          Generado el {fecha} · {datos.totalSeguimiento} presupuestos en seguimiento
        </Text>
        <Text style={{ ...S.coverMeta, marginTop: 4 }}>
          Informe generado con IA · Confidencial · Uso interno
        </Text>
      </Page>

      {/* ─── 2. Resumen ejecutivo ────────────────────────────────── */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>RESUMEN EJECUTIVO — {semanaLabel.toUpperCase()}</Text>

        {/* Fila 1: 3 métricas */}
        <View style={S.metricsRow}>
          <View style={S.metricCard}>
            <Text style={S.metricValue}>{datos.totalNuevos}</Text>
            <Text style={S.metricLabel}>Nuevos esta semana</Text>
          </View>
          <View style={S.metricCard}>
            <Text style={S.metricValue}>{datos.totalSeguimiento}</Text>
            <Text style={S.metricLabel}>En seguimiento</Text>
          </View>
          <View style={S.metricCard}>
            <Text style={S.metricValue}>{euro(datos.eurosSeguimiento)}</Text>
            <Text style={S.metricLabel}>Euros en juego</Text>
          </View>
        </View>

        {/* Fila 2: 2 métricas de riesgo */}
        <View style={{ ...S.metricsRow, marginBottom: 16 }}>
          <View style={S.metricCard}>
            <Text style={{ ...S.metricValue, color: C.orange }}>{datos.riesgoAlto}</Text>
            <Text style={S.metricLabel}>Riesgo alto (14+ dias)</Text>
          </View>
          <View style={S.metricCard}>
            <Text style={{ ...S.metricValue, color: datos.riesgoMuyAlto > 0 ? C.red : C.text }}>
              {datos.riesgoMuyAlto}
            </Text>
            <Text style={S.metricLabel}>Riesgo muy alto (30+ dias)</Text>
          </View>
          <View style={S.metricCardEmpty} />
        </View>

        {/* Alerta principal */}
        <View style={S.analysisBlock}>
          <Text style={S.analysisBody}>{datos.alertaPrincipal}</Text>
        </View>
        <Footer />
      </Page>

      {/* ─── 3. Pipeline y riesgo por clínica ───────────────────── */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>PIPELINE POR CLÍNICA</Text>
        {pngPipeline ? (
          <Image style={S.chartImg} src={`data:image/png;base64,${pngPipeline}`} />
        ) : (
          <View style={{ ...S.analysisBlock, marginBottom: 10 }}>
            <Text style={S.analysisBody}>Sin datos de pipeline disponibles.</Text>
          </View>
        )}

        <Text style={{ ...S.sectionTitle, marginTop: 6 }}>RIESGO POR CLÍNICA</Text>
        {pngRiesgo ? (
          <Image style={S.chartImgHalf} src={`data:image/png;base64,${pngRiesgo}`} />
        ) : null}

        {/* Tabla detallada */}
        <View style={S.tableHeader}>
          <Text style={{ ...S.th, flex: 2 }}>Clínica</Text>
          <Text style={{ ...S.th, textAlign: "right" }}>Nuevos</Text>
          <Text style={{ ...S.th, textAlign: "right" }}>Seguimiento</Text>
          <Text style={{ ...S.th, textAlign: "right" }}>Pipeline</Text>
          <Text style={{ ...S.th, textAlign: "right" }}>Riesgo alto</Text>
        </View>
        {datos.clinicas.map((c, i) => (
          <View key={i} style={S.tableRow}>
            <Text style={{ ...S.td, flex: 2 }}>{c.clinica}</Text>
            <Text style={{ ...S.td, textAlign: "right" }}>{c.nuevos}</Text>
            <Text style={{ ...S.td, textAlign: "right" }}>{c.totalSeguimiento}</Text>
            <Text style={{ ...S.td, textAlign: "right" }}>{euro(c.eurosSeguimiento)}</Text>
            <Text style={{ ...S.td, textAlign: "right", color: riesgoColor(c.riesgoAlto) }}>
              {c.riesgoAlto}
            </Text>
          </View>
        ))}
        <Footer />
      </Page>

      {/* ─── 4. Análisis narrativo ───────────────────────────────── */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>ANÁLISIS NARRATIVO — IA</Text>
        {parrafos.length > 0 ? (
          parrafos.map((p, i) => (
            <Text key={i} style={S.paragraph}>{p}</Text>
          ))
        ) : (
          <Text style={S.small}>Sin análisis disponible para esta semana.</Text>
        )}
        <Footer />
      </Page>

      {/* ─── 5. Acciones del lunes + progreso mensual ───────────── */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>ACCIONES DEL LUNES</Text>
        {acciones.length > 0 ? (
          acciones.map((a, i) => (
            <View key={i} style={S.planBlock}>
              <Text style={S.planNum}>ACCIÓN {i + 1}</Text>
              <Text style={S.planBody}>{a}</Text>
            </View>
          ))
        ) : (
          <Text style={S.small}>Sin acciones disponibles.</Text>
        )}

        {/* Progreso mensual */}
        <Text style={{ ...S.sectionTitle, marginTop: 14 }}>PROGRESO MENSUAL POR CLÍNICA</Text>
        {pngProgreso ? (
          <Image style={S.chartImgHalf} src={`data:image/png;base64,${pngProgreso}`} />
        ) : null}

        {objetivosEntries.length > 0 ? (
          <View>
            <View style={S.tableHeader}>
              <Text style={{ ...S.th, flex: 2 }}>Clínica</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>Objetivo</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>Aceptados</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>Progreso</Text>
            </View>
            {objetivosEntries.map(([clinicaName, obj], i) => {
              const acept = datos.aceptadosMes?.[clinicaName] ?? 0;
              const pct = obj > 0 ? Math.round((acept / obj) * 100) : 0;
              const pctColor = pct >= 80 ? C.green : pct >= 50 ? C.text : C.red;
              return (
                <View key={i} style={S.tableRow}>
                  <Text style={{ ...S.td, flex: 2 }}>{clinicaName}</Text>
                  <Text style={{ ...S.td, textAlign: "right" }}>{obj}</Text>
                  <Text style={{ ...S.td, textAlign: "right" }}>{acept}</Text>
                  <Text style={{ ...S.td, textAlign: "right", color: pctColor }}>{pct}%</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={S.small}>Sin datos de objetivos mensuales configurados.</Text>
        )}

        <View style={{ marginTop: 16 }}>
          <Text style={{ ...S.small, color: C.muted }}>
            Generado el {fecha} · {semanaLabel} · {datos.totalSeguimiento} presupuestos en seguimiento · Confidencial · Fyllio CRM
          </Text>
        </View>
        <Footer />
      </Page>
    </Document>
  );
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  if (!(await isAuthed())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { periodo, clinica, textoNarrativo, datos } = body as {
      periodo: string;
      clinica: string;
      textoNarrativo: string;
      datos: SemanalDatos;
    };

    if (!periodo || !datos) {
      return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
    }

    const clinicasData = datos.clinicas ?? [];

    // ── Generar gráficos server-side ─────────────────────────────────────────

    const [bufPipeline, bufRiesgo, bufProgreso] = await Promise.all([
      // Pipeline: euros en seguimiento por clínica
      graficoBarrasH(
        clinicasData
          .filter((c) => c.eurosSeguimiento > 0)
          .map((c) => ({ label: c.clinica, value: c.eurosSeguimiento, color: "#7C3AED" }))
      ),

      // Riesgo alto por clínica
      graficoBarrasH(
        clinicasData
          .filter((c) => c.riesgoAlto > 0)
          .map((c) => ({
            label: c.clinica,
            value: c.riesgoAlto,
            color: c.riesgoMuyAlto > 0 ? "#DC2626" : "#EA580C",
          }))
      ),

      // Progreso mensual por clínica (% hacia objetivo)
      Object.keys(datos.objetivos ?? {}).length > 0
        ? graficoBarrasH(
            Object.entries(datos.objetivos ?? {})
              .map(([clinicaName, obj]) => {
                const acept = datos.aceptadosMes?.[clinicaName] ?? 0;
                const pct = obj > 0 ? Math.round((acept / obj) * 100) : 0;
                return {
                  label: clinicaName,
                  value: pct,
                  color: pct >= 80 ? "#16A34A" : pct >= 50 ? "#D97706" : "#DC2626",
                };
              })
              .filter((d) => d.value >= 0)
          )
        : Promise.resolve(null),
    ]);

    const toB64 = (b: Buffer | null): string => (b ? b.toString("base64") : "");
    const pngPipeline = toB64(bufPipeline);
    const pngRiesgo   = toB64(bufRiesgo);
    const pngProgreso = toB64(bufProgreso);

    const generadoEn = new Date().toISOString();

    const buffer = await renderToBuffer(
      <InformeSemanalPDF
        periodo={periodo}
        clinica={clinica ?? "Todas las clínicas"}
        textoNarrativo={textoNarrativo ?? ""}
        datos={datos}
        generadoEn={generadoEn}
        pngPipeline={pngPipeline}
        pngRiesgo={pngRiesgo}
        pngProgreso={pngProgreso}
      />
    );

    // Filename: Informe_Semanal_2025-W04_Clinica.pdf
    const safePeriodo = periodo.replace(/[^A-Za-z0-9_-]/g, "_");
    const safeCli = (clinica ?? "Clinicas").replace(/\s+/g, "_");
    const filename = `Informe_Semanal_${safePeriodo}_${safeCli}.pdf`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (err) {
    console.error("[generar-pdf-semanal] error:", err);
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
