// app/api/informes/generar-pdf/route.tsx
// POST — genera informe ejecutivo mensual en PDF usando @react-pdf/renderer
// Gráficos generados server-side con chartjs-node-canvas
//
// Body: { mes, clinica, informe, datos: KpiResumen }

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { renderToBuffer, Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import Anthropic from "@anthropic-ai/sdk";
import { graficoLineas, graficoBarsHorizontal, graficoBarsVertical } from "../../../lib/charts/generar";

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

type TendenciaMes = { mes: string; label: string; total: number; aceptados: number };
type ClinicaKpi = { clinica: string; total: number; aceptados: number; importeTotal: number; tasa: number };
type DoctorKpi = { doctor: string; total: number; aceptados: number; tasa: number };
type KpiResumen = {
  total: number; aceptados: number; perdidos: number; activos: number;
  tasa: number; importeTotal: number; importePipeline: number;
  porDoctor: DoctorKpi[];
  porOrigen: { origen: string; count: number }[];
  porMotivo: { motivo: string; count: number }[];
  privados: { total: number; tasa: number };
  adeslas: { total: number; tasa: number };
  tendenciaMensual?: TendenciaMes[];
  porClinica?: ClinicaKpi[];
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const COLOR_PRIMARY = "#7C3AED";
const COLOR_TEXT     = "#1e293b";
const COLOR_MUTED    = "#64748b";
const COLOR_BORDER   = "#e2e8f0";
const COLOR_GREEN    = "#16a34a";
const COLOR_RED      = "#dc2626";
const COLOR_ORANGE   = "#ea580c";

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 11, color: COLOR_TEXT, paddingTop: 40, paddingBottom: 50, paddingHorizontal: 50 },
  coverPage: { fontFamily: "Helvetica", backgroundColor: COLOR_PRIMARY, paddingTop: 160, paddingHorizontal: 60, paddingBottom: 60 },
  coverTitle: { fontSize: 30, fontFamily: "Helvetica-Bold", color: "#ffffff", marginBottom: 10 },
  coverSubtitle: { fontSize: 17, color: "#ede9fe", marginBottom: 4 },
  coverMeta: { fontSize: 10, color: "#c4b5fd", marginTop: 40 },
  coverDivider: { width: 48, height: 3, backgroundColor: "#a78bfa", marginTop: 24, marginBottom: 24 },
  // Section title
  sectionTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", color: COLOR_PRIMARY, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: COLOR_PRIMARY, paddingBottom: 4 },
  // Metric cards
  metricsRow: { flexDirection: "row", gap: 10, marginBottom: 18 },
  metricCard: { flex: 1, backgroundColor: "#f8fafc", borderRadius: 6, padding: 10, borderWidth: 1, borderColor: COLOR_BORDER },
  metricValue: { fontSize: 22, fontFamily: "Helvetica-Bold", color: COLOR_TEXT, marginBottom: 2 },
  metricLabel: { fontSize: 8, color: COLOR_MUTED, textTransform: "uppercase" },
  // Text
  paragraph: { fontSize: 10, lineHeight: 1.7, color: COLOR_TEXT, marginBottom: 10 },
  label: { fontSize: 8, color: COLOR_MUTED, textTransform: "uppercase", marginBottom: 4 },
  // Table
  tableHeader: { flexDirection: "row", backgroundColor: "#f1f5f9", paddingVertical: 5, paddingHorizontal: 8, borderRadius: 4, marginBottom: 2 },
  tableRow: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  tableCell: { flex: 1, fontSize: 9, color: COLOR_TEXT },
  tableHeaderCell: { flex: 1, fontSize: 8, fontFamily: "Helvetica-Bold", color: COLOR_MUTED, textTransform: "uppercase" },
  // Chart
  chartImage: { width: "100%", marginBottom: 14, borderRadius: 4 },
  // Footer
  footer: { position: "absolute", bottom: 20, left: 50, right: 50, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 8, color: COLOR_MUTED },
  // Plan de acción
  planBlock: { marginBottom: 16, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: COLOR_PRIMARY },
  planNum: { fontSize: 9, fontFamily: "Helvetica-Bold", color: COLOR_PRIMARY, marginBottom: 2, textTransform: "uppercase" },
  planBody: { fontSize: 10, lineHeight: 1.6, color: COLOR_TEXT },
  // Semáforo
  semaforoGreen: { color: COLOR_GREEN, fontFamily: "Helvetica-Bold" },
  semaforoOrange: { color: COLOR_ORANGE, fontFamily: "Helvetica-Bold" },
  semaforoRed: { color: COLOR_RED, fontFamily: "Helvetica-Bold" },
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

function plainText(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1");
}

function tasaColor(tasa: number) {
  if (tasa >= 40) return COLOR_GREEN;
  if (tasa >= 20) return COLOR_TEXT;
  return COLOR_RED;
}

// ─── Claude analysis helpers ──────────────────────────────────────────────────

async function generarAnalisisTendencia(
  tendencia: TendenciaMes[],
  mes: string
): Promise<string> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || !tendencia.length) return "";
    const client = new Anthropic({ apiKey });
    const resumen = tendencia.map(t => `${t.label}: ${t.total} presupuestos, ${t.aceptados} aceptados`).join(" | ");
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{
        role: "user",
        content: `Analiza esta evolución mensual de una clínica dental en 2-3 frases: ${resumen}. Mes de referencia: ${mes}. Indica tendencia general, mejor mes y cualquier cambio significativo. Sin bullets, solo texto.`,
      }],
    });
    return (msg.content[0] as { type: string; text: string }).text?.trim() ?? "";
  } catch { return ""; }
}

