#!/usr/bin/env node
// SEED RICO de DEMO — directo a Postgres/Supabase (jamás Airtable).
//
//   node scripts/db-seed-demo-rico.mjs        (= npm run demo:reset)
//
// SOLO tenant DEMO. Conecta como fyllio_app + SET LOCAL app.cliente='DEMO' →
// RLS hace ESTRUCTURALMENTE imposible tocar RB/INDEP (el motor los niega).
// NO importa Airtable ni usa base()/AIRTABLE_* → no puede escribir en Airtable.
// NO toca identidad (usuarios/clinicas/usuario_clinicas) ni catálogo
// (staff/tratamientos/sillones): solo borra y resiembra lo TRANSACCIONAL.
//
// Fechas RELATIVAS a hoy (la demo no envejece). Teléfonos +34 6XX XXX XXX.
// Automatizaciones con TRIPLE candado de no-envío: modo_test=true +
// paciente_test inexistente, eventos procesado=true, modo_whatsapp='manual'.

import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const db = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query("begin");
await db.query("select set_config('app.cliente', 'DEMO', true)");
// Guarda dura: si por lo que sea el contexto no es DEMO, abortar.
const ctx = (await db.query("select current_setting('app.cliente', true) as c")).rows[0].c;
if (ctx !== "DEMO") { console.error("✗ contexto no es DEMO:", ctx); process.exit(1); }

// ── util fechas relativas ─────────────────────────────────────────────
const HOY = new Date(); HOY.setHours(9, 0, 0, 0);
const dPlus = (n, h = 9, m = 0) => { const x = new Date(HOY); x.setDate(x.getDate() + n); x.setHours(h, m, 0, 0); return x; };
const dISO = (n) => dPlus(n).toISOString();
const fecha10 = (n) => dPlus(n).toISOString().slice(0, 10);
const mesAct = HOY.toISOString().slice(0, 7);
const mesPrev = new Date(HOY.getFullYear(), HOY.getMonth() - 1, 1).toISOString().slice(0, 7);

// ── catálogo (se conserva; se leen sus ids) ───────────────────────────
const clinicas = (await db.query("select id, nombre from clinicas where cliente='DEMO'")).rows;
const CID = Object.fromEntries(clinicas.map((c) => [c.nombre, c.id]));
const CENTRO = CID["Clínica Demo Centro"], NORTE = CID["Clínica Demo Norte"], SUR = CID["Clínica Demo Sur"], ESTE = CID["Clínica Demo Este"];
const staff = (await db.query("select id, nombre, rol, clinica_id from staff where cliente='DEMO'")).rows;
const dentistas = staff.filter((s) => s.rol === "Dentista");
const tratamientos = (await db.query("select id, nombre from tratamientos where cliente='DEMO'")).rows;
const TID = Object.fromEntries(tratamientos.map((t) => [t.nombre, t.id]));
const sillones = (await db.query("select id, clinica_id from sillones where cliente='DEMO'")).rows;
const docEn = (cid) => dentistas.find((d) => d.clinica_id === cid) ?? dentistas[0];
const silEn = (cid) => sillones.find((s) => s.clinica_id === cid) ?? sillones[0];

// helper insert que devuelve id
let SEQ = 0;
async function ins(tabla, row) {
  const cols = ["cliente", ...Object.keys(row)];
  const vals = ["DEMO", ...Object.values(row)];
  const ph = cols.map((_, i) => `$${i + 1}`).join(",");
  const r = await db.query(`insert into ${tabla} (${cols.join(",")}) values (${ph}) returning id`, vals);
  return r.rows[0].id;
}
const tel = () => `+34 6${String(10 + (SEQ++ % 89)).padStart(2, "0")} ${String(100 + (SEQ * 7 % 900)).padStart(3, "0")} ${String(100 + (SEQ * 13 % 900)).padStart(3, "0")}`;

