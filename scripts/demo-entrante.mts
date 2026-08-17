#!/usr/bin/env tsx
// La herramienta de demo del agente (fase A): simula un entrante de WhatsApp
// en la DEMO y cuenta EN FRASES qué entendió, qué decidió, qué anotó y qué
// borrador propone. Documentación de uso: DEMO-ENTRANTE.md (raíz del repo).
//
//   npm run demo:entrante -- --estado                       interruptores
//   npm run demo:entrante -- --on norte                     enciende una clínica
//   npm run demo:entrante -- --off norte                    la apaga
//   npm run demo:entrante -- "+34 613 128 152" "texto"      simula y evalúa
//        [--clinica norte]   solo para números sin hilo previo
//        [--nombre "Ana R."] nombre de perfil de WhatsApp (números nuevos)
//
// QUÉ HACE, y es la razón de que sirva como demo: exactamente la secuencia
// del webhook con el interruptor encendido — persistir el mensaje con
// `servicio.recibirMensaje` y evaluar con `evaluarEntranteConversacion`.
// Cero lógica de agente propia: si esto funciona, el webhook funciona. La
// única copia es `buscarPresupuestoPorTelefono` (el matcher del webhook no
// está exportado; si cambia allí, cambiarlo aquí — está señalado en ambos).
//
// Solo DEMO. Nada sale por WhatsApp real (modo A: el borrador se propone, la
// persona envía; la DEMO además no tiene número conectado). Limpieza total:
// `npm run demo:reset`. Coste: ~medio céntimo por mensaje evaluado.
//
// Salidas (§9): 0 = evaluación completada (incluye no-reversión y fallback,
// señalizados) · 1 = mal uso o interruptor apagado · 2 = entorno/conexión.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { evaluadorActivo, registrarEvento } from "../app/lib/automatizacion/pg";
import { semaforoDeContacto, ETIQUETA_MOTIVO_ROJO } from "../app/lib/automatizacion/semaforo";
import { evaluarEntranteConversacion } from "../app/lib/agente/evaluar-entrante";
import { contextoDeConversacion } from "../app/lib/agente/contexto-conversacion";
import { getServicioMensajeria } from "../app/lib/presupuestos/mensajeria";
import { selectPresupuestosRaw } from "../app/lib/presupuestos/repo";
import { buscarLeadActivoPorTelefono } from "../app/lib/leads/leads";
import { ETIQUETA_CLAVE, type ClaveAplazado } from "../app/lib/automatizacion/aplazamientos";
import { colaDeDerivacion, type CausaDerivacion } from "../app/lib/automatizacion/estado";
import type { PayloadEvaluacion } from "../app/lib/agente/persistir-turno";

// ─── entorno ────────────────────────────────────────────────────────────────

for (const v of ["SUPABASE_DB_URL_APP", "ANTHROPIC_API_KEY"]) {
  if (!process.env[v]) {
    console.error(`✗ Falta ${v} en .env.local — no puedo hacer nada.`);
    process.exit(2);
  }
}

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL_APP,
  ssl: { rejectUnauthorized: false },
});
try {
  await db.connect();
} catch (err) {
  console.error("✗ No se pudo conectar a la base:", err instanceof Error ? err.message : String(err));
  process.exit(2);
}

// TODA consulta directa va en su transacción con set_config LOCAL. La URL de
// la app pasa por el pooler de Supabase en modo transacción (puerto 6543):
// un set_config de sesión NO sobrevive entre queries — cada una puede caer en
// otro backend sin `app.cliente`, y RLS devuelve cero filas EN SILENCIO. Se
// pagó aquí mismo: la primera versión leía el log recién escrito, volvía
// vacío, y pintaba un «no pudo evaluar» falso con la evaluación persistida.
async function q(texto: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> {
  await db.query("begin");
  try {
    await db.query("select set_config('app.cliente','DEMO',true)");
    const r = await db.query(texto, params);
    await db.query("commit");
    return r as { rows: any[]; rowCount: number | null };
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  }
}

// ─── argumentos ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function sacarFlag(nombre: string): string | null {
  const i = argv.indexOf(nombre);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (!v) {
    console.error(`✗ ${nombre} necesita un valor.`);
    process.exit(1);
  }
  argv.splice(i, 2);
  return v;
}

