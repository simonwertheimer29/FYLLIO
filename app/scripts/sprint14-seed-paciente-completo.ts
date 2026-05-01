// app/scripts/sprint14-seed-paciente-completo.ts
//
// Sprint 14a Bloque 1.5 — seed end-to-end de 5 pacientes para QA del
// hub Paciente360. Cada paciente lleva: lead origen, conversión a
// paciente con presupuesto firmado, varios pagos en Pagos_Paciente,
// acciones en Acciones_Lead (llamadas + WhatsApp + notas), notas
// libres en paciente.Notas y presupuesto.Notas.
//
// Diferencias respecto al seed Sprint 13.1.1:
//   - 5 pacientes en lugar de 7.
//   - Cada paciente tiene 2-3 pagos (no 1) → para validar timeline
//     ordenado y stats cumulativas.
//   - Cada paciente tiene 4-6 acciones de lead → tab Acciones con
//     historial real.
//   - Presupuestos creados como records reales en Presupuestos
//     (con Estado=ACEPTADO + Fecha_Aceptado) → tab Presupuestos.
//   - Notas en paciente y presupuesto.
//
// Idempotencia: marker [SEED Bloque 1.5] en lead.Notas, paciente.Notas,
// presupuesto.Notas, pago.Nota, accion.Detalles. Si ya existen 5 leads
// con ese marker, skip. Si parcial, cleanup + recrear.
//
// Modos:
//   --dry-run   plan sin escribir.
//   --cleanup   borrar todo lo que tenga marker.
//   (sin flag)  apply.
//
// Guard: solo Dev. Prod requiere --apply-prod.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { base, TABLES, fetchAll } from "../lib/airtable";
import { createPaciente } from "../lib/pacientes/pacientes";
import {
  createLead,
  updateLead,
  markLeadConvertido,
  appendLeadLog,
} from "../lib/leads/leads";
import { logAccionLead } from "../lib/leads/acciones";
import { crearPago } from "../lib/pagos";

const DRY_RUN = process.argv.includes("--dry-run");
const CLEANUP_ONLY = process.argv.includes("--cleanup");
const APPLY_PROD = process.argv.includes("--apply-prod");
const PROD_BASE_ID = "appfUJcyGnkZ16Fhr";
const BASE_ID = process.env.AIRTABLE_BASE_ID ?? "?";
const NOTA_MARKER = "[SEED Bloque 1.5] Paciente end-to-end";
const TARGET = 5;
const NUM_DOCTORES = 4;

if (BASE_ID === PROD_BASE_ID && !APPLY_PROD) {
  console.error(
    `✖ AIRTABLE_BASE_ID apunta a Prod (${PROD_BASE_ID}). Requiere --apply-prod explicito.`,
  );
  process.exit(1);
}

type Doctor = { id: string; nombre: string; clinicaId: string | null };

type SeedPaciente = {
  nombre: string;
  telefono: string;
  email: string;
  canal:
    | "Instagram"
    | "Google Ads"
    | "Facebook"
    | "Referido"
    | "WhatsApp";
  tratamiento:
    | "Implantología"
    | "Ortodoncia Invisible"
    | "Periodoncia"
    | "Corona cerámica"
    | "Endodoncia";
  presupuestoTotal: number;
  pagos: Array<{
    importe: number;
    diasAtras: number;
    metodo: "Tarjeta" | "Efectivo" | "Transferencia" | "Bizum" | "Financiacion";
    // Sprint 14 Bloque 6 (re-scoped) — solo 3 hitos comerciales.
    tipo: "Senal" | "Primer_Pago_Plan" | "Liquidacion";
    nota?: string;
  }>;
  acciones: Array<{
    tipo: "Llamada" | "WhatsApp_Saliente" | "WhatsApp_Entrante" | "Cambio_Estado" | "Nota";
    diasAtras: number;
    detalles: string;
  }>;
  notaPaciente?: string;
  notaPresupuesto?: string;
};

