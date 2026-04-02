// app/api/informes/generar-pdf/route.ts
// POST — genera informe ejecutivo mensual en PDF usando @react-pdf/renderer
//
// Body: {
//   mes: "YYYY-MM",
//   clinica: string,           // nombre de la clínica o "Todas las clínicas"
//   informe: string,           // texto narrativo de Claude
//   datos: KpiResumen,         // KPIs calculados
//   charts: string[],          // base64 PNG de los gráficos (5 items)
// }

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { renderToBuffer, Document, Page, View, Text, Image, StyleSheet, Font } from "@react-pdf/renderer";

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

type DoctorKpi = { doctor: string; total: number; aceptados: number; tasa: number };
type KpiResumen = {
  total: number; aceptados: number; perdidos: number; activos: number;
  tasa: number; importeTotal: number; importePipeline: number;
  porDoctor: DoctorKpi[];
  porOrigen: { origen: string; count: number }[];
  porMotivo: { motivo: string; count: number }[];
  privados: { total: number; tasa: number };
  adeslas: { total: number; tasa: number };
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const COLOR_PRIMARY = "#7C3AED";
const COLOR_TEXT     = "#1e293b";
const COLOR_MUTED    = "#64748b";
const COLOR_BORDER   = "#e2e8f0";
const COLOR_GREEN    = "#16a34a";
const COLOR_RED      = "#dc2626";

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 11, color: COLOR_TEXT, paddingTop: 40, paddingBottom: 40, paddingHorizontal: 50 },
  // Cover
  coverPage: { fontFamily: "Helvetica", backgroundColor: COLOR_PRIMARY, paddingTop: 180, paddingHorizontal: 60, paddingBottom: 60 },
  coverTitle: { fontSize: 28, fontFamily: "Helvetica-Bold", color: "#ffffff", marginBottom: 8 },
  coverSubtitle: { fontSize: 16, color: "#ede9fe", marginBottom: 4 },
  coverMeta: { fontSize: 10, color: "#c4b5fd", marginTop: 40 },
  // Sections
  sectionTitle: { fontSize: 14, fontFamily: "Helvetica-Bold", color: COLOR_PRIMARY, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: COLOR_PRIMARY, paddingBottom: 4 },
  // Metrics row
  metricsRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  metricCard: { flex: 1, backgroundColor: "#f8fafc", borderRadius: 6, padding: 10, borderWidth: 1, borderColor: COLOR_BORDER },
  metricValue: { fontSize: 22, fontFamily: "Helvetica-Bold", color: COLOR_TEXT, marginBottom: 2 },
  metricLabel: { fontSize: 8, color: COLOR_MUTED, textTransform: "uppercase" },
  // Text
  paragraph: { fontSize: 10.5, lineHeight: 1.7, color: COLOR_TEXT, marginBottom: 10 },
  // Table
  table: { marginBottom: 16 },
  tableHeader: { flexDirection: "row", backgroundColor: "#f1f5f9", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 4, marginBottom: 2 },
  tableRow: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  tableCell: { flex: 1, fontSize: 9, color: COLOR_TEXT },
  tableCellBold: { flex: 1, fontSize: 9, fontFamily: "Helvetica-Bold", color: COLOR_TEXT },
  tableHeaderCell: { flex: 1, fontSize: 8, fontFamily: "Helvetica-Bold", color: COLOR_MUTED, textTransform: "uppercase" },
  // Footer
  footer: { position: "absolute", bottom: 20, left: 50, right: 50, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 8, color: COLOR_MUTED },
  // Chart
  chartImage: { width: "100%", marginBottom: 12, borderRadius: 4 },
  // Comparison table
  compRow: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  compCell: { flex: 2, fontSize: 9, color: COLOR_TEXT },
  compCellNum: { flex: 1, fontSize: 9, color: COLOR_TEXT, textAlign: "right" },
  compCellDelta: { flex: 1, fontSize: 9, textAlign: "right" },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MES_LABEL = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

function mesLabel(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return `${MES_LABEL[m - 1]} ${y}`;
}

function euro(n: number): string {
  return `€${n.toLocaleString("es-ES")}`;
}

// ─── PDF Document ─────────────────────────────────────────────────────────────

