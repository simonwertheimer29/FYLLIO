// app/api/informes/generar-pdf/route.tsx
// POST — genera informe ejecutivo mensual en PDF — 8 páginas V5c
// Gráficos generados server-side con chartjs-node-canvas
//
// Body: { mes, clinica, informe, datos: KpiResumen }

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import { renderToBuffer, Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import {
  graficoLineas,
  graficoBarsHorizontal,
  graficoBarsVertical,
  graficoClinicasBars,
  graficoDoctoresConMedia,
  graficoForecast,
  graficoAB,
} from "../../../lib/charts/generar";

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
  abTonos?: { tono: string; mensajes: number; aceptados: number; tasa: number }[];
};

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  // Cover
  coverTitle: { fontSize: 30, fontFamily: "Helvetica-Bold", color: "#FFF", marginBottom: 10 },
  coverDivider: { width: 48, height: 3, backgroundColor: "#A78BFA", marginBottom: 20 },
  coverSubtitle: { fontSize: 17, color: "#EDE9FE", marginBottom: 4 },
  coverMeta: { fontSize: 9.5, color: "#C4B5FD", marginTop: 36 },
  // Section
  sectionTitle: {
    fontSize: 13, fontFamily: "Helvetica-Bold", color: C.primary,
    marginBottom: 10, borderBottomWidth: 1, borderBottomColor: C.primary, paddingBottom: 3,
  },
  subTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.text, marginBottom: 6, marginTop: 10 },
  // Metrics
  metricsRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  metricCard: {
    flex: 1, backgroundColor: C.bg, borderRadius: 5, padding: 9,
    borderWidth: 1, borderColor: C.border,
  },
  metricValue: { fontSize: 20, fontFamily: "Helvetica-Bold", color: C.text, marginBottom: 1 },
  metricLabel: { fontSize: 7.5, color: C.muted, textTransform: "uppercase" },
  // Text
  paragraph: { fontSize: 9.5, lineHeight: 1.65, color: C.text, marginBottom: 8 },
  small: { fontSize: 8.5, lineHeight: 1.5, color: C.muted, marginBottom: 6 },
  // Table
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
  // Chart
  chartImg: { width: "100%", marginBottom: 10, borderRadius: 3 },
  chartImgHalf: { width: "100%", marginBottom: 8, borderRadius: 3 },
  // Plan blocks
  planBlock: { marginBottom: 12, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: C.primary },
  planNum: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.primary, marginBottom: 2 },
  planBody: { fontSize: 9.5, lineHeight: 1.6, color: C.text },
  // Footer
  footer: { position: "absolute", bottom: 18, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 7.5, color: C.muted },
  // Análisis block
  analysisBlock: {
    backgroundColor: C.bgPurple, borderRadius: 4, padding: 8,
    borderLeftWidth: 2.5, borderLeftColor: C.primary, marginBottom: 8,
  },
  analysisTitle: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.primary, marginBottom: 2 },
  analysisBody: { fontSize: 8.5, lineHeight: 1.55, color: C.text },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MES_LABEL = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MES_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

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

function tasaColor(tasa: number): string {
  if (tasa >= 40) return C.green;
  if (tasa >= 20) return C.text;
  return C.red;
}

function doctorEstado(d: DoctorKpi): string {
  if (d.total < 3) return "Sin datos";
  if (d.tasa === 0) return "🔴 Urgente";
  if (d.tasa >= 50) return "✅ Referencia";
  if (d.tasa >= 30) return "⚠ Atención";
  return "⚠ Atención";
}

