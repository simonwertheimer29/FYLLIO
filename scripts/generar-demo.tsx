// scripts/generar-demo.tsx
// Script standalone para generar PDF + PPT de demo con datos hardcoded de Marzo 2026
// Ejecutar: npx tsx scripts/generar-demo.tsx
// Output: scripts/output/demo_marzo_2026.pdf + scripts/output/demo_marzo_2026.pptx

import React from "react";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { renderToBuffer, Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import PptxGenJS from "pptxgenjs";
import {
  graficoLineas,
  graficoBarrasH,
  graficoBarrasV,
  graficoForecast,
  graficoAB,
} from "../app/lib/charts/svg-charts";

// ─── Datos hardcoded Marzo 2026 ───────────────────────────────────────────────

const MES = "2026-03";
const CLINICA = "Red Clinicas Demo";

const DATOS = {
  total: 47,
  aceptados: 22,
  perdidos: 18,
  activos: 7,
  tasa: 47,
  importeTotal: 38500,
  importePipeline: 12250,
  privados: { total: 31, tasa: 52 },
  adeslas: { total: 16, tasa: 37 },
  porDoctor: [
    { doctor: "Dra. García", total: 18, aceptados: 11, tasa: 61 },
    { doctor: "Dr. Martínez", total: 14, aceptados: 6, tasa: 43 },
    { doctor: "Dra. López", total: 9, aceptados: 3, tasa: 33 },
    { doctor: "Dr. Sánchez", total: 6, aceptados: 2, tasa: 33 },
  ],
  porOrigen: [
    { origen: "Referido paciente", count: 19 },
    { origen: "Google Ads", count: 12 },
    { origen: "Instagram", count: 9 },
    { origen: "Web orgánico", count: 7 },
  ],
  porMotivo: [
    { motivo: "Precio elevado", count: 9 },
    { motivo: "Sin urgencia percibida", count: 5 },
    { motivo: "Fue a otra clínica", count: 3 },
    { motivo: "No responde seguimiento", count: 1 },
  ],
  tendenciaMensual: [
    { mes: "2025-04", label: "Abr", total: 34, aceptados: 14 },
    { mes: "2025-05", label: "May", total: 38, aceptados: 17 },
    { mes: "2025-06", label: "Jun", total: 41, aceptados: 19 },
    { mes: "2025-07", label: "Jul", total: 29, aceptados: 11 },
    { mes: "2025-08", label: "Ago", total: 22, aceptados: 8 },
    { mes: "2025-09", label: "Sep", total: 36, aceptados: 16 },
    { mes: "2025-10", label: "Oct", total: 43, aceptados: 20 },
    { mes: "2025-11", label: "Nov", total: 45, aceptados: 21 },
    { mes: "2025-12", label: "Dic", total: 39, aceptados: 18 },
    { mes: "2026-01", label: "Ene", total: 42, aceptados: 19 },
    { mes: "2026-02", label: "Feb", total: 44, aceptados: 21 },
    { mes: "2026-03", label: "Mar", total: 47, aceptados: 22 },
  ],
  porClinica: [
    { clinica: "Clínica Norte", total: 18, aceptados: 10, importeTotal: 15200, tasa: 56 },
    { clinica: "Clínica Sur", total: 15, aceptados: 7, importeTotal: 11800, tasa: 47 },
    { clinica: "Clínica Centro", total: 14, aceptados: 5, importeTotal: 11500, tasa: 36 },
  ],
  abTonos: [
    { tono: "Empático + urgencia", mensajes: 89, aceptados: 47, tasa: 53 },
    { tono: "Informativo directo", mensajes: 74, aceptados: 31, tasa: 42 },
    { tono: "Financiación destacada", mensajes: 61, aceptados: 22, tasa: 36 },
  ],
};

const INFORME = `La clínica cerró marzo con 47 presupuestos y una tasa de conversión del 47%, superando la media anual de 39%.

Dra. García lidera el equipo con 61% de cierre, 14pp por encima de la media. Su protocolo debería documentarse y compartirse.

El precio sigue siendo la principal barrera (50% de las pérdidas). Activar la presentación de financiación proactiva en consulta antes del presupuesto podría reducir este motivo en 3-5 puntos.

El canal de referidos (40% del volumen) es el más eficiente. Aumentar el programa de incentivos por referido podría acelerar el crecimiento.

1. Implementar protocolo de presentación de financiación en todas las consultas antes del fin de mes.
2. Documentar y replicar el proceso de Dra. García en el resto del equipo.
3. Lanzar campaña de referidos para pacientes activos con tratamiento completado.`;

// ─── Types ────────────────────────────────────────────────────────────────────

type TendenciaMes = { mes: string; label: string; total: number; aceptados: number };
type DoctorKpi = { doctor: string; total: number; aceptados: number; tasa: number };
type KpiResumen = typeof DATOS;

// ─── Shared helpers ───────────────────────────────────────────────────────────

const MES_LABEL = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const MES_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function mesLabel(mes: string): string {
  const [, m] = mes.split("-").map(Number);
  const [y] = mes.split("-");
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
  if (d.tasa === 0) return "Urgente";
  if (d.tasa >= 50) return "Referencia";
  return "Atención";
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
  if (mL.includes("precio")) return `${count} casos (${pct}% de las pérdidas). Acción: presentar financiación durante la consulta. Ejemplo: €4.000 = €167/mes a 24 meses.`;
  if (mL.includes("urgencia") || mL.includes("tiempo")) return `${count} casos (${pct}%). Reforzar: coste de la inacción y progresión del problema sin tratamiento.`;
  if (mL.includes("clínica") || mL.includes("clinica")) return `${count} casos (${pct}%). Identificar a qué clínicas van los pacientes para ajustar argumentario.`;
  if (mL.includes("responde")) return `${count} casos (${pct}%). Activar motor IA para presupuestos sin respuesta > 3 días.`;
  return `${count} casos (${pct}% de las pérdidas).`;
}
function doctorAnalisis(d: DoctorKpi, mediaRed: number): string {
  const diff = d.tasa - mediaRed;
  if (d.total < 3) return `${d.total} presupuesto${d.total !== 1 ? "s" : ""} — muestra insuficiente para análisis estadístico.`;
  if (d.tasa >= 50) return `${d.aceptados}/${d.total} cierres — ${Math.abs(diff)}pp por encima de la media. Modelo de referencia para el equipo.`;
  if (d.tasa === 0) return `0/${d.total} cierres — resultado crítico. Convocar revisión urgente.`;
  if (diff < 0) return `${d.aceptados}/${d.total} cierres — ${Math.abs(diff)}pp por debajo de la media. Motor IA puede mejorar 5-8pp.`;
  return `${d.aceptados}/${d.total} cierres — en línea con la media de la red (${mediaRed}%).`;
}
function proyeccionMeses(tendencia: TendenciaMes[], mes: string): { mes: string; valor: number }[] {
  const last3 = tendencia.slice(-3).filter((t) => t.total > 0);
  const avgTotal = last3.length ? Math.round(last3.reduce((s, t) => s + t.total, 0) / last3.length) : 0;
  const avgTasa = last3.length ? last3.reduce((s, t) => s + (t.total > 0 ? t.aceptados / t.total : 0), 0) / last3.length : 0;
  const avgImporte = 850;
  const parts = mes.split("-").map(Number);
  const y = parts[0]; let m = parts[1];
  return [1, 2, 3].map((i) => {
    let mo = m + i; let yr = y;
    if (mo > 12) { mo -= 12; yr++; }
    return { mes: `${MES_SHORT[mo - 1]} ${yr}`, valor: Math.round(avgTotal * avgTasa * avgImporte * (1 - i * 0.1)) };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDF
// ═══════════════════════════════════════════════════════════════════════════════

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
  page: { fontFamily: "Helvetica", fontSize: 10, color: C.text, paddingTop: 36, paddingBottom: 50, paddingHorizontal: 48 },
  coverPage: { fontFamily: "Helvetica", backgroundColor: C.primary, paddingTop: 140, paddingHorizontal: 60, paddingBottom: 60 },
  coverTitle: { fontSize: 30, fontFamily: "Helvetica-Bold", color: "#FFF", marginBottom: 10 },
  coverDivider: { width: 48, height: 3, backgroundColor: "#A78BFA", marginBottom: 20 },
  coverSubtitle: { fontSize: 17, color: "#EDE9FE", marginBottom: 4 },
  coverMeta: { fontSize: 9.5, color: "#C4B5FD", marginTop: 36 },
  sectionTitle: { fontSize: 13, fontFamily: "Helvetica-Bold", color: C.primary, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: C.primary, paddingBottom: 3 },
  subTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.text, marginBottom: 6, marginTop: 10 },
  metricsRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  metricCard: { flex: 1, backgroundColor: C.bg, borderRadius: 5, padding: 9, borderWidth: 1, borderColor: C.border },
  metricValue: { fontSize: 20, fontFamily: "Helvetica-Bold", color: C.text, marginBottom: 1 },
  metricLabel: { fontSize: 7.5, color: C.muted, textTransform: "uppercase" },
  paragraph: { fontSize: 9.5, lineHeight: 1.65, color: C.text, marginBottom: 8 },
  small: { fontSize: 8.5, lineHeight: 1.5, color: C.muted, marginBottom: 6 },
  tableHeader: { flexDirection: "row", backgroundColor: "#F1F5F9", paddingVertical: 4, paddingHorizontal: 7, borderRadius: 3, marginBottom: 1 },
  tableRow: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 7, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  th: { flex: 1, fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.muted, textTransform: "uppercase" },
  td: { flex: 1, fontSize: 8.5, color: C.text },
  chartImg: { width: "100%", marginBottom: 10, borderRadius: 3 },
  chartImgHalf: { width: "100%", marginBottom: 8, borderRadius: 3 },
  planBlock: { marginBottom: 12, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: C.primary },
  planNum: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.primary, marginBottom: 2 },
  planBody: { fontSize: 9.5, lineHeight: 1.6, color: C.text },
  footer: { position: "absolute", bottom: 18, left: 48, right: 48, flexDirection: "row", justifyContent: "space-between" },
  footerText: { fontSize: 7.5, color: C.muted },
  analysisBlock: { backgroundColor: C.bgPurple, borderRadius: 4, padding: 8, borderLeftWidth: 2.5, borderLeftColor: C.primary, marginBottom: 8 },
  analysisTitle: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.primary, marginBottom: 2 },
  analysisBody: { fontSize: 8.5, lineHeight: 1.55, color: C.text },
});

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
  const tendenciaTxt = tendenciaAnalisis(datos.tendenciaMensual, mes);

  const planItems: string[] = (() => {
    if (!parrafos[4]) return [];
    const actions = parrafos[4].split(/(?=\d\.)/).filter(Boolean);
    return (actions.length >= 2 ? actions : [parrafos[4]]).slice(0, 3);
  })();

  const Footer = () => (
    <View style={S.footer} fixed>
      <Text style={S.footerText}>{clinica} · {label}</Text>
      <Text style={S.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );

  return (
    <Document title={`Informe ${label} — ${clinica}`} author="Fyllio" creator="Fyllio CRM">

      {/* 1. Portada */}
      <Page size="A4" style={S.coverPage}>
        <Text style={S.coverTitle}>INFORME MENSUAL{"\n"}DE PRESUPUESTOS</Text>
        <View style={S.coverDivider} />
        <Text style={S.coverSubtitle}>{label.toUpperCase()}</Text>
        <Text style={{ ...S.coverSubtitle, fontSize: 14 }}>{clinica}</Text>
        <Text style={S.coverMeta}>Generado el {fecha} · {datos.total} presupuestos analizados</Text>
        <Text style={{ ...S.coverMeta, marginTop: 4 }}>Informe generado con IA · Confidencial · Uso interno</Text>
      </Page>

      {/* 2. Resumen ejecutivo */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>RESUMEN EJECUTIVO</Text>
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
            <Text style={{ ...S.metricValue, fontSize: 16 }}>{datos.adeslas.total} ({datos.adeslas.tasa}%)</Text>
            <Text style={S.metricLabel}>Adeslas</Text>
          </View>
        </View>
        {parrafos.slice(0, 2).map((p, i) => (
          <Text key={i} style={S.paragraph}>{p}</Text>
        ))}
        <Footer />
      </Page>

      {/* 3. Evolución 12 meses */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>EVOLUCIÓN 12 MESES</Text>
        {pngLinea ? (
          <Image style={S.chartImg} src={`data:image/png;base64,${pngLinea}`} />
        ) : (
          <View style={{ backgroundColor: C.bg, borderRadius: 4, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: C.border }}>
            <Text style={{ ...S.small, textAlign: "center" }}>Sin datos de evolución para este período</Text>
          </View>
        )}
        {tendenciaTxt ? (
          <View style={{ ...S.analysisBlock, marginBottom: 10 }}>
            <Text style={S.analysisBody}>{tendenciaTxt}</Text>
          </View>
        ) : null}
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
        <Footer />
      </Page>

      {/* 4. Rendimiento por clínica */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>RENDIMIENTO POR CLÍNICA</Text>
        {pngClinicas ? (
          <Image style={S.chartImg} src={`data:image/png;base64,${pngClinicas}`} />
        ) : null}
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
        <Footer />
      </Page>

      {/* 5. Motivos de pérdida */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>MOTIVOS DE PÉRDIDA</Text>
        {pngMotivos ? (
          <Image style={S.chartImg} src={`data:image/png;base64,${pngMotivos}`} />
        ) : null}
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
        {datos.porMotivo.filter((m) => m.count >= 3).slice(0, 3).map((m, i) => (
          <View key={i} style={S.analysisBlock}>
            <Text style={S.analysisTitle}>{m.motivo}</Text>
            <Text style={S.analysisBody}>{motivoAnalisis(m.motivo, m.count, datos.perdidos)}</Text>
          </View>
        ))}
        {parrafos[2] ? <Text style={S.paragraph}>{parrafos[2]}</Text> : null}
        <Footer />
      </Page>

      {/* 6. Rendimiento por doctor */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>RENDIMIENTO POR DOCTOR</Text>
        {pngDoctores ? (
          <Image style={S.chartImg} src={`data:image/png;base64,${pngDoctores}`} />
        ) : null}
        <View style={{ marginBottom: 10 }}>
          <View style={S.tableHeader}>
            <Text style={{ ...S.th, flex: 2 }}>Doctor</Text>
            <Text style={{ ...S.th, textAlign: "right" }}>Total</Text>
            <Text style={{ ...S.th, textAlign: "right" }}>Acept.</Text>
            <Text style={{ ...S.th, textAlign: "right" }}>Tasa</Text>
            <Text style={{ ...S.th, flex: 1.2 }}>Estado</Text>
          </View>
          {datos.porDoctor.map((d, i) => (
            <View key={i} style={S.tableRow}>
              <Text style={{ ...S.td, flex: 2 }}>{d.doctor}</Text>
              <Text style={{ ...S.td, textAlign: "right" }}>{d.total}</Text>
              <Text style={{ ...S.td, textAlign: "right" }}>{d.aceptados}</Text>
              <Text style={{ ...S.td, textAlign: "right", color: tasaColor(d.tasa) }}>{d.tasa}%</Text>
              <Text style={{ ...S.td, flex: 1.2, fontSize: 8 }}>{doctorEstado(d)}</Text>
            </View>
          ))}
        </View>
        {datos.porDoctor.filter((d) => d.total >= 3).slice(0, 4).map((d, i) => (
          <View key={i} style={S.analysisBlock}>
            <Text style={S.analysisTitle}>{d.doctor} — {d.tasa}% tasa</Text>
            <Text style={S.analysisBody}>{doctorAnalisis(d, mediaRed)}</Text>
          </View>
        ))}
        <Footer />
      </Page>

      {/* 7. Canales + A/B */}
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
        <Footer />
      </Page>

      {/* 8. Plan de acción + Forecasting */}
      <Page size="A4" style={S.page}>
        <Text style={S.sectionTitle}>PLAN DE ACCIÓN</Text>
        {planItems.length > 0 ? planItems.map((a, i) => (
          <View key={i} style={S.planBlock}>
            <Text style={S.planNum}>ACCIÓN {i + 1}</Text>
            <Text style={S.planBody}>{a.trim()}</Text>
          </View>
        )) : (
          <Text style={S.small}>Sin recomendaciones disponibles.</Text>
        )}
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
              {["*** Alta", "**  Media", "*   Baja"][i]}
            </Text>
          </View>
        ))}
        <Text style={{ ...S.small, marginTop: 6 }}>
          Proyección basada en media rolling de últimos 3 meses.
        </Text>
        <View style={{ marginTop: 16 }}>
          <Text style={{ ...S.small, color: C.muted }}>
            Fyllio CRM · Demo Marzo 2026 · Confidencial
          </Text>
        </View>
        <Footer />
      </Page>
    </Document>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PPT
// ═══════════════════════════════════════════════════════════════════════════════

const BG_DARK = "1E1B4B";
const PRIMARY = "7C3AED";
const WHITE = "FFFFFF";
const DARK = "1E293B";
const MUTED = "64748B";
const LIGHT = "F8FAFC";
const PURPLE_LIGHT = "F5F3FF";
const GREEN = "16A34A";
const ORANGE = "D97706";
const RED = "DC2626";

type CellOpts = { text: string; bold?: boolean; fontSize?: number; color?: string; fill?: string; align?: "left" | "center" | "right" };

function cell(opts: CellOpts) {
  return {
    text: opts.text,
    options: {
      bold: opts.bold ?? false,
      fontSize: opts.fontSize ?? 9,
      color: opts.color ?? DARK,
      fill: opts.fill ? { color: opts.fill } : undefined,
      border: { type: "solid" as const, pt: 0.5, color: "E5E7EB" },
      align: opts.align ?? "left",
    },
  };
}

function semaforoColor(tasa: number, media: number): string {
  if (tasa >= media * 1.1) return GREEN;
  if (tasa >= media * 0.8) return ORANGE;
  return RED;
}

async function generarPPT(
  mes: string, clinica: string, informe: string, datos: KpiResumen,
  pngLinea: string, pngClinicas: string, pngMotivos: string, pngDoctores: string,
  pngCanales: string, pngForecast: string, pngAB: string,
  proyeccion: { mes: string; valor: number }[]
): Promise<Buffer> {
  const label = mesLabel(mes);
  const labelCaps = label.charAt(0).toUpperCase() + label.slice(1);
  const clinicaName = clinica;
  const parrafos = informe.split("\n\n").filter(Boolean).map((p) => plainText(p.trim()));
  const mediaRed = datos.total > 0 ? Math.round(datos.aceptados / datos.total * 100) : 0;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "Fyllio CRM";
  pptx.title = `Informe ${labelCaps} — ${clinicaName}`;

  // S1 — Portada
  {
    const s = pptx.addSlide();
    s.background = { color: BG_DARK };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 2.0, w: 0.09, h: 4.5, fill: { color: PRIMARY } });
    s.addText("INFORME MENSUAL\nDE PRESUPUESTOS", { x: 0.6, y: 1.2, w: 9, h: 2.2, fontSize: 44, bold: true, color: WHITE, fontFace: "Calibri" });
    s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 3.45, w: 2.4, h: 0.07, fill: { color: PRIMARY } });
    s.addText(`${labelCaps.toUpperCase()} · ${clinicaName}`, { x: 0.6, y: 3.65, w: 12, h: 0.6, fontSize: 22, color: "A5B4FC", fontFace: "Calibri" });
    s.addText(`${datos.total} presupuestos · Generado con IA · Confidencial`, { x: 0.6, y: 5.1, w: 12, h: 0.4, fontSize: 13, color: "4B5563", fontFace: "Calibri" });
  }

  // S2 — Resumen ejecutivo
  {
    const s = pptx.addSlide();
    s.background = { color: WHITE };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
    s.addText(`${labelCaps} en números`, { x: 0.5, y: 0.28, w: 9, h: 0.65, fontSize: 28, bold: true, color: DARK, fontFace: "Calibri" });
    const kpis = [
      { val: String(datos.total), lbl: "PRESUPUESTOS", x: 0.35 },
      { val: String(datos.aceptados), lbl: `ACEPTADOS (${datos.tasa}%)`, x: 3.6 },
      { val: euro(datos.importeTotal), lbl: "IMPORTE ACEPTADO", x: 6.85 },
      { val: String(datos.activos), lbl: "PIPELINE ACTIVO", x: 10.1 },
    ];
    kpis.forEach((k) => {
      s.addShape(pptx.ShapeType.rect, { x: k.x, y: 1.05, w: 2.85, h: 1.9, fill: { color: "F5F3FF" }, line: { color: "DDD6FE", width: 1 } });
      s.addText(k.val, { x: k.x + 0.1, y: 1.2, w: 2.65, h: 1.05, fontSize: 38, bold: true, color: PRIMARY, align: "center", fontFace: "Calibri" });
      s.addText(k.lbl, { x: k.x + 0.1, y: 2.3, w: 2.65, h: 0.45, fontSize: 9, color: MUTED, align: "center", fontFace: "Calibri" });
    });
    parrafos.slice(0, 3).forEach((b, i) => {
      s.addText(`● ${b.slice(0, 220)}`, { x: 0.4, y: 3.2 + i * 0.9, w: 12.5, h: 0.8, fontSize: 10, color: DARK, fontFace: "Calibri", wrap: true });
    });
  }

  // S3 — Evolución 12 meses
  {
    const s = pptx.addSlide();
    s.background = { color: WHITE };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
    s.addText("Evolución — últimos 12 meses", { x: 0.5, y: 0.25, w: 10, h: 0.6, fontSize: 26, bold: true, color: DARK, fontFace: "Calibri" });
    if (pngLinea) {
      s.addImage({ data: `data:image/png;base64,${pngLinea}`, x: 0.5, y: 0.97, w: 12.3, h: 3.3 });
    }
    const last6 = datos.tendenciaMensual.slice(-6);
    const rows = [
      [cell({ text: "Mes", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9" }),
       cell({ text: "Ofrecidos", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" }),
       cell({ text: "Aceptados", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" }),
       cell({ text: "Tasa", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" })],
      ...last6.map((t, i) => [
        cell({ text: `${t.label} ${t.mes.slice(0, 4)}`, fontSize: 11, fill: i % 2 === 0 ? WHITE : "FAFAFA" }),
        cell({ text: String(t.total), fontSize: 11, fill: i % 2 === 0 ? WHITE : "FAFAFA", align: "center" }),
        cell({ text: String(t.aceptados), fontSize: 11, fill: i % 2 === 0 ? WHITE : "FAFAFA", align: "center" }),
        cell({ text: t.total > 0 ? Math.round(t.aceptados / t.total * 100) + "%" : "—", fontSize: 11, fill: i % 2 === 0 ? WHITE : "FAFAFA", align: "center" }),
      ]),
    ];
    s.addTable(rows, { x: 0.5, y: 4.43, w: 12.3, h: 2.1 });
  }

  // S4 — Red de clínicas
  {
    const s = pptx.addSlide();
    s.background = { color: LIGHT };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
    s.addText("Estado de la red de clínicas", { x: 0.5, y: 0.25, w: 10, h: 0.6, fontSize: 26, bold: true, color: DARK, fontFace: "Calibri" });
    datos.porClinica.slice(0, 4).forEach((c, i) => {
      const col = Math.floor(i / 2);
      const row = i % 2;
      const x = 0.35 + col * 6.55;
      const y = 1.05 + row * 2.9;
      const bColor = semaforoColor(c.tasa, mediaRed);
      s.addShape(pptx.ShapeType.rect, { x, y, w: 6.2, h: 2.5, fill: { color: WHITE }, line: { color: bColor, width: 2.5 } });
      s.addShape(pptx.ShapeType.rect, { x, y, w: 0.1, h: 2.5, fill: { color: bColor } });
      s.addText(c.clinica, { x: x + 0.25, y: y + 0.12, w: 4.5, h: 0.5, fontSize: 18, bold: true, color: DARK, fontFace: "Calibri" });
      s.addText(`${c.tasa}%`, { x: x + 4.9, y: y + 0.08, w: 1.2, h: 0.6, fontSize: 32, bold: true, color: bColor, align: "right", fontFace: "Calibri" });
      s.addText("conversión", { x: x + 4.9, y: y + 0.7, w: 1.2, h: 0.3, fontSize: 10, color: MUTED, align: "right", fontFace: "Calibri" });
      s.addText(`${c.total} presupuestos  ·  ${c.aceptados} aceptados  ·  ${euro(c.importeTotal)}`, { x: x + 0.25, y: y + 0.75, w: 4.5, h: 0.35, fontSize: 13, color: "4B5563", fontFace: "Calibri" });
    });
    if (pngClinicas) {
      s.addImage({ data: `data:image/png;base64,${pngClinicas}`, x: 0.35, y: 6.1, w: 12.6, h: 0.6 });
    }
  }

  // S5 — Barreras
  {
    const s = pptx.addSlide();
    s.background = { color: WHITE };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
    s.addText("¿Por qué se pierden los presupuestos?", { x: 0.5, y: 0.25, w: 12, h: 0.6, fontSize: 24, bold: true, color: DARK, fontFace: "Calibri" });
    if (pngMotivos) {
      s.addImage({ data: `data:image/png;base64,${pngMotivos}`, x: 0.4, y: 0.97, w: 6.8, h: 5.2 });
    }
    datos.porMotivo.slice(0, 3).map((m) => {
      const pct = datos.perdidos > 0 ? Math.round(m.count / datos.perdidos * 100) : 0;
      const mL = m.motivo.toLowerCase();
      let accion = "Revisar protocolo de consulta.";
      if (mL.includes("precio")) accion = "Ofrecer financiación proactiva en consulta.";
      else if (mL.includes("urgencia")) accion = "Comunicar consecuencias de no tratar.";
      else if (mL.includes("clínica") || mL.includes("clinica")) accion = "Reforzar argumentario de diferenciación.";
      else if (mL.includes("responde")) accion = "Activar motor IA para seguimiento > 3 días.";
      return { titulo: `${pct}% — ${m.motivo}`, texto: accion };
    }).forEach((ins, i) => {
      s.addText(ins.titulo, { x: 7.5, y: 1.2 + i * 1.8, w: 5.4, h: 0.45, fontSize: 15, bold: true, color: RED, fontFace: "Calibri" });
      s.addShape(pptx.ShapeType.rect, { x: 7.5, y: 1.7 + i * 1.8, w: 5.4, h: 1.0, fill: { color: "FEF2F2" }, line: { color: "FECACA", width: 1 } });
      s.addText(ins.texto, { x: 7.65, y: 1.78 + i * 1.8, w: 5.1, h: 0.85, fontSize: 13, color: DARK, fontFace: "Calibri", wrap: true, valign: "middle" });
    });
  }

  // S6 — Equipo médico
  {
    const s = pptx.addSlide();
    s.background = { color: WHITE };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
    s.addText("Rendimiento del equipo médico", { x: 0.5, y: 0.25, w: 10, h: 0.6, fontSize: 24, bold: true, color: DARK, fontFace: "Calibri" });
    if (pngDoctores) {
      s.addImage({ data: `data:image/png;base64,${pngDoctores}`, x: 0.4, y: 0.97, w: 12.5, h: 3.3 });
    }
    const topDoc = datos.porDoctor.find((d) => d.total >= 3 && d.tasa >= 50);
    if (topDoc) {
      s.addShape(pptx.ShapeType.rect, { x: 0.4, y: 4.4, w: 12.5, h: 0.75, fill: { color: "F5F3FF" }, line: { color: "DDD6FE", width: 1 } });
      s.addText(`★ ${topDoc.doctor} (${topDoc.tasa}%) — ${topDoc.tasa - mediaRed}pp por encima de la media (${mediaRed}%). Documentar su protocolo.`,
        { x: 0.6, y: 4.5, w: 12.1, h: 0.55, fontSize: 13, color: "4C1D95", fontFace: "Calibri", wrap: true });
    }
    const docRows = [
      [cell({ text: "Doctor", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9" }),
       cell({ text: "Total", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" }),
       cell({ text: "Acept.", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" }),
       cell({ text: "Tasa", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9", align: "center" }),
       cell({ text: "Estado", bold: true, fontSize: 11, color: MUTED, fill: "F1F5F9" })],
      ...datos.porDoctor.map((d, i) => {
        const estado = d.tasa === 0 && d.total >= 3 ? "Urgente" : d.tasa >= 50 ? "Referencia" : "Atención";
        const tasaC = d.tasa === 0 && d.total >= 3 ? RED : d.tasa >= 50 ? GREEN : DARK;
        const bg = i % 2 === 0 ? WHITE : "FAFAFA";
        return [
          cell({ text: d.doctor, bold: d.tasa >= 50, fontSize: 11, fill: bg }),
          cell({ text: String(d.total), fontSize: 11, fill: bg, align: "center" }),
          cell({ text: String(d.aceptados), fontSize: 11, fill: bg, align: "center" }),
          cell({ text: `${d.tasa}%`, bold: true, fontSize: 11, color: tasaC, fill: bg, align: "center" }),
          cell({ text: estado, fontSize: 10, fill: bg }),
        ];
      }),
    ];
    s.addTable(docRows, { x: 0.4, y: topDoc ? 5.3 : 4.45, w: 12.5, h: 1.8 });
  }

  // S7 — Canales y A/B
  {
    const s = pptx.addSlide();
    s.background = { color: WHITE };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
    s.addText("¿De dónde vienen los pacientes?", { x: 0.5, y: 0.25, w: 12.3, h: 0.6, fontSize: 22, bold: true, color: DARK, fontFace: "Calibri" });
    s.addText("ORIGEN DE LEADS", { x: 0.4, y: 0.97, w: 6, h: 0.35, fontSize: 11, bold: true, color: PRIMARY, fontFace: "Calibri" });
    if (pngCanales) {
      s.addImage({ data: `data:image/png;base64,${pngCanales}`, x: 0.4, y: 1.38, w: 6.1, h: 3.4 });
    }
    s.addShape(pptx.ShapeType.line, { x: 6.85, y: 1.0, w: 0, h: 5.5, line: { color: "E5E7EB", width: 1 } });
    s.addText("A/B DE TONOS — MOTOR IA", { x: 7.1, y: 0.97, w: 6, h: 0.35, fontSize: 11, bold: true, color: PRIMARY, fontFace: "Calibri" });
    const abSorted = [...datos.abTonos].sort((a, b) => b.tasa - a.tasa);
    const abColors = [{ bg: "F0FDF4", border: GREEN, color: GREEN }, { bg: "FFFBEB", border: ORANGE, color: ORANGE }, { bg: "F9FAFB", border: "E5E7EB", color: MUTED }];
    abSorted.slice(0, 3).forEach((t, i) => {
      const col = abColors[i] ?? abColors[2];
      const y = 1.42 + i * 1.55;
      s.addShape(pptx.ShapeType.rect, { x: 7.1, y, w: 5.9, h: 1.35, fill: { color: col.bg }, line: { color: col.border, width: 1 } });
      s.addText(`${i === 0 ? "★ " : ""}${t.tono}`, { x: 7.25, y: y + 0.1, w: 3.5, h: 0.45, fontSize: 16, bold: true, color: col.color, fontFace: "Calibri" });
      s.addText(`${t.tasa}%`, { x: 11.2, y: y + 0.05, w: 1.7, h: 0.65, fontSize: 34, bold: true, color: col.color, align: "right", fontFace: "Calibri" });
      s.addText(`${t.mensajes} mensajes · ${t.aceptados} aceptados`, { x: 7.25, y: y + 0.75, w: 5.5, h: 0.35, fontSize: 12, color: MUTED, fontFace: "Calibri" });
    });
    if (pngAB) {
      s.addImage({ data: `data:image/png;base64,${pngAB}`, x: 7.1, y: 6.15, w: 5.9, h: 0.7 });
    }
  }

  // S8 — Forecasting
  {
    const s = pptx.addSlide();
    s.background = { color: LIGHT };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
    s.addText("Proyección próximos 3 meses", { x: 0.5, y: 0.25, w: 10, h: 0.6, fontSize: 26, bold: true, color: DARK, fontFace: "Calibri" });
    s.addText("Basado en la media rolling de los últimos 3 meses · Estimación orientativa", { x: 0.5, y: 0.9, w: 12, h: 0.38, fontSize: 11, color: MUTED, fontFace: "Calibri" });
    const fColors = [
      { bg: "F0FDF4", border: GREEN, numColor: DARK },
      { bg: "FFFBEB", border: ORANGE, numColor: DARK },
      { bg: "F9FAFB", border: "9CA3AF", numColor: MUTED },
    ];
    const confianzaLabels = ["Alta confianza", "Media confianza", "Baja confianza"];
    const confianzaColors = [GREEN, ORANGE, MUTED];
    proyeccion.forEach((p, i) => {
      const fc = fColors[i];
      const xCard = 0.4 + i * 4.3;
      s.addShape(pptx.ShapeType.rect, { x: xCard, y: 1.4, w: 4.05, h: 4.55, fill: { color: fc.bg }, line: { color: fc.border, width: 1.5 } });
      s.addText(p.mes.toUpperCase(), { x: xCard + 0.2, y: 1.6, w: 3.65, h: 0.5, fontSize: 13, bold: true, color: fc.border, fontFace: "Calibri" });
      s.addText(euro(p.valor), { x: xCard + 0.15, y: 2.15, w: 3.75, h: 1.2, fontSize: 40, bold: true, color: fc.numColor, fontFace: "Calibri" });
      s.addText(confianzaLabels[i] + " confianza", { x: xCard + 0.2, y: 3.45, w: 3.65, h: 0.45, fontSize: 14, color: confianzaColors[i], fontFace: "Calibri" });
      s.addText(i === 0 ? `Pipeline: ${euro(datos.importePipeline)}` : i === 1 ? "Tendencia 6 meses" : "Proyección a 3 meses", { x: xCard + 0.2, y: 4.0, w: 3.65, h: 0.6, fontSize: 12, color: MUTED, fontFace: "Calibri", wrap: true });
    });
    s.addText("* La confianza decrece con la distancia temporal.", { x: 0.4, y: 6.3, w: 12.5, h: 0.4, fontSize: 11, color: MUTED, italic: true, fontFace: "Calibri" });
  }

  // S9 — Plan de acción
  {
    const s = pptx.addSlide();
    s.background = { color: PURPLE_LIGHT };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: PRIMARY } });
    s.addText("Plan de acción", { x: 0.5, y: 0.25, w: 10, h: 0.6, fontSize: 26, bold: true, color: DARK, fontFace: "Calibri" });
    const planText = parrafos[parrafos.length - 1] ?? "";
    const actions = planText.split(/(?=\d\.)/).filter(Boolean);
    const items = actions.length >= 2 ? actions.slice(0, 3) : planText.split(/[.!]/).filter((s) => s.trim().length > 20).slice(0, 3);
    items.forEach((a, i) => {
      const xCol = 0.35 + i * 4.35;
      s.addShape(pptx.ShapeType.ellipse, { x: xCol + 1.5, y: 1.0, w: 0.85, h: 0.85, fill: { color: PRIMARY } });
      s.addText(String(i + 1), { x: xCol + 1.5, y: 1.0, w: 0.85, h: 0.85, fontSize: 22, bold: true, color: WHITE, align: "center", valign: "middle", fontFace: "Calibri" });
      s.addShape(pptx.ShapeType.rect, { x: xCol, y: 1.95, w: 4.1, h: 4.45, fill: { color: WHITE }, line: { color: "DDD6FE", width: 1.5 } });
      s.addText(a.trim().slice(0, 220), { x: xCol + 0.18, y: 2.15, w: 3.75, h: 4.05, fontSize: 13, color: DARK, fontFace: "Calibri", wrap: true, valign: "top" });
    });
  }

  // S10 — Cierre
  {
    const s = pptx.addSlide();
    s.background = { color: BG_DARK };
    s.addShape(pptx.ShapeType.rect, { x: 4.67, y: 3.0, w: 4.0, h: 0.07, fill: { color: PRIMARY } });
    s.addText("¿Preguntas?", { x: 1, y: 1.5, w: 11.33, h: 1.8, fontSize: 52, bold: true, color: WHITE, align: "center", fontFace: "Calibri" });
    s.addText(`${clinicaName} · ${labelCaps}`, { x: 1, y: 3.55, w: 11.33, h: 0.65, fontSize: 22, color: "A5B4FC", align: "center", fontFace: "Calibri" });
    s.addText("Informe generado con Fyllio CRM · Confidencial", { x: 1, y: 4.85, w: 11.33, h: 0.45, fontSize: 13, color: "4B5563", align: "center", fontFace: "Calibri" });
  }

  return await pptx.write({ outputType: "nodebuffer" }) as Buffer;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  const outputDir = join(process.cwd(), "scripts", "output");
  mkdirSync(outputDir, { recursive: true });

  const datos = DATOS as unknown as KpiResumen;
  const mediaRed = datos.total > 0 ? Math.round(datos.aceptados / datos.total * 100) : 0;
  const proyeccion = proyeccionMeses(datos.tendenciaMensual, MES);

  console.log("Generando gráficos...");
  const [bufLinea, bufClinicas, bufMotivos, bufDoctores, bufCanales, bufForecast, bufAB] =
    await Promise.all([
      graficoLineas(datos.tendenciaMensual.map((t) => ({ label: t.label, ofrecidos: t.total, aceptados: t.aceptados }))),
      graficoBarrasH(datos.porClinica.map((c) => ({ label: c.clinica, value: c.tasa, color: c.tasa >= mediaRed ? "#16A34A" : "#DC2626" }))),
      graficoBarrasH(datos.porMotivo.map((m) => ({ label: m.motivo, value: m.count, color: "#DC2626" }))),
      graficoBarrasV(datos.porDoctor.map((d) => ({ label: d.doctor, value: d.tasa })), mediaRed),
      graficoBarrasH(datos.porOrigen.map((o) => ({ label: o.origen, value: o.count, color: "#7C3AED" }))),
      graficoForecast(proyeccion.map((p, i) => ({ mes: p.mes, valor: p.valor, color: ["#16A34A", "#D97706", "#9CA3AF"][i] }))),
      graficoAB(datos.abTonos.map((t) => ({ tono: t.tono, tasa: t.tasa, mensajes: t.mensajes }))),
    ]);

  const toB64 = (b: Buffer | null): string => b ? b.toString("base64") : "";
  const pngLinea    = toB64(bufLinea);
  const pngClinicas = toB64(bufClinicas);
  const pngMotivos  = toB64(bufMotivos);
  const pngDoctores = toB64(bufDoctores);
  const pngCanales  = toB64(bufCanales);
  const pngForecast = toB64(bufForecast);
  const pngAB       = toB64(bufAB);

  console.log("Charts:", {
    linea:    bufLinea    ? `${Math.round(bufLinea.byteLength / 1024)}KB`    : "EMPTY",
    clinicas: bufClinicas ? `${Math.round(bufClinicas.byteLength / 1024)}KB` : "EMPTY",
    motivos:  bufMotivos  ? `${Math.round(bufMotivos.byteLength / 1024)}KB`  : "EMPTY",
    doctores: bufDoctores ? `${Math.round(bufDoctores.byteLength / 1024)}KB` : "EMPTY",
    canales:  bufCanales  ? `${Math.round(bufCanales.byteLength / 1024)}KB`  : "EMPTY",
    forecast: bufForecast ? `${Math.round(bufForecast.byteLength / 1024)}KB` : "EMPTY",
    ab:       bufAB       ? `${Math.round(bufAB.byteLength / 1024)}KB`       : "EMPTY",
  });

  // PDF
  console.log("\nGenerando PDF...");
  const pdfBuffer = await renderToBuffer(
    <InformePDF
      mes={MES}
      clinica={CLINICA}
      informe={INFORME}
      datos={datos}
      generadoEn={new Date().toISOString()}
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
  const pdfPath = join(outputDir, "demo_marzo_2026.pdf");
  writeFileSync(pdfPath, new Uint8Array(pdfBuffer));
  console.log(`PDF generado: ${pdfPath} (${Math.round(pdfBuffer.byteLength / 1024)}KB)`);

  // PPT
  console.log("\nGenerando PPT...");
  const pptBuffer = await generarPPT(MES, CLINICA, INFORME, datos, pngLinea, pngClinicas, pngMotivos, pngDoctores, pngCanales, pngForecast, pngAB, proyeccion);
  const pptPath = join(outputDir, "demo_marzo_2026.pptx");
  writeFileSync(pptPath, new Uint8Array(pptBuffer));
  console.log(`PPT generado: ${pptPath} (${Math.round(pptBuffer.byteLength / 1024)}KB)`);

  console.log("\nListo! Abrir los archivos en scripts/output/");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