function InformePDF({
  mes, clinica, informe, datos, charts, generadoEn,
}: {
  mes: string; clinica: string; informe: string; datos: KpiResumen; charts: string[]; generadoEn: string;
}) {
  const label = mesLabel(mes);
  const fecha = new Date(generadoEn).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });

  // Strip markdown bold markers for PDF plain text
  const plainText = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1");

  const [chartLine, chartMotivos, chartOrigen, chartDoctores, chartAB] = charts;

  return (
    <Document title={`Informe ${label} — ${clinica}`} author="Fyllio" creator="Fyllio CRM">
      {/* ── Portada ─────────────────────────────────────── */}
      <Page size="A4" style={styles.coverPage}>
        <Text style={styles.coverTitle}>INFORME MENSUAL{"\n"}DE PRESUPUESTOS</Text>
        <Text style={styles.coverSubtitle}>{label.toUpperCase()}</Text>
        <Text style={{ ...styles.coverSubtitle, fontSize: 13 }}>{clinica}</Text>
        <Text style={styles.coverMeta}>Generado el {fecha} · Datos de {datos.total} presupuestos</Text>
        <Text style={{ ...styles.coverMeta, marginTop: 4 }}>Confidencial · Uso interno</Text>
      </Page>

      {/* ── Resumen ejecutivo ───────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>RESUMEN EJECUTIVO</Text>
        {/* 4 métricas */}
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{datos.total}</Text>
            <Text style={styles.metricLabel}>Presupuestos</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{datos.aceptados}</Text>
            <Text style={styles.metricLabel}>Aceptados ({datos.tasa}%)</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{euro(datos.importeTotal)}</Text>
            <Text style={styles.metricLabel}>€ Aceptado</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{datos.activos}</Text>
            <Text style={styles.metricLabel}>Pipeline activo</Text>
          </View>
        </View>
        {/* Narrativo */}
        {informe.split("\n\n").filter(Boolean).map((para, i) => (
          <Text key={i} style={styles.paragraph}>{plainText(para.trim())}</Text>
        ))}
        {/* Gráfico de evolución */}
        {chartLine && <Image style={{ ...styles.chartImage, marginTop: 8 }} src={`data:image/png;base64,${chartLine}`} />}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{clinica} · {label}</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      {/* ── Análisis por clínica + doctores ─────────────── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>RENDIMIENTO POR DOCTOR</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.tableHeaderCell}>Doctor</Text>
            <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Presupuestos</Text>
            <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Aceptados</Text>
            <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Tasa</Text>
            <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>€ Aceptado</Text>
          </View>
          {datos.porDoctor.slice(0, 8).map((d, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.tableCell}>{d.doctor}</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right" }}>{d.total}</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right" }}>{d.aceptados}</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right", color: d.tasa >= 40 ? COLOR_GREEN : d.tasa < 20 ? COLOR_RED : COLOR_TEXT }}>{d.tasa}%</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right" }}>—</Text>
            </View>
          ))}
        </View>
        {chartDoctores && <Image style={styles.chartImage} src={`data:image/png;base64,${chartDoctores}`} />}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{clinica} · {label}</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      {/* ── Motivos de pérdida ──────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>MOTIVOS DE PÉRDIDA</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={{ ...styles.tableHeaderCell, flex: 3 }}>Motivo</Text>
            <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Casos</Text>
            <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>%</Text>
          </View>
          {datos.porMotivo.map((m, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={{ ...styles.tableCell, flex: 3 }}>{m.motivo}</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right" }}>{m.count}</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right" }}>
                {datos.perdidos > 0 ? Math.round((m.count / datos.perdidos) * 100) : 0}%
              </Text>
            </View>
          ))}
        </View>
        {chartMotivos && <Image style={styles.chartImage} src={`data:image/png;base64,${chartMotivos}`} />}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{clinica} · {label}</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      {/* ── Canales + A/B tonos ─────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>ORIGEN DE LEADS</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={{ ...styles.tableHeaderCell, flex: 3 }}>Canal</Text>
            <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Presupuestos</Text>
            <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>%</Text>
          </View>
          {datos.porOrigen.map((o, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={{ ...styles.tableCell, flex: 3 }}>{o.origen}</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right" }}>{o.count}</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right" }}>
                {datos.total > 0 ? Math.round((o.count / datos.total) * 100) : 0}%
              </Text>
            </View>
          ))}
        </View>
        {chartOrigen && <Image style={styles.chartImage} src={`data:image/png;base64,${chartOrigen}`} />}
        {chartAB && (
          <>
            <Text style={{ ...styles.sectionTitle, marginTop: 16 }}>MOTOR IA — A/B DE TONOS</Text>
            <Image style={styles.chartImage} src={`data:image/png;base64,${chartAB}`} />
          </>
        )}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{clinica} · {label}</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      {/* ── Pie de documento ────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>INFORMACIÓN DEL DOCUMENTO</Text>
        <Text style={styles.paragraph}>
          Este informe fue generado automáticamente el {fecha} con datos de {datos.total} presupuestos de {label}.
        </Text>
        <Text style={styles.paragraph}>
          Tipo de paciente: {datos.privados.total} privados (tasa {datos.privados.tasa}%) · {datos.adeslas.total} Adeslas (tasa {datos.adeslas.tasa}%).
          Pipeline activo al cierre del análisis: {euro(datos.importePipeline)}.
        </Text>
        <Text style={{ ...styles.paragraph, color: COLOR_MUTED, marginTop: 20 }}>
          Documento confidencial · Uso interno · Fyllio CRM
        </Text>
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{clinica} · {label}</Text>
          <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
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
    const { mes, clinica, informe, datos, charts = [] }: {
      mes: string; clinica: string; informe: string; datos: KpiResumen; charts: string[];
    } = body;

    if (!mes || !datos) {
      return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
    }

    const buffer = await renderToBuffer(
      <InformePDF
        mes={mes}
        clinica={clinica ?? "Clínica"}
        informe={informe ?? ""}
        datos={datos}
        charts={charts}
        generadoEn={new Date().toISOString()}
      />
    );

    const [y, m] = mes.split("-");
    const label = `${MES_LABEL[Number(m) - 1]}_${y}`;
    const filename = `Informe_${label}_${(clinica ?? "Clinicas").replace(/\s+/g, "_")}.pdf`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