function tendenciaAnalisis(tendencia: TendenciaMes[], mes: string): string {
  if (!tendencia.length) return "";
  const conDatos = tendencia.filter((t) => t.total > 0);
  if (!conDatos.length) return "";
  const mediaTotal = Math.round(conDatos.reduce((s, t) => s + t.total, 0) / conDatos.length);
  const mediaTasa = Math.round(conDatos.reduce((s, t) => s + (t.total > 0 ? t.aceptados / t.total * 100 : 0), 0) / conDatos.length);
  const mejor = [...conDatos].sort((a, b) => (b.total > 0 ? b.aceptados / b.total : 0) - (a.total > 0 ? a.aceptados / a.total : 0))[0];
  const last3 = tendencia.slice(-3);
  const avg3 = last3.length ? Math.round(last3.reduce((s, t) => s + t.total, 0) / last3.length) : 0;
  const tendDir = avg3 > mediaTotal ? "ascendente" : avg3 < mediaTotal ? "descendente" : "estable";

  const mesActual = tendencia.find((t) => t.mes === mes);
  const tasaActual = mesActual && mesActual.total > 0 ? Math.round(mesActual.aceptados / mesActual.total * 100) : 0;
  const diff = tasaActual - mediaTasa;

  return `Media anual: ${mediaTotal} presupuestos/mes · tasa media ${mediaTasa}%. ` +
    `Mejor mes: ${mejor.label} con ${mejor.total > 0 ? Math.round(mejor.aceptados / mejor.total * 100) : 0}% de conversión. ` +
    `Tendencia últimos 3 meses: ${tendDir} (${avg3} pres./mes). ` +
    (mesActual ? `Mes actual: ${diff >= 0 ? "+" : ""}${diff}pp respecto a la media anual.` : "");
}

function motivoAnalisis(motivo: string, count: number, totalPerdidos: number): string {
  const pct = totalPerdidos > 0 ? Math.round(count / totalPerdidos * 100) : 0;
  const mL = motivo.toLowerCase();
  if (mL.includes("precio")) {
    return `${count} casos (${pct}% de las pérdidas). Acción recomendada: presentar opciones de financiación durante la consulta, antes de que el paciente lo rechace. Ejemplo: €4.000 = €167/mes a 24 meses.`;
  }
  if (mL.includes("urgencia") || mL.includes("tiempo")) {
    return `${count} casos (${pct}%). El paciente no percibe consecuencias de posponer. Reforzar en consulta: coste de la inacción y progresión del problema sin tratamiento.`;
  }
  if (mL.includes("clínica") || mL.includes("clinica")) {
    return `${count} casos (${pct}%). Identificar a qué clínicas van los pacientes para ajustar argumentario de diferenciación.`;
  }
  if (mL.includes("responde")) {
    return `${count} casos (${pct}%). Revisión urgente del protocolo de seguimiento: activar motor IA para presupuestos sin respuesta > 3 días.`;
  }
  return `${count} casos (${pct}% de las pérdidas).`;
}

function doctorAnalisis(d: DoctorKpi, mediaRed: number): string {
  const diff = d.tasa - mediaRed;
  if (d.total < 3) return `${d.total} presupuesto${d.total !== 1 ? "s" : ""} — muestra insuficiente para análisis estadístico.`;
  if (d.tasa >= 50) return `${d.aceptados}/${d.total} cierres — ${Math.abs(diff)}pp por encima de la media de la red. Modelo de referencia para el equipo. Documentar su protocolo de presentación.`;
  if (d.tasa === 0) return `0/${d.total} cierres — resultado crítico. Verificar perfil de pacientes asignados; si es similar al resto del equipo, convocar revisión urgente.`;
  if (diff < 0) return `${d.aceptados}/${d.total} cierres — ${Math.abs(diff)}pp por debajo de la media. Revisar presupuestos activos; uso sistemático del motor IA podría mejorar 5-8pp en el próximo mes.`;
  return `${d.aceptados}/${d.total} cierres — en línea con la media de la red (${mediaRed}%).`;
}

function proyeccionMeses(tendencia: TendenciaMes[], mes: string): { mes: string; valor: number }[] {
  const last3 = tendencia.slice(-3).filter((t) => t.total > 0);
  const avgTotal = last3.length ? Math.round(last3.reduce((s, t) => s + t.total, 0) / last3.length) : 0;
  const avgTasa = last3.length ? last3.reduce((s, t) => s + (t.total > 0 ? t.aceptados / t.total : 0), 0) / last3.length : 0;
  const avgImporte = 850;
  const [y, m] = mes.split("-").map(Number);
  return [1, 2, 3].map((i) => {
    let mo = m + i; let yr = y;
    if (mo > 12) { mo -= 12; yr++; }
    return { mes: `${MES_SHORT[mo - 1]} ${yr}`, valor: Math.round(avgTotal * avgTasa * avgImporte * (1 - i * 0.1)) };
  });
}

// ─── PDF Document ─────────────────────────────────────────────────────────────

