#!/usr/bin/env node
// Bloque 2 · arreglo "una sola verdad" #1 — ejercita las ESCRITURAS del cierre
// «Aceptó y pagó» contra el Postgres de DEMO (protocolo FASE 2: las escrituras
// se ejercitan de verdad, no se asumen).
//
//   npx tsx scripts/qa-cierre-presupuesto.ts
//
// Qué cubre (las mismas escrituras que hace /api/presupuestos/kanban/[id] y
// registrar-respuesta tras el fix):
//   1. Cierre completo: Estado=ACEPTADO + Fecha_Aceptado + Fase_seguimiento=Cerrado
//      en una escritura → lectura-tras-escritura verifica los 3 campos.
//   2. Fase colgada: "Mensaje recibido" → Fase_seguimiento="En intervención".
//   3. Pago del cierre: crearPago (señal 500) → fila en pagos + cache del
//      paciente resincronizada (pagado sube, pendiente baja).
//   4. Limpieza total: eliminarPago (cache vuelve) + restaurar el presupuesto.
//
// Solo DEMO (RLS + runWithCliente); jamás toca RB/INDEP ni Airtable.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_DOMINIOS = "presupuestos,pagos,pacientes";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import { runWithCliente } from "../app/lib/airtable";
import {
  selectPresupuestosRaw,
  getPresupuestoPorIdRaw,
  updatePresupuestoRaw,
} from "../app/lib/presupuestos/repo";
import { crearPago, eliminarPago, getPagosByPaciente } from "../app/lib/pagos";
import { getPaciente } from "../app/lib/pacientes/pacientes";

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`);
  if (!c) fallos++;
};

async function main() {
  await runWithCliente("DEMO", async () => {
    // ── Sujeto: un presupuesto PRESENTADO con paciente vinculado ──
    const candidatos = await selectPresupuestosRaw({
      filterByFormula: "{Estado}='PRESENTADO'",
      fields: ["Estado", "Fecha_Aceptado", "Fase_seguimiento", "Importe", "Paciente_Link"],
    });
    const rec = candidatos.find(
      (r: any) => Array.isArray(r.fields["Paciente_Link"]) && r.fields["Paciente_Link"][0],
    );
    if (!rec) throw new Error("No hay presupuesto PRESENTADO con paciente en DEMO — corre el seed");
    const id = rec.id as string;
    const f0 = rec.fields as Record<string, unknown>;
    const pacienteId = (f0["Paciente_Link"] as string[])[0]!;
    const importeTotal = Number(f0["Importe"] ?? 0);
    console.log(`Sujeto: presupuesto ${id} (importe ${importeTotal}) · paciente ${pacienteId}`);

    const snapshot = {
      Estado: f0["Estado"] ?? null,
      Fecha_Aceptado: f0["Fecha_Aceptado"] ?? null,
      Fase_seguimiento: f0["Fase_seguimiento"] ?? null,
    };

    const pac0 = await getPaciente(pacienteId);
    if (!pac0) throw new Error("Paciente del presupuesto no existe");
    const pagado0 = Number(pac0.pagado ?? 0);
    const pendiente0 = Number(pac0.pendiente ?? 0);

    try {
      // ── 1. Cierre completo en una escritura ──
      const hoy = new Date().toISOString().slice(0, 10);
      await updatePresupuestoRaw(id, {
        Estado: "ACEPTADO",
        Fecha_Aceptado: hoy,
        Fase_seguimiento: "Cerrado",
      });
      const r1 = await getPresupuestoPorIdRaw(id, ["Estado", "Fecha_Aceptado", "Fase_seguimiento"]);
      const f1 = (r1?.fields ?? {}) as Record<string, unknown>;
      ok("Estado=ACEPTADO persistido", f1["Estado"] === "ACEPTADO", String(f1["Estado"]));
      ok("Fecha_Aceptado=hoy persistida", f1["Fecha_Aceptado"] === hoy, String(f1["Fecha_Aceptado"]));
      ok("Fase_seguimiento=Cerrado persistida", f1["Fase_seguimiento"] === "Cerrado", String(f1["Fase_seguimiento"]));

      // ── 2. Respuesta del paciente saca de "Esperando respuesta" ──
      await updatePresupuestoRaw(id, { Fase_seguimiento: "Esperando respuesta" });
      await updatePresupuestoRaw(id, { Fase_seguimiento: "En intervención" });
      const r2 = await getPresupuestoPorIdRaw(id, ["Fase_seguimiento"]);
      ok(
        "Fase vuelve a 'En intervención' (reset del webhook/manual)",
        (r2?.fields as any)?.["Fase_seguimiento"] === "En intervención",
      );

      // ── 3. Pago del cierre (señal parcial de 500) ──
      const pago = await crearPago({
        pacienteId,
        importe: 500,
        metodo: "Tarjeta",
        tipo: "Senal",
        nota: "Registrado al aceptar el presupuesto [QA_CIERRE]",
      });
      ok("crearPago devuelve fila con id", !!pago?.id, pago?.id);

      const pagos = await getPagosByPaciente(pacienteId);
      ok(
        "El pago aparece en el historial del paciente",
        pagos.some((p) => p.id === pago.id && p.importe === 500),
      );

      const pac1 = await getPaciente(pacienteId);
      ok(
        `Cache pagado resincronizada (+500: ${pagado0} → ${Number(pac1?.pagado ?? 0)})`,
        Number(pac1?.pagado ?? 0) === pagado0 + 500,
      );
      ok(
        "Cache pendiente baja o se mantiene coherente",
        Number(pac1?.pendiente ?? 0) <= pendiente0 || pendiente0 === 0,
        `${pendiente0} → ${Number(pac1?.pendiente ?? 0)}`,
      );

      // ── 4. Limpieza: borrar pago → cache restaurada ──
      await eliminarPago(pago.id);
      const pagosTras = await getPagosByPaciente(pacienteId);
      ok("Pago QA eliminado", !pagosTras.some((p) => p.id === pago.id));
      const pac2 = await getPaciente(pacienteId);
      ok(
        "Cache pagado restaurada tras eliminar",
        Number(pac2?.pagado ?? 0) === pagado0,
        `${Number(pac2?.pagado ?? 0)} vs ${pagado0}`,
      );
    } finally {
      // Restaurar el presupuesto pase lo que pase (sin residuos de QA).
      await updatePresupuestoRaw(id, snapshot as any);
      const rFin = await getPresupuestoPorIdRaw(id, ["Estado", "Fecha_Aceptado", "Fase_seguimiento"]);
      const fFin = (rFin?.fields ?? {}) as Record<string, unknown>;
      const restaurado =
        (fFin["Estado"] ?? null) === snapshot.Estado &&
        (fFin["Fecha_Aceptado"] ?? null) === snapshot.Fecha_Aceptado &&
        (fFin["Fase_seguimiento"] ?? null) === snapshot.Fase_seguimiento;
      console.log(`  ${restaurado ? "✓" : "✗ FALLO"} presupuesto restaurado al estado previo`);
      if (!restaurado) fallos++;
    }
  });

  console.log(fallos === 0 ? "\nVERDE — todas las escrituras del cierre verificadas" : `\nROJO — ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