const AYUDA = `Uso:
  npm run demo:entrante -- --estado
  npm run demo:entrante -- --on <clinica>      (norte | sur | centro | este)
  npm run demo:entrante -- --off <clinica>
  npm run demo:entrante -- "<telefono>" "<texto del mensaje>" [--clinica <c>] [--nombre "<perfil>"]
  npm run demo:entrante -- --resolver "<telefono>"   (una persona cierra el asunto derivado)

Documentación completa: DEMO-ENTRANTE.md`;

async function clinicaPorNombre(trozo: string): Promise<{ id: string; nombre: string }> {
  const r = await q(
    `select id, nombre from clinicas where nombre ilike $1 order by nombre`,
    [`%${trozo}%`],
  );
  if (r.rows.length === 1) return r.rows[0];
  console.error(
    r.rows.length === 0
      ? `✗ Ninguna clínica del DEMO se llama «${trozo}».`
      : `✗ «${trozo}» es ambiguo: ${r.rows.map((x: any) => x.nombre).join(" · ")}.`,
  );
  process.exit(1);
}

async function pintarInterruptores(): Promise<void> {
  const r = await q(
    `select c.nombre, ca.evaluador_activo
       from configuracion_automatizaciones ca join clinicas c on c.id = ca.clinica_id
      order by c.nombre`,
  );
  console.log("\nEl interruptor del agente, clínica a clínica:");
  for (const f of r.rows) {
    console.log(`  ${f.evaluador_activo ? "🟢 ENCENDIDO" : "⚪ apagado  "}  ${f.nombre}`);
  }
  console.log("");
}

// ─── modos de interruptor ───────────────────────────────────────────────────

const flagOn = sacarFlag("--on");
const flagOff = sacarFlag("--off");
if (argv.includes("--estado") || flagOn || flagOff) {
  if (flagOn || flagOff) {
    const cl = await clinicaPorNombre((flagOn ?? flagOff)!);
    const r = await q(
      `update configuracion_automatizaciones set evaluador_activo=$2 where clinica_id=$1`,
      [cl.id, flagOn != null],
    );
    if (r.rowCount !== 1) {
      // §1: un update que no toca filas no es un éxito.
      console.error(`✗ ${cl.nombre} no tiene fila de configuración — corre \`npm run demo:reset\`.`);
      process.exit(1);
    }
    console.log(`\n${flagOn ? "🟢 Encendido" : "⚪ Apagado"} el agente en ${cl.nombre}.`);
  }
  await pintarInterruptores();
  await db.end();
  process.exit(0);
}

// ─── modo resolver: el botón «resuelto» de la coordinadora, en terminal ─────
// (hasta que exista la pantalla de fase C). UN botón para todas las causas:
// la causa ya está en el log.
const flagResolver = sacarFlag("--resolver");
if (flagResolver) {
  await runWithCliente("DEMO", async () => {
    const sem = await semaforoDeContacto(flagResolver);
    if (sem.verde) {
      console.log(`\n🟢 ${flagResolver} ya está en verde — no hay asunto que resolver.`);
      return;
    }
    await registrarEvento({
      tipoCaso: "conversacion",
      casoId: flagResolver.trim(),
      evento: "resuelto_manual",
      actorNombre: "persona (demo)",
      motivoTexto: "resuelto desde demo-entrante",
    });
    const despues = await semaforoDeContacto(flagResolver);
    console.log(`\n✓ Asunto resuelto (era: ${sem.motivo ? ETIQUETA_MOTIVO_ROJO[sem.motivo] : "?"}${sem.causa ? ` · ${sem.causa}` : ""}).`);
    console.log(
      despues.verde
        ? "🟢 El hilo vuelve a estar en verde: el agente contestará el próximo mensaje."
        : `⚠ Sigue en rojo: ${despues.motivo ? ETIQUETA_MOTIVO_ROJO[despues.motivo] : "?"}${despues.hasta ? ` (hasta ${despues.hasta})` : ""}.`,
    );
  });
  await db.end();
  process.exit(0);
}