const SEEDS: SeedPaciente[] = [
  {
    nombre: "Beatriz Morales Castro",
    telefono: "+34 611 100 200",
    email: "beatriz.morales@example.com",
    canal: "Instagram",
    tratamiento: "Implantología",
    presupuestoTotal: 4200,
    // 2 hitos: señal + primer pago de plan. Pagos intermedios (cuotas
    // mensuales sucesivas) ya no se registran en Fyllio (re-scope).
    pagos: [
      { importe: 1500, diasAtras: 35, metodo: "Tarjeta", tipo: "Senal", nota: "Señal inicio tratamiento" },
      { importe: 1000, diasAtras: 21, metodo: "Tarjeta", tipo: "Primer_Pago_Plan", nota: "Primer pago plan 4 cuotas" },
    ],
    acciones: [
      { tipo: "Llamada", diasAtras: 45, detalles: "Llamada inicial, interesada en implante posterior derecho" },
      { tipo: "WhatsApp_Saliente", diasAtras: 44, detalles: "Envío folleto y cita propuesta" },
      { tipo: "WhatsApp_Entrante", diasAtras: 43, detalles: "Confirmó cita y preguntó por financiación" },
      { tipo: "Cambio_Estado", diasAtras: 40, detalles: "Citado → Asistido" },
      { tipo: "Nota", diasAtras: 36, detalles: "Aceptó plan de pago en 3 cuotas" },
    ],
    notaPaciente: "Paciente fidelizada, prefiere comunicación por WhatsApp.",
    notaPresupuesto: "Plan de pagos: señal + 2 cuotas de 1.000€ + liquidación.",
  },
  {
    nombre: "Roberto Sánchez Vega",
    telefono: "+34 622 200 300",
    email: "roberto.sv@example.com",
    canal: "Google Ads",
    tratamiento: "Ortodoncia Invisible",
    presupuestoTotal: 5500,
    pagos: [
      { importe: 5500, diasAtras: 18, metodo: "Transferencia", tipo: "Liquidacion", nota: "Pago al contado con descuento" },
    ],
    acciones: [
      { tipo: "Llamada", diasAtras: 30, detalles: "Primera consulta, valora invisible vs brackets" },
      { tipo: "Nota", diasAtras: 28, detalles: "Solicitó tarifa para 18 meses" },
      { tipo: "WhatsApp_Saliente", diasAtras: 25, detalles: "Envío presupuesto detallado" },
      { tipo: "Cambio_Estado", diasAtras: 22, detalles: "Citado → Convertido" },
    ],
    notaPaciente: "Pago al contado con 10% descuento aplicado.",
  },
  {
    nombre: "Lucía Hernández Cano",
    telefono: "+34 633 300 400",
    email: "lucia.hc@example.com",
    canal: "Referido",
    tratamiento: "Periodoncia",
    presupuestoTotal: 1200,
    pagos: [
      { importe: 400, diasAtras: 14, metodo: "Efectivo", tipo: "Senal", nota: "Señal sesión inicial" },
      { importe: 400, diasAtras: 7, metodo: "Tarjeta", tipo: "Primer_Pago_Plan", nota: "Primer pago plan 3 sesiones" },
    ],
    acciones: [
      { tipo: "Llamada", diasAtras: 20, detalles: "Referida por su hermana (paciente activa)" },
      { tipo: "WhatsApp_Saliente", diasAtras: 18, detalles: "Envío instrucciones pre-tratamiento" },
      { tipo: "Nota", diasAtras: 15, detalles: "Confirmó alergia a la amoxicilina" },
    ],
    notaPaciente: "ALERGIA confirmada: amoxicilina. Usar alternativa.",
    notaPresupuesto: "3 sesiones de raspado y alisado radicular.",
  },
  {
    nombre: "Andrés Pérez Jiménez",
    telefono: "+34 644 400 500",
    email: "andres.pj@example.com",
    canal: "Facebook",
    tratamiento: "Corona cerámica",
    presupuestoTotal: 950,
    pagos: [
      { importe: 950, diasAtras: 9, metodo: "Bizum", tipo: "Liquidacion", nota: "Pago completo en un solo Bizum" },
    ],
    acciones: [
      { tipo: "WhatsApp_Entrante", diasAtras: 16, detalles: "Llegó vía anuncio FB sobre coronas estéticas" },
      { tipo: "Llamada", diasAtras: 14, detalles: "Cita confirmada, viene con foto del diente roto" },
      { tipo: "Nota", diasAtras: 12, detalles: "Tomada impresión, color A2" },
    ],
  },
  {
    nombre: "Carmen Iglesias Soto",
    telefono: "+34 655 500 600",
    email: "carmen.is@example.com",
    canal: "WhatsApp",
    tratamiento: "Endodoncia",
    presupuestoTotal: 480,
    pagos: [
      { importe: 240, diasAtras: 11, metodo: "Tarjeta", tipo: "Primer_Pago_Plan", nota: "Primer pago plan endodoncia" },
      { importe: 240, diasAtras: 3, metodo: "Tarjeta", tipo: "Liquidacion", nota: "Sesión final + corona provisional" },
    ],
    acciones: [
      { tipo: "WhatsApp_Entrante", diasAtras: 18, detalles: "Dolor agudo, urgencia" },
      { tipo: "Llamada", diasAtras: 17, detalles: "Atendida urgencia mismo día" },
      { tipo: "Nota", diasAtras: 14, detalles: "Diagnóstico: pulpitis irreversible" },
      { tipo: "WhatsApp_Saliente", diasAtras: 8, detalles: "Recordatorio cita 2ª sesión" },
    ],
    notaPaciente: "Paciente ansiosa, pautar sedación consciente si fuera necesario.",
    notaPresupuesto: "Endodoncia + reconstrucción + corona provisional.",
  },
];

