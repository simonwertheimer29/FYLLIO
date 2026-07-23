#!/usr/bin/env node
// Bloque 2 · arreglos #3/#4 — verifica la derivación de finanzas-paciente
// (firmado/cobrado/pendiente/aceptado) contra el Postgres de DEMO, cruzándola
// con lecturas independientes de los mismos repos.
//
//   npx tsx scripts/qa-finanzas-paciente.ts
//
// Solo lecturas; no escribe nada.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_DOMINIOS = "presupuestos,pagos,pacientes";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import { runWithCliente } from "../app/lib/airtable";
import { finanzasPorPaciente } from "../app/lib/finanzas-paciente";
import { selectPresupuestosRaw } from "../app/lib/presupuestos/repo";
import { getPagosByPaciente, listPagosResumen } from "../app/lib/pagos";
import { listPacientes } from "../app/lib/pacientes/pacientes";

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`);
  if (!c) fallos++;
};

async function main() {
  await runWithCliente("DEMO", async () => {
    const fin = await finanzasPorPaciente();
    ok("El mapa tiene pacientes", fin.size > 0, `${fin.size} pacientes con datos`);

    // ── Global: Σ cobrado del mapa == Σ pagos de la tabla ──
    const pagosAll = await listPagosResumen();
    const totalPagos = pagosAll.reduce((s, p) => s + p.importe, 0);
    const totalCobrado = [...fin.values()].reduce((s, f) => s + f.cobrado, 0);
    ok("Σ cobrado == Σ pagos_paciente", totalCobrado === totalPagos, `${totalCobrado} vs ${totalPagos}`);

    // ── Global: Σ firmado == Σ importes de presupuestos ACEPTADO con paciente ──
    const presus = await selectPresupuestosRaw({ fields: ["Paciente", "Estado", "Importe"] });
    const totalAceptado = presus
      .filter(
        (r: any) =>
          r.fields["Estado"] === "ACEPTADO" &&
          Array.isArray(r.fields["Paciente"]) &&
          r.fields["Paciente"][0],
      )
      .reduce((s: number, r: any) => s + (Number(r.fields["Importe"] ?? 0) || 0), 0);
    const totalFirmado = [...fin.values()].reduce((s, f) => s + f.firmado, 0);
    ok("Σ firmado == Σ presupuestos ACEPTADO", totalFirmado === totalAceptado, `${totalFirmado} vs ${totalAceptado}`);

    // ── Muestra: cobrado por paciente cuadra con getPagosByPaciente ──
    const muestra = [...fin.entries()].filter(([, f]) => f.cobrado > 0).slice(0, 3);
    for (const [pid, f] of muestra) {
      const pagos = await getPagosByPaciente(pid);
      const suma = pagos.reduce((s, p) => s + (p.importe || 0), 0);
      ok(`cobrado(${pid.slice(0, 8)}…) == Σ getPagosByPaciente`, f.cobrado === suma, `${f.cobrado} vs ${suma}`);
    }

    // ── Derivación de aceptado: coherencia con los estados reales ──
    const porPaciente = new Map<string, string[]>();
    for (const r of presus as any[]) {
      const pid = Array.isArray(r.fields["Paciente"]) ? r.fields["Paciente"][0] : undefined;
      if (!pid) continue;
      porPaciente.set(pid, [...(porPaciente.get(pid) ?? []), String(r.fields["Estado"] ?? "")]);
    }
    let coherentes = 0;
    let total = 0;
    for (const [pid, estados] of porPaciente) {
      const f = fin.get(pid);
      if (!f) continue;
      total++;
      const esperado = estados.includes("ACEPTADO")
        ? "Si"
        : estados.some((e) => e !== "PERDIDO")
          ? "Pendiente"
          : "No";
      if (f.aceptado === esperado) coherentes++;
      else console.log(`    · incoherente ${pid.slice(0, 8)}…: derivado=${f.aceptado} esperado=${esperado} (${estados.join(",")})`);
    }
    ok(`aceptado derivado coherente en ${coherentes}/${total} pacientes`, coherentes === total && total > 0);

    // ── Informe (no fallo): divergencia del cache manual vs derivado ──
    // Esta ES la enfermedad que se cura: el reseed las correlacionará.
    const pacientes = await listPacientes({});
    let divAceptado = 0;
    let divPagado = 0;
    for (const p of pacientes) {
      const f = fin.get(p.id);
      const dAce = (f?.aceptado ?? null) !== (p.aceptado ?? null);
      const dPag = (f?.cobrado ?? 0) !== (p.pagado ?? 0);
      if (dAce) divAceptado++;
      if (dPag) divPagado++;
    }
    console.log(
      `  ℹ divergencia cache vs derivado (informativo, lo cura el reseed): aceptado ${divAceptado}/${pacientes.length} · pagado ${divPagado}/${pacientes.length}`,
    );
  });

  console.log(fallos === 0 ? "\nVERDE — derivación de finanzas verificada" : `\nROJO — ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