// ─── modo mensaje ───────────────────────────────────────────────────────────

// Flags ANTES que posicionales: así valen en cualquier orden.
const flagClinica = sacarFlag("--clinica");
const flagNombre = sacarFlag("--nombre");
const [telefonoArg, contenido] = argv;
if (!telefonoArg || !contenido) {
  console.log(AYUDA);
  await db.end();
  process.exit(1);
}

const dig = (t: string) => t.replace(/[^0-9]/g, "");

// La clave del hilo es el STRING exacto guardado en mensajes_whatsapp. Si el
// número ya tiene hilo con otro formato («+34 613 128 152» vs «+34613128152»),
// usar el formato guardado — si no, el mismo paciente se parte en dos
// conversaciones y el evaluador no ve su historia.
let telefono = telefonoArg.trim();
{
  const hilos = await q(`select distinct telefono from mensajes_whatsapp where telefono is not null`);
  const iguales = hilos.rows.map((r: any) => String(r.telefono)).filter((t: string) => dig(t) === dig(telefono));
  if (iguales.length > 1) {
    console.error(`✗ Ese número tiene VARIOS hilos con formatos distintos: ${iguales.join(" · ")} — pásame el exacto.`);
    process.exit(1);
  }
  if (iguales.length === 1 && iguales[0] !== telefono) {
    console.log(`  (uso el formato del hilo existente: «${iguales[0]}»)`);
    telefono = iguales[0];
  }
}

// La clínica del mensaje: la del hilo si existe (último valor no nulo, el
// mismo criterio que la bandeja); si no, --clinica; si no, la única encendida.
let clinicaId: string | null = null;
{
  const h = await q(
    `select clinica_id from mensajes_whatsapp
      where telefono=$1 and clinica_id is not null order by "timestamp" desc limit 1`,
    [telefono],
  );
  clinicaId = h.rows[0]?.clinica_id ?? null;
  if (!clinicaId && flagClinica) clinicaId = (await clinicaPorNombre(flagClinica)).id;
  if (!clinicaId) {
    const enc = await q(
      `select c.id, c.nombre from configuracion_automatizaciones ca
        join clinicas c on c.id = ca.clinica_id where ca.evaluador_activo = true`,
    );
    if (enc.rows.length === 1) {
      clinicaId = enc.rows[0].id;
      console.log(`  (lo recibe ${enc.rows[0].nombre}, la única clínica encendida)`);
    } else {
      // El hilo no dice la clínica (el seed no la estampa; producción sí, por
      // el número WABA) y no hay una sola encendida que haga de default.
      console.error(
        enc.rows.length === 0
          ? `✗ No sé qué clínica recibe este mensaje. Enciende una (--on norte) o dímela con --clinica.`
          : `✗ Hay varias clínicas encendidas y el hilo no dice la suya: dímela con --clinica (norte|sur|centro|este).`,
      );
      process.exit(1);
    }
  }
}
const nombreClinica = String(
  (await q(`select nombre from clinicas where id=$1`, [clinicaId])).rows[0]?.nombre ?? clinicaId,
);

// El interruptor manda, igual que en producción: apagado → el flujo viejo, sin
// evaluación. La herramienta no se lo salta — sería enseñar algo que no pasa.
if (!(await runWithCliente("DEMO", () => evaluadorActivo(clinicaId)))) {
  console.error(`\n⚪ El agente está APAGADO en ${nombreClinica} — este mensaje NO se evaluaría en producción.`);
  console.error(`   Enciéndelo con:  npm run demo:entrante -- --on ${nombreClinica.split(" ").pop()!.toLowerCase()}\n`);
  await db.end();
  process.exit(1);
}

// ─── el matcher del webhook (COPIA — ver cabecera) ──────────────────────────

