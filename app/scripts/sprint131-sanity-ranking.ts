// app/scripts/sprint131-sanity-ranking.ts
//
// Sprint 13.1.1 — verifica el delta entre suma del ranking doctores
// (pagos reales por pacienteIds) y el facturado total del funnel lead
// (getFacturadoEnPeriodo soloOrigenLead). El delta esperado son los
// pacientes con origen lead que NO tienen doctorAsignadoId en el lead.
//
// Si delta > 5% del total → WARN en el reporte; cualidad de dato a
// discutir antes de Prod.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listLeads } from "../lib/leads/leads";
import { getFacturadoEnPeriodo, getFacturadoPorPacientes } from "../lib/pagos";

async function main() {
  // Periodo "trimestre" (max alcance de datos en Dev tras la migracion).
  const hasta = new Date();
  const desde = new Date(hasta);
  desde.setMonth(desde.getMonth() - 3);

  console.log(
    `Periodo trimestre: ${desde.toISOString().slice(0, 10)} → ${hasta.toISOString().slice(0, 10)}`,
  );

  const leads = await listLeads({});
  const enPeriodo = leads.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return t >= desde.getTime() && t <= hasta.getTime();
  });

  // Agrupar por doctor y juntar pacienteIds convertidos.
  const leadsConvertidosPorDoctor = new Map<string, string[]>();
  let convertidosSinDoctor = 0;
  let convertidosTotal = 0;
  for (const l of enPeriodo) {
    if (!l.convertido) continue;
    convertidosTotal++;
    if (!l.doctorAsignadoId) {
      convertidosSinDoctor++;
      continue;
    }
    const arr = leadsConvertidosPorDoctor.get(l.doctorAsignadoId) ?? [];
    if (l.pacienteId) arr.push(l.pacienteId);
    leadsConvertidosPorDoctor.set(l.doctorAsignadoId, arr);
  }

  console.log(`Convertidos en periodo: ${convertidosTotal}`);
  console.log(`Convertidos SIN doctor asignado: ${convertidosSinDoctor}`);
  console.log(`Doctores con conversiones: ${leadsConvertidosPorDoctor.size}`);

  // Suma facturado por doctor (paralela).
  let sumRanking = 0;
  await Promise.all(
    Array.from(leadsConvertidosPorDoctor.entries()).map(async ([_id, ids]) => {
      const r = await getFacturadoPorPacientes({ pacienteIds: ids, desde, hasta });
      sumRanking += r.total;
    }),
  );

  // Referencia: total funnel lead.
  const ref = await getFacturadoEnPeriodo({ desde, hasta, soloOrigenLead: true });

  const delta = ref.total - sumRanking;
  const deltaPct = ref.total === 0 ? 0 : Math.abs(Math.round((delta / ref.total) * 100));

  console.log("");
  console.log(`Σ ranking doctores facturado: ${sumRanking.toLocaleString("es-ES")}€`);
  console.log(`Referencia funnel lead total: ${ref.total.toLocaleString("es-ES")}€`);
  console.log(`Delta: ${delta.toLocaleString("es-ES")}€ (${deltaPct}%)`);
  if (deltaPct > 5) {
    console.log(`⚠ WARN delta>${5}%: pacientes con origen lead sin doctor asignado.`);
  } else {
    console.log(`✓ Delta dentro del 5% esperado por huérfanos.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
