// app/scripts/sprint131-1-1-enrich-conversions.ts
//
// Sprint 13.1.1 — enriquecimiento de Dev con leads convertidos para
// validar el sanity check de ranking doctores.
//
// Por que: el sanity de R2b compara Σ ranking.facturadoGenerado vs
// getFacturadoEnPeriodo({soloOrigenLead:true}). El endpoint segmenta
// el ranking por leads cuyo lead.createdAt cae en el periodo. Los
// leads del seed Dev tienen createdTime >12m (createdTime es inmutable
// en Airtable), por lo que NO podemos reutilizarlos: el ranking siempre
// daria 0 y el sanity siempre WARN.
//
// Solucion (opcion E): este script CREA leads sinteticos NUEVOS (con
// createdTime = ahora, automaticamente dentro del trimestre actual),
// los convierte a pacientes con presupuesto firmado y pagos asociados.
//
// Idempotencia: marker [SEED Sprint 13.1.1] en lead.Notas, paciente.Notas
// y pago.Nota. Si ya existen 7 leads con marker, skip.
//
// Modos:
//   npx tsx app/scripts/sprint131-1-1-enrich-conversions.ts --dry-run
//   npx tsx app/scripts/sprint131-1-1-enrich-conversions.ts --cleanup
//   npx tsx app/scripts/sprint131-1-1-enrich-conversions.ts            (apply)

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { base, TABLES, fetchAll } from "../lib/airtable";
import { createPaciente } from "../lib/pacientes/pacientes";
import {
  createLead,
  updateLead,
  markLeadConvertido,
} from "../lib/leads/leads";
import { crearPago } from "../lib/pagos";

const DRY_RUN = process.argv.includes("--dry-run");
const CLEANUP_ONLY = process.argv.includes("--cleanup");
const NOTA_MARKER = "[SEED Sprint 13.1.1] Lead convertido para validación ranking doctores";
const TARGET_CONVERSIONES = 7;
const NUM_DOCTORES = 4;

type Doctor = { id: string; nombre: string; clinicaId: string | null };

type SyntheticLead = {
  nombre: string;
  telefono: string;
  email: string;
  canal:
    | "Instagram"
    | "Google Ads"
    | "Facebook"
    | "Referido"
    | "Google Orgánico"
    | "WhatsApp"
    | "Visita directa";
  tratamiento:
    | "Implantología"
    | "Ortodoncia Invisible"
    | "Ortodoncia"
    | "Periodoncia"
    | "Corona cerámica"
    | "Limpieza";
  presupuestoTotal: number;
  importePagado: number;
  diasAtras: number;
};

// 7 leads sinteticos. Distribucion doctores (i % 4): Rocío, Daniel,
// Irene, Javier, Rocío, Daniel, Irene → 2/2/2/1.
const SYNTHETIC_LEADS: SyntheticLead[] = [
  {
    nombre: "Lucía Fernández Vega",
    telefono: "+34 611 234 567",
    email: "lucia.fernandez@example.com",
    canal: "Instagram",
    tratamiento: "Implantología",
    presupuestoTotal: 3500,
    importePagado: 2500,
    diasAtras: 3,
  },
  {
    nombre: "Pablo Romero Soler",
    telefono: "+34 622 345 678",
    email: "pablo.romero@example.com",
    canal: "Google Ads",
    tratamiento: "Implantología",
    presupuestoTotal: 2800,
    importePagado: 2800,
    diasAtras: 7,
  },
  {
    nombre: "Carmen Iglesias Vargas",
    telefono: "+34 633 456 789",
    email: "carmen.iglesias@example.com",
    canal: "Facebook",
    tratamiento: "Ortodoncia Invisible",
    presupuestoTotal: 4200,
    importePagado: 1200,
    diasAtras: 11,
  },
  {
    nombre: "Diego Herrera Castaño",
    telefono: "+34 644 567 890",
    email: "diego.herrera@example.com",
    canal: "Referido",
    tratamiento: "Ortodoncia",
    presupuestoTotal: 1800,
    importePagado: 1800,
    diasAtras: 15,
  },
  {
    nombre: "Marta Ortega Aguilar",
    telefono: "+34 655 678 901",
    email: "marta.ortega@example.com",
    canal: "Google Orgánico",
    tratamiento: "Periodoncia",
    presupuestoTotal: 900,
    importePagado: 600,
    diasAtras: 19,
  },
  {
    nombre: "Hugo Vázquez Pérez",
    telefono: "+34 666 789 012",
    email: "hugo.vazquez@example.com",
    canal: "WhatsApp",
    tratamiento: "Corona cerámica",
    presupuestoTotal: 850,
    importePagado: 850,
    diasAtras: 23,
  },
  {
    nombre: "Elena Cabrera Solís",
    telefono: "+34 677 890 123",
    email: "elena.cabrera@example.com",
    canal: "Visita directa",
    tratamiento: "Limpieza",
    presupuestoTotal: 80,
    importePagado: 80,
    diasAtras: 27,
  },
];