async function buscarPresupuestoId(telefonoNormalizado: string): Promise<string | null> {
  const tel = telefonoNormalizado;
  const formula = `OR(
    FIND('${tel}', SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({Paciente_Telefono}, ' ', ''), '+', ''), '-', '')),
    FIND('${tel}', SUBSTITUTE(SUBSTITUTE(SUBSTITUTE({Teléfono}&'', ' ', ''), '+', ''), '-', ''))
  )`.replace(/\s+/g, " ");
  const recs = await selectPresupuestosRaw({
    filterByFormula: formula,
    fields: ["Paciente_nombre"],
    sort: [{ field: "Fecha", direction: "desc" }],
    maxRecords: 1,
  });
  return recs.length ? (recs[0].id as string) : null;
}

// ─── la secuencia del webhook, y el relato ──────────────────────────────────

const ETIQUETA_CAUSA: Record<CausaDerivacion, string> = {
  urgencia: "urgencia médica",
  antecedente_medico: "antecedente médico con cita próxima",
  peticion_queja: "petición o queja del paciente",
  insistencia: "insistencia sobre algo que quedó aplazado",
  caso_completo: "caso completo — listo para que la clínica actúe",
};
const ETIQUETA_ETAPA: Record<string, string> = {
  cobro: "cobrar lo firmado",
  presupuesto: "cerrar el presupuesto",
  cita: "conseguir la cita",
  identificar: "saber quién es",
};
const linea = (c = "─") => console.log(c.repeat(64));

const mensajeId = `sim_${Date.now()}`;
let salida = 0;