try {
  // ── WIPE transaccional (orden FK-seguro; identidad y catálogo intactos) ──
  const WIPE = ["acciones_pago", "inconsistencias_pagos", "acciones_automatizacion", "secuencias_automaticas",
    "eventos_sistema", "contactos_presupuesto", "cola_envios", "mensajes_whatsapp", "llamadas_vapi",
    "lista_espera", "citas", "presupuestos", "pagos_paciente", "acciones_lead", "notificaciones",
    "alertas_enviadas", "conversaciones_copilot", "informes_guardados", "configuraciones_clinica",
    "configuracion_recordatorios", "configuracion_waba", "push_subscriptions", "historial_acciones",
    "objetivos_mensuales", "reglas_automatizacion", "configuracion_automatizaciones", "doctores_presupuestos",
    "usuarios_presupuestos", "plantillas_mensaje", "plantillas_lead", "leads", "pacientes"];
  let borradas = 0;
  for (const t of WIPE) { const r = await db.query(`delete from ${t} where cliente='DEMO'`); borradas += r.rowCount; }
  console.log(`wipe transaccional DEMO: ${borradas} filas fuera`);

  // ── PACIENTES (46): financiero coherente para KPIs ───────────────────
  const NOMBRES = ["María Sánchez", "Javier Ortega", "Lucía Romero", "Carlos Herrera", "Elena Navarro",
    "Pablo Gil", "Marta Vidal", "Sergio Ramos", "Ana Torres", "David Castro", "Cristina Muñoz", "Alberto Ruiz",
    "Sara Delgado", "Miguel Ángel Prieto", "Laura Iglesias", "Raúl Serrano", "Nuria Cano", "Diego Vargas",
    "Patricia León", "Fernando Gallego", "Beatriz Marín", "Óscar Peña", "Rocío Santos", "Andrés Cabrera",
    "Silvia Reyes", "Jorge Fuentes", "Isabel Crespo", "Rubén Nieto", "Carmen Aguilar", "Víctor Campos",
    "Alicia Vega", "Gonzalo Bravo", "Teresa Molina", "Iván Guerrero", "Julia Pascual", "Hugo Márquez",
    "Natalia Soto", "Adrián Lorenzo", "Paula Ferrer", "Emilio Blanco", "Clara Rey", "Marcos Prieto",
    "Sonia Herrero", "Alejandro Vera", "Irene Pastor", "Rafael Ortiz"];
  const CANALES = ["Instagram", "Google", "Recomendación", "Landing Page", "Llamada directa", "Walk-in"];
  const clis = [CENTRO, CENTRO, CENTRO, NORTE, NORTE, SUR, ESTE]; // Centro pesa más (flagship)
  const pacientes = [];
  for (let i = 0; i < NOMBRES.length; i++) {
    const cid = clis[i % clis.length];
    // El financiero (presupuesto_total/pagado/pendiente/aceptado) NO se
    // inventa aquí: se BACKFILLEA al final derivado de los presupuestos y
    // pagos que este mismo seed crea — una sola verdad, como en la app
    // (bug estructural #3/#4, 2026-07-23).
    const id = await ins("pacientes", {
      nombre: NOMBRES[i], telefono: tel(), email: `${NOMBRES[i].toLowerCase().replace(/[^a-z]/g, ".")}@email.com`,
      clinica_id: cid, doctor_id: docEn(cid).id, canal_origen: CANALES[i % CANALES.length],
      canal_preferido: i % 3 === 0 ? "Llamada" : "WhatsApp", consentimiento_whatsapp: true,
      edad: 22 + (i * 3 % 55),
      activo: true, notas: i % 5 === 0 ? "Paciente recurrente, buena adherencia." : null,
      fecha_cita: i < 12 ? fecha10(i - 4) : null,
    });
    pacientes.push({ id, nombre: NOMBRES[i], cid, tel: (await db.query("select telefono from pacientes where id=$1", [id])).rows[0].telefono });
  }
  console.log(`pacientes: ${pacientes.length}`);

  // ── LEADS (38): conversación coherente de punta a punta ──────────────
  // Regla del seed (cierre estadoConversacion, 2026-07-23): TODO lead que no
  // sea "Nuevo" tiene hilo WhatsApp real cuyo ÚLTIMO mensaje cuadra con el
  // estado derivado que verán las pantallas (umbral leads = 48 h). Los 8
  // "Nuevo" son EXACTAMENTE los sin_conversacion: ni mensajes ni acciones.
  // Las fechas son relativas (dh = días, hAgo = horas): resembrar re-ancla
  // sin romper la coherencia.
  const hAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
  const dh = (n, h = 10) => dPlus(n, h).toISOString();
  const estadosLead = [
    ...Array(8).fill("Nuevo"), ...Array(9).fill("Contactado"), ...Array(4).fill("Citado"),
    ...Array(2).fill("Citados Hoy"), ...Array(9).fill("Convertido"), ...Array(6).fill("No Interesado")];
  const MOTIVOS_NO = ["Se fue a otra clínica más barata", "No le convenció el tratamiento", "Problema de horarios", "Precio fuera de presupuesto"];
  const RECHAZO_LEAD = {
    "Se fue a otra clínica más barata": "Al final me lo voy a hacer en otra clínica que me sale más barato. Gracias de todas formas.",
    "No le convenció el tratamiento": "Lo he estado pensando y no me convence el tratamiento. Lo siento.",
    "Problema de horarios": "Con mis horarios me es imposible ir, lo tenemos que dejar.",
    "Precio fuera de presupuesto": "Ahora mismo se me va de presupuesto. ¡Gracias!",
  };
  const TRATS_INT = ["Implante unitario", "Ortodoncia invisible", "Blanqueamiento LED", "Endodoncia molar", "Limpieza dental", "Corona sobre implante"];
  const leadNombresExtra = ["Yolanda Ríos", "Tomás Benítez", "Lorena Cuevas", "Álvaro Méndez", "Noelia Ibáñez",
    "Gabriel Rojas", "Verónica Nieves", "Samuel Arias", "Lidia Palma", "Mario Esteban", "Celia Duarte", "Ismael Rubio",
    "Rosa Domínguez", "Guillermo Sáez", "Ainhoa Vicente", "Daniel Roldán", "Marina Cortés", "Sergio Bermúdez",
    "Eva Montero", "Ángel Carrasco", "Vanesa Gimeno", "Joaquín Ledesma", "Miriam Salas", "Pablo Escobar",
    "Nerea Aparicio", "Rubén Caballero", "Sandra Quintana", "Iker Robledo", "Amparo Gil", "Cristian Vázquez"];
  let nlNi = 0;
  let mensajesLeadN = 0;
  const leads = [];
  const CNT_LEAD = {};
  for (let i = 0; i < estadosLead.length; i++) {
    const est = estadosLead[i];
    const k = (CNT_LEAD[est] = (CNT_LEAD[est] ?? -1) + 1); // índice dentro del estado
    const cid = clis[i % clis.length];
    const conv = est === "Convertido";
    const pac = conv ? pacientes[20 + (i % 20)] : null; // convertidos apuntan a pacientes existentes
    const nombre = conv ? pac.nombre : leadNombresExtra[nlNi++ % leadNombresExtra.length];
    const primer = nombre.split(" ")[0];
    const trat = TRATS_INT[i % TRATS_INT.length];
    const tratLow = trat.toLowerCase();
    const telLead = tel();
    const guion = [];    // {dir, ts, txt, intn?} — el hilo REAL del lead
    const acciones = []; // {tipo, ts, resumen, det} — llamadas registradas
    let motivoNo = null, fechaCita = null, horaCita = null;

    if (est === "Contactado") {
      const rot = k % 3; // 3 pendientes · 3 en espera · 3 reactivables
      if (rot === 0) {
        // PENDIENTE_RESPONDER: contestó hoy y la pelota es nuestra.
        const preg = [
          { intn: "Pregunta precio", txt: `Hola, ¿me podéis decir cuánto costaría ${tratLow}? ¿Tenéis financiación?` },
          { intn: "Pide cita", txt: "Buenas, sí me interesa. ¿Tenéis hueco esta semana por la tarde?" },
          { intn: "Interesado", txt: `Vi vuestra publicación de ${tratLow} en Instagram y me interesa mucho. ¿Me contáis?` },
        ][Math.floor(k / 3) % 3];
        acciones.push({ tipo: "Llamada", ts: dh(-3, 12), resumen: "Primer contacto telefónico", det: "No contesta; se sigue por WhatsApp." });
        guion.push({ dir: "Saliente", ts: dh(-3, 13), txt: `Hola ${primer}, soy del equipo de la clínica 😊 Nos dejaste tus datos interesándote por ${tratLow}. ¿Hablamos por aquí?` });
        guion.push({ dir: "Entrante", ts: hAgo(2 + (k % 4)), txt: preg.txt, intn: preg.intn });
      } else if (rot === 1) {
        // EN_ESPERA_PACIENTE: le contestamos hace <48 h; la pelota es suya.
        acciones.push({ tipo: "Llamada", ts: dh(-4, 12), resumen: "Primer contacto telefónico", det: "No contesta; se sigue por WhatsApp." });
        guion.push({ dir: "Saliente", ts: dh(-4, 13), txt: `Hola ${primer}, soy del equipo de la clínica 😊 ¿Sigues interesado en ${tratLow}?` });
        guion.push({ dir: "Entrante", ts: dh(-2, 11), txt: `¿Cuánto costaría ${tratLow} más o menos? Es por hacerme una idea.`, intn: "Pregunta precio" });
        guion.push({ dir: "Saliente", ts: hAgo(20), txt: "Depende del caso, pero trabajamos con financiación hasta 24 meses. Si quieres te preparo una valoración sin compromiso, ¿te viene bien esta semana?" });
      } else {
        // REACTIVABLE: le escribimos hace ≥48 h y no ha contestado.
        guion.push({ dir: "Saliente", ts: dh(-6, 12), txt: `Hola ${primer}, soy del equipo de la clínica. ¿Sigues interesado en ${tratLow}?` });
        guion.push({ dir: "Entrante", ts: dh(-5, 10), txt: "Me lo estoy pensando, ¿me mandáis más información?", intn: "Pide más info" });
        guion.push({ dir: "Saliente", ts: dh(-4, 9), txt: "¡Claro! Te acabo de enviar el dossier con precios y opciones de financiación. Cualquier duda me dices 😊" });
      }
    } else if (est === "Citado" || est === "Citados Hoy") {
      // Conversación CONCLUIDA en cita agendada; el último mensaje es nuestra
      // confirmación (reciente → en_espera, y la cita manda en el contexto).
      const off = est === "Citados Hoy" ? 0 : 2;
      fechaCita = fecha10(off); horaCita = "16:30";
      guion.push({ dir: "Saliente", ts: dh(-2, 10), txt: `Hola ${primer}, gracias por tu interés en ${tratLow}. ¿Te viene bien una primera visita sin compromiso?` });
      guion.push({ dir: "Entrante", ts: dh(-2, 12), txt: "Sí, ¿qué días tenéis hueco por la tarde?", intn: "Pide cita" });
      guion.push({ dir: "Saliente", ts: dh(-2, 13), txt: `Te propongo el ${fechaCita} a las 16:30. ¿Te lo reservo?` });
      guion.push({ dir: "Entrante", ts: dh(-1, 18), txt: "Perfecto, resérvalo. ¡Gracias!", intn: "Pide cita" });
      guion.push({
        dir: "Saliente", ts: est === "Citados Hoy" ? hAgo(18) : dh(-1, 19),
        txt: est === "Citados Hoy"
          ? "¡Te esperamos hoy a las 16:30! Si te surge algo, avísanos por aquí."
          : `¡Reservado! Te esperamos el ${fechaCita} a las 16:30. Te mandaremos un recordatorio el día antes.`,
      });
    } else if (conv) {
      // Convertido: hilo concluido días atrás; el estado de negocio lo saca
      // de todas las colas (el panel muestra "Convertido en paciente").
      guion.push({ dir: "Saliente", ts: dh(-8, 10), txt: `Hola ${primer}, soy del equipo de la clínica 😊 ¿Te cuento cómo sería la primera visita para ${tratLow}?` });
      guion.push({ dir: "Entrante", ts: dh(-7, 11), txt: "Sí, me interesa. ¿Cuándo puedo ir?", intn: "Interesado" });
      guion.push({ dir: "Saliente", ts: dh(-7, 12), txt: "Te reservo hueco esta misma semana 😊" });
      guion.push({ dir: "Entrante", ts: dh(-6, 9), txt: "Genial, allí estaré. ¡Gracias!", intn: "Pide cita" });
      guion.push({ dir: "Saliente", ts: dh(-6, 10), txt: `¡Hecho, ${primer}! Ya tienes tu ficha con nosotros; seguimos por aquí para lo que necesites.` });
    } else if (est === "No Interesado") {
      // Cerrado perdido: el rechazo del hilo CUADRA con el motivo registrado.
      motivoNo = MOTIVOS_NO[k % MOTIVOS_NO.length];
      guion.push({ dir: "Saliente", ts: dh(-6, 10), txt: `Hola ${primer}, ¿pudiste valorar lo que hablamos sobre ${tratLow}?` });
      guion.push({ dir: "Entrante", ts: dh(-5, 12), txt: RECHAZO_LEAD[motivoNo], intn: "No interesado" });
      guion.push({ dir: "Saliente", ts: dh(-5, 13), txt: "Entendido, gracias por avisar 😊 Aquí nos tienes si cambias de idea." });
    }
    // est === "Nuevo" → sin guion y sin acciones: sin_conversacion puro.

    const salientes = guion.filter((m) => m.dir === "Saliente");
    const lastEnt = [...guion].reverse().find((m) => m.dir === "Entrante") ?? null;
    const lastSal = salientes[salientes.length - 1] ?? null;
    const lid = await ins("leads", {
      nombre, telefono: telLead, email: null, tratamiento_interes: trat,
      canal_captacion: CANALES[i % CANALES.length], estado: est, clinica_id: cid,
      doctor_asignado_id: docEn(cid).id, tipo_visita: "Primera visita",
      fecha_cita: fechaCita, hora_cita: horaCita,
      llamado: acciones.some((a) => a.tipo === "Llamada"),
      whatsapp_enviados: salientes.length,
      motivo_no_interes: motivoNo,
      intencion_detectada: lastEnt?.intn ?? null,
      convertido_a_paciente: conv, paciente_id: conv ? pac.id : null,
      ultima_accion: lastSal ? "WhatsApp_Saliente" : (acciones.length ? "Llamada" : null),
    });
    leads.push({ id: lid, est, cid, nombre, guion });
    for (const a of acciones) await ins("acciones_lead", { lead_id: lid, tipo_accion: a.tipo, resumen: a.resumen, timestamp: a.ts, detalles: a.det });
    // El envío real registra acción + fila de hilo (prerequisito 5417982):
    if (lastSal) await ins("acciones_lead", { lead_id: lid, tipo_accion: "WhatsApp_Saliente", resumen: "WhatsApp enviado", timestamp: lastSal.ts, detalles: "Mensaje enviado desde el panel." });
    for (const m of guion) {
      await ins("mensajes_whatsapp", {
        lead_id: lid, telefono: telLead, direccion: m.dir, contenido: m.txt,
        timestamp: m.ts, fuente: "Modo_A_manual", procesado_por_ia: m.dir === "Entrante",
        intencion_detectada: m.intn ?? null,
      });
      mensajesLeadN++;
    }
  }
  console.log(`leads: ${leads.length} (hilos: ${mensajesLeadN} mensajes)`);

  // ── PRESUPUESTOS (34): narrativa conversacional coherente por caso ───
  // Cada presupuesto define su GUION (hilo WhatsApp) y de él se DERIVAN los
  // campos persistidos que pintan las cards (última respuesta, tipo/fecha de
  // última acción, fase, urgencia, acción sugerida): lo que se lee en el hilo
  // y lo que recomienda la card no pueden contradecirse. Umbral = 72 h:
  //   reactivable → último saliente hace ≥4 días sin respuesta
  //   en_espera   → último saliente hace <48 h
  //   pendiente   → último mensaje es DEL PACIENTE
  const EST_PRES = [["PRESENTADO", 7], ["INTERESADO", 5], ["EN_DUDA", 5], ["EN_NEGOCIACION", 4], ["ACEPTADO", 8], ["PERDIDO", 5]];
  const TRAT_PRES = [["Implante unitario", 2800], ["Ortodoncia invisible", 3500], ["Corona sobre implante", 950],
    ["Endodoncia molar", 480], ["Blanqueamiento LED", 300], ["Implante unitario", 4200], ["Férula de descarga", 220],
    ["Limpieza dental", 90], ["Ortodoncia invisible", 3800], ["Corona sobre implante", 1200]];
  const MOTIVOS_PERD = ["Precio", "Se fue a otra clínica", "Sin respuesta tras 3 contactos", "Cambió de opinión"];
  const RECHAZO_PRES = {
    Precio: "Lo he pensado y ahora mismo es demasiado caro para mí. Lo siento.",
    "Se fue a otra clínica": "Al final me lo hago en otra clínica, gracias por todo.",
    "Cambió de opinión": "He decidido no hacerme el tratamiento por ahora. Gracias.",
  };
  const presupuestos = []; let np = 0; let idxAcept = 0; let mensajesN = 0;
  const IMPORTES_ACEPT = [2800, 3500, 4200, 3800, 3850, 2100, 1200, 950]; // Σ = 22.400 (facturado mes)
  for (const [estado, n] of EST_PRES) {
    for (let k = 0; k < n; k++) {
      const pac = pacientes[np % pacientes.length]; np++;
      const [tnom, imp0] = TRAT_PRES[np % TRAT_PRES.length];
      const importe = estado === "ACEPTADO" ? IMPORTES_ACEPT[idxAcept++] : imp0;
      const primer = pac.nombre.split(" ")[0];
      const tratLow = tnom.toLowerCase();
      const impTxt = `${importe.toLocaleString("es-ES")}€`;
      const guion = []; // {dir, ts, txt, intn?}
      let urgencia = "BAJO", accion = null, mensajeSug = null;
      let altaOff = -(1 + (np % 5));
      let fechaAceptado = null, motivoPerd = null, motivoPerdTexto = null, fechaPerdida = null;

      if (estado === "PRESENTADO") {
        if (k === 0) {
          // REACTIVABLE: se presentó hace 9 días y nunca contestó.
          altaOff = -9;
          guion.push({ dir: "Saliente", ts: dh(-9, 10), txt: `Hola ${primer}, te envío el presupuesto de ${tratLow} (${impTxt}). Cualquier duda me preguntas, ¡estamos para ayudarte! 😊` });
          urgencia = "ALTO"; accion = "Llamar para reactivar";
          mensajeSug = `Hola ${primer}, hace unos días te enviamos el presupuesto de ${tratLow}. ¿Te ayudo a resolver alguna duda? Tenemos financiación sin intereses 😊`;
        } else {
          // EN_ESPERA: presentado hace horas; aún dentro del plazo.
          altaOff = -1;
          guion.push({ dir: "Saliente", ts: hAgo(10 + k * 5), txt: `Hola ${primer}, aquí tienes el presupuesto de ${tratLow} (${impTxt}). Cualquier duda me preguntas 😊` });
          urgencia = "BAJO"; accion = "Enviar recordatorio si no responde";
        }
      } else if (estado === "INTERESADO") {
        if (k === 0) {
          // REACTIVABLE: mostró interés y se enfrió hace 9 días.
          altaOff = -12;
          guion.push({ dir: "Saliente", ts: dh(-12, 10), txt: `Hola ${primer}, te envío el presupuesto de ${tratLow} (${impTxt}). ¿Lo vemos juntos?` });
          guion.push({ dir: "Entrante", ts: dh(-11, 12), txt: "Me interesa mucho, ¿cómo pido cita?", intn: "Acepta sin condiciones" });
          guion.push({ dir: "Saliente", ts: dh(-9, 10), txt: "¡Genial! Te propongo jueves o viernes por la tarde, ¿qué te viene mejor?" });
          urgencia = "ALTO"; accion = "Llamar para reactivar";
          mensajeSug = `Hola ${primer}, quedamos en buscar hueco para ${tratLow} y no quiero que se te pase 😊 ¿Te viene bien esta semana?`;
        } else if (k % 2 === 1) {
          // PENDIENTE_RESPONDER: contestó hoy pidiendo cita.
          altaOff = -2;
          guion.push({ dir: "Saliente", ts: dh(-2, 10), txt: `Hola ${primer}, ¿pudiste ver el presupuesto de ${tratLow} (${impTxt})?` });
          guion.push({ dir: "Entrante", ts: hAgo(3 + k), txt: "Perfecto, me viene bien el jueves por la tarde. ¿A qué hora tenéis hueco?", intn: "Acepta sin condiciones" });
          urgencia = "ALTO"; accion = "Responder y cerrarle la cita";
          mensajeSug = `¡Genial, ${primer}! El jueves tenemos hueco a las 16:30 o a las 18:00. ¿Cuál te reservo?`;
        } else {
          // EN_ESPERA: le contestamos hace <48 h.
          altaOff = -3;
          guion.push({ dir: "Saliente", ts: dh(-3, 10), txt: `Hola ${primer}, ¿pudiste ver el presupuesto de ${tratLow} (${impTxt})?` });
          guion.push({ dir: "Entrante", ts: dh(-2, 12), txt: "Me interesa, la semana que viene os digo algo seguro.", intn: "Quiere pensarlo" });
          guion.push({ dir: "Saliente", ts: hAgo(20), txt: "¡Perfecto! Quedo pendiente. Si te surge cualquier duda, aquí me tienes 😊" });
          urgencia = "BAJO"; accion = "Recordatorio si no responde en unos días";
        }
      } else if (estado === "EN_DUDA") {
        if (k === 0) {
          // REACTIVABLE: dudó por precio, le ofrecimos financiación y silencio 8 días.
          altaOff = -10;
          guion.push({ dir: "Saliente", ts: dh(-10, 10), txt: `Hola ${primer}, te envío el presupuesto de ${tratLow} (${impTxt}).` });
          guion.push({ dir: "Entrante", ts: dh(-9, 12), txt: `Buenas, lo he visto pero ${impTxt} se me va un poco… ¿tenéis financiación?`, intn: "Pide oferta/descuento" });
          guion.push({ dir: "Saliente", ts: dh(-8, 10), txt: "¡Claro! Trabajamos con financiación hasta 24 meses sin intereses. ¿Te preparo una simulación?" });
          urgencia = "ALTO"; accion = "Llamar para reactivar";
          mensajeSug = `Hola ${primer}, ¿pudiste ver la opción de financiación para ${tratLow}? Te preparo la simulación sin compromiso 😊`;
        } else if (k <= 2) {
          // PENDIENTE_RESPONDER: planteó su duda hoy.
          altaOff = -2;
          const duda = k === 1
            ? { txt: "La verdad es que me da bastante respeto el tratamiento… ¿duele mucho?", intn: "Tiene duda sobre tratamiento", acc: "Responder a su duda clínica", sug: `Hola ${primer}, es normal que impresione, pero va con anestesia y la mayoría lo tolera genial. Si quieres, el doctor te lo explica en una llamada 😊` }
            : { txt: "¿Me haríais algún descuento si lo pago todo por adelantado?", intn: "Pide oferta/descuento", acc: "Ofrecer financiación", sug: `Hola ${primer}, déjame consultarlo con administración y te digo hoy mismo. También tenemos financiación sin intereses por si te encaja mejor 😊` };
          guion.push({ dir: "Saliente", ts: dh(-2, 10), txt: `Hola ${primer}, ¿qué te pareció el presupuesto de ${tratLow} (${impTxt})?` });
          guion.push({ dir: "Entrante", ts: hAgo(4 + k), txt: duda.txt, intn: duda.intn });
          urgencia = "MEDIO"; accion = duda.acc; mensajeSug = duda.sug;
        } else {
          // EN_ESPERA: respondimos a su duda hace <48 h.
          altaOff = -3;
          guion.push({ dir: "Saliente", ts: dh(-3, 10), txt: `Hola ${primer}, te envío el presupuesto de ${tratLow} (${impTxt}).` });
          guion.push({ dir: "Entrante", ts: dh(-2, 11), txt: "¿El precio incluye todas las revisiones?", intn: "Tiene duda sobre tratamiento" });
          guion.push({ dir: "Saliente", ts: hAgo(26), txt: "¡Sí! Incluye todas las revisiones y las radiografías de control. Sin sorpresas 😊" });
          urgencia = "BAJO"; accion = "Recordatorio si no responde en unos días";
        }
      } else if (estado === "EN_NEGOCIACION") {
        if (k === 0) {
          // REACTIVABLE: negociación enfriada hace 8 días.
          altaOff = -11;
          guion.push({ dir: "Saliente", ts: dh(-11, 10), txt: `Hola ${primer}, te envío el presupuesto de ${tratLow} (${impTxt}). Podemos ajustar la forma de pago.` });
          guion.push({ dir: "Entrante", ts: dh(-10, 12), txt: "Dadme unos días, lo tengo que hablar en casa.", intn: "Quiere pensarlo" });
          guion.push({ dir: "Saliente", ts: dh(-8, 10), txt: "¡Claro! Quedo pendiente. Si os ayuda, os preparo una simulación de financiación." });
          urgencia = "ALTO"; accion = "Llamar para reactivar";
          mensajeSug = `Hola ${primer}, ¿pudisteis valorarlo en casa? Cualquier duda sobre ${tratLow} o la financiación, me dices 😊`;
        } else if (k === 1) {
          // PENDIENTE_RESPONDER: quiere aceptar y pregunta por el pago.
          altaOff = -4;
          guion.push({ dir: "Saliente", ts: dh(-4, 10), txt: `Hola ${primer}, ¿cómo lo ves? Podemos ajustar la forma de pago de ${tratLow}.` });
          guion.push({ dir: "Entrante", ts: hAgo(4), txt: "Vale, me decido. ¿Puedo pagarlo en dos veces?", intn: "Acepta pero pregunta pago" });
          urgencia = "ALTO"; accion = "Envíale los detalles de pago";
          mensajeSug = `¡Genial, ${primer}! Sí: puedes dejar una señal ahora y el resto al empezar, o financiarlo hasta 24 meses. ¿Qué te encaja mejor?`;
        } else if (k === 2) {
          // PENDIENTE_RESPONDER: pidió tiempo hoy — responder con tacto.
          altaOff = -3;
          guion.push({ dir: "Saliente", ts: dh(-3, 10), txt: `Hola ${primer}, ¿seguimos con ${tratLow}? Podemos ver opciones de pago.` });
          guion.push({ dir: "Entrante", ts: hAgo(7), txt: "Dadme unos días, lo hablo con mi familia y os digo.", intn: "Quiere pensarlo" });
          urgencia = "MEDIO"; accion = "Confirmar que le das espacio y agendar recordatorio";
          mensajeSug = `¡Por supuesto, ${primer}! Tómate tu tiempo. Te escribo la semana que viene por si tenéis dudas 😊`;
        } else {
          // EN_ESPERA: le enviamos la simulación hace <48 h.
          altaOff = -4;
          guion.push({ dir: "Saliente", ts: dh(-4, 10), txt: `Hola ${primer}, ¿cómo lo ves? Podemos ajustar la forma de pago de ${tratLow}.` });
          guion.push({ dir: "Entrante", ts: dh(-2, 12), txt: "¿Me mandáis la simulación de financiación?", intn: "Pide oferta/descuento" });
          guion.push({ dir: "Saliente", ts: hAgo(30), txt: "¡Enviada! La tienes en el PDF: 24 cuotas sin intereses. Cualquier duda me dices 😊" });
          urgencia = "BAJO"; accion = "Recordatorio si no responde en unos días";
        }
      } else if (estado === "ACEPTADO") {
        // Cerrado ganado: el hilo termina con aceptación y nuestra confirmación.
        const aceptOff = -(np % 10) - 1;
        altaOff = aceptOff - 3;
        fechaAceptado = fecha10(aceptOff);
        guion.push({ dir: "Saliente", ts: dh(aceptOff - 2, 10), txt: `Hola ${primer}, ¿has podido pensar sobre el presupuesto de ${tratLow} (${impTxt})?` });
        guion.push({ dir: "Entrante", ts: dh(aceptOff, 11), txt: "Sí, lo hemos decidido: ¡adelante! ¿Cómo lo hacemos?", intn: "Acepta sin condiciones" });
        guion.push({ dir: "Saliente", ts: dh(aceptOff, 12), txt: `¡Enhorabuena, ${primer}! 🎉 Te llamamos hoy para cerrar la primera cita y el pago. Bienvenido/a.` });
        urgencia = "NINGUNO";
      } else {
        // PERDIDO — el hilo cuadra con el motivo registrado. La FECHA de
        // pérdida vive en historial_acciones (cambio_estado→PERDIDO), que es
        // lo que escribe la app al perder: el dashboard la deriva de ahí.
        motivoPerd = MOTIVOS_PERD[k % MOTIVOS_PERD.length];
        altaOff = -8;
        if (motivoPerd === "Sin respuesta tras 3 contactos") {
          guion.push({ dir: "Saliente", ts: dh(-9, 10), txt: `Hola ${primer}, te envío el presupuesto de ${tratLow} (${impTxt}).` });
          guion.push({ dir: "Saliente", ts: dh(-7, 10), txt: `Hola ${primer}, ¿pudiste verlo? Cualquier duda me dices 😊` });
          guion.push({ dir: "Saliente", ts: dh(-5, 10), txt: `Hola ${primer}, último recordatorio para no ser pesados 😊 Si te interesa retomarlo, aquí estamos.` });
          motivoPerdTexto = "No respondió a ninguno de los tres contactos.";
          fechaPerdida = dh(-4, 10);
        } else {
          guion.push({ dir: "Saliente", ts: dh(-6, 10), txt: `Hola ${primer}, ¿qué te pareció el presupuesto de ${tratLow} (${impTxt})?` });
          guion.push({ dir: "Entrante", ts: dh(-5, 12), txt: RECHAZO_PRES[motivoPerd], intn: "Rechaza" });
          guion.push({ dir: "Saliente", ts: dh(-5, 13), txt: "Entendido, gracias por decírnoslo. Si en algún momento quieres retomarlo, aquí nos tienes 😊" });
          motivoPerdTexto = RECHAZO_PRES[motivoPerd];
          fechaPerdida = dh(-5, 14);
        }
        urgencia = "NINGUNO";
      }

      // Campos persistidos DERIVADOS del guion — una sola verdad.
      const cerrado = estado === "ACEPTADO" || estado === "PERDIDO";
      const lastEnt = [...guion].reverse().find((m) => m.dir === "Entrante") ?? null;
      const lastMsg = guion[guion.length - 1];
      const salientes = guion.filter((m) => m.dir === "Saliente");
      const pid = await ins("presupuestos", {
        paciente_id: pac.id, clinica_id: pac.cid, tratamiento_nombre: tnom, estado, importe,
        fecha_alta: fecha10(altaOff), fecha: fecha10(altaOff),
        fecha_aceptado: fechaAceptado,
        doctor: docEn(pac.cid).nombre, tipo_paciente: "Nuevo", tipo_visita: "Primera visita",
        paciente_telefono: pac.tel, contact_count: salientes.length,
        motivo_perdida: motivoPerd, motivo_perdida_texto: motivoPerdTexto,
        fase_seguimiento: cerrado ? "Cerrado" : (lastMsg.dir === "Entrante" ? "En intervención" : "Esperando respuesta"),
        ultima_accion_registrada: lastMsg.ts, ultimo_contacto: lastMsg.ts.slice(0, 10),
        tipo_ultima_accion: lastMsg.dir === "Saliente" ? "WhatsApp enviado" : "Mensaje recibido",
        fecha_ultima_respuesta: lastEnt?.ts ?? null,
        ultima_respuesta_paciente: lastEnt?.txt ?? null,
        intencion_detectada: lastEnt?.intn ?? null,
        urgencia_intervencion: urgencia,
        accion_sugerida: accion,
        mensaje_sugerido: mensajeSug,
      });
      presupuestos.push({ id: pid, estado, importe, pac, fechaAceptado, guion });
      if (fechaPerdida) await ins("historial_acciones", {
        presupuesto_id: pid, tipo: "cambio_estado",
        descripcion: "Estado cambiado a PERDIDO",
        metadata: JSON.stringify({ estadoNuevo: "PERDIDO" }),
        registrado_por: "Coordinación", fecha: fechaPerdida,
      });
      for (const m of guion) {
        await ins("mensajes_whatsapp", {
          paciente_id: pac.id, presupuesto_id: pid, telefono: pac.tel, direccion: m.dir,
          contenido: m.txt, timestamp: m.ts, fuente: "Modo_A_manual", procesado_por_ia: m.dir === "Entrante",
          intencion_detectada: m.intn ?? null,
        });
        mensajesN++;
      }
      // contactos_presupuesto: uno por saliente real del hilo (score/ContactCount).
      for (const m of salientes) await ins("contactos_presupuesto", {
        presupuesto_id: pid, tipo_contacto: "WhatsApp", resultado: "Enviado",
        fecha_hora: m.ts, nota: "Mensaje del hilo de WhatsApp.",
        registrado_por: "Coordinación", mensaje_ia_usado: true, tono_usado: "cercano",
      });
    }
  }
  // ── PRESUPUESTOS HISTÓRICOS (dashboard de Red: 6 meses de progreso) ──
  // Aceptados de meses anteriores, cerrados y coherentes de punta a punta
  // (guion concluido en su fecha, campos derivados, pago en el mismo mes).
  // pctPago explícito: liquidación casi siempre; dos señales viejas dejan
  // pendiente antiguo que alimenta los "cobros vencidos" del dashboard.
  // Un PERDIDO en el mes anterior (con historial) da el delta de perdidos.
  const dMes = (mesesAtras, dia, h = 11) => {
    const x = new Date(HOY); x.setMonth(x.getMonth() - mesesAtras); x.setDate(dia); x.setHours(h, 0, 0, 0);
    return x;
  };
  const HIST = [
    { m: 1, importe: 3200, trat: "Implante unitario", pct: 1 },
    { m: 1, importe: 1500, trat: "Ortodoncia invisible", pct: 1 },
    { m: 2, importe: 2600, trat: "Corona sobre implante", pct: 1 },
    { m: 2, importe: 900, trat: "Blanqueamiento LED", pct: 0.5 },
    { m: 3, importe: 4100, trat: "Implante unitario", pct: 1 },
    { m: 3, importe: 1200, trat: "Endodoncia molar", pct: 1 },
    { m: 4, importe: 2400, trat: "Ortodoncia invisible", pct: 0.6 },
    { m: 5, importe: 3000, trat: "Implante unitario", pct: 1 },
    { m: 5, importe: 800, trat: "Férula de descarga", pct: 1 },
  ];
  for (const hct of HIST) {
    const pac = pacientes[np % pacientes.length]; np++;
    const primer = pac.nombre.split(" ")[0];
    const dia = 6 + (np % 18);
    const acept = dMes(hct.m, dia);
    const iso = (d, hh, mm = 0) => { const x = new Date(d); x.setHours(hh, mm, 0, 0); return x.toISOString(); };
    const antes = new Date(acept); antes.setDate(antes.getDate() - 2);
    const fechaAceptado = acept.toISOString().slice(0, 10);
    const tratLow = hct.trat.toLowerCase();
    const guion = [
      { dir: "Saliente", ts: iso(antes, 10), txt: `Hola ${primer}, ¿has podido pensar sobre el presupuesto de ${tratLow} (${hct.importe.toLocaleString("es-ES")}€)?` },
      { dir: "Entrante", ts: iso(acept, 11), txt: "Sí, lo hemos decidido: ¡adelante! ¿Cómo lo hacemos?", intn: "Acepta sin condiciones" },
      { dir: "Saliente", ts: iso(acept, 12), txt: `¡Enhorabuena, ${primer}! 🎉 Te llamamos hoy para cerrar la primera cita y el pago. Bienvenido/a.` },
    ];
    const lastEnt = guion[1];
    const lastMsg = guion[2];
    const pid = await ins("presupuestos", {
      paciente_id: pac.id, clinica_id: pac.cid, tratamiento_nombre: hct.trat, estado: "ACEPTADO",
      importe: hct.importe, fecha_alta: iso(antes, 9).slice(0, 10), fecha: iso(antes, 9).slice(0, 10),
      fecha_aceptado: fechaAceptado,
      doctor: docEn(pac.cid).nombre, tipo_paciente: "Nuevo", tipo_visita: "Primera visita",
      paciente_telefono: pac.tel, contact_count: 2,
      fase_seguimiento: "Cerrado",
      ultima_accion_registrada: lastMsg.ts, ultimo_contacto: lastMsg.ts.slice(0, 10),
      tipo_ultima_accion: "WhatsApp enviado",
      fecha_ultima_respuesta: lastEnt.ts, ultima_respuesta_paciente: lastEnt.txt,
      intencion_detectada: lastEnt.intn, urgencia_intervencion: "NINGUNO",
    });
    presupuestos.push({ id: pid, estado: "ACEPTADO", importe: hct.importe, pac, fechaAceptado, guion, pctPago: hct.pct });
    for (const m of guion) {
      await ins("mensajes_whatsapp", {
        paciente_id: pac.id, presupuesto_id: pid, telefono: pac.tel, direccion: m.dir,
        contenido: m.txt, timestamp: m.ts, fuente: "Modo_A_manual", procesado_por_ia: m.dir === "Entrante",
        intencion_detectada: m.intn ?? null,
      });
      mensajesN++;
    }
    for (const m of guion.filter((x) => x.dir === "Saliente")) await ins("contactos_presupuesto", {
      presupuesto_id: pid, tipo_contacto: "WhatsApp", resultado: "Enviado",
      fecha_hora: m.ts, nota: "Mensaje del hilo de WhatsApp.",
      registrado_por: "Coordinación", mensaje_ia_usado: true, tono_usado: "cercano",
    });
  }
  // Perdido del MES ANTERIOR (delta de perdidos del dashboard), con historial.
  {
    const pac = pacientes[np % pacientes.length]; np++;
    const primer = pac.nombre.split(" ")[0];
    const perd = dMes(1, 20);
    const iso = (d, hh) => { const x = new Date(d); x.setHours(hh, 0, 0, 0); return x.toISOString(); };
    const antes = new Date(perd); antes.setDate(antes.getDate() - 1);
    const guion = [
      { dir: "Saliente", ts: iso(antes, 10), txt: `Hola ${primer}, ¿qué te pareció el presupuesto de limpieza dental (700€)?` },
      { dir: "Entrante", ts: iso(perd, 12), txt: "Lo he pensado y ahora mismo es demasiado caro para mí. Lo siento.", intn: "Rechaza" },
      { dir: "Saliente", ts: iso(perd, 13), txt: "Entendido, gracias por decírnoslo. Si en algún momento quieres retomarlo, aquí nos tienes 😊" },
    ];
    const pid = await ins("presupuestos", {
      paciente_id: pac.id, clinica_id: pac.cid, tratamiento_nombre: "Limpieza dental", estado: "PERDIDO",
      importe: 700, fecha_alta: iso(antes, 9).slice(0, 10), fecha: iso(antes, 9).slice(0, 10),
      doctor: docEn(pac.cid).nombre, tipo_paciente: "Nuevo", tipo_visita: "Primera visita",
      paciente_telefono: pac.tel, contact_count: 2,
      motivo_perdida: "Precio", motivo_perdida_texto: "Lo he pensado y ahora mismo es demasiado caro para mí. Lo siento.",
      fase_seguimiento: "Cerrado",
      ultima_accion_registrada: guion[2].ts, ultimo_contacto: guion[2].ts.slice(0, 10),
      tipo_ultima_accion: "WhatsApp enviado",
      fecha_ultima_respuesta: guion[1].ts, ultima_respuesta_paciente: guion[1].txt,
      intencion_detectada: "Rechaza", urgencia_intervencion: "NINGUNO",
    });
    presupuestos.push({ id: pid, estado: "PERDIDO", importe: 700, pac, fechaAceptado: null, guion });
    await ins("historial_acciones", {
      presupuesto_id: pid, tipo: "cambio_estado", descripcion: "Estado cambiado a PERDIDO",
      metadata: JSON.stringify({ estadoNuevo: "PERDIDO" }), registrado_por: "Coordinación",
      fecha: iso(perd, 14),
    });
    for (const m of guion) {
      await ins("mensajes_whatsapp", {
        paciente_id: pac.id, presupuesto_id: pid, telefono: pac.tel, direccion: m.dir,
        contenido: m.txt, timestamp: m.ts, fuente: "Modo_A_manual", procesado_por_ia: m.dir === "Entrante",
        intencion_detectada: m.intn ?? null,
      });
      mensajesN++;
    }
  }
  console.log(`presupuestos: ${presupuestos.length} (hilos: ${mensajesN} mensajes, con histórico 6 meses)`);

  // ── CITAS (28): hoy/mañana/semana/pasadas ────────────────────────────
  const citasPlan = [[0, 6, "Confirmada"], [1, 5, "Confirmada"], [3, 4, "Programada"], [4, 3, "Programada"],
    [-2, 4, "Completado"], [-5, 3, "Completado"], [-3, 3, "Cancelado"]];
  let nc = 0; let citasN = 0;
  for (const [off, cnt, estado] of citasPlan) {
    for (let k = 0; k < cnt; k++) {
      const pac = pacientes[nc % pacientes.length]; nc++;
      const trat = tratamientos[nc % tratamientos.length];
      await ins("citas", {
        nombre: pac.nombre, hora_inicio: dPlus(off, 9 + k, 0).toISOString(), hora_final: dPlus(off, 9 + k, 30).toISOString(),
        estado, notas: estado === "Cancelado" ? "[NO_SHOW] no se presentó" : null, origen: "Coordinación",
        paciente_id: pac.id, tratamiento_id: trat.id, profesional_id: docEn(pac.cid).id, sillon_id: silEn(pac.cid).id, clinica_id: pac.cid,
      }); citasN++;
    }
  }
  console.log(`citas: ${citasN}`);

  // (Los hilos WhatsApp nacen con cada lead y cada presupuesto, arriba —
  // no existe un bloque de mensajes aparte que pueda descorrelacionarse.)

  // ── PAGOS derivados de los presupuestos ACEPTADO ─────────────────────
  // Cada aceptado genera su pago: señal/parcial (lo común en dental) o
  // liquidación completa. El pago nace del presupuesto — nunca de un campo
  // manual del paciente — para que Aceptado (Σ presupuestos), Cobrado
  // (Σ pagos) y Pendiente (resta) cuadren en toda la app por construcción.
  let pagosN = 0; let cicloPct = 0;
  const PCT_PAGO = [0.4, 1, 0.3, 0.6, 1, 0.5, 1, 0.8]; // 5 parciales · 3 liquidados
  const pagadoPorPaciente = new Map();
  for (const p of presupuestos.filter((x) => x.estado === "ACEPTADO")) {
    // Los históricos traen pctPago explícito; los del mes usan el ciclo de
    // siempre (mismo reparto 22.400/15.020 que antes).
    const pct = p.pctPago ?? PCT_PAGO[cicloPct++ % PCT_PAGO.length];
    const importe = Math.round(p.importe * pct);
    const parcial = pct < 1;
    const pid = await ins("pagos_paciente", {
      paciente_id: p.pac.id, importe, fecha_pago: p.fechaAceptado,
      metodo: ["Tarjeta", "Efectivo", "Transferencia", "Financiación"][pagosN % 4],
      tipo: parcial ? "Senal" : "Liquidacion",
      resumen: `Pago de ${p.pac.nombre}`,
      nota: parcial ? "Señal al aceptar el presupuesto; resto pendiente." : "Liquidación completa al aceptar.",
    });
    await ins("acciones_pago", { pago_id: pid, tipo: "Crear", fecha: `${p.fechaAceptado}T10:00:00.000Z`, importe_antes: null, importe_despues: importe, resumen: `Alta de pago · ${p.pac.nombre}`, nota_cambio: "Registrado por coordinación." });
    pagadoPorPaciente.set(p.pac.id, (pagadoPorPaciente.get(p.pac.id) ?? 0) + importe);
    pagosN++;
  }
  console.log(`pagos_paciente: ${pagosN} (+ acciones)`);

  // ── BACKFILL financiero del paciente (cache derivada, una sola verdad) ──
  // presupuesto_total = Σ ACEPTADO · pagado = Σ pagos · pendiente = resta ·
  // aceptado = derivado de los estados reales (Si / Pendiente / No / null).
  for (const pac of pacientes) {
    const suyos = presupuestos.filter((x) => x.pac.id === pac.id);
    const firmado = suyos.filter((x) => x.estado === "ACEPTADO").reduce((s, x) => s + x.importe, 0);
    const cobrado = pagadoPorPaciente.get(pac.id) ?? 0;
    const aceptado = suyos.some((x) => x.estado === "ACEPTADO") ? "Si"
      : suyos.some((x) => x.estado !== "PERDIDO") ? "Pendiente"
      : suyos.length > 0 ? "No" : null;
    await db.query(
      "update pacientes set presupuesto_total=$1, pagado=$2, pendiente=$3, aceptado=$4 where id=$5 and cliente='DEMO'",
      [firmado || null, cobrado || null, firmado ? Math.max(0, firmado - cobrado) : null, aceptado, pac.id],
    );
  }
  console.log(`pacientes: financiero backfilleado (derivado de presupuestos+pagos)`);

  // ── AUTOMATIZACIONES — TRIPLE CANDADO de no-envío ────────────────────
  const PACIENTE_TEST_INEXISTENTE = "recTESTNOEXISTE0000"; // no existe → modo_test nunca coincide
  const reglasDef = [
    ["cita_24h", "Recordatorio 24h antes de la cita", "cita_proxima", 41],
    ["presupuesto_estancado_7d", "Reactivar presupuesto estancado >7 días", "presupuesto_estancado", 23],
    ["lead_inactivo_3d", "Seguimiento de lead sin respuesta", "lead_inactivo", 17],
    ["bienvenida_lead", "Mensaje de bienvenida a lead nuevo", "lead_creado", 34],
    ["reactivacion_60d", "Reactivación de paciente inactivo 60 días", "paciente_inactivo", 8],
  ];
  const reglas = [];
  for (const [codigo, nombre, trigger, veces] of reglasDef) {
    const rid = await ins("reglas_automatizacion", {
      codigo, nombre, descripcion: `Automatización: ${nombre.toLowerCase()}.`, trigger_tipo: trigger,
      clinica_id: CENTRO, activa: true, veces_disparada: veces, ultima_disparada_at: dISO(-(veces % 5) - 1),
      modo_test: true, paciente_test_id: PACIENTE_TEST_INEXISTENTE, resumen: nombre,
      condiciones: "{}", acciones: "enviar_whatsapp_template", updated_at: dISO(-1),
    });
    reglas.push(rid);
    // historial de disparos (display "veces disparada"), en el pasado, ya ejecutados
    const hist = Math.min(7, Math.round(veces / 5));
    for (let k = 0; k < hist; k++) await ins("acciones_automatizacion", {
      regla_id: rid, resultado: k % 4 === 0 ? "skipped_test" : "success", detalle: k % 4 === 0 ? "Modo test: no se envió." : "WhatsApp enviado (histórico).",
      ejecutada_at: dISO(-(k + 1)), resumen: `Disparo de ${nombre}`,
    });
  }
  // configuración por clínica: modo_whatsapp MANUAL (candado 3)
  for (const cid of [CENTRO, NORTE, SUR, ESTE]) await ins("configuracion_automatizaciones", {
    clinica_id: cid, activa: true, dias_inactividad_alerta: 3, dias_portal_sin_respuesta: 7, dias_reactivacion: 60,
    modo_whatsapp: "manual", actualizado_en: dISO(-2),
  });
  // eventos del sistema — TODOS procesado=true (candado 2: el cron los ignora)
  let eventosN = 0;
  for (let i = 0; i < 15; i++) { await ins("eventos_sistema", { tipo: "lead_creado", entidad_tipo: "Lead", entidad_id: leads[i % leads.length].id, payload: "{}", procesado: true, resumen: "Evento lead_creado (procesado)" }); eventosN++; }
  // secuencias (operativo)
  for (let i = 0; i < 12; i++) { const p = presupuestos[i]; await ins("secuencias_automaticas", { presupuesto_id: p.id, clinica_id: p.pac.cid, paciente_nombre: p.pac.nombre, telefono: p.pac.tel, tratamiento: "Tratamiento", tipo_evento: "seguimiento", estado: i % 3 === 0 ? "pendiente" : "enviado", mensaje_generado: "Hola, ¿seguimos adelante con tu tratamiento?", tono_usado: "cercano", canal_sugerido: "whatsapp", actualizado_en: dISO(-(i % 4)) }); }
  console.log(`automatizaciones: ${reglas.length} reglas · ${eventosN} eventos(procesado) · config manual ×4`);

  // ── OBJETIVOS, CONFIG, PLANTILLAS, MISC ──────────────────────────────
  for (const cid of [CENTRO, NORTE, SUR, ESTE]) {
    await ins("objetivos_mensuales", { clinica_id: cid, mes: mesAct, objetivo_aceptados: cid === CENTRO ? 12 : 6, creado_por: "Administración", actualizado_en: dISO(-1) });
    await ins("objetivos_mensuales", { clinica_id: cid, mes: mesPrev, objetivo_aceptados: cid === CENTRO ? 12 : 6, creado_por: "Administración", actualizado_en: dISO(-30) });
  }
  const CONFIG = [["Metodos_Pago", ["Tarjeta", "Efectivo", "Transferencia", "Financiación 12m", "Financiación 24m"]],
    ["Razones_No_Interesado", ["Precio", "Se fue a otra clínica", "Horarios", "Cambió de opinión"]]];
  for (const [cat, vals] of CONFIG) for (let o = 0; o < vals.length; o++) await ins("configuraciones_clinica", { clinica_id: null, categoria: cat, valor: vals[o], activo: true, orden: o, resumen: `${cat} · ${vals[o]}` });
  const PLANTILLAS = [["Recordatorio de cita", "Recordatorio", "Hola {nombre}, te recordamos tu cita el {fecha} a las {hora}. ¡Te esperamos!"],
    ["Seguimiento presupuesto", "Seguimiento", "Hola {nombre}, ¿has podido valorar el presupuesto? Estamos para lo que necesites."],
    ["Bienvenida lead", "Bienvenida", "¡Hola {nombre}! Gracias por tu interés. ¿Cuándo te viene bien una primera visita sin compromiso?"],
    ["Financiación", "Comercial", "Hola {nombre}, podemos financiar tu tratamiento hasta 24 meses sin intereses. ¿Te preparo una simulación?"]];
  for (const [nombre, tipo, contenido] of PLANTILLAS) { await ins("plantillas_mensaje", { nombre, tipo, categoria: "General", contenido, activa: true }); await ins("plantillas_lead", { nombre, tipo, contenido, activa: true }); }
  // notificaciones, alertas, llamadas, copilot, informes, lista_espera
  for (let i = 0; i < 10; i++) await ins("notificaciones", { usuario: "todos", tipo: "Sistema", titulo: ["Nuevo lead", "Respuesta de paciente", "Presupuesto aceptado", "Cita confirmada"][i % 4], mensaje: "Tienes una novedad en tu bandeja.", link: "/actuar-hoy", leida: i > 3, fecha_creacion: dISO(-(i % 5)) });
  const adminId = (await db.query("select id from usuarios where cliente='DEMO' and rol='admin' limit 1")).rows[0]?.id;
  const coordId = (await db.query("select id from usuarios where cliente='DEMO' and rol='coordinacion' limit 1")).rows[0]?.id;
  for (let i = 0; i < 8; i++) await ins("alertas_enviadas", { clinica_id: [CENTRO, NORTE, SUR, ESTE][i % 4], tipo_alerta: "cobro_vencido_7d", admin_origen_id: adminId, coordinadora_destino_id: coordId, mensaje: "Hay cobros pendientes vencidos que requieren atención.", error: false });
  for (let i = 0; i < 12; i++) { const pac = pacientes[i]; await ins("llamadas_vapi", { paciente_id: pac.id, tipo_llamada: "recordatorio", estado: i % 4 === 3 ? "fallida" : "completada", resultado: i % 4 === 3 ? "no_contesta" : "confirmada", iniciada_at: dISO(-(i % 6)), finalizada_at: dISO(-(i % 6)), duracion_segundos: i % 4 === 3 ? 0 : 45 + i, resumen: i % 4 === 3 ? "No contestó" : "Cita confirmada por el paciente.", coste_usd: i % 4 === 3 ? 0 : 0.12 }); }
  for (let i = 0; i < 3; i++) await ins("conversaciones_copilot", { usuario_id: coordId, clinica_id: CENTRO, titulo: ["Resumen del día", "Cobros vencidos", "Leads sin contactar"][i], mensajes: "[]", mensaje_count: 2 + i, modelo_usado: "claude", activa: true, updated_at: dISO(-i), resumen: "Consulta al copiloto" });
  for (let i = 0; i < 2; i++) await ins("informes_guardados", { tipo: i === 0 ? "semanal_ia" : "noshow", clinica_id: null, periodo: mesAct, titulo: i === 0 ? "Resumen semanal" : "Informe de no-shows", contenido_json: "{}", texto_narrativo: "La conversión mejoró un 8% respecto a la semana anterior.", generado_en: dISO(-1), generado_por: "IA" });
  for (let i = 0; i < 6; i++) { const pac = pacientes[30 + i]; await ins("lista_espera", { clinica_id: pac.cid, paciente_id: pac.id, tratamiento_id: tratamientos[i % tratamientos.length].id, dias_permitidos: "LUN,MAR,MIE,JUE,VIE", estado: "ACTIVE", prioridad: ["ALTA", "MEDIA", "BAJA"][i % 3], urgencia_nivel: "MED", permite_fuera_rango: false, notas: "Quiere hueco lo antes posible." }); }

  // ── KPIs (report de coherencia — vocabulario del dinero 2026-07-23) ──
  const aceptadoTot = (await db.query("select coalesce(sum(importe),0) s from presupuestos where cliente='DEMO' and estado='ACEPTADO'")).rows[0].s;
  const cobradoTot = (await db.query("select coalesce(sum(importe),0) s from pagos_paciente where cliente='DEMO'")).rows[0].s;
  const pendiente = (await db.query("select coalesce(sum(pendiente),0) s from pacientes where cliente='DEMO'")).rows[0].s;
  const nLeads = (await db.query("select count(*) n from leads where cliente='DEMO'")).rows[0].n;
  const nConv = (await db.query("select count(*) n from leads where cliente='DEMO' and estado='Convertido'")).rows[0].n;
  // Invariante dura del seed: pendiente == aceptado − cobrado. Si no cuadra,
  // el seed está descorrelacionado y NO debe darse por bueno.
  if (Number(aceptadoTot) - Number(cobradoTot) !== Number(pendiente)) {
    throw new Error(`Seed descorrelacionado: aceptado(${aceptadoTot}) − cobrado(${cobradoTot}) ≠ pendiente(${pendiente})`);
  }

  // Invariante dura de COHERENCIA CONVERSACIONAL (cierre estadoConversacion):
  //   1) "Nuevo" = sin_conversacion puro: ni mensajes ni acciones.
  //   2) Todo lead no-Nuevo y todo presupuesto tienen hilo real.
  //   3) Los campos de card derivan del hilo: fecha_ultima_respuesta ==
  //      último Entrante del hilo del presupuesto (nunca otra cosa).
  // Si algo no cuadra, el seed NO se da por bueno (fail-closed).
  const iNuevo = (await db.query(`select count(*)::int n from leads l where cliente='DEMO' and estado='Nuevo'
    and (exists(select 1 from mensajes_whatsapp m where m.lead_id=l.id)
      or exists(select 1 from acciones_lead a where a.lead_id=l.id))`)).rows[0].n;
  const iNoNuevo = (await db.query(`select count(*)::int n from leads l where cliente='DEMO' and estado<>'Nuevo'
    and not exists(select 1 from mensajes_whatsapp m where m.lead_id=l.id)`)).rows[0].n;
  const iPres = (await db.query(`select count(*)::int n from presupuestos p where cliente='DEMO'
    and not exists(select 1 from mensajes_whatsapp m where m.presupuesto_id=p.id)`)).rows[0].n;
  const iFur = (await db.query(`select count(*)::int n from presupuestos p where cliente='DEMO'
    and p.fecha_ultima_respuesta::timestamptz is distinct from (select max(m.timestamp) from mensajes_whatsapp m
      where m.presupuesto_id=p.id and m.direccion='Entrante')`)).rows[0].n;
  const iPerd = (await db.query(`select count(*)::int n from presupuestos p where cliente='DEMO' and estado='PERDIDO'
    and not exists(select 1 from historial_acciones h where h.presupuesto_id=p.id and h.tipo='cambio_estado')`)).rows[0].n;
  if (iNuevo || iNoNuevo || iPres || iFur || iPerd) {
    throw new Error(`Seed incoherente: nuevosConConversacion=${iNuevo} · noNuevosSinHilo=${iNoNuevo} · presupuestosSinHilo=${iPres} · fechaRespuestaDescorrelacionada=${iFur} · perdidosSinHistorial=${iPerd}`);
  }

  await db.query("commit");
  console.log("\n✓ SEED RICO commit.");
  console.log(`  KPIs: aceptado(firmado)=${Number(aceptadoTot).toLocaleString("es")}€ · cobrado(pagos)=${Number(cobradoTot).toLocaleString("es")}€ · pendiente=${Number(pendiente).toLocaleString("es")}€ · conversión=${Math.round(nConv / nLeads * 100)}% (${nConv}/${nLeads})`);
} catch (e) {
  await db.query("rollback");
  console.error("✗ SEED FALLÓ (rollback):", e.message, e.detail ?? "");
  process.exit(1);
} finally { await db.end(); }