async function generarAnalisisMotivos(
  porMotivo: { motivo: string; count: number }[],
  totalPerdidos: number
): Promise<string> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || !porMotivo.length) return "";
    const client = new Anthropic({ apiKey });
    const resumen = porMotivo.map(m => `${m.motivo}: ${m.count} casos (${totalPerdidos > 0 ? Math.round(m.count / totalPerdidos * 100) : 0}%)`).join(", ");
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{
        role: "user",
        content: `Interpreta estos motivos de pérdida de presupuestos dentales en 2-3 frases: ${resumen}. Sugiere qué acción concreta abordar primero. Sin bullets, solo texto.`,
      }],
    });
    return (msg.content[0] as { type: string; text: string }).text?.trim() ?? "";
  } catch { return ""; }
}

// ─── PDF Document ─────────────────────────────────────────────────────────────

function InformePDF({
  mes, clinica, informe, datos, generadoEn,
  pngLinea, pngMotivos, pngDoctores, pngCanales,
  analisisTendencia, analisisMotivos,
}: {
  mes: string; clinica: string; informe: string; datos: KpiResumen; generadoEn: string;
  pngLinea: string; pngMotivos: string; pngDoctores: string; pngCanales: string;
  analisisTendencia: string; analisisMotivos: string;
}) {
  const label = mesLabel(mes);
  const fecha = new Date(generadoEn).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  const parrafos = informe.split("\n\n").filter(Boolean).map(p => plainText(p.trim()));

  const Footer = () => (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>{clinica} · {label}</Text>
      <Text style={styles.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );

  return (
    <Document title={`Informe ${label} — ${clinica}`} author="Fyllio" creator="Fyllio CRM">

      {/* ── 1. Portada ─────────────────────────────────────── */}
      <Page size="A4" style={styles.coverPage}>
        <Text style={styles.coverTitle}>INFORME MENSUAL{"\n"}DE PRESUPUESTOS</Text>
        <View style={styles.coverDivider} />
        <Text style={styles.coverSubtitle}>{label.toUpperCase()}</Text>
        <Text style={{ ...styles.coverSubtitle, fontSize: 14 }}>{clinica}</Text>
        <Text style={styles.coverMeta}>Generado el {fecha} · {datos.total} presupuestos analizados</Text>
        <Text style={{ ...styles.coverMeta, marginTop: 4 }}>Informe generado con IA · Confidencial · Uso interno</Text>
      </Page>

      {/* ── 2. Resumen ejecutivo ─────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>RESUMEN EJECUTIVO</Text>
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{datos.total}</Text>
            <Text style={styles.metricLabel}>Presupuestos</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={{ ...styles.metricValue, color: COLOR_GREEN }}>{datos.aceptados}</Text>
            <Text style={styles.metricLabel}>Aceptados ({datos.tasa}%)</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{euro(datos.importeTotal)}</Text>
            <Text style={styles.metricLabel}>Importe aceptado</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={{ ...styles.metricValue, color: COLOR_ORANGE }}>{datos.activos}</Text>
            <Text style={styles.metricLabel}>Pipeline activo</Text>
          </View>
        </View>
        <View style={styles.metricsRow}>
          <View style={styles.metricCard}>
            <Text style={{ ...styles.metricValue, fontSize: 16 }}>{euro(datos.importePipeline)}</Text>
            <Text style={styles.metricLabel}>€ Pipeline activo</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={{ ...styles.metricValue, fontSize: 16 }}>{datos.privados.total} ({datos.privados.tasa}%)</Text>
            <Text style={styles.metricLabel}>Privados</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={{ ...styles.metricValue, fontSize: 16 }}>{datos.adeslas.total} ({datos.adeslas.tasa}%)</Text>
            <Text style={styles.metricLabel}>Adeslas</Text>
          </View>
          <View style={styles.metricCard}>
            <Text style={{ ...styles.metricValue, fontSize: 16, color: COLOR_RED }}>{datos.perdidos}</Text>
            <Text style={styles.metricLabel}>Perdidos</Text>
          </View>
        </View>
        {parrafos.slice(0, 2).map((p, i) => (
          <Text key={i} style={styles.paragraph}>{p}</Text>
        ))}
        <Footer />
      </Page>

      {/* ── 3. Evolución 12 meses ─────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>EVOLUCIÓN 12 MESES</Text>
        {pngLinea ? (
          <Image style={styles.chartImage} src={`data:image/png;base64,${pngLinea}`} />
        ) : (
          <Text style={{ ...styles.paragraph, color: COLOR_MUTED }}>Sin datos de evolución disponibles.</Text>
        )}
        {analisisTendencia ? (
          <Text style={styles.paragraph}>{analisisTendencia}</Text>
        ) : null}
        {datos.tendenciaMensual && datos.tendenciaMensual.length > 0 && (
          <View>
            <Text style={styles.label}>DATOS MENSUALES</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.tableHeaderCell}>Mes</Text>
              <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Ofrecidos</Text>
              <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Aceptados</Text>
              <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Tasa</Text>
            </View>
            {datos.tendenciaMensual.slice(-6).map((t, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.tableCell}>{t.label} {t.mes.slice(0, 4)}</Text>
                <Text style={{ ...styles.tableCell, textAlign: "right" }}>{t.total}</Text>
                <Text style={{ ...styles.tableCell, textAlign: "right" }}>{t.aceptados}</Text>
                <Text style={{ ...styles.tableCell, textAlign: "right", color: tasaColor(t.total > 0 ? Math.round(t.aceptados / t.total * 100) : 0) }}>
                  {t.total > 0 ? Math.round(t.aceptados / t.total * 100) : 0}%
                </Text>
              </View>
            ))}
          </View>
        )}
        <Footer />
      </Page>

      {/* ── 4. Rendimiento por clínica ──────────────────────── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>RENDIMIENTO POR CLÍNICA</Text>
        {datos.porClinica && datos.porClinica.length > 0 ? (
          <View>
            <View style={styles.tableHeader}>
              <Text style={{ ...styles.tableHeaderCell, flex: 2 }}>Clínica</Text>
              <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Total</Text>
              <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Aceptados</Text>
              <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Tasa</Text>
              <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>€ Aceptado</Text>
            </View>
            {datos.porClinica.map((c, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={{ ...styles.tableCell, flex: 2 }}>{c.clinica}</Text>
                <Text style={{ ...styles.tableCell, textAlign: "right" }}>{c.total}</Text>
                <Text style={{ ...styles.tableCell, textAlign: "right" }}>{c.aceptados}</Text>
                <Text style={{ ...styles.tableCell, textAlign: "right", color: tasaColor(c.tasa) }}>{c.tasa}%</Text>
                <Text style={{ ...styles.tableCell, textAlign: "right" }}>{euro(c.importeTotal)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ ...styles.paragraph, color: COLOR_MUTED }}>Datos de clínica no disponibles para este filtro.</Text>
        )}
        <Footer />
      </Page>

      {/* ── 5. Motivos de pérdida ────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>MOTIVOS DE PÉRDIDA</Text>
        <View style={{ marginBottom: 14 }}>
          <View style={styles.tableHeader}>
            <Text style={{ ...styles.tableHeaderCell, flex: 3 }}>Motivo</Text>
            <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Casos</Text>
            <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>%</Text>
          </View>
          {datos.porMotivo.length > 0 ? datos.porMotivo.map((m, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={{ ...styles.tableCell, flex: 3 }}>{m.motivo}</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right" }}>{m.count}</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right" }}>
                {datos.perdidos > 0 ? Math.round(m.count / datos.perdidos * 100) : 0}%
              </Text>
            </View>
          )) : (
            <View style={styles.tableRow}><Text style={styles.tableCell}>Sin datos suficientes</Text></View>
          )}
        </View>
        {pngMotivos ? (
          <Image style={styles.chartImage} src={`data:image/png;base64,${pngMotivos}`} />
        ) : null}
        {analisisMotivos ? (
          <Text style={styles.paragraph}>{analisisMotivos}</Text>
        ) : parrafos[2] ? (
          <Text style={styles.paragraph}>{parrafos[2]}</Text>
        ) : null}
        <Footer />
      </Page>

      {/* ── 6. Análisis doctores ─────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>RENDIMIENTO POR DOCTOR</Text>
        <View style={{ marginBottom: 14 }}>
          <View style={styles.tableHeader}>
            <Text style={{ ...styles.tableHeaderCell, flex: 2 }}>Doctor</Text>
            <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Total</Text>
            <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Aceptados</Text>
            <Text style={{ ...styles.tableHeaderCell, textAlign: "right" }}>Tasa</Text>
          </View>
          {datos.porDoctor.slice(0, 8).map((d, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={{ ...styles.tableCell, flex: 2 }}>{d.doctor}</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right" }}>{d.total}</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right" }}>{d.aceptados}</Text>
              <Text style={{ ...styles.tableCell, textAlign: "right", color: tasaColor(d.tasa) }}>{d.tasa}%</Text>
            </View>
          ))}
        </View>
        {pngDoctores ? (
          <Image style={styles.chartImage} src={`data:image/png;base64,${pngDoctores}`} />
        ) : null}
        {parrafos[1] ? <Text style={styles.paragraph}>{parrafos[1]}</Text> : null}
        <Footer />
      </Page>

      {/* ── 7. Canales de captación ─────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>CANALES DE CAPTACIÓN</Text>
        <View style={{ marginBottom: 14 }}>
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
                {datos.total > 0 ? Math.round(o.count / datos.total * 100) : 0}%
              </Text>
            </View>
          ))}
        </View>
        {pngCanales ? (
          <Image style={styles.chartImage} src={`data:image/png;base64,${pngCanales}`} />
        ) : null}
        {parrafos[3] ? <Text style={styles.paragraph}>{parrafos[3]}</Text> : null}
        <Footer />
      </Page>

      {/* ── 8. Plan de acción ────────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.sectionTitle}>PLAN DE ACCIÓN</Text>
        {parrafos[4] ? (
          <Text style={styles.paragraph}>{parrafos[4]}</Text>
        ) : (
          <Text style={{ ...styles.paragraph, color: COLOR_MUTED }}>Sin recomendaciones disponibles en este informe.</Text>
        )}
        <View style={{ marginTop: 20 }}>
          <Text style={{ ...styles.paragraph, color: COLOR_MUTED, fontSize: 9 }}>
            Generado automáticamente el {fecha}. Datos de {datos.total} presupuestos de {label}.
            Pipeline activo: {euro(datos.importePipeline)}.
            Privados: {datos.privados.total} (tasa {datos.privados.tasa}%) · Adeslas: {datos.adeslas.total} (tasa {datos.adeslas.tasa}%).
          </Text>
          <Text style={{ ...styles.paragraph, color: COLOR_MUTED, fontSize: 9, marginTop: 8 }}>
            Documento confidencial · Uso interno · Fyllio CRM
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
    const { mes, clinica, informe, datos }: {
      mes: string; clinica: string; informe: string; datos: KpiResumen;
    } = body;

    if (!mes || !datos) {
      return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
    }

    // Generate charts + Claude analysis in parallel
    const [pngLinea, pngMotivos, pngDoctores, pngCanales, analisisTendencia, analisisMotivos] =
      await Promise.all([
        graficoLineas(datos.tendenciaMensual ?? [], mes),
        graficoBarsHorizontal(datos.porMotivo.map(m => ({ label: m.motivo, value: m.count })), "#DC2626"),
        graficoBarsVertical(datos.porDoctor.slice(0, 8).map(d => ({ label: d.doctor, total: d.total, aceptados: d.aceptados }))),
        graficoBarsVertical(datos.porOrigen.map(o => ({ label: o.origen, total: o.count }))),
        generarAnalisisTendencia(datos.tendenciaMensual ?? [], mes),
        generarAnalisisMotivos(datos.porMotivo, datos.perdidos),
      ]);

    const generadoEn = new Date().toISOString();

    const buffer = await renderToBuffer(
      <InformePDF
        mes={mes}
        clinica={clinica ?? "Clínica"}
        informe={informe ?? ""}
        datos={datos}
        generadoEn={generadoEn}
        pngLinea={pngLinea}
        pngMotivos={pngMotivos}
        pngDoctores={pngDoctores}
        pngCanales={pngCanales}
        analisisTendencia={analisisTendencia}
        analisisMotivos={analisisMotivos}
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