await runWithCliente("DEMO", async () => {
  // Quién es, ANTES de insertar nada — para el encabezado y para enseñar qué
  // persigue el agente en este hilo.
  const ctx = await contextoDeConversacion(telefono);
  // EL SEMÁFORO (026): ya no hay EXISTS eterno — el agente calla solo
  // mientras el asunto derivado siga sin resolver o el hilo esté asumido.
  // Una espera vigente NO lo calla (responder no es contactar).
  const sem = await semaforoDeContacto(telefono);
  const agenteCalla = !sem.verde && sem.motivo !== "espera";

  const presupuestoId = await buscarPresupuestoId(dig(telefono));
  const leadInfo = presupuestoId ? null : await buscarLeadActivoPorTelefono(dig(telefono));

  console.log("");
  linea("━");
  console.log(`ENTRANTE SIMULADO → ${nombreClinica} (agente encendido)`);
  linea("━");
  const quien =
    ctx.origenNombre === "telefono"
      ? `${telefono} — desconocido total (ni paciente, ni lead)`
      : `${ctx.nombre} (${telefono}) — ${ctx.pacienteId ? "paciente" : ctx.origenNombre === "perfil" ? "solo nombre de perfil de WhatsApp" : "lead"}`;
  console.log(`De: ${quien}`);
  if (ctx.presupuestosVivos.length)
    console.log(
      `Presupuestos vivos: ${ctx.presupuestosVivos.map((p) => `${p.tratamiento ?? "sin tratamiento"} (${p.importe ?? "?"} €)`).join(" · ")}`,
    );
  if (ctx.pendienteCobro > 0) console.log(`Pendiente de cobro: ${ctx.pendienteCobro} €`);
  console.log(
    `Qué persigue el agente aquí: ${ctx.objetivosAbiertos.length ? ctx.objetivosAbiertos.map((o) => ETIQUETA_ETAPA[o] ?? o).join(" → ") : "nada abierto (acompañar)"}`,
  );
  console.log(`\n«${contenido}»\n`);

  // 1 · Registrar el mensaje — LO MISMO que hace el webhook antes de evaluar.
  const servicio = getServicioMensajeria("waba");
  await servicio.recibirMensaje({
    telefono,
    contenido,
    presupuestoId: presupuestoId ?? undefined,
    leadId: leadInfo?.id,
    wabaMessageId: mensajeId,
    nombrePerfil: flagNombre,
    clinicaId,
  });
  console.log("✓ Mensaje registrado en el hilo (visible en /mensajeria).\n");

  if (agenteCalla) {
    linea();
    console.log(`SEMÁFORO EN ROJO: ${sem.motivo ? ETIQUETA_MOTIVO_ROJO[sem.motivo] : "?"}${sem.causa ? ` (causa: ${sem.causa}${sem.objetivo ? ` · objetivo: ${sem.objetivo}` : ""})` : ""}.`);
    console.log("El agente no actúa mientras el asunto esté con una persona. Se");
    console.log("cierra cuando el sistema ve el hecho (la cita creada, el cobro,");
    console.log("el presupuesto cerrado) o cuando una persona lo marca resuelto:");
    console.log(`  npm run demo:entrante -- --resolver "${telefono}"`);
    console.log("Producción hace exactamente esto. El censo: npm run semaforo");
    linea();
    return;
  }
  if (!sem.verde && sem.motivo === "espera") {
    console.log(`(en espera hasta ${sem.hasta} — el agente responde igualmente al entrante; son las CADENCIAS las que callan)`);
  }

  // 2 · Evaluar — la MISMA llamada que hace el webhook en after().
  await evaluarEntranteConversacion({ telefono, mensajeId, contenido, presupuestoId, clinicaId });

  // 3 · Leer lo persistido y contarlo. Se lee del LOG, no de una variable: lo
  //     que se enseña es lo que quedó guardado de verdad.
  const evs = (
    await q(
      `select evento, clave_aplazado, causa_derivacion, malestar, motivo_texto, evaluacion_json, hasta
         from eventos_automatizacion where mensaje_id=$1 order by created_at`,
      [mensajeId],
    )
  ).rows as {
    evento: string;
    clave_aplazado: ClaveAplazado | null;
    causa_derivacion: CausaDerivacion | null;
    malestar: boolean | null;
    motivo_texto: string | null;
    evaluacion_json: string | null;
  }[];

  const evalRow = evs.find((e) => e.evento === "evaluacion");
  if (!evalRow?.evaluacion_json) {
    linea();
    console.log("⚠ EL EVALUADOR NO PUDO EVALUAR (el modelo no contestó o contestó");
    console.log("  ilegible). Fail-closed: no se inventa juicio.");
    if (presupuestoId)
      console.log("  El caso subió a persona: tarjeta en /presupuestos → Intervención,\n  urgencia MEDIO, motivo «No se pudo evaluar el mensaje automáticamente».");
    else console.log("  Sin presupuesto no hay tarjeta: el mensaje queda en /mensajeria.");
    console.log("  Si esto se repite en cada mensaje, algo está roto — no es azar.");
    linea();
    salida = 0;
    return;
  }
  const p = JSON.parse(evalRow.evaluacion_json) as PayloadEvaluacion;
  const derivado = evs.find((e) => e.evento === "derivado");
  const aplazados = evs.filter((e) => e.evento === "aplazado");

  linea();
  console.log("QUÉ ENTENDIÓ");
  console.log(`  Tema del mensaje: ${p.tema}`);
  const si = (b: boolean) => (b ? "SÍ" : "no");
  console.log(`  ¿Urgencia médica? ${si(p.urgenciaMedica)} · ¿Petición o queja? ${si(p.peticionOQueja)}${p.peticionOQueja ? ` (malestar: ${si(p.malestar)})` : ""}`);
  console.log(`  ¿Menciona un antecedente médico? ${si(p.mencionaAntecedenteMedico)} · ¿Insiste sobre algo aplazado? ${p.vuelveSobreAplazado ? `SÍ (${ETIQUETA_CLAVE[p.vuelveSobreAplazado]})` : "no"}`);
  const recogidos = Object.entries(p.camposRecogidos ?? {}).flatMap(([, campos]) =>
    Object.entries(campos ?? {}).filter(([, v]) => v != null && v !== ""),
  );
  if (recogidos.length)
    console.log(`  Datos que el paciente dio este turno: ${recogidos.map(([k, v]) => `${k} = ${v === "no_aplica" ? "no aplica" : `«${v}»`}`).join(" · ")}`);

  console.log("\nQUÉ DECIDIÓ");
  if (derivado?.causa_derivacion) {
    const causa = derivado.causa_derivacion;
    const cola = colaDeDerivacion(causa, derivado.malestar);
    console.log(`  DERIVA a una persona — motivo: ${ETIQUETA_CAUSA[causa]}.`);
    if (cola === "prioritaria") {
      console.log("  Cola PRIORITARIA: aviso push creado → mira la campanita («Atención inmediata»).");
      if (presupuestoId) console.log("  Tarjeta en /presupuestos → Intervención con urgencia CRÍTICO.");
    } else {
      console.log("  Cola normal: SIN aviso push (el push es solo para lo que no puede esperar).");
      if (presupuestoId) console.log("  Tarjeta en /presupuestos → Intervención con urgencia ALTO.");
    }
    console.log("  El hilo queda EN ROJO hasta que el asunto se cierre: por hecho del sistema");
    console.log("  (cita creada, cobro, presupuesto cerrado) o con --resolver. Censo: npm run semaforo");
  } else {
    console.log("  SIGUE — el agente continúa la conversación. Nadie tiene que intervenir.");
  }

  console.log("\nQUÉ ANOTÓ");
  const espera = evs.find((e) => e.evento === "espera_fijada");
  if (aplazados.length === 0 && !espera) console.log("  Nada nuevo pendiente.");
  for (const a of aplazados)
    console.log(`  Pendiente para la clínica: ${ETIQUETA_CLAVE[a.clave_aplazado!]} — «${a.motivo_texto ?? ""}»\n  (el agente ya le dijo al paciente que se le confirmará; cuando la clínica responda, se cierra)`);
  if (espera) {
    const hastaTxt = (espera as any).hasta instanceof Date ? (espera as any).hasta.toISOString().slice(0, 10) : String((espera as any).hasta).slice(0, 10);
    console.log(`  ESPERA fijada: sin contacto hasta el ${hastaTxt} (lo pidió el paciente).`);
    console.log("  Las cadencias no le escribirán hasta entonces; si él escribe, el agente responde.");
  }

  console.log("\nBORRADOR QUE PROPONE (nadie lo envía — modo A, lo envía la persona)");
  console.log(`  «${p.respuesta}»`);
  if (p.borradorDescartado) {
    const razon = p.borradorDescartado.motivo === "clinica" ? "regla clínica (afirmaba algo sobre dolor/resultado/riesgo)"
      : p.borradorDescartado.motivo === "economica" ? "regla económica (comprometía condiciones que no constan)"
      : p.borradorDescartado.motivo === "datos_sensibles" ? "art. 9 (volcaba tratamiento o importe que nadie pidió)"
      : p.borradorDescartado.motivo === "promesa" ? "prometía una acción de la clínica sin entregar el caso"
      : p.borradorDescartado.motivo === "sin_categoria" ? "el juez dijo que infringe pero su categoría llegó ilegible"
      : "el juez no contestó (fail-closed)";
    console.log(`  ⚠ El borrador del modelo se DESCARTÓ — ${razon}${p.borradorDescartado.frase ? `; la frase: «${p.borradorDescartado.frase}»` : ""}.`);
    console.log("  Lo de arriba es la plantilla neutra. Una vez es la guarda funcionando; en cada mensaje, es el generador degradado.");
  }
  if (p.hiloTruncado) console.log("  (aviso: el hilo era tan largo que se recortó — puede faltar contexto antiguo)");

  console.log("\nDÓNDE VERLO EN PANTALLA");
  console.log(`  /mensajeria → hilo de ${ctx.nombre}`);
  if (presupuestoId) console.log("  /presupuestos → pestaña Intervención (la tarjeta del paciente)");
  else console.log("  (sin presupuesto no hay tarjeta de intervención: la evaluación vive en el hilo y en este log)");
  linea();
});

await db.end();
process.exit(salida);