function InformePDF({
  mes, clinica, informe, datos, generadoEn,
  pngLinea, pngClinicas, pngMotivos, pngDoctores, pngCanales, pngForecast, pngAB,
  proyeccion,
}: {
  mes: string; clinica: string; informe: string; datos: KpiResumen; generadoEn: string;
  pngLinea: string; pngClinicas: string; pngMotivos: string; pngDoctores: string;
  pngCanales: string; pngForecast: string; pngAB: string;
  proyeccion: { mes: string; valor: number }[];
}) {
  const label = mesLabel(mes);
  const fecha = new Date(generadoEn).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
  const parrafos = informe.split("\n\n").filter(Boolean).map((p) => plainText(p.trim()));
  const mediaRed = datos.total > 0 ? Math.round(datos.aceptados / datos.total * 100) : 0;
  const tendenciaTxt = tendenciaAnalisis(datos.tendenciaMensual ?? [], mes);

  const Footer = () => (
    <View style={S.footer} fixed>
      <Text style={S.footerText}>{clinica} · {label}</Text>
      <Text style={S.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );

  return (
    <Document title={`Informe ${label} — ${clinica}`} author="Fyllio" creator="Fyllio CRM">

      {/* ─── 1. Portada ─────────────────────────────────────────── */}
      <Page size="A4" style={S.coverPage}>
        <Text style={S.coverTitle}>INFORME MENSUAL{"\n"}DE PRESUPUESTOS</Text>
        <View style={S.coverDivider} />
        <Text style={S.coverSubtitle}>{label.toUpperCase()}</Text>
        <Text style={{ ...S.coverSubtitle, fontSize: 14 }}>{clinica}</Text>
        <Text style={S.coverMeta}>Generado el {fecha} · {datos.total} presupuestos analizados</Text>
        <Text style={{ ...S.coverMeta, marginTop: 4 }}>Informe generado con IA · Confidencial · Uso interno</Text>
      </Page>

      {/* ─── 2. Resumen ejecutivo ────────────────────────────────── */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>RESUMEN EJECUTIVO</Text>
        {/* Fila 1: 3 métricas principales */}
        <View style={S.metricsRow}>
          <View style={S.metricCard}>
            <Text style={S.metricValue}>{datos.total}</Text>
            <Text style={S.metricLabel}>Presupuestos</Text>
          </View>
          <View style={S.metricCard}>
            <Text style={{ ...S.metricValue, color: C.green }}>{datos.aceptados}</Text>
            <Text style={S.metricLabel}>Aceptados ({datos.tasa}%)</Text>
          </View>
          <View style={S.metricCard}>
            <Text style={S.metricValue}>{euro(datos.importeTotal)}</Text>
            <Text style={S.metricLabel}>€ Aceptado</Text>
          </View>
        </View>
        {/* Fila 2: 3 métricas secundarias */}
        <View style={{ ...S.metricsRow, marginBottom: 16 }}>
          <View style={S.metricCard}>
            <Text style={{ ...S.metricValue, fontSize: 16, color: C.orange }}>{euro(datos.importePipeline)}</Text>
            <Text style={S.metricLabel}>Pipeline activo</Text>
          </View>
          <View style={S.metricCard}>
            <Text style={{ ...S.metricValue, fontSize: 16 }}>{datos.privados.total} ({datos.privados.tasa}%)</Text>
            <Text style={S.metricLabel}>Privados</Text>
          </View>
          <View style={S.metricCard}>
            <Text style={{ ...S.metricValue, fontSize: 16, color: datos.adeslas.tasa === 0 ? C.red : C.text }}>
              {datos.adeslas.total} ({datos.adeslas.tasa}%)
            </Text>
            <Text style={S.metricLabel}>Adeslas</Text>
          </View>
        </View>
        {parrafos.slice(0, 2).map((p, i) => (
          <Text key={i} style={S.paragraph}>{p}</Text>
        ))}
        <Footer />
      </Page>

      {/* ─── 3. Evolución 12 meses ───────────────────────────────── */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>EVOLUCIÓN 12 MESES</Text>
        {pngLinea ? (
          <Image style={S.chartImg} src={`data:image/png;base64,${pngLinea}`} />
        ) : (
          <Text style={{ ...S.small, marginBottom: 8 }}>Gráfico no disponible — sin datos de evolución.</Text>
        )}
        {tendenciaTxt ? (
          <View style={{ ...S.analysisBlock, marginBottom: 10 }}>
            <Text style={S.analysisBody}>{tendenciaTxt}</Text>
          </View>
        ) : null}
        {datos.tendenciaMensual && datos.tendenciaMensual.length > 0 && (
          <View>
            <Text style={S.subTitle}>Datos mensuales</Text>
            <View style={S.tableHeader}>
              <Text style={S.th}>Mes</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>Ofrecidos</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>Aceptados</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>Tasa</Text>
            </View>
            {datos.tendenciaMensual.map((t, i) => (
              <View key={i} style={S.tableRow}>
                <Text style={S.td}>{t.label} {t.mes.slice(0, 4)}</Text>
                <Text style={{ ...S.td, textAlign: "right" }}>{t.total}</Text>
                <Text style={{ ...S.td, textAlign: "right" }}>{t.aceptados}</Text>
                <Text style={{ ...S.td, textAlign: "right", color: tasaColor(t.total > 0 ? Math.round(t.aceptados / t.total * 100) : 0) }}>
                  {t.total > 0 ? Math.round(t.aceptados / t.total * 100) : 0}%
                </Text>
              </View>
            ))}
          </View>
        )}
        <Footer />
      </Page>

      {/* ─── 4. Rendimiento por clínica ─────────────────────────── */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>RENDIMIENTO POR CLÍNICA</Text>
        {pngClinicas && datos.porClinica && datos.porClinica.length > 0 ? (
          <Image style={S.chartImg} src={`data:image/png;base64,${pngClinicas}`} />
        ) : null}
        {datos.porClinica && datos.porClinica.length > 0 ? (
          <View>
            <View style={S.tableHeader}>
              <Text style={{ ...S.th, flex: 2 }}>Clínica</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>Total</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>Acept.</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>Tasa</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>€ Aceptado</Text>
            </View>
            {datos.porClinica.map((c, i) => (
              <View key={i} style={S.tableRow}>
                <Text style={{ ...S.td, flex: 2 }}>{c.clinica}</Text>
                <Text style={{ ...S.td, textAlign: "right" }}>{c.total}</Text>
                <Text style={{ ...S.td, textAlign: "right" }}>{c.aceptados}</Text>
                <Text style={{ ...S.td, textAlign: "right", color: tasaColor(c.tasa) }}>{c.tasa}%</Text>
                <Text style={{ ...S.td, textAlign: "right" }}>{euro(c.importeTotal)}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={S.small}>Datos de clínica no disponibles para este filtro.</Text>
        )}
        <Footer />
      </Page>

      {/* ─── 5. Motivos de pérdida ──────────────────────────────── */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>MOTIVOS DE PÉRDIDA</Text>
        {pngMotivos ? (
          <Image style={S.chartImg} src={`data:image/png;base64,${pngMotivos}`} />
        ) : null}
        {/* Tabla */}
        {datos.porMotivo.length > 0 && (
          <View style={{ marginBottom: 10 }}>
            <View style={S.tableHeader}>
              <Text style={{ ...S.th, flex: 3 }}>Motivo</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>Casos</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>%</Text>
            </View>
            {datos.porMotivo.map((m, i) => (
              <View key={i} style={S.tableRow}>
                <Text style={{ ...S.td, flex: 3 }}>{m.motivo}</Text>
                <Text style={{ ...S.td, textAlign: "right" }}>{m.count}</Text>
                <Text style={{ ...S.td, textAlign: "right" }}>
                  {datos.perdidos > 0 ? Math.round(m.count / datos.perdidos * 100) : 0}%
                </Text>
              </View>
            ))}
          </View>
        )}
        {/* Análisis por motivo principal */}
        {datos.porMotivo.filter((m) => m.count >= 3).slice(0, 3).map((m, i) => (
          <View key={i} style={S.analysisBlock}>
            <Text style={S.analysisTitle}>{m.motivo}</Text>
            <Text style={S.analysisBody}>{motivoAnalisis(m.motivo, m.count, datos.perdidos)}</Text>
          </View>
        ))}
        {parrafos[2] ? <Text style={S.paragraph}>{parrafos[2]}</Text> : null}
        <Footer />
      </Page>

      {/* ─── 6. Rendimiento por doctor ──────────────────────────── */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>RENDIMIENTO POR DOCTOR</Text>
        {pngDoctores ? (
          <Image style={S.chartImg} src={`data:image/png;base64,${pngDoctores}`} />
        ) : null}
        {/* Tabla */}
        <View style={{ marginBottom: 10 }}>
          <View style={S.tableHeader}>
            <Text style={{ ...S.th, flex: 2 }}>Doctor</Text>
            <Text style={{ ...S.th, textAlign: "right" }}>Total</Text>
            <Text style={{ ...S.th, textAlign: "right" }}>Acept.</Text>
            <Text style={{ ...S.th, textAlign: "right" }}>Tasa</Text>
            <Text style={{ ...S.th, flex: 1.2 }}>Estado</Text>
          </View>
          {datos.porDoctor.slice(0, 8).map((d, i) => (
            <View key={i} style={S.tableRow}>
              <Text style={{ ...S.td, flex: 2 }}>{d.doctor}</Text>
              <Text style={{ ...S.td, textAlign: "right" }}>{d.total}</Text>
              <Text style={{ ...S.td, textAlign: "right" }}>{d.aceptados}</Text>
              <Text style={{ ...S.td, textAlign: "right", color: tasaColor(d.tasa) }}>{d.tasa}%</Text>
              <Text style={{ ...S.td, flex: 1.2, fontSize: 8 }}>{doctorEstado(d)}</Text>
            </View>
          ))}
        </View>
        {/* Análisis por doctor (solo con ≥3 presupuestos) */}
        {datos.porDoctor.filter((d) => d.total >= 3).slice(0, 4).map((d, i) => (
          <View key={i} style={S.analysisBlock}>
            <Text style={S.analysisTitle}>{d.doctor} — {d.tasa}% tasa</Text>
            <Text style={S.analysisBody}>{doctorAnalisis(d, mediaRed)}</Text>
          </View>
        ))}
        <Footer />
      </Page>

      {/* ─── 7. Canales + A/B de tonos ─────────────────────────── */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>CANALES DE CAPTACIÓN</Text>
        {pngCanales ? (
          <Image style={{ ...S.chartImg, marginBottom: 8 }} src={`data:image/png;base64,${pngCanales}`} />
        ) : null}
        <View style={{ marginBottom: 12 }}>
          <View style={S.tableHeader}>
            <Text style={{ ...S.th, flex: 3 }}>Canal</Text>
            <Text style={{ ...S.th, textAlign: "right" }}>Vol.</Text>
            <Text style={{ ...S.th, textAlign: "right" }}>%</Text>
          </View>
          {datos.porOrigen.map((o, i) => (
            <View key={i} style={S.tableRow}>
              <Text style={{ ...S.td, flex: 3 }}>{o.origen}</Text>
              <Text style={{ ...S.td, textAlign: "right" }}>{o.count}</Text>
              <Text style={{ ...S.td, textAlign: "right" }}>
                {datos.total > 0 ? Math.round(o.count / datos.total * 100) : 0}%
              </Text>
            </View>
          ))}
        </View>
        {parrafos[3] ? <Text style={{ ...S.paragraph, marginBottom: 10 }}>{parrafos[3]}</Text> : null}

        {/* A/B sección (si hay datos) */}
        {datos.abTonos && datos.abTonos.length > 0 ? (
          <View>
            <Text style={{ ...S.sectionTitle, marginTop: 4 }}>A/B DE TONOS — MOTOR IA</Text>
            {pngAB ? (
              <Image style={S.chartImgHalf} src={`data:image/png;base64,${pngAB}`} />
            ) : null}
            <View style={S.tableHeader}>
              <Text style={{ ...S.th, flex: 2 }}>Tono</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>Mensajes</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>Acept.</Text>
              <Text style={{ ...S.th, textAlign: "right" }}>Tasa</Text>
            </View>
            {datos.abTonos.map((t, i) => (
              <View key={i} style={S.tableRow}>
                <Text style={{ ...S.td, flex: 2 }}>{i === 0 ? `★ ${t.tono}` : t.tono}</Text>
                <Text style={{ ...S.td, textAlign: "right" }}>{t.mensajes}</Text>
                <Text style={{ ...S.td, textAlign: "right" }}>{t.aceptados}</Text>
                <Text style={{ ...S.td, textAlign: "right", color: tasaColor(t.tasa) }}>{t.tasa}%</Text>
              </View>
            ))}
          </View>
        ) : (
          <View>
            <Text style={{ ...S.sectionTitle, marginTop: 4 }}>PROYECCIÓN — PRÓXIMOS 3 MESES</Text>
            {pngForecast ? (
              <Image style={S.chartImgHalf} src={`data:image/png;base64,${pngForecast}`} />
            ) : null}
          </View>
        )}
        <Footer />
      </Page>

      {/* ─── 8. Plan de acción + Forecasting ───────────────────── */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>PLAN DE ACCIÓN</Text>
        {parrafos[4] ? (
          (() => {
            const planText = parrafos[4];
            const actions = planText.split(/(?=\d\.)/).filter(Boolean);
            const items = actions.length >= 2 ? actions : [planText];
            return items.slice(0, 3).map((a, i) => (
              <View key={i} style={S.planBlock}>
                <Text style={S.planNum}>ACCIÓN {i + 1}</Text>
                <Text style={S.planBody}>{a.trim()}</Text>
              </View>
            ));
          })()
        ) : (
          <Text style={S.small}>Sin recomendaciones disponibles.</Text>
        )}

        {/* Forecasting */}
        <Text style={{ ...S.sectionTitle, marginTop: 14 }}>PROYECCIÓN — PRÓXIMOS 3 MESES</Text>
        {pngForecast ? (
          <Image style={S.chartImgHalf} src={`data:image/png;base64,${pngForecast}`} />
        ) : null}
        <View style={S.tableHeader}>
          <Text style={S.th}>Mes</Text>
          <Text style={{ ...S.th, textAlign: "right" }}>€ Proyectado</Text>
          <Text style={{ ...S.th }}>Confianza</Text>
        </View>
        {proyeccion.map((p, i) => (
          <View key={i} style={S.tableRow}>
            <Text style={S.td}>{p.mes}</Text>
            <Text style={{ ...S.td, textAlign: "right", fontFamily: "Helvetica-Bold" }}>{euro(p.valor)}</Text>
            <Text style={{ ...S.td, color: i === 0 ? C.green : i === 1 ? C.orange : C.muted }}>
              {["●●● Alta", "●●○ Media", "●○○ Baja"][i]}
            </Text>
          </View>
        ))}
        <Text style={{ ...S.small, marginTop: 6 }}>
          Proyección basada en media rolling de últimos 3 meses. La confianza decrece con la distancia temporal.
        </Text>

        <View style={{ marginTop: 16 }}>
          <Text style={{ ...S.small, color: C.muted }}>
            Generado el {fecha} · {datos.total} presupuestos de {label} ·
            Pipeline activo: {euro(datos.importePipeline)} · Confidencial · Uso interno · Fyllio CRM
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

    const mediaRed = datos.total > 0 ? Math.round(datos.aceptados / datos.total * 100) : 0;
    const proyeccion = proyeccionMeses(datos.tendenciaMensual ?? [], mes);

    // Generate 7 charts in parallel
    const [pngLinea, pngClinicas, pngMotivos, pngDoctores, pngCanales, pngForecast, pngAB] =
      await Promise.all([
        graficoLineas(datos.tendenciaMensual ?? [], mes),
        graficoClinicasBars(
          (datos.porClinica ?? []).map((c) => ({ label: c.clinica, tasa: c.tasa })),
          mediaRed
        ),
        graficoBarsHorizontal(
          datos.porMotivo.map((m) => ({ label: m.motivo, value: m.count })),
          "#DC2626"
        ),
        graficoDoctoresConMedia(
          datos.porDoctor.slice(0, 8).map((d) => ({ label: d.doctor, tasa: d.tasa, total: d.total })),
          mediaRed
        ),
        graficoBarsVertical(
          datos.porOrigen.map((o) => ({ label: o.origen, total: o.count }))
        ),
        graficoForecast(proyeccion),
        datos.abTonos && datos.abTonos.length > 0
          ? graficoAB(datos.abTonos.map((t) => ({ label: t.tono, tasa: t.tasa })))
          : Promise.resolve(""),
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
        pngClinicas={pngClinicas}
        pngMotivos={pngMotivos}
        pngDoctores={pngDoctores}
        pngCanales={pngCanales}
        pngForecast={pngForecast}
        pngAB={pngAB}
        proyeccion={proyeccion}
      />
    );

    const [y, m] = mes.split("-");
    const fileLabel = `${MES_LABEL[Number(m) - 1]}_${y}`;
    const filename = `Informe_${fileLabel}_${(clinica ?? "Clinicas").replace(/\s+/g, "_")}.pdf`;

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (err) {
    console.error("[generar-pdf] error:", err);
    const msg = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