function shiftDay(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function shiftDateTime(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

async function destroyInBatches(table: any, ids: string[]) {
  for (let i = 0; i < ids.length; i += 10) {
    await table.destroy(ids.slice(i, i + 10));
  }
}

async function cleanupMarkerRecords(): Promise<{
  pagos: number;
  acciones: number;
  presupuestos: number;
  pacientes: number;
  leads: number;
}> {
  const find = (q: string) => `FIND('${NOTA_MARKER}', ${q}&'')>0`;
  const [pagoRecs, accRecs, presRecs, pacRecs, leadRecs] = await Promise.all([
    fetchAll(
      base(TABLES.pagosPaciente as any).select({ filterByFormula: find("{Nota}"), fields: ["Nota"] }),
    ),
    fetchAll(
      base(TABLES.accionesLead as any).select({ filterByFormula: find("{Detalles}"), fields: ["Detalles"] }),
    ),
    fetchAll(
      base(TABLES.presupuestos as any).select({ filterByFormula: find("{Notas}"), fields: ["Notas", "Paciente"] }),
    ),
    fetchAll(
      base(TABLES.patients as any).select({ filterByFormula: find("{Notas}"), fields: ["Notas", "Lead_Origen"] }),
    ),
    fetchAll(
      base(TABLES.leads as any).select({ filterByFormula: find("{Notas}"), fields: ["Notas"] }),
    ),
  ]);
  const pagoIds = pagoRecs.map((r) => r.id);
  const accIds = accRecs.map((r) => r.id);
  const presIds = presRecs.map((r) => r.id);
  const pacIds = pacRecs.map((r) => r.id);
  const leadIdsSet = new Set<string>(leadRecs.map((r) => r.id));
  for (const r of pacRecs) {
    const links = ((r.fields as any)["Lead_Origen"] ?? []) as string[];
    for (const id of links) leadIdsSet.add(id);
  }
  const leadIds = Array.from(leadIdsSet);

  console.log(
    `  Cleanup encontrado: ${pagoIds.length} pagos · ${accIds.length} acciones · ${presIds.length} presupuestos · ${pacIds.length} pacientes · ${leadIds.length} leads.`,
  );

  if (pagoIds.length > 0) await destroyInBatches(base(TABLES.pagosPaciente as any), pagoIds);
  if (accIds.length > 0) await destroyInBatches(base(TABLES.accionesLead as any), accIds);
  if (presIds.length > 0) await destroyInBatches(base(TABLES.presupuestos as any), presIds);
  if (pacIds.length > 0) await destroyInBatches(base(TABLES.patients as any), pacIds);
  if (leadIds.length > 0) await destroyInBatches(base(TABLES.leads as any), leadIds);

  return {
    pagos: pagoIds.length,
    acciones: accIds.length,
    presupuestos: presIds.length,
    pacientes: pacIds.length,
    leads: leadIds.length,
  };
}

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(
    `Sprint 14a Bloque 1.5 — seed paciente completo${
      CLEANUP_ONLY ? " (CLEANUP)" : DRY_RUN ? " (DRY RUN)" : " (APPLY)"
    } · base ${BASE_ID} (${target})`,
  );
  const startedAt = Date.now();

  if (CLEANUP_ONLY) {
    const r = await cleanupMarkerRecords();
    console.log(
      `✔ Cleanup: ${r.pagos} pagos · ${r.acciones} acciones · ${r.presupuestos} presupuestos · ${r.pacientes} pacientes · ${r.leads} leads.`,
    );
    return;
  }

  // Idempotencia: contar leads con marker.
  const leadsConMarker = await fetchAll(
    base(TABLES.leads as any).select({
      filterByFormula: `FIND('${NOTA_MARKER}', {Notas}&'')>0`,
      fields: ["Nombre"],
    }),
  );
  if (leadsConMarker.length >= TARGET) {
    console.log(
      `  Ya hay ${leadsConMarker.length} leads con marker (>=${TARGET}). Idempotente · nada que hacer.`,
    );
    return;
  }
  if (leadsConMarker.length > 0) {
    console.log(
      `  Hay ${leadsConMarker.length} leads con marker (parcial). Limpiando antes de re-crear los ${TARGET}.`,
    );
  }

  if (!DRY_RUN) {
    await cleanupMarkerRecords();
  }

  // Doctores Dentistas activos.
  const staffRecs = await fetchAll(
    base(TABLES.staff as any).select({
      filterByFormula: `AND({Rol}='Dentista', {Activo})`,
      fields: ["Nombre", "Clínica"],
    }),
  );
  const todosDoctores: Doctor[] = staffRecs
    .map((r) => {
      const f = r.fields as any;
      const clinicas = (f["Clínica"] ?? []) as string[];
      return {
        id: r.id as string,
        nombre: String(f["Nombre"] ?? "Doctor"),
        clinicaId: clinicas[0] ?? null,
      };
    })
    .filter((d) => d.clinicaId)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (todosDoctores.length < NUM_DOCTORES) {
    console.error(`✖ Solo ${todosDoctores.length} doctores con Clinica.`);
    process.exit(1);
  }
  const doctores = todosDoctores.slice(0, NUM_DOCTORES);
  console.log(`  Doctores seleccionados (${doctores.length}):`);
  for (const d of doctores) console.log(`    ${d.id}  ${d.nombre}`);

  console.log("");
  console.log(
    `  Plan: ${SEEDS.length} pacientes con presupuestos firmados, pagos cumulativos y log de acciones.`,
  );
  for (let i = 0; i < SEEDS.length; i++) {
    const s = SEEDS[i]!;
    const totalPagado = s.pagos.reduce((sum, p) => sum + p.importe, 0);
    console.log(
      `   ${i + 1}. ${s.nombre.padEnd(28)} ${s.tratamiento.padEnd(20)} pres €${s.presupuestoTotal} · pagos ${s.pagos.length} (€${totalPagado}) · acciones ${s.acciones.length}`,
    );
  }
  console.log("");

  if (DRY_RUN) {
    console.log("  --dry-run: nada escrito.");
    return;
  }

  let creados = 0;
  for (let i = 0; i < SEEDS.length; i++) {
    const s = SEEDS[i]!;
    const doctor = doctores[i % NUM_DOCTORES]!;
    try {
      // 1) crear lead.
      const lead = await createLead({
        nombre: s.nombre,
        telefono: s.telefono,
        email: s.email,
        tratamiento: s.tratamiento as any,
        canal: s.canal as any,
        estado: "Citado",
        clinicaId: doctor.clinicaId!,
        fechaCita: shiftDay(s.acciones[s.acciones.length - 1]?.diasAtras ?? 30),
        notas: NOTA_MARKER,
      });
      // 2) lead → asistido + doctor.
      await updateLead(lead.id, {
        doctorAsignadoId: doctor.id,
        asistido: true,
      });
      // 3) paciente con presupuestoTotal y aceptado.
      const totalPagado = s.pagos.reduce((sum, p) => sum + p.importe, 0);
      const paciente = await createPaciente({
        nombre: s.nombre,
        telefono: s.telefono,
        clinicaId: doctor.clinicaId!,
        tratamientos: [s.tratamiento as any],
        doctorLinkId: doctor.id,
        presupuestoTotal: s.presupuestoTotal,
        aceptado: "Si",
        canalOrigen: s.canal as any,
        leadOrigenId: lead.id,
        notas: s.notaPaciente
          ? `${NOTA_MARKER}\n\n${s.notaPaciente}`
          : NOTA_MARKER,
      });
      // 4) lead.convertido = true + Paciente_ID link + Estado=Convertido.
      // markLeadConvertido solo setea Convertido_A_Paciente y Paciente_ID;
      // dejamos Estado='Citado' por defecto, lo cual rompe el flujo
      // realista de QA (coordinadora espera ver 'Convertido' en kanban).
      // Forzamos el estado explicito tras la conversion.
      await markLeadConvertido(lead.id, paciente.id);
      await updateLead(lead.id, { estado: "Convertido" });
      // 5) presupuesto record con Estado=ACEPTADO + Fecha_Aceptado.
      const fechaAlta = shiftDay(s.acciones[0]?.diasAtras ?? 30);
      const fechaAceptado = shiftDay(
        Math.min(...s.pagos.map((p) => p.diasAtras)) + 1,
      );
      await base(TABLES.presupuestos as any).create([
        {
          fields: {
            "Presupuesto ID": `SEED14-${i + 1}`,
            Paciente: [paciente.id],
            Tratamiento_nombre: s.tratamiento,
            Importe: s.presupuestoTotal,
            Estado: "ACEPTADO",
            Fecha: fechaAlta,
            FechaAlta: fechaAlta,
            Fecha_Aceptado: fechaAceptado,
            Doctor: doctor.nombre,
            Notas: s.notaPresupuesto
              ? `${NOTA_MARKER}\n\n${s.notaPresupuesto}`
              : NOTA_MARKER,
          },
        },
      ]);
      // 6) pagos.
      for (const pago of s.pagos) {
        await crearPago({
          pacienteId: paciente.id,
          importe: pago.importe,
          fechaPago: shiftDay(pago.diasAtras),
          metodo: pago.metodo as any,
          tipo: pago.tipo as any,
          nota: pago.nota
            ? `${NOTA_MARKER} · ${pago.nota}`
            : NOTA_MARKER,
        });
      }
      // 7) acciones del lead.
      for (const acc of s.acciones) {
        await logAccionLead({
          leadId: lead.id,
          tipo: acc.tipo as any,
          timestamp: shiftDateTime(acc.diasAtras),
          detalles: `${NOTA_MARKER} · ${acc.detalles}`,
        });
      }
      // 8) lead log marker.
      await appendLeadLog(lead.id, "Sprint 14 seed: convertido end-to-end con presupuesto + pagos");

      creados++;
      process.stdout.write(`\r  Creados ${creados}/${SEEDS.length}`);
    } catch (err) {
      console.error(
        `\n  ✖ Error en seed #${i + 1} (${s.nombre}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  process.stdout.write("\n");

  const elapsedS = Math.round((Date.now() - startedAt) / 1000);
  console.log(`✔ Seed completo: ${creados} pacientes en ${elapsedS}s.`);
  console.log(`  Marker: "${NOTA_MARKER}" (lead.Notas, paciente.Notas, presupuesto.Notas, pago.Nota, accion.Detalles).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
