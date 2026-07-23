#!/usr/bin/env node
// estadoConversacion — QA de CONVERGENCIA: los 3 casos que ANTES divergían
// entre pantallas (cola vs ficha/panel del mismo caso) ahora clasifican igual,
// porque todas consumen la misma función sobre los mismos datos.
//
//   npx tsx scripts/qa-estado-conversacion.ts
//
// Caso 1 — presupuesto: "Mensaje recibido" registrado a mano SIN que la IA
//   bumpee Fecha_ultima_respuesta. Criterio viejo de la cola → "esperando"
//   (mal); criterio nuevo (hilo) → pendiente_responder en cola Y ficha.
// Caso 2 — lead: saliente registrado solo en acciones_lead (llamada/apertura
//   de chat), sin fila de hilo. Antes lista (acciones) y panel (hilo) se
//   contradecían; ahora ambos usan los timestamps fusionados → en_espera.
// Caso 3 — presupuesto: saliente hace 5 días sin respuesta → reactivable en
//   cola Y ficha (umbral 72h centralizado).
//
// Solo DEMO; limpieza total de residuos [QA_CONV].

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_DOMINIOS = "presupuestos,mensajes,leads,pagos,pacientes";
process.env.DATA_BACKEND_PG_CLIENTES = "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import {
  getServicioMensajeria,
  ultimosMensajesPorConversacion,
} from "../app/lib/presupuestos/mensajeria";
import {
  estadoConversacion,
  entradaDesdeMensajes,
  UMBRAL_REACTIVACION_MS,
} from "../app/lib/presupuestos/estado-conversacion";
import {
  selectPresupuestosRaw,
  getPresupuestoPorIdRaw,
  updatePresupuestoRaw,
} from "../app/lib/presupuestos/repo";
import { logAccionLead, ultimasAccionesDireccionPorLead } from "../app/lib/leads/acciones";
import { listLeadsPorEstados } from "../app/lib/leads/leads";

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? "  — " + extra : ""}`);
  if (!c) fallos++;
};

// La MISMA composición que hace la ruta de la cola (hilo primario + acción
// saliente registrada como complemento).
const TIPOS_SALIENTE = new Set(["WhatsApp enviado", "Llamada realizada", "Sin respuesta tras llamada"]);
async function estadoSegunCola(presupuestoId: string) {
  const [ultimos, rec] = await Promise.all([
    ultimosMensajesPorConversacion(),
    getPresupuestoPorIdRaw(presupuestoId, [
      "Fecha_ultima_respuesta",
      "Ultima_accion_registrada",
      "Tipo_ultima_accion",
    ]),
  ]);
  const f = (rec?.fields ?? {}) as any;
  const hilo = ultimos.porPresupuesto.get(presupuestoId);
  const accionSaliente =
    f["Ultima_accion_registrada"] && TIPOS_SALIENTE.has(String(f["Tipo_ultima_accion"] ?? ""))
      ? String(f["Ultima_accion_registrada"])
      : null;
  const fur = f["Fecha_ultima_respuesta"] ? String(f["Fecha_ultima_respuesta"]) : null;
  const entranteComplemento =
    !hilo?.entranteAt || (fur && fur > hilo.entranteAt) ? fur : null;
  return estadoConversacion(
    {
      ultimoEntranteAt: entranteComplemento ?? hilo?.entranteAt ?? null,
      ultimoSalienteAt: hilo?.salienteAt ?? null,
      ultimaAccionSalienteAt: accionSaliente,
    },
    UMBRAL_REACTIVACION_MS.presupuesto,
  );
}

async function estadoSegunFicha(presupuestoId: string) {
  const servicio = getServicioMensajeria("manual");
  const mensajes = await servicio.getHistorialConversacion({ presupuestoId, limit: 50 });
  return estadoConversacion(
    entradaDesdeMensajes(mensajes as any),
    UMBRAL_REACTIVACION_MS.presupuesto,
  );
}

async function limpiar() {
  const url = process.env.SUPABASE_DB_URL_APP;
  if (!url) throw new Error("SUPABASE_DB_URL_APP requerida para limpiar");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.cliente','DEMO',true)");
    const m = await c.query("delete from mensajes_whatsapp where contenido like '%[QA_CONV]%'");
    const a = await c.query("delete from acciones_lead where detalles like '%[QA_CONV]%'");
    await c.query("commit");
    console.log(`  limpieza: ${m.rowCount} mensaje(s) y ${a.rowCount} acción(es) QA borrados`);
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    await c.end();
  }
}

async function main() {
  await runWithCliente("DEMO", async () => {
    const servicio = getServicioMensajeria("manual");

    // ── CASO 1 — recibido manual sin IA ──
    console.log("\nCASO 1 · presupuesto: respuesta del paciente registrada a mano (sin IA)");
    const ultimos0 = await ultimosMensajesPorConversacion();
    const abiertos = await selectPresupuestosRaw({
      filterByFormula: "AND({Estado}!='ACEPTADO',{Estado}!='PERDIDO')",
      fields: ["Estado", "Paciente_Telefono", "Fase_seguimiento", "Ultima_accion_registrada", "Tipo_ultima_accion", "Fecha_ultima_respuesta"],
    });
    const caso1 = abiertos.find((r: any) => {
      const h = ultimos0.porPresupuesto.get(r.id);
      return h?.salienteAt && (!h.entranteAt || h.salienteAt > h.entranteAt);
    });
    if (!caso1) throw new Error("No hay presupuesto abierto con último mensaje saliente — corre el seed");
    const f1 = caso1.fields as any;
    const snapshot1 = {
      Ultima_accion_registrada: f1["Ultima_accion_registrada"] ?? null,
      Tipo_ultima_accion: f1["Tipo_ultima_accion"] ?? null,
      Fase_seguimiento: f1["Fase_seguimiento"] ?? null,
    };
    const now = new Date().toISOString();
    // Lo que hace la ruta registrar-respuesta con "Mensaje recibido" (la IA
    // NO corre → Fecha_ultima_respuesta NO se toca):
    await updatePresupuestoRaw(caso1.id, {
      Ultima_accion_registrada: now,
      Tipo_ultima_accion: "Mensaje recibido",
      Fase_seguimiento: "En intervención",
    });
    await servicio.recibirMensaje({
      presupuestoId: caso1.id,
      telefono: String(f1["Paciente_Telefono"] ?? ""),
      contenido: "[QA_CONV] Hola, sí me interesa, ¿me contáis?",
    });
    // Criterio VIEJO de la cola (el bug): acción > Fecha_ultima_respuesta y <72h → "esperando".
    const fur1 = f1["Fecha_ultima_respuesta"] ? new Date(String(f1["Fecha_ultima_respuesta"])).getTime() : 0;
    const viejoDeciaEsperando = new Date(now).getTime() > fur1;
    ok("el criterio viejo lo clasificaba mal ('esperando')", viejoDeciaEsperando);
    const cola1 = await estadoSegunCola(caso1.id);
    const ficha1 = await estadoSegunFicha(caso1.id);
    ok(`cola = ${cola1.estado}`, cola1.estado === "pendiente_responder");
    ok(`ficha = ${ficha1.estado}`, ficha1.estado === "pendiente_responder");
    ok("cola y ficha COINCIDEN", cola1.estado === ficha1.estado);
    await updatePresupuestoRaw(caso1.id, snapshot1 as any);

    // ── CASO 2 — lead con saliente solo en acciones ──
    console.log("\nCASO 2 · lead: saliente registrado solo en acciones (sin fila de hilo)");
    const ultimosLead = await ultimosMensajesPorConversacion();
    const leads = await listLeadsPorEstados(["Contactado", "Nuevo"]);
    const lead2 = leads.find((l) => !ultimosLead.porLead.has(l.id));
    if (!lead2) throw new Error("No hay lead sin hilo en DEMO");
    await logAccionLead({
      leadId: lead2.id,
      tipo: "WhatsApp_Saliente",
      detalles: "[QA_CONV] apertura de chat registrada",
    });
    const { salientePorLead, entrantePorLead } = await ultimasAccionesDireccionPorLead();
    const hiloLead = (await ultimosMensajesPorConversacion()).porLead.get(lead2.id);
    const max = (a?: string | null, b?: string | null) => (!a ? (b ?? null) : !b || a > b ? a : b);
    // LISTA (endpoint fusionado) y PANEL (hilo + accionDir del mismo endpoint):
    const entradaLista = {
      ultimoEntranteAt: max(entrantePorLead[lead2.id], hiloLead?.entranteAt),
      ultimoSalienteAt: max(salientePorLead[lead2.id], hiloLead?.salienteAt),
    };
    const lista2 = estadoConversacion(entradaLista, UMBRAL_REACTIVACION_MS.lead);
    const panel2 = estadoConversacion(
      {
        ultimoEntranteAt: max(null, entradaLista.ultimoEntranteAt),
        ultimoSalienteAt: max(null, entradaLista.ultimoSalienteAt),
      },
      UMBRAL_REACTIVACION_MS.lead,
    );
    ok(`lista = ${lista2.estado}`, lista2.estado === "en_espera_paciente");
    ok(`panel = ${panel2.estado}`, panel2.estado === "en_espera_paciente");
    ok("lista y panel COINCIDEN (antes el panel sin hilo decía otra cosa)", lista2.estado === panel2.estado);

    // ── CASO 3 — reactivable (saliente viejo sin respuesta, del propio seed) ──
    // El seed coherente garantiza ≥1 reactivable por estado abierto (último
    // saliente hace ≥4 días, sin respuesta): no hace falta fabricar nada —
    // se verifica que cola y ficha coinciden sobre el caso REAL.
    console.log("\nCASO 3 · presupuesto: saliente viejo sin respuesta → reactivable");
    const caso3 = abiertos.find((r: any) => {
      const h = ultimos0.porPresupuesto.get(r.id);
      const f = r.fields as any;
      const acc = f["Ultima_accion_registrada"];
      const accReciente = acc && Date.now() - new Date(String(acc)).getTime() < UMBRAL_REACTIVACION_MS.presupuesto;
      const salienteViejo =
        h?.salienteAt &&
        (!h.entranteAt || h.entranteAt < h.salienteAt) &&
        Date.now() - new Date(h.salienteAt).getTime() >= UMBRAL_REACTIVACION_MS.presupuesto;
      const furReciente =
        f["Fecha_ultima_respuesta"] &&
        Date.now() - new Date(String(f["Fecha_ultima_respuesta"])).getTime() < UMBRAL_REACTIVACION_MS.presupuesto;
      return r.id !== caso1.id && salienteViejo && !accReciente && !furReciente;
    });
    if (!caso3) throw new Error("No hay presupuesto reactivable en DEMO — corre npm run demo:reset");
    const cola3 = await estadoSegunCola(caso3.id);
    const ficha3 = await estadoSegunFicha(caso3.id);
    ok(`cola = ${cola3.estado}`, cola3.estado === "reactivable");
    ok(`ficha = ${ficha3.estado}`, ficha3.estado === "reactivable");
    ok("cola y ficha COINCIDEN", cola3.estado === ficha3.estado);
  });

  await limpiar();
  console.log(fallos === 0 ? "\nVERDE — las pantallas clasifican igual en los 3 casos" : `\nROJO — ${fallos} fallo(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("ERROR:", e);
  try {
    await limpiar();
  } catch {}
  process.exit(1);
});
