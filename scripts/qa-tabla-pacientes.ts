#!/usr/bin/env node
// Bloque 3 — QA de la tabla de Pacientes editable ("ventana, no base de datos").
//
//   npx tsx scripts/qa-tabla-pacientes.ts
//
// Flujos comprometidos en el gate:
//   1. Whitelist del PATCH: cachés de dinero y derivados RECHAZADOS;
//      contacto/notas/doctor permitidos.
//   2. Editar contacto: teléfono se propaga a los presupuestos ABIERTOS
//      (deuda D1 — la copia paciente_telefono que usa la cola).
//   3. Registrar cobro por el servicio origen (crearPago) → el derivado
//      cobrado (finanzasDePaciente) sube exactamente el importe.
//   4. Cambio de estado: PERDIDO sin motivo RECHAZADO; con motivo válido;
//      el editor nunca ofrece el estado actual (estadosAlcanzables).
//
// Solo DEMO; snapshot/restore de todo lo tocado (marcador [QA_TABLA]).

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_DOMINIOS = "presupuestos,mensajes,leads,pagos,pacientes";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { camposNoEditables, propagarTelefonoAPresupuestos } from "../app/lib/pacientes/edicion";
import { validarCambioEstado, estadosAlcanzables, ESTADOS_PRESUPUESTO } from "../app/lib/presupuestos/transiciones";
import { selectPresupuestosRaw, updatePresupuestoRaw } from "../app/lib/presupuestos/repo";
import { crearPago } from "../app/lib/pagos";
import { finanzasDePaciente } from "../app/lib/finanzas-paciente";

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`);
  if (!c) fallos++;
};

async function main() {
  const url = process.env.SUPABASE_DB_URL_APP;
  if (!url) throw new Error("SUPABASE_DB_URL_APP requerida");

  await runWithCliente("DEMO", async () => {
    // ── 1 · Whitelist del PATCH ──
    console.log("\n1 · Whitelist: la tabla no puede escribir cachés ni derivados");
    const rechazados = camposNoEditables({
      pagado: 999, aceptado: "Si", presupuestoTotal: 1, pendiente: 0, financiado: 5,
      firmado: 1, telefono: "+34 600 000 001", notas: "n", doctorLinkId: "x",
    });
    ok("rechaza pagado/aceptado/presupuestoTotal/pendiente/financiado/firmado",
      ["pagado", "aceptado", "presupuestoTotal", "pendiente", "financiado", "firmado"]
        .every((k) => rechazados.includes(k)));
    ok("permite telefono/notas/doctorLinkId",
      !rechazados.includes("telefono") && !rechazados.includes("notas") && !rechazados.includes("doctorLinkId"));

    // ── 2 · Propagación del teléfono a presupuestos abiertos ──
    console.log("\n2 · Teléfono → propagado a los presupuestos ABIERTOS (D1)");
    const abiertos = await selectPresupuestosRaw({
      filterByFormula: "AND({Estado}!='ACEPTADO',{Estado}!='PERDIDO')",
      fields: ["Paciente", "Paciente_Telefono"],
    });
    const conPaciente = abiertos.find((r) => {
      const l = (r.fields as any)["Paciente"];
      return Array.isArray(l) && l[0];
    });
    if (!conPaciente) throw new Error("No hay presupuesto abierto con paciente en DEMO");
    const pacienteId = ((conPaciente.fields as any)["Paciente"] as string[])[0];
    const suyos = abiertos.filter((r) => {
      const l = (r.fields as any)["Paciente"];
      return Array.isArray(l) ? l.includes(pacienteId) : l === pacienteId;
    });
    const snapshotTel = suyos.map((r) => ({
      id: r.id,
      tel: String((r.fields as any)["Paciente_Telefono"] ?? ""),
    }));
    const TEL_QA = "+34 600 000 111";
    const n = await propagarTelefonoAPresupuestos(pacienteId, TEL_QA);
    ok(`propagó a ${n} presupuesto(s) abierto(s) (esperado ${suyos.length})`, n === suyos.length && n > 0);
    const trasProp = await selectPresupuestosRaw({
      filterByFormula: "AND({Estado}!='ACEPTADO',{Estado}!='PERDIDO')",
      fields: ["Paciente", "Paciente_Telefono"],
    });
    const todosCambiados = trasProp
      .filter((r) => {
        const l = (r.fields as any)["Paciente"];
        return Array.isArray(l) ? l.includes(pacienteId) : l === pacienteId;
      })
      .every((r) => String((r.fields as any)["Paciente_Telefono"] ?? "") === TEL_QA);
    ok("todos sus abiertos llevan el teléfono nuevo", todosCambiados);
    for (const s of snapshotTel) await updatePresupuestoRaw(s.id, { Paciente_Telefono: s.tel });
    console.log("  (teléfonos restaurados)");

    // ── 3 · Registrar cobro por el servicio origen ──
    console.log("\n3 · Cobro por crearPago → el derivado 'cobrado' sube exacto");
    const antes = await finanzasDePaciente(pacienteId);
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const snapCache = (await c.query(
      "select pagado, pendiente from pacientes where id=$1", [pacienteId],
    )).rows[0];
    await c.query("commit");
    await crearPago({ pacienteId, importe: 111, metodo: "Efectivo", tipo: "Senal", nota: "[QA_TABLA] cobro de prueba" });
    const despues = await finanzasDePaciente(pacienteId);
    ok(`cobrado sube exactamente 111 € (${antes.cobrado} → ${despues.cobrado})`,
      despues.cobrado === antes.cobrado + 111);
    // limpieza: pago + acciones + caché del paciente restaurada
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    await c.query("delete from acciones_pago where pago_id in (select id from pagos_paciente where nota like '%[QA_TABLA]%')");
    const del = await c.query("delete from pagos_paciente where nota like '%[QA_TABLA]%'");
    await c.query("update pacientes set pagado=$1, pendiente=$2 where id=$3",
      [snapCache?.pagado ?? null, snapCache?.pendiente ?? null, pacienteId]);
    await c.query("commit");
    await c.end();
    const restaurado = await finanzasDePaciente(pacienteId);
    ok(`limpieza: ${del.rowCount} pago(s) QA borrado(s) y derivado restaurado`,
      restaurado.cobrado === antes.cobrado);

    // ── 4 · Transiciones de estado ──
    console.log("\n4 · Transiciones: PERDIDO exige motivo; el editor no ofrece el estado actual");
    ok("PERDIDO sin motivo → RECHAZADO",
      validarCambioEstado({ nuevo: "PERDIDO", motivoPerdida: null }) !== null);
    ok("PERDIDO con motivo → válido",
      validarCambioEstado({ nuevo: "PERDIDO", motivoPerdida: "Precio" }) === null);
    ok("estado desconocido → RECHAZADO",
      validarCambioEstado({ nuevo: "INVENTADO" }) !== null);
    ok("mismo estado → RECHAZADO",
      validarCambioEstado({ actual: "PRESENTADO", nuevo: "PRESENTADO" }) !== null);
    ok("estadosAlcanzables nunca incluye el actual",
      ESTADOS_PRESUPUESTO.every((e) => !estadosAlcanzables(e).includes(e)));
  });

  console.log(fallos === 0 ? "\nVERDE — tabla editable verificada contra sus registros origen" : `\nROJO — ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