function shiftDay(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function destroyInBatches(table: any, ids: string[]) {
  for (let i = 0; i < ids.length; i += 10) {
    await table.destroy(ids.slice(i, i + 10));
  }
}

async function cleanupMarkerRecords(
  dryRun: boolean,
): Promise<{ pagos: number; pacientes: number; leads: number }> {
  const formula = `FIND('${NOTA_MARKER}', {Nota}&'')>0`;
  const formulaNotas = `FIND('${NOTA_MARKER}', {Notas}&'')>0`;

  // 1) Pagos con marker en Nota.
  const pagoRecs = await fetchAll(
    base(TABLES.pagosPaciente as any).select({
      filterByFormula: formula,
      fields: ["Paciente_Link"],
    }),
  );
  const pagoIds = pagoRecs.map((r) => r.id);

  // 2) Pacientes con marker en Notas. Conservamos Lead_Origen para
  //    poder borrar tambien los leads originales (si los hay del run v1
  //    en el que el lead no llevaba marker).
  const pacRecs = await fetchAll(
    base(TABLES.patients as any).select({
      filterByFormula: formulaNotas,
      fields: ["Lead_Origen", "Notas"],
    }),
  );
  const pacIds = pacRecs.map((r) => r.id);
  const leadIdsFromPac = new Set<string>();
  for (const p of pacRecs) {
    const links = ((p.fields as any)?.["Lead_Origen"] ?? []) as string[];
    for (const id of links) leadIdsFromPac.add(id);
  }

  // 3) Leads con marker en Notas (creados por la v2 de este script).
  const leadRecs = await fetchAll(
    base(TABLES.leads as any).select({
      filterByFormula: formulaNotas,
      fields: ["Nombre"],
    }),
  );
  const leadIds = new Set<string>(leadIdsFromPac);
  for (const r of leadRecs) leadIds.add(r.id);
  const leadIdsArr = Array.from(leadIds);

  console.log(
    `  Cleanup: ${pagoIds.length} pagos · ${pacIds.length} pacientes · ${leadIdsArr.length} leads con marker.`,
  );
  if (dryRun) {
    return { pagos: pagoIds.length, pacientes: pacIds.length, leads: leadIdsArr.length };
  }

  // Orden: pagos → pacientes → leads (evita huerfanos).
  if (pagoIds.length > 0) await destroyInBatches(base(TABLES.pagosPaciente as any), pagoIds);
  if (pacIds.length > 0) await destroyInBatches(base(TABLES.patients as any), pacIds);
  if (leadIdsArr.length > 0) await destroyInBatches(base(TABLES.leads as any), leadIdsArr);

  return { pagos: pagoIds.length, pacientes: pacIds.length, leads: leadIdsArr.length };
}

async function main() {
  const baseId = process.env.AIRTABLE_BASE_ID ?? "?";
  console.log(
    `Sprint 13.1.1 — enriquecimiento conversiones${
      CLEANUP_ONLY ? " (CLEANUP)" : DRY_RUN ? " (DRY RUN)" : " (APPLY)"
    } · base ${baseId}`,
  );
  if (baseId !== "app5hrVAgzRfyKHew") {
    console.error(
      `✖ Este script solo debe correrse contra Dev (app5hrVAgzRfyKHew). Base actual: ${baseId}.`,
    );
    process.exit(1);
  }
  const startedAt = Date.now();

  if (CLEANUP_ONLY) {
    const r = await cleanupMarkerRecords(false);
    console.log(
      `✔ Cleanup completo: ${r.pagos} pagos · ${r.pacientes} pacientes · ${r.leads} leads borrados.`,
    );
    return;
  }

  // Idempotencia: contar leads con marker. >=7 → skip.
  const leadsConMarker = await fetchAll(
    base(TABLES.leads as any).select({
      filterByFormula: `FIND('${NOTA_MARKER}', {Notas}&'')>0`,
      fields: ["Nombre"],
    }),
  );
  if (leadsConMarker.length >= TARGET_CONVERSIONES) {
    console.log(
      `  Ya hay ${leadsConMarker.length} leads con marker (>=${TARGET_CONVERSIONES}). Idempotente · nada que hacer.`,
    );
    return;
  }
  if (leadsConMarker.length > 0) {
    console.log(
      `  Hay ${leadsConMarker.length} leads con marker (parcial). Limpiando antes de re-crear los 7.`,
    );
  }

  // Cleanup parcial (incluye runs viejos sin marker en lead).
  if (!DRY_RUN) {
    const cleaned = await cleanupMarkerRecords(false);
    if (cleaned.pagos + cleaned.pacientes + cleaned.leads > 0) {
      console.log(
        `  Limpiado: ${cleaned.pagos} pagos · ${cleaned.pacientes} pacientes · ${cleaned.leads} leads.`,
      );
    }
  } else {
    await cleanupMarkerRecords(true);
  }

  // Doctores Dentistas activos. 4 estables (orden por id).
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
    .sort((a, b) => a.id.localeCompare(b.id));
  if (todosDoctores.length < NUM_DOCTORES) {
    console.error(
      `✖ Solo ${todosDoctores.length} doctores Dentistas, necesito ${NUM_DOCTORES}.`,
    );
    process.exit(1);
  }
  const doctores = todosDoctores.slice(0, NUM_DOCTORES);
  // Cada lead sintetico requiere doctor con clinicaId definida.
  const doctoresValidos = doctores.filter((d) => d.clinicaId);
  if (doctoresValidos.length < NUM_DOCTORES) {
    console.error(
      `✖ Solo ${doctoresValidos.length}/${NUM_DOCTORES} doctores tienen Clínica asignada.`,
    );
    process.exit(1);
  }
  console.log(`  Doctores seleccionados (${doctoresValidos.length}):`);
  for (const d of doctoresValidos) console.log(`    ${d.id}  ${d.nombre}`);

  console.log("");
  console.log(
    "  i | nombre                  | doctor                          | tratamiento           | presup  | pagado  | fecha",
  );
  console.log(
    "  --+-------------------------+---------------------------------+-----------------------+---------+---------+-----------",
  );
  for (let i = 0; i < SYNTHETIC_LEADS.length; i++) {
    const s = SYNTHETIC_LEADS[i]!;
    const d = doctoresValidos[i % NUM_DOCTORES]!;
    console.log(
      `  ${String(i + 1).padStart(1)} | ${s.nombre.padEnd(23)} | ${d.nombre
        .slice(0, 31)
        .padEnd(31)} | ${s.tratamiento.padEnd(21)} | €${String(s.presupuestoTotal).padStart(
        6,
      )} | €${String(s.importePagado).padStart(6)} | ${shiftDay(s.diasAtras)}`,
    );
  }
  console.log("");

  if (DRY_RUN) {
    console.log(
      `  --dry-run: would create ${SYNTHETIC_LEADS.length} leads + pacientes + pagos sinteticos · sin escribir.`,
    );
    return;
  }

  // Aplicar.
  let creados = 0;
  for (let i = 0; i < SYNTHETIC_LEADS.length; i++) {
    const s = SYNTHETIC_LEADS[i]!;
    const doctor = doctoresValidos[i % NUM_DOCTORES]!;
    const fechaPago = shiftDay(s.diasAtras);
    try {
      // 1) crear lead nuevo (createdTime = ahora).
      const lead = await createLead({
        nombre: s.nombre,
        telefono: s.telefono,
        email: s.email,
        tratamiento: s.tratamiento as any,
        canal: s.canal as any,
        estado: "Citado",
        clinicaId: doctor.clinicaId!,
        fechaCita: shiftDay(s.diasAtras + 1), // dia antes del pago
        notas: NOTA_MARKER,
      });
      // 2) asignar doctor + marcar asistido.
      await updateLead(lead.id, {
        doctorAsignadoId: doctor.id,
        asistido: true,
      });
      // 3) crear paciente con presupuesto firmado.
      // Nota: Pacientes en este Airtable no tiene campo Email (la lib lo
      // acepta pero el field no existe en schema). Solo va en el lead.
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
        notas: NOTA_MARKER,
      });
      // 4) marcar lead convertido + Paciente_ID.
      await markLeadConvertido(lead.id, paciente.id);
      // 5) crear pago en Pagos_Paciente.
      await crearPago({
        pacienteId: paciente.id,
        importe: s.importePagado,
        fechaPago,
        metodo: "Tarjeta",
        tipo: s.importePagado >= s.presupuestoTotal ? "Pago_Unico" : "Senal",
        nota: NOTA_MARKER,
      });
      creados++;
      process.stdout.write(`\r  Creados ${creados}/${SYNTHETIC_LEADS.length}`);
    } catch (err) {
      console.error(
        `\n  ✖ Error en lead sintetico #${i + 1} (${s.nombre}): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }
  process.stdout.write("\n");

  const elapsedS = Math.round((Date.now() - startedAt) / 1000);
  console.log(`✔ Enriquecimiento completo: ${creados} conversiones en ${elapsedS}s.`);
  console.log(`  Marker: "${NOTA_MARKER}" (en lead.Notas, paciente.Notas, pago.Nota).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
