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
//
// LAS HORAS SON DE LA CLÍNICA, no de la máquina que siembra (2026-07-29).
// `setHours(16, 30)` fija las 16:30 LOCALES de quien corre el seed; desde una
// máquina en UTC−4 eso son las 20:30 UTC, que en Madrid se leen como las 22:30.
// La demo enseñaba una clínica dental citando a las 19:30 y 21:30, que ninguna
// clínica española hace. La FECHA ya era segura (ancla a las 09:00 y ningún
// huso realista cambia el día); la hora no lo era.
const TZ_CLINICA = "Europe/Madrid";
const p2 = (n) => String(n).padStart(2, "0");
const diaEnClinica = (d) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_CLINICA, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
/** El INSTANTE cuya hora en la clínica es h:m del día de `d`.
 *  Admite h fuera de 0-23 y desborda al día siguiente, como hacía `setHours`:
 *  el seed llama con `9 + k` y k llega a pasar de 14. Sin esto, "T25:00:00Z"
 *  es una fecha inválida y el seed revienta a mitad (lo hizo). */
function aHoraClinica(d, h, m = 0) {
  // Se normaliza en MINUTOS TOTALES para que desborden tanto las horas ≥ 24 como
  // los minutos ≥ 60: el seed llama con `9 + k` (k pasa de 14) y con minutos
  // calculados. `setHours` desbordaba solo; "T10:90:00Z" es fecha inválida y el
  // seed reventaba a mitad — con rollback, pero reventaba.
  const totalMin = Math.round(h * 60 + m);
  const base = new Date(`${diaEnClinica(d)}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Math.floor(totalMin / 1440));
  const enElDia = ((totalMin % 1440) + 1440) % 1440;
  const hh = Math.floor(enElDia / 60);
  const mm = enElDia % 60;
  const aprox = new Date(`${diaEnClinica(base)}T${p2(hh)}:${p2(mm)}:00Z`);
  const off =
    new Date(aprox.toLocaleString("en-US", { timeZone: TZ_CLINICA })).getTime() -
    new Date(aprox.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(aprox.getTime() - off);
}

const HOY = new Date(); HOY.setHours(9, 0, 0, 0);
const dPlus = (n, h = 9, m = 0) => { const x = new Date(HOY); x.setDate(x.getDate() + n); return aHoraClinica(x, h, m); };
const dISO = (n) => dPlus(n).toISOString();
const fecha10 = (n) => dPlus(n).toISOString().slice(0, 10);
const nacDe = (edad, i) => { const b = new Date(HOY); b.setFullYear(HOY.getFullYear() - edad); b.setMonth((i * 7) % 12, 1 + (i * 5) % 28); return b.toISOString().slice(0, 10); };
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
// G2.6 — COHERENCIA CON LA AGENDA (el rayado «donde no toca» de la revisión
// del 30-08 eran citas sembradas fuera del horario del doctor): las citas se
// siembran DENTRO de las franjas de horarios_staff. Doctor sin franjas ese
// día → se intenta otro dentista de la clínica; ninguno trabaja → sin cita.
const horariosStaff = (await db.query("select staff_id, dia_semana, inicio, fin from horarios_staff where cliente='DEMO'")).rows;
const franjasDe = (staffId, dow) =>
  horariosStaff.filter((h) => h.staff_id === staffId && Number(h.dia_semana) === dow);
const aMinSeed = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** Doctor de la clínica que trabaje ese día + un arranque de cita (min del
 *  día, en punto o y-media) dentro de una de sus franjas; null = nadie. */
function citaEnHorario(cid, fechaJs, r) {
  const dow = fechaJs.getDay() === 0 ? 7 : fechaJs.getDay();
  const candidatos = [docEn(cid), ...dentistas.filter((d) => d.clinica_id === cid)];
  for (const doc of candidatos) {
    const franjas = franjasDe(doc.id, dow);
    if (!franjas.length) continue;
    const f = franjas[Math.floor(r * franjas.length) % franjas.length];
    const ini = aMinSeed(f.inicio);
    const fin = aMinSeed(f.fin);
    const slots = Math.max(1, Math.floor((fin - ini - 30) / 30) + 1);
    const min = ini + (Math.floor(r * 997) % slots) * 30;
    return { doc, h: Math.floor(min / 60), m: min % 60 };
  }
  return null;
}
// especialidad estable por dentista → KPI por doctor + catálogo de doctores
const ESPEC = ["Implantología", "Ortodoncia", "Endodoncia", "Estética dental", "Odontología general"];
const especPorDoc = Object.fromEntries(dentistas.map((d, i) => [d.id, ESPEC[i % ESPEC.length]]));
const especEn = (cid) => especPorDoc[docEn(cid).id] ?? "Odontología general";

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
  // historial_acciones ANTES que presupuestos: su FK bloquea el borrado del
  // presupuesto referenciado (bug latente destapado el primer wipe con filas).
  const WIPE = ["acciones_pago", "inconsistencias_pagos", "acciones_automatizacion", "secuencias_automaticas",
    "eventos_sistema", "contactos_presupuesto", "cola_envios", "mensajes_whatsapp", "llamadas_vapi",
    "lista_espera", "historial_acciones", "citas", "presupuestos", "pagos_paciente", "acciones_lead",
    "notificaciones", "alertas_enviadas", "conversaciones_copilot", "informes_guardados", "configuraciones_clinica",
    "configuracion_recordatorios", "configuracion_waba", "push_subscriptions",
    "objetivos_mensuales", "reglas_automatizacion", "configuracion_automatizaciones", "doctores_presupuestos",
    "usuarios_presupuestos", "plantillas_mensaje", "plantillas_lead", "leads", "pacientes"];
  let borradas = 0;
  for (const t of WIPE) { const r = await db.query(`delete from ${t} where cliente='DEMO'`); borradas += r.rowCount; }
  console.log(`wipe transaccional DEMO: ${borradas} filas fuera`);

  // ── WIPE de eventos_automatizacion — VÍA ADMIN, y obligatorio ─────────
  // El rol de la app solo tiene SELECT/INSERT sobre el log (append-only a
  // propósito), así que esta tabla NO puede ir en la lista de arriba. Se
  // aprendió el 2026-08-17: un `derivado` de una prueba sobrevivió al reset,
  // el semáforo lo leyó, y el agente enmudeció «sin motivo» en un hilo
  // recién sembrado. Sin la URL admin se ABORTA — un reset que deja el log
  // sucio no es un reset, es una demo que miente (§15).
  if (!process.env.SUPABASE_DB_URL_ADMIN) {
    throw new Error("Falta SUPABASE_DB_URL_ADMIN: sin ella no se puede limpiar eventos_automatizacion (append-only para la app) y el reset quedaría a medias.");
  }
  {
    const admin = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
    await admin.connect();
    try {
      const r = await admin.query(`delete from eventos_automatizacion where cliente='DEMO'`);
      console.log(`wipe admin eventos_automatizacion DEMO: ${r.rowCount} filas fuera`);
    } finally {
      await admin.end();
    }
  }

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
  const TRAT_ALTO = ["Implante unitario", "Ortodoncia invisible"]; // total ≥ 1500€
  const TRAT_BAJO = ["Corona sobre implante", "Endodoncia molar", "Blanqueamiento LED", "Limpieza dental", "Férula de descarga"];
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
  // MEJORAS 41 + 42 (2026-07-27) — el motivo es un vocabulario CERRADO de seis
  // valores (lib/leads/motivos). El seed escribía texto libre y los 158
  // descartados quedaban fuera del enum: la columna los agrupaba a todos igual y
  // el panel afirmaba "rechazó la propuesta" de quien no había asistido. Cada
  // motivo lleva su rechazo literal en el hilo, para que card y conversación
  // digan lo mismo.
  const MOTIVOS_NO = ["No_Asistio", "No_Contesta", "Horarios", "Precio", "Otra_Clinica", "Ya_No_Necesita"];
  const RECHAZO_LEAD = {
    No_Asistio: "Perdona, no pude ir al final y no avisé. Ya te escribiré más adelante.",
    No_Contesta: "",
    Horarios: "Con mis horarios me es imposible ir, lo tenemos que dejar.",
    Precio: "Ahora mismo se me va de presupuesto. ¡Gracias!",
    Otra_Clinica: "Al final me lo voy a hacer en otra clínica que me sale más barato. Gracias de todas formas.",
    Ya_No_Necesita: "Ya me lo he resuelto por otro lado, muchas gracias.",
  };
  const MOTIVO_ENUM = Object.fromEntries(MOTIVOS_NO.map((m) => [m, m]));
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
      // Un "no asistió" tuvo cita: sin ella la ficha se contradice sola.
      if (motivoNo === "No_Asistio") {
        fechaCita = dh(-5, 10).slice(0, 10);
        horaCita = "10:00";
      }
      guion.push({ dir: "Saliente", ts: dh(-6, 10), txt: `Hola ${primer}, ¿pudiste valorar lo que hablamos sobre ${tratLow}?` });
      if (motivoNo === "No_Contesta") {
        // Coherencia: "no contesta" NO puede tener un entrante en el hilo.
        guion.push({ dir: "Saliente", ts: dh(-3, 11), txt: `${primer}, te escribo por si te ayudo con alguna duda 😊` });
      } else {
        guion.push({ dir: "Entrante", ts: dh(-5, 12), txt: RECHAZO_LEAD[motivoNo], intn: "No interesado" });
        guion.push({ dir: "Saliente", ts: dh(-5, 13), txt: "Entendido, gracias por avisar 😊 Aquí nos tienes si cambias de idea." });
      }
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
      motivo_no_interes: motivoNo ? MOTIVO_ENUM[motivoNo] : null,
      // MEJORAS 37 — los cerrados llevan su fecha de cierre real (la del hilo).
      fecha_cierre: est === "No Interesado" ? dh(-5, 13) : est === "Convertido" ? dh(-6, 10) : null,
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
        lead_id: lid, telefono: telLead, clinica_id: cid, direccion: m.dir, contenido: m.txt,
        timestamp: m.ts, fuente: "Modo_A_manual", procesado_por_ia: m.dir === "Entrante",
        intencion_detectada: m.intn ?? null,
        // 018 — la autoría. En modo A el saliente lo manda una persona; el
        // texto es de plantilla, no de la IA. Sembrarlo en NULL dejaría la
        // pestaña «Ha respondido el agente» de la bandeja midiendo el vacío.
        autor: m.dir === "Saliente" ? "persona" : null,
        sugerido_por_ia: m.dir === "Saliente" ? false : null,
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
  // MEJORAS 46 — la PRESENTACIÓN se reparte hacia atrás; la CONVERSACIÓN no se
  // mueve. Eran la misma variable (`altaOff`) y por eso los 28 casos vivos
  // nacían todos en las últimas dos semanas: la serie mensual de presentados
  // daba 15 → 48 (+220%) y cualquier comparativa de la cabecera o de /red se
  // leía absurda aunque la fórmula fuese correcta.
  //
  // Se separan porque son dos hechos distintos: "cuándo se presentó" y "de qué
  // se ha hablado últimamente". Un presupuesto presentado hace seis semanas cuya
  // conversación está viva HOY no es un artificio del seed — es exactamente el
  // caso que el producto existe para rescatar, y era el que faltaba.
  //
  // Reparto determinista en las últimas 8 semanas, con la garantía dura de que
  // la presentación NUNCA es posterior al primer mensaje del hilo (un
  // presupuesto no puede tener conversación antes de existir).
  // Reparto PONDERADO por mes, no uniforme: en una clínica real los
  // presupuestos antiguos ya están casi todos decididos, así que la cartera
  // abierta pesa hacia los meses recientes. 40 % este mes · 30 % el anterior ·
  // 20 % · 10 %. Determinista (sin azar) para que `demo:reset` sea reproducible.
  const diaDelMes = HOY.getDate();
  // El peso del MES EN CURSO se escala por los días transcurridos (d/30).
  // Sin esto, el 40 % de la cartera caía entera en los días 1..hoy y la
  // invariante C (mismo TRAMO contra el mes anterior) daba ratio 40/d — el
  // seed solo pasaba a final de mes y reventaba cualquier día antes del 20.
  // Escalado, el ratio del tramo es 0,4/0,3 = 1,33 constante, corras el día
  // que corras (§13: la misma lección del umbral, en el propio seed — dos
  // decisiones correctas por separado que se contradecían por fecha).
  const PESOS_REPARTO = [0.4 * Math.min(1, diaDelMes / 30), 0.3, 0.2, 0.1];
  const SUMA_PESOS = PESOS_REPARTO.reduce((a, b) => a + b, 0);
  /** Offsets en días, uno por caso abierto, repartidos dentro de cada mes. */
  function calendarioReparto(total) {
    const offs = [];
    let arrastre = 0; // casos que no caben en el mes en curso
    for (let m = 0; m < PESOS_REPARTO.length; m++) {
      // Días disponibles del mes m hacia atrás: el mes en curso solo llega a hoy.
      const inicio = m === 0 ? 0 : -(diaDelMes + 30 * (m - 1));
      const largo = m === 0 ? diaDelMes : 30;
      let cuantos = Math.max(1, Math.round((total * PESOS_REPARTO[m]) / SUMA_PESOS)) + arrastre;
      arrastre = 0;
      // Si el mes en curso NO tiene días donde repartir (correr `demo:reset` el
      // día 1, o el 2), su cuota se arrastra al mes anterior en vez de apilar
      // catorce casos en la misma fecha — que es exactamente el defecto que esto
      // viene a arreglar, reproducido en un solo día.
      if (m === 0 && cuantos > largo) {
        arrastre = cuantos - largo;
        cuantos = largo;
      }
      for (let i = 0; i < cuantos; i++) {
        offs.push(inicio - Math.round(((i + 0.5) * (largo - 1)) / cuantos));
      }
    }
    return offs;
  }
  const OFFS_REPARTO = calendarioReparto(EST_PRES.reduce((a, [, n]) => a + n, 0));
  let nReparto = 0;
  const presentOffDe = (anclaConversacion) => {
    const off = OFFS_REPARTO[nReparto++ % OFFS_REPARTO.length];
    // Garantía dura: la presentación NUNCA es posterior al primer mensaje del
    // hilo — un presupuesto no puede tener conversación antes de existir.
    return Math.min(off, anclaConversacion);
  };

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
      // La presentación se reparte TAMBIÉN en los cerrados: su fecha de CIERRE
      // no se toca —es la que alimenta "Firmado este mes" y los deltas de
      // aceptados/perdidos, que ya eran correctos— pero presentarse y cerrarse
      // son dos fechas distintas, y un presupuesto presentado en junio y
      // aceptado en julio es lo NORMAL, no un artificio. Dejarlos anclados al
      // mes en curso era la otra mitad del escalón de MEJORAS 46.
      //
      // Dos garantías duras, en este orden: la presentación va antes del primer
      // mensaje del hilo (no hay conversación antes de existir) y antes del
      // cierre (no se cierra lo que no se ha presentado).
      const primerMsg = guion.length
        ? Math.round((new Date(guion[0].ts) - dPlus(0)) / 86_400_000)
        : altaOff;
      const cierreOff = fechaAceptado
        ? Math.round((new Date(`${fechaAceptado}T12:00:00Z`) - dPlus(0)) / 86_400_000)
        : fechaPerdida
          ? Math.round((new Date(fechaPerdida) - dPlus(0)) / 86_400_000)
          : 0;
      const presentOff = presentOffDe(Math.min(altaOff, primerMsg, cierreOff));
      const lastEnt = [...guion].reverse().find((m) => m.dir === "Entrante") ?? null;
      const lastMsg = guion[guion.length - 1];
      const salientes = guion.filter((m) => m.dir === "Saliente");
      const pid = await ins("presupuestos", {
        paciente_id: pac.id, clinica_id: pac.cid, tratamiento_nombre: tnom, estado, importe,
        fecha_alta: fecha10(presentOff), fecha: fecha10(presentOff),
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
          paciente_id: pac.id, presupuesto_id: pid, telefono: pac.tel, clinica_id: pac.cid, direccion: m.dir,
          contenido: m.txt, timestamp: m.ts, fuente: "Modo_A_manual", procesado_por_ia: m.dir === "Entrante",
          intencion_detectada: m.intn ?? null,
          autor: m.dir === "Saliente" ? "persona" : null,
          sugerido_por_ia: m.dir === "Saliente" ? false : null,
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
    const x = new Date(HOY); x.setMonth(x.getMonth() - mesesAtras); x.setDate(dia);
    return aHoraClinica(x, h);
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
    const iso = (d, hh, mm = 0) => aHoraClinica(d, hh, mm).toISOString();
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
        paciente_id: pac.id, presupuesto_id: pid, telefono: pac.tel, clinica_id: pac.cid, direccion: m.dir,
        contenido: m.txt, timestamp: m.ts, fuente: "Modo_A_manual", procesado_por_ia: m.dir === "Entrante",
        intencion_detectada: m.intn ?? null,
        // 018 — la autoría. En modo A el saliente lo manda una persona; el
        // texto es de plantilla, no de la IA. Sembrarlo en NULL dejaría la
        // pestaña «Ha respondido el agente» de la bandeja midiendo el vacío.
        autor: m.dir === "Saliente" ? "persona" : null,
        sugerido_por_ia: m.dir === "Saliente" ? false : null,
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
    const iso = (d, hh) => aHoraClinica(d, hh).toISOString();
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
        paciente_id: pac.id, presupuesto_id: pid, telefono: pac.tel, clinica_id: pac.cid, direccion: m.dir,
        contenido: m.txt, timestamp: m.ts, fuente: "Modo_A_manual", procesado_por_ia: m.dir === "Entrante",
        intencion_detectada: m.intn ?? null,
        // 018 — la autoría. En modo A el saliente lo manda una persona; el
        // texto es de plantilla, no de la IA. Sembrarlo en NULL dejaría la
        // pestaña «Ha respondido el agente» de la bandeja midiendo el vacío.
        autor: m.dir === "Saliente" ? "persona" : null,
        sugerido_por_ia: m.dir === "Saliente" ? false : null,
      });
      mensajesN++;
    }
  }
  console.log(`presupuestos: ${presupuestos.length} (hilos: ${mensajesN} mensajes, con histórico 6 meses)`);

  // ── DOCTORES (catálogo de presupuestos: nombre + especialidad) ───────
  // Con la tabla poblada, el selector de doctor y el KPI por especialidad
  // dejan de derivarse por fallback y muestran la plantilla real.
  for (const d of dentistas) await ins("doctores_presupuestos", { nombre: d.nombre, especialidad: especPorDoc[d.id] ?? "Odontología general", activo: true, clinica_id: d.clinica_id });
  console.log(`doctores_presupuestos: ${dentistas.length}`);

  // ── CITAS (28): hoy/mañana/semana/pasadas ────────────────────────────
  // 031: No_show es estado propio del vocabulario — el prefijo [NO_SHOW] en
  // notas murió con la migración (la nota humana se queda).
  const citasPlan = [[0, 6, "Confirmada"], [1, 5, "Confirmada"], [3, 4, "Programada"], [4, 3, "Programada"],
    [-2, 4, "Completado"], [-5, 3, "Completado"], [-3, 3, "No_show"]];
  // 034 — quién confirmó. Los pacientes[0..11] con llamada de voz «confirmada»
  // (se siembran más abajo, i%4!==3) confirmaron por el AGENTE DE VOZ; el
  // resto alterna recordatorio/persona. Coherente con las llamadas sembradas.
  const confirmoVoz = new Set(pacientes.slice(0, 12).filter((_, i) => i % 4 !== 3).map((p) => p.id));
  const confirmadaPor = (pacId, n) => (confirmoVoz.has(pacId) ? "agente_voz" : n % 2 === 0 ? "recordatorio" : "persona");
  let nc = 0; let citasN = 0;
  for (const [off, cnt, estado] of citasPlan) {
    for (let k = 0; k < cnt; k++) {
      const pac = pacientes[nc % pacientes.length]; nc++;
      const trat = tratamientos[nc % tratamientos.length];
      // G2.6: dentro del horario real del doctor; sin doctor ese día, sin cita.
      const hueco = citaEnHorario(pac.cid, dPlus(off), (nc * 0.137) % 1);
      if (!hueco) continue;
      await ins("citas", {
        nombre: pac.nombre, hora_inicio: dPlus(off, hueco.h, hueco.m).toISOString(), hora_final: dPlus(off, hueco.h, hueco.m + 30).toISOString(),
        estado, notas: estado === "No_show" ? "No se presentó." : null, origen: "Coordinación",
        confirmada_por: estado === "Confirmada" ? confirmadaPor(pac.id, nc) : null,
        // 032: el seed simula la agenda que la clínica YA tenía en su
        // software — 'importado', no 'fyllio': la lista «pendientes de pasar»
        // es SOLO para lo que nace en Fyllio.
        origen_sistema: "importado",
        paciente_id: pac.id, tratamiento_id: trat.id, profesional_id: hueco.doc.id, sillon_id: silEn(pac.cid).id, clinica_id: pac.cid,
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

  // ════════════════════════════════════════════════════════════════════
  // CAPA DE VOLUMEN (MEJORAS nº 31, 2026-07-24) — la red de 4 clínicas con
  // 6 meses de historia: cientos de leads con forma mensual creíble,
  // decenas de presupuestos por clínica, pagos que pueblan los TRES buckets
  // de Cobros y agenda casi llena. Reglas:
  //   · Determinista (LCG, cero Math.random): resembrar re-ancla idéntico.
  //   · Se integra en las MISMAS estructuras del seed narrativo (pacientes,
  //     presupuestos, pagadoPorPaciente) → el backfill financiero y TODAS
  //     las invariantes duras del final cubren también el volumen.
  //   · El volumen histórico llega CERRADO (Convertido/No Interesado,
  //     ACEPTADO/PERDIDO): las colas de hoy las gobierna el seed narrativo,
  //     que es quien cuida la coherencia conversacional fina.
  //   · Los presupuestos de volumen usan SOLO pacientes de volumen: el
  //     dinero curado de los pacientes narrativos (Clara Rey, etc.) no se toca.
  // ════════════════════════════════════════════════════════════════════
  {
    // RNG determinista (LCG) — jitter reproducible.
    let rngS = 42;
    const rnd = () => ((rngS = (rngS * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const jit = (base, spread) => base + Math.floor(rnd() * (2 * spread + 1)) - spread;

    // insert por lotes (~2.800 citas y ~900 mensajes no van fila a fila).
    async function insMany(tabla, rows) {
      const ids = [];
      if (!rows.length) return ids;
      const cols = ["cliente", ...Object.keys(rows[0])];
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const vals = []; const ph = [];
        chunk.forEach((row, r) => {
          const rowVals = ["DEMO", ...cols.slice(1).map((c) => row[c] ?? null)];
          ph.push(`(${rowVals.map((_, c) => `$${vals.length + c + 1}`).join(",")})`);
          vals.push(...rowVals);
        });
        const res = await db.query(
          `insert into ${tabla} (${cols.join(",")}) values ${ph.join(",")} returning id`, vals);
        for (const r of res.rows) ids.push(r.id);
      }
      return ids;
    }

    const VCLIS = [CENTRO, CENTRO, CENTRO, NORTE, NORTE, SUR, SUR, ESTE]; // Centro flagship
    const dOffISO = (dias, h = 10, m = 0) => dPlus(-dias, h, m).toISOString();
    const iso10 = (d) => d.toISOString().slice(0, 10);
    const enHora = (d, h, m = 0) => aHoraClinica(d, h, m).toISOString();
    const diasAntes = (d, n) => { const x = new Date(d); x.setDate(x.getDate() - n); return x; };
    // Fecha ANCLADA al mes de calendario `mesesAtras` (día con jitter). Para
    // el mes actual se acota a [1, hoy]: la invariante de serie mensual no
    // puede romperse por correr demo:reset el día 1 del mes.
    const mesDia = (mesesAtras, h = 10) => {
      const x = new Date(HOY);
      x.setDate(1); x.setMonth(x.getMonth() - mesesAtras);
      const tope = mesesAtras === 0 ? Math.max(1, HOY.getDate() - 2) : 27;
      x.setDate(1 + Math.floor(rnd() * tope));
      return aHoraClinica(x, h);
    };
    // Ningún timestamp del volumen puede quedar en el futuro (borde: reset a
    // primera hora en los días 1-2 del mes).
    const nowIso = new Date().toISOString();
    const tsSafe = (iso) => (iso > nowIso ? hAgo(1) : iso);
    const clampGuion = (guion) => { for (const g of guion) g.ts = tsSafe(g.ts); return guion; };

    // nombres únicos generados (no chocan con los narrativos)
    const PILA = ["Aitana", "Bruno", "Candela", "Darío", "Estela", "Fabio", "Gemma", "Héctor", "Inés", "Jon",
      "Leire", "Manel", "Nadia", "Otto", "Perla", "Quique", "Rocco", "Salma", "Telmo", "Uxía", "Valeria",
      "Wenceslao", "Ximena", "Yago", "Zaira", "Abril", "Biel", "Carla", "Dídac", "Elsa", "Ferran", "Gala"];
    const APE = ["Alarcón", "Bustos", "Cifuentes", "Dueñas", "Escudero", "Fajardo", "Garrido", "Hidalgo",
      "Izquierdo", "Jurado", "Lozano", "Maldonado", "Noguera", "Olmedo", "Peñalver", "Quirós", "Riquelme",
      "Saavedra", "Tordesillas", "Urrutia", "Valbuena", "Zabala", "Arenas", "Barrios", "Cordero", "Dávila"];
    const usados = new Set(pacientes.map((p) => p.nombre));
    let nomSeq = 0;
    const nombreNuevo = () => {
      for (;;) {
        const n = `${PILA[nomSeq % PILA.length]} ${APE[Math.floor(nomSeq / PILA.length + nomSeq) % APE.length]}`;
        nomSeq++;
        if (!usados.has(n)) { usados.add(n); return n; }
      }
    };

    // ── PACIENTES de volumen (pool para presupuestos, citas y conversiones) ──
    const NUM_PAC_VOL = 120;
    const pacVolRows = [];
    for (let i = 0; i < NUM_PAC_VOL; i++) {
      const cid = VCLIS[i % VCLIS.length];
      const nombre = nombreNuevo();
      const alta = mesDia(5 - Math.floor(i / (NUM_PAC_VOL / 6)), 9); // repartidos en 6 meses
      pacVolRows.push({
        nombre, telefono: tel(), email: `${nombre.toLowerCase().replace(/[^a-z]/g, ".")}@email.com`,
        clinica_id: cid, doctor_id: docEn(cid).id, canal_origen: CANALES[i % CANALES.length],
        canal_preferido: i % 3 === 0 ? "Llamada" : "WhatsApp", consentimiento_whatsapp: true,
        edad: 20 + (i * 7 % 58), activo: true, created_at: alta.toISOString(),
      });
    }
    const pacVolIds = await insMany("pacientes", pacVolRows);
    const pacsVol = pacVolIds.map((id, i) => ({
      id, nombre: pacVolRows[i].nombre, cid: pacVolRows[i].clinica_id, tel: pacVolRows[i].telefono,
    }));
    pacientes.push(...pacsVol); // ← entran en el backfill financiero y el report
    let pacVolIdx = 0;
    const pacVolNext = () => pacsVol[pacVolIdx++ % pacsVol.length];

    // ── LEADS de volumen: forma mensual creíble, histórico CERRADO ───────
    // Por mes (5 atrás → mes actual): variación real, no rampa.
    const LEADS_MES = [34, 41, 37, 46, 52, 20];
    const CONV_SHARE = [0.29, 0.32, 0.27, 0.33, 0.30, 0.30];
    const leadRows = []; const leadMeta = [];
    for (let m = 0; m < LEADS_MES.length; m++) {
      const mesesAtras = 5 - m;
      const n = LEADS_MES[m];
      const nConvMes = Math.round(n * CONV_SHARE[m]);
      // Mes actual: además de cerrados, entran NUEVOS sin llamar (la realidad
      // de una red con captación viva; el resto de estados vivos los pone el
      // seed narrativo con su coherencia fina).
      const nNuevos = mesesAtras === 0 ? 8 : 0;
      for (let k = 0; k < n; k++) {
        const cid = VCLIS[(m * 7 + k) % VCLIS.length];
        const estado = k < nNuevos ? "Nuevo" : k < nNuevos + nConvMes ? "Convertido" : "No Interesado";
        const trat = TRATS_INT[(m + k) % TRATS_INT.length];
        // Creado ANCLADO a su mes de calendario; la conversación concluye
        // 1-2 días después (mensajes fuera del mes no rompen nada).
        const creado = mesDia(mesesAtras, 9);
        const conv = estado === "Convertido";
        const pacConv = conv ? pacVolNext() : null;
        const nombre = conv ? pacConv.nombre : nombreNuevo();
        const telL = conv ? pacConv.tel : tel();
        const motivoNo = estado === "No Interesado" ? MOTIVOS_NO[(m + k) % MOTIVOS_NO.length] : null;
        let cierre = new Date(creado); cierre.setDate(cierre.getDate() + 1);
        if (cierre > new Date()) cierre = creado; // hoy: se cierra en el día (10h→11h→12h)
        const guion = estado === "Nuevo" ? [] : [
          { dir: "Saliente", ts: enHora(creado, 10), txt: `Hola ${nombre.split(" ")[0]}, soy del equipo de la clínica 😊 Nos dejaste tus datos interesándote por ${trat.toLowerCase()}. ¿Hablamos por aquí?` },
          conv
            ? { dir: "Entrante", ts: enHora(cierre, 11), txt: "Sí, me interesa. ¿Cuándo puedo ir?", intn: "Interesado" }
            : motivoNo === "No_Contesta"
              ? { dir: "Saliente", ts: enHora(cierre, 11), txt: `${nombre.split(" ")[0]}, te escribo por si te ayudo con alguna duda 😊` }
              : { dir: "Entrante", ts: enHora(cierre, 11), txt: RECHAZO_LEAD[motivoNo], intn: "No interesado" },
          conv
            ? { dir: "Saliente", ts: enHora(cierre, 12), txt: `¡Hecho, ${nombre.split(" ")[0]}! Ya tienes tu ficha con nosotros; seguimos por aquí para lo que necesites.` }
            : { dir: "Saliente", ts: enHora(cierre, 12), txt: "Entendido, gracias por avisar 😊 Aquí nos tienes si cambias de idea." },
        ];
        clampGuion(guion);
        const lastEnt = guion.find((x) => x.dir === "Entrante") ?? null;
        leadRows.push({
          nombre, telefono: telL, tratamiento_interes: trat, canal_captacion: CANALES[(m + k) % CANALES.length],
          estado, clinica_id: cid, doctor_asignado_id: docEn(cid).id, tipo_visita: "Primera visita",
          llamado: false, whatsapp_enviados: guion.filter((x) => x.dir === "Saliente").length,
          motivo_no_interes: motivoNo ? MOTIVO_ENUM[motivoNo] : null,
          // MEJORAS 37 — el cierre del lead de volumen es el del guion.
          fecha_cierre: estado === "Nuevo" ? null : enHora(cierre, 12),
          intencion_detectada: lastEnt?.intn ?? null,
          convertido_a_paciente: conv, paciente_id: conv ? pacConv.id : null,
          ultima_accion: guion.length ? "WhatsApp_Saliente" : null,
          created_at: creado.toISOString(),
        });
        leadMeta.push({ guion, telefono: telL, cid });
      }
    }
    const leadVolIds = await insMany("leads", leadRows);
    const msgVolRows = []; const accVolRows = [];
    leadVolIds.forEach((lid, i) => {
      const { guion, telefono, cid } = leadMeta[i];
      const lastSal = [...guion].reverse().find((x) => x.dir === "Saliente");
      if (lastSal) accVolRows.push({ lead_id: lid, tipo_accion: "WhatsApp_Saliente", resumen: "WhatsApp enviado", timestamp: lastSal.ts, detalles: "Mensaje enviado desde el panel." });
      // Claves homogéneas: insMany toma las columnas de la PRIMERA fila del
      // lote — todos los mensajes llevan los tres vínculos (con null).
      for (const g of guion) msgVolRows.push({
        lead_id: lid, paciente_id: null, presupuesto_id: null, clinica_id: cid,
        telefono, direccion: g.dir, contenido: g.txt, timestamp: g.ts,
        fuente: "Modo_A_manual", procesado_por_ia: g.dir === "Entrante", intencion_detectada: g.intn ?? null,
        // La invariante de autoría (b005c80) aplica también al volumen: sin
        // esto, demo:reset revienta — llevaba roto desde el 11-08 sin correrse.
        autor: g.dir === "Saliente" ? "persona" : null, sugerido_por_ia: g.dir === "Saliente" ? false : null,
      });
    });
    await insMany("acciones_lead", accVolRows);

    // ── PRESUPUESTOS de volumen ──────────────────────────────────────────
    // Especiales de Cobros (offsets exactos en días, plazo global 90):
    //   VENCIDO   → aceptado hace >97d con señal parcial sin liquidación
    //   POR_VENCER→ aceptado hace 83-89d con señal parcial
    //   ESTANCADO → aceptado hace 35-70d, >2.000€ y CERO pagos
    // Más liquidados por mes (serie de cobrado con forma), perdidos por mes
    // (con historial: el dashboard deriva la fecha de pérdida de ahí) y unos
    // pocos abiertos recientes.
    // Cada especial lleva su fecha `base`: los de bucket con OFFSET EXACTO
    // en días (la regla de vencimiento es relativa a hoy); los de serie
    // mensual ANCLADOS al mes de calendario (la serie no depende del día en
    // que se corra demo:reset).
    const espec = [];
    const IMP_VENC = [2400, 3100, 1800, 4200, 2700, 3600, 2100];
    IMP_VENC.forEach((imp, i) => espec.push({ tipo: "vencido", base: dPlus(-(100 + i * 9)), importe: imp, pct: [0.4, 0.35, 0.5, 0.45, 0.3, 0.4, 0.5][i] }));
    const IMP_PV = [1600, 3400, 950, 2800, 1900, 3200];
    IMP_PV.forEach((imp, i) => espec.push({ tipo: "por_vencer", base: dPlus(-(83 + i)), importe: imp, pct: i % 2 ? 0.5 : 0.4 }));
    const IMP_EST = [2600, 3800, 2200, 4800, 3100];
    IMP_EST.forEach((imp, i) => espec.push({ tipo: "estancado", base: dPlus(-[36, 45, 52, 60, 68][i]), importe: imp, pct: 0 }));
    // Liquidados mismo mes — la serie mensual de cobrado (forma con dips).
    const LIQ_MES = [[5, 2080], [6, 2300], [4, 2225], [7, 2314], [5, 2220], [3, 2333]]; // [n, importe medio] m5→m0
    LIQ_MES.forEach(([n, media], m) => {
      for (let k = 0; k < n; k++) espec.push({ tipo: "liquidado", base: mesDia(5 - m), importe: jit(media, 900), pct: 1 });
    });
    // Señales recientes normales (ni vencidas ni estancadas).
    [1450, 2050, 980].forEach((imp, i) => espec.push({ tipo: "parcial_reciente", base: dPlus(-(6 + i * 4)), importe: imp, pct: 0.5 }));
    // Perdidos por mes (con motivo + historial).
    const PERD_MES = [3, 4, 3, 5, 4, 2];
    PERD_MES.forEach((n, m) => {
      for (let k = 0; k < n; k++) espec.push({ tipo: "perdido", base: mesDia(5 - m), importe: jit(1500, 800) });
    });
    // Abiertos recientes (en espera <48h — no ensucian "pendiente_responder").
    [1200, 2600, 800, 1750].forEach((imp, i) => espec.push({ tipo: "abierto", base: dPlus(-1), importe: imp, horas: 8 + i * 7 }));

    // Motivos de pérdida del volumen: SOLO los que tienen frase de rechazo
    // (el hilo y el motivo registrado no pueden contradecirse).
    const MOTIVOS_PERD_VOL = ["Precio", "Se fue a otra clínica", "Cambió de opinión"];
    const presVolRows = []; const presVolMeta = [];
    for (const e of espec) {
      const pac = pacVolNext();
      const primer = pac.nombre.split(" ")[0];
      const [tnom] = TRAT_PRES[(presVolRows.length * 3) % TRAT_PRES.length];
      const tratLow = tnom.toLowerCase();
      const impTxt = `${e.importe.toLocaleString("es-ES")}€`;
      const abierto = e.tipo === "abierto";
      const perdido = e.tipo === "perdido";
      const aceptado = !abierto && !perdido;
      const fechaAceptado = aceptado ? iso10(e.base) : null;
      const alta = diasAntes(e.base, 2);
      const motivoPerd = perdido ? MOTIVOS_PERD_VOL[presVolRows.length % MOTIVOS_PERD_VOL.length] : null;
      const guion = abierto
        ? [{ dir: "Saliente", ts: hAgo(e.horas), txt: `Hola ${primer}, aquí tienes el presupuesto de ${tratLow} (${impTxt}). Cualquier duda me preguntas 😊` }]
        : perdido
          ? [
              { dir: "Saliente", ts: enHora(diasAntes(e.base, 1), 10), txt: `Hola ${primer}, ¿qué te pareció el presupuesto de ${tratLow} (${impTxt})?` },
              { dir: "Entrante", ts: enHora(e.base, 12), txt: RECHAZO_PRES[motivoPerd], intn: "Rechaza" },
              { dir: "Saliente", ts: enHora(e.base, 13), txt: "Entendido, gracias por decírnoslo. Si en algún momento quieres retomarlo, aquí nos tienes 😊" },
            ]
          : [
              { dir: "Saliente", ts: enHora(alta, 10), txt: `Hola ${primer}, ¿has podido pensar sobre el presupuesto de ${tratLow} (${impTxt})?` },
              { dir: "Entrante", ts: enHora(e.base, 11), txt: "Sí, lo hemos decidido: ¡adelante! ¿Cómo lo hacemos?", intn: "Acepta sin condiciones" },
              { dir: "Saliente", ts: enHora(e.base, 12), txt: `¡Enhorabuena, ${primer}! 🎉 Te llamamos hoy para cerrar la primera cita y el pago. Bienvenido/a.` },
            ];
      clampGuion(guion);
      const lastEnt = [...guion].reverse().find((x) => x.dir === "Entrante") ?? null;
      const lastMsg = guion[guion.length - 1];
      const salientes = guion.filter((x) => x.dir === "Saliente");
      presVolRows.push({
        paciente_id: pac.id, clinica_id: pac.cid, tratamiento_nombre: tnom,
        estado: abierto ? "PRESENTADO" : perdido ? "PERDIDO" : "ACEPTADO",
        importe: e.importe, fecha_alta: iso10(alta), fecha: iso10(alta),
        fecha_aceptado: fechaAceptado, doctor: docEn(pac.cid).nombre,
        tipo_paciente: "Nuevo", tipo_visita: "Primera visita", paciente_telefono: pac.tel,
        contact_count: salientes.length,
        motivo_perdida: motivoPerd, motivo_perdida_texto: perdido ? lastEnt?.txt ?? null : null,
        fase_seguimiento: abierto ? "Esperando respuesta" : "Cerrado",
        ultima_accion_registrada: lastMsg.ts, ultimo_contacto: lastMsg.ts.slice(0, 10),
        tipo_ultima_accion: lastMsg.dir === "Saliente" ? "WhatsApp enviado" : "Mensaje recibido",
        fecha_ultima_respuesta: lastEnt?.ts ?? null,
        ultima_respuesta_paciente: lastEnt?.txt ?? null,
        intencion_detectada: lastEnt?.intn ?? null,
        urgencia_intervencion: abierto ? "BAJO" : "NINGUNO",
        accion_sugerida: abierto ? "Enviar recordatorio si no responde" : null,
      });
      presVolMeta.push({ e, pac, guion, fechaAceptado });
    }
    const presVolIds = await insMany("presupuestos", presVolRows);
    const histVolRows = []; const contVolRows = []; const pagoVolRows = []; const pagoVolMeta = [];
    presVolIds.forEach((pid, i) => {
      const { e, pac, guion, fechaAceptado } = presVolMeta[i];
      presupuestos.push({ id: pid, estado: presVolRows[i].estado, importe: e.importe, pac, fechaAceptado, guion });
      for (const g of guion) msgVolRows.push({
        lead_id: null, paciente_id: pac.id, presupuesto_id: pid, telefono: pac.tel, clinica_id: pac.cid, direccion: g.dir,
        contenido: g.txt, timestamp: g.ts, fuente: "Modo_A_manual",
        procesado_por_ia: g.dir === "Entrante", intencion_detectada: g.intn ?? null,
        autor: g.dir === "Saliente" ? "persona" : null, sugerido_por_ia: g.dir === "Saliente" ? false : null,
      });
      for (const g of guion.filter((x) => x.dir === "Saliente")) contVolRows.push({
        presupuesto_id: pid, tipo_contacto: "WhatsApp", resultado: "Enviado", fecha_hora: g.ts,
        nota: "Mensaje del hilo de WhatsApp.", registrado_por: "Coordinación", mensaje_ia_usado: true, tono_usado: "cercano",
      });
      if (presVolRows[i].estado === "PERDIDO") histVolRows.push({
        presupuesto_id: pid, tipo: "cambio_estado", descripcion: "Estado cambiado a PERDIDO",
        metadata: JSON.stringify({ estadoNuevo: "PERDIDO" }), registrado_por: "Coordinación",
        fecha: tsSafe(enHora(e.base, 14)),
      });
      // Pagos: liquidación completa, señal parcial (vencidos/por vencer) o
      // NADA (estancados — esa ausencia es lo que los define).
      if (presVolRows[i].estado === "ACEPTADO" && e.pct > 0) {
        const importe = Math.round(e.importe * e.pct);
        pagoVolRows.push({
          paciente_id: pac.id, importe, fecha_pago: fechaAceptado,
          metodo: ["Tarjeta", "Efectivo", "Transferencia", "Financiación"][i % 4],
          tipo: e.pct < 1 ? "Senal" : "Liquidacion",
          resumen: `Pago de ${pac.nombre}`,
          nota: e.pct < 1 ? "Señal al aceptar el presupuesto; resto pendiente." : "Liquidación completa al aceptar.",
        });
        pagoVolMeta.push({ pacId: pac.id, importe, fechaAceptado, nombre: pac.nombre });
      }
    });
    await insMany("mensajes_whatsapp", msgVolRows);
    await insMany("contactos_presupuesto", contVolRows);
    await insMany("historial_acciones", histVolRows);
    const pagoVolIds = await insMany("pagos_paciente", pagoVolRows);
    await insMany("acciones_pago", pagoVolIds.map((pid, i) => ({
      pago_id: pid, tipo: "Crear", fecha: `${pagoVolMeta[i].fechaAceptado}T10:00:00.000Z`,
      importe_antes: null, importe_despues: pagoVolMeta[i].importe,
      resumen: `Alta de pago · ${pagoVolMeta[i].nombre}`, nota_cambio: "Registrado por coordinación.",
    })));
    for (const pm of pagoVolMeta) pagadoPorPaciente.set(pm.pacId, (pagadoPorPaciente.get(pm.pacId) ?? 0) + pm.importe);

    // ── AGENDA: ~6 meses casi llenos + próximas 2 semanas ────────────────
    // Días laborables; carga diaria por clínica con jitter (y algún día flojo).
    const CARGA = new Map([[CENTRO, 7], [NORTE, 5], [SUR, 5], [ESTE, 4]]);
    const citaVolRows = [];
    for (let off = -182; off <= 10; off++) {
      const d = dPlus(off);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue; // fin de semana
      for (const cid of [CENTRO, NORTE, SUR, ESTE]) {
        const flojo = rnd() < 0.06; // un ~6% de días flojos (vacaciones, festivo local)
        const n = Math.max(1, flojo ? 2 : jit(CARGA.get(cid), 1));
        for (let k = 0; k < n; k++) {
          const pac = pacientes[Math.floor(rnd() * pacientes.length)];
          const trat = tratamientos[Math.floor(rnd() * tratamientos.length)];
          const pasada = off < 0;
          const r = rnd();
          // 031: No_show es estado propio (~2/3 de las que antes eran
          // "Cancelado + [NO_SHOW]" en notas).
          const noShow = pasada && r >= 0.87 && r < 0.845 + 0.087;
          const estado = !pasada
            ? (r < 0.6 ? "Confirmada" : "Programada")
            : r < 0.87 ? "Completado" : noShow ? "No_show" : "Cancelado";
          // G2.6: dentro del horario real del doctor; nadie trabaja → sin cita.
          const hueco = citaEnHorario(cid, d, rnd());
          if (!hueco) continue;
          // 031: agendada_en = cuándo se reservó. Para el histórico sembrado
          // es el mismo instante retroactivo que created_at — el factor de
          // antelación del predictor lee esto, no un default de hoy.
          const reservadaEn = dPlus(Math.min(off - 3, -1), 9).toISOString();
          citaVolRows.push({
            nombre: pac.nombre, hora_inicio: dPlus(off, hueco.h, hueco.m).toISOString(),
            hora_final: dPlus(off, hueco.h, hueco.m + 30).toISOString(), estado,
            confirmada_por: estado === "Confirmada" ? confirmadaPor(pac.id, k) : null,
            notas: noShow ? "No se presentó." : null, origen: "Coordinación",
            origen_sistema: "importado", // 032: agenda preexistente, no nacida en Fyllio
            paciente_id: pac.id, tratamiento_id: trat.id, profesional_id: hueco.doc.id,
            sillon_id: silEn(cid).id, clinica_id: cid, created_at: reservadaEn, agendada_en: reservadaEn,
          });
        }
      }
    }
    await insMany("citas", citaVolRows);
    console.log(`VOLUMEN: +${pacsVol.length} pacientes · +${leadVolIds.length} leads · +${presVolIds.length} presupuestos · +${pagoVolIds.length} pagos · +${citaVolRows.length} citas · +${msgVolRows.length} mensajes`);
  }

  // ── BACKFILL financiero del paciente (cache derivada, una sola verdad) ──
  // presupuesto_total = Σ ACEPTADO · pagado = Σ pagos · pendiente = resta ·
  // aceptado = derivado de los estados reales (Si / Pendiente / No / null).
  // MEJORAS 28 paso 2 (2026-07-27) — aquí se backfilleaban
  // presupuesto_total/pagado/pendiente/aceptado en pacientes. Esas cuatro
  // columnas ya no existen: el dinero se deriva siempre de presupuestos+pagos.

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
  // 31-08 — el agente ENCENDIDO en la demo (modo A: evalúa y redacta, la
  // persona envía). Con el log del agente sembrado desde los hilos, un agente
  // «apagado» en la config contradiría el log — y la demo enseña el agente.
  // Sin WABA en el entorno demo nada sale de verdad.
  for (const cid of [CENTRO, NORTE, SUR, ESTE]) await ins("configuracion_automatizaciones", {
    clinica_id: cid, activa: true, dias_inactividad_alerta: 3, dias_portal_sin_respuesta: 7, dias_reactivacion: 60,
    modo_whatsapp: "manual", evaluador_activo: true, actualizado_en: dISO(-2),
  });
  // eventos del sistema — TODOS procesado=true (candado 2: el cron los ignora)
  let eventosN = 0;
  for (let i = 0; i < 15; i++) { await ins("eventos_sistema", { tipo: "lead_creado", entidad_tipo: "Lead", entidad_id: leads[i % leads.length].id, payload: "{}", procesado: true, resumen: "Evento lead_creado (procesado)" }); eventosN++; }
  // secuencias (operativo)
  // `tipo_evento` y `tono_usado` van del VOCABULARIO REAL (ver VOCABULARIO al
  // final): esta línea escribía `tipo_evento:"seguimiento"`, que no existe en
  // el tipo `TipoEvento`, y con eso la pestaña Automatizaciones → Operativo
  // reventaba entera (`EVENTO_CONFIG[…].color` sobre undefined). El tono era
  // "cercano", que tampoco está en los tres que mide la tabla A/B de /kpis, así
  // que 12 de 28 mensajes se descartaban en silencio.
  for (let i = 0; i < 12; i++) { const p = presupuestos[i]; await ins("secuencias_automaticas", { presupuesto_id: p.id, clinica_id: p.pac.cid, paciente_nombre: p.pac.nombre, telefono: p.pac.tel, tratamiento: "Tratamiento", tipo_evento: "presupuesto_inactivo", estado: i % 3 === 0 ? "pendiente" : "enviado", mensaje_generado: "Hola, ¿seguimos adelante con tu tratamiento?", tono_usado: i % 2 === 0 ? "empatico" : "directo", canal_sugerido: "whatsapp", actualizado_en: dISO(-(i % 4)) }); }
  console.log(`automatizaciones: ${reglas.length} reglas · ${eventosN} eventos(procesado) · config manual ×4`);

  // ── PLANTILLAS DE MENSAJE (globales: clinica_id NULL ⇒ "Todas") ──────
  //  Alimentan el botón «Plantillas» del composer de los paneles de acción.
  //  Placeholders leads: {nombre} {clinica} {tratamiento} {fecha_cita}
  //  Placeholders presupuestos: {nombre} {tratamiento} {importe} {doctor} {clinica}
  const PLANTILLAS_LEAD = [
    ["Primer contacto", "Primer_Contacto", "Hola {nombre}, soy del equipo de {clinica} 😊 Hemos recibido tu interés en {tratamiento}. ¿Te viene bien que te llame hoy y buscamos hueco para una primera visita sin compromiso?"],
    ["Seguimiento sin respuesta", "Seguimiento_SinRespuesta", "Hola {nombre}, te escribí hace unos días por {tratamiento} y no quería que se quedara en el aire. Si sigues con la idea, dime y te reservo hueco esta misma semana."],
    ["Recordatorio de cita", "Recordatorio_Cita", "Hola {nombre}, te recuerdo tu cita el {fecha_cita} en {clinica}. Si necesitas cambiarla, respóndeme por aquí y lo ajustamos sin problema. ¡Te esperamos!"],
    ["Reactivación tras no asistir", "Reactivacion_NoAsistio", "Hola {nombre}, vimos que no pudiste venir a tu cita — no pasa nada. ¿Buscamos otro día que te encaje mejor? Tengo huecos esta semana por la tarde."],
  ];
  for (const [nombre, tipo, contenido] of PLANTILLAS_LEAD) await ins("plantillas_lead", { nombre, tipo, contenido, activa: true });

  // Estas cinco usaban UNA llave ({nombre}) y no traían `categoria`, que es
  // exactamente lo que arregló la migración 017: el renderizador que se usa de
  // verdad solo sustituye {{…}}, así que con una llave llegaban al paciente con
  // las llaves puestas, y sin categoría el lector las archivaba donde le
  // parecía. Si el seed las volviera a escribir así, `demo:reset` deshace la
  // migración — que es el §15 de las lecciones, y ya nos ha mordido tres veces.
  const PLANTILLAS_PRESUPUESTO = [
    ["Seguimiento de presupuesto", "Seguimiento", "lead_seguimiento", "Hola {{nombre}}, te escribo por el presupuesto de {{tratamiento}} ({{importe}}). ¿Has podido pensarlo? Cualquier duda te la resuelvo por aquí, sin compromiso."],
    ["Detalles de pago", "Detalles de pago", "cobranza", "Hola {{nombre}}, ¡gracias por tu confianza! Estas son las opciones de pago para tu {{tratamiento}} ({{importe}}):\n\n· Pago único con 5% de descuento\n· Financiación hasta 24 meses sin intereses\n\nDime cuál te encaja mejor y lo dejamos todo listo."],
    ["Financiación", "Financiacion", "cobranza", "Hola {{nombre}}, sobre el presupuesto de {{tratamiento}} ({{importe}}): podemos financiarlo hasta en 24 meses sin intereses, quedaría en una cuota mucho más cómoda. ¿Te preparo una simulación sin compromiso?"],
    ["Confirmación de aceptación", "Confirmacion", "cobranza", "¡Enhorabuena {{nombre}}! Hemos registrado la aceptación de tu presupuesto de {{tratamiento}} ({{importe}}). El siguiente paso es agendar el inicio del tratamiento con {{nombre_doctor}} — ¿te viene bien esta semana?"],
    ["Reactivación", "Reactivacion", "lead_seguimiento", "Hola {{nombre}}, soy del equipo de {{nombre_clinica}}. Hace un tiempo te preparamos un presupuesto de {{tratamiento}} y quedó pendiente. Si quieres retomarlo, lo revisamos juntos y vemos las opciones actuales. ¿Te llamo?"],
  ];
  for (const [nombre, tipo, categoria, contenido] of PLANTILLAS_PRESUPUESTO) {
    const vars = [...new Set([...contenido.matchAll(/\{\{([a-zA-Z_]+)\}\}/g)].map((m) => m[1]))].sort().join(", ");
    await ins("plantillas_mensaje", { nombre, tipo, categoria, contenido, variables_detectadas: vars, activa: true });
  }
  console.log(`plantillas: ${PLANTILLAS_LEAD.length} de leads · ${PLANTILLAS_PRESUPUESTO.length} de presupuestos`);

  // ── HUÉRFANOS (fase A · paso 5, 2026-08-14): dos hilos sin caso ───────
  //  Gente que escribe a la clínica sin ser paciente ni lead. La bandeja los
  //  pinta desde la 018; con el evaluador encendido, se atienden. qa:contexto
  //  EXIGE que existan: la rama `identificar` deja de estar cubierta solo por
  //  el teléfono sintético del QA.
  await ins("mensajes_whatsapp", {
    telefono: "+34611999001", clinica_id: CENTRO, direccion: "Entrante",
    contenido: "Hola, ¿cuánto cuesta una limpieza dental? Nunca he ido a vuestra clínica.",
    timestamp: hAgo(3), fuente: "Modo_A_manual", procesado_por_ia: false,
  });
  await ins("mensajes_whatsapp", {
    telefono: "+34611999002", clinica_id: NORTE, direccion: "Entrante", nombre_perfil: "Mónica G.",
    contenido: "Buenas, ¿abrís los sábados por la mañana?",
    timestamp: hAgo(26), fuente: "Modo_A_manual", procesado_por_ia: false,
  });
  await ins("mensajes_whatsapp", {
    telefono: "+34611999002", clinica_id: NORTE, direccion: "Entrante", nombre_perfil: "Mónica G.",
    contenido: "¿Hola? ¿Me podéis decir el horario del sábado?",
    timestamp: hAgo(2), fuente: "Modo_A_manual", procesado_por_ia: false,
  });
  console.log("huérfanos: 2 hilos (3 mensajes) sin paciente ni lead — la rama identificar del QA");

  // ── OBJETIVOS, CONFIG, MISC ──────────────────────────────────────────
  for (const cid of [CENTRO, NORTE, SUR, ESTE]) {
    await ins("objetivos_mensuales", { clinica_id: cid, mes: mesAct, objetivo_aceptados: cid === CENTRO ? 12 : 6, creado_por: "Administración", actualizado_en: dISO(-1) });
    await ins("objetivos_mensuales", { clinica_id: cid, mes: mesPrev, objetivo_aceptados: cid === CENTRO ? 12 : 6, creado_por: "Administración", actualizado_en: dISO(-30) });
  }
  // El CATÁLOGO DE TIPOS DE PACIENTE (decisión 2026-07-29: propiedad de la
  // persona, catálogo configurable por clínica, y la CATEGORÍA es la marca de
  // aseguradora). Faltaba aquí: `demo:reset` borra `configuraciones_clinica` en
  // el wipe, así que cada reseed dejaba el catálogo VACÍO — sin él la pestaña
  // Tarifas enseña cards a cero, la línea de mezcla de /red no enseña mezcla y
  // el portal del paciente nunca puede mostrar el bloque de cobertura. Lo
  // destapó la sonda de `npm run qa:portal`, que abortó con "el catálogo no
  // tiene mutua y no-mutua" en vez de dar por bueno un catálogo vacío.
  const CONFIG = [["Metodos_Pago", ["Tarjeta", "Efectivo", "Transferencia", "Financiación 12m", "Financiación 24m"]],
    ["Razones_No_Interesado", ["Precio", "Se fue a otra clínica", "Horarios", "Cambió de opinión"]],
    ["Tipos_Paciente", ["Privado"]],
    ["Tipos_Paciente_Aseguradora", ["Adeslas", "Sanitas", "DKV"]]];
  for (const [cat, vals] of CONFIG) for (let o = 0; o < vals.length; o++) await ins("configuraciones_clinica", { clinica_id: null, categoria: cat, valor: vals[o], activo: true, orden: o, resumen: `${cat} · ${vals[o]}` });
  // Las plantillas generales se siembran ARRIBA, curadas por dominio
  // (leads vs presupuestos, tipos válidos y placeholders que la UI
  //  resuelve) — sustituyen a la lista genérica que vivía aquí.
  // Las de COBRANZA sí se quedan: son las 3 canónicas del módulo de
  // Cobros y el otro lado del merge no las tenía (2026-07-29).
  // Plantillas de COBRANZA (módulo Cobros 2026-07-24) — las 3 canónicas del
  // sprint 14b (app/scripts/sprint14b-bloque4-plantillas.ts). Sin ellas el
  // panel "Recordar pago" no puede precargar el recordatorio.
  // MEJORAS nº 32: lo que se RECLAMA usa {{pendiente}} (importe − pagos);
  // la señal confirma el presupuesto y mantiene {{importe}}.
  const PLANTILLAS_COBRANZA = [
    ["recordatorio_senal", "Hola {{nombre}}, soy {{nombre_doctor}} de {{nombre_clinica}}. Confirmamos tu presupuesto de {{importe}}€ para {{tratamiento}}. Para reservar tu plaza, ¿podrías abonar la señal? Cualquier duda, aquí estamos."],
    ["recordatorio_primer_pago", "Hola {{nombre}}, ¿cómo estás? Te recuerdo que tienes pendiente el primer pago de tu plan de tratamiento ({{pendiente}}€). ¿Cuándo te viene bien pasar por la clínica? Te esperamos."],
    ["recordatorio_liquidacion", "Hola {{nombre}}, soy {{nombre_doctor}}. Tienes pendiente la liquidación de {{pendiente}}€ desde hace {{dias_vencido}} días. ¿Hay algo en lo que pueda ayudarte? Llámanos cuando quieras."],
  ];
  for (const [nombre, contenido] of PLANTILLAS_COBRANZA) {
    const vars = [...new Set([...contenido.matchAll(/\{\{([a-zA-Z_]+)\}\}/g)].map((m) => m[1]))].join(", ");
    await ins("plantillas_mensaje", { nombre, tipo: "Cobranza", categoria: "cobranza", contenido, variables_detectadas: vars, activa: true });
  }
  // Recordatorio de CITA (B6.1, 18-08): el generador de la cola única
  // (lib/envios/recordatorios-cita) busca categoria='cita_recordatorio' y con
  // la opción (b) —sin plantilla no se genera— un seed sin esta fila deja la
  // demo enseñando «sin plantilla» en vez de la cola. Las variables son las
  // que ESE contexto resuelve ({{fecha_cita}}, {{hora_cita}} — §16).
  {
    const contenido =
      "Hola {{nombre}}, te recordamos tu cita de {{tratamiento}} {{fecha_cita}} a las {{hora_cita}} en {{nombre_clinica}}. Si necesitas cambiarla o cancelarla, respóndenos por aquí.";
    const vars = [...new Set([...contenido.matchAll(/\{\{([a-zA-Z_]+)\}\}/g)].map((m) => m[1]))].join(", ");
    await ins("plantillas_mensaje", { nombre: "Recordatorio de cita", tipo: "Recordatorio de cita", categoria: "cita_recordatorio", contenido, variables_detectadas: vars, activa: true });
  }

  // ── EL LOG DEL AGENTE (Inicio, 31-08) — GENERADO DESDE LOS HILOS ─────────
  //  Condición dictada: coherente con lo que dicen las conversaciones. Por eso
  //  no se inventa un log aparte: se LEE cada hilo ya persistido y de cada
  //  entrante con intención se deriva lo que el agente habría anotado —
  //  evaluación (con campos recogidos que salen del texto), aplazamiento con
  //  su clave, espera, o entrega del caso completo. Un log que contradiga el
  //  hilo es peor que ninguno; generado desde el hilo, no puede.
  //  Modo A: los salientes posteriores a una evaluación quedan como borrador
  //  del agente enviado por la persona (sugerido_por_ia), no como «autor
  //  agente» — el agente aún no envía solo.
  {
    // Dos hilos más, para que existan las causas que el resto del seed no
    // produce: una QUEJA (con malestar) y una URGENCIA. Van sobre leads en
    // espera (le escribimos y ahora contesta esto): la causa ES el texto.
    {
      const { rows: enEspera } = await db.query(
        `select m.lead_id, m.telefono, l.clinica_id, max(m."timestamp") as ult
           from mensajes_whatsapp m join leads l on l.id = m.lead_id
          where m.cliente = 'DEMO' and l.cliente = 'DEMO' and l.estado = 'Contactado'
          group by m.lead_id, m.telefono, l.clinica_id
          having count(*) = 3 order by max(m."timestamp") desc limit 2`,
      );
      const extras = [
        { txt: "Llevo dos días esperando respuesta y nadie me dice nada. Quiero hablar con una persona, por favor.", ts: hAgo(3) },
        { txt: "Se me ha roto una muela y me duele bastante. ¿Podéis verme hoy o mañana como muy tarde?", ts: hAgo(1) },
      ];
      for (let i = 0; i < Math.min(2, enEspera.length); i++) {
        await ins("mensajes_whatsapp", {
          lead_id: enEspera[i].lead_id, telefono: enEspera[i].telefono, clinica_id: enEspera[i].clinica_id, direccion: "Entrante",
          contenido: extras[i].txt, timestamp: extras[i].ts, fuente: "Modo_A_manual", procesado_por_ia: true,
        });
      }
    }

    const { rows: msgs } = await db.query(
      `select id, telefono, lead_id, presupuesto_id, paciente_id, direccion, contenido,
              intencion_detectada as intn, "timestamp" as ts
         from mensajes_whatsapp where cliente = 'DEMO' and telefono is not null
         order by telefono, "timestamp" asc, id asc`,
    );
    const { rows: leadRows } = await db.query(`select id, nombre, estado, tratamiento_interes from leads where cliente = 'DEMO'`);
    const { rows: presRows } = await db.query(`select id, estado, tratamiento_nombre, importe from presupuestos where cliente = 'DEMO'`);
    const leadDe = new Map(leadRows.map((l) => [l.id, l]));
    const presDe = new Map(presRows.map((p) => [p.id, p]));
    const hilos = new Map();
    for (const m of msgs) (hilos.get(m.telefono) ?? hilos.set(m.telefono, []).get(m.telefono)).push(m);

    const MODELO = "claude-haiku-4-5-20251001";
    const seg = (iso, n) => new Date(new Date(iso).getTime() + n * 1000).toISOString();
    const dias = (iso, n) => new Date(new Date(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
    const evento = (row) => ins("eventos_automatizacion", { tipo_caso: "conversacion", actor_nombre: "agente", ...row });
    let nEval = 0, nDeriv = 0, nAplaz = 0, nEspera = 0;
    const sugeridos = [];

    for (const [telefono, hilo] of hilos) {
      const lead = hilo.find((m) => m.lead_id) ? leadDe.get(hilo.find((m) => m.lead_id).lead_id) : null;
      const pres = hilo.find((m) => m.presupuesto_id) ? presDe.get(hilo.find((m) => m.presupuesto_id).presupuesto_id) : null;
      const tema = pres ? "presupuesto" : lead ? "cita" : "identificar";
      const trat = pres?.tratamiento_nombre ?? lead?.tratamiento_interes ?? null;
      let entrantesVistos = 0;
      let evaluado = false;
      let entregado = false;
      for (let i = 0; i < hilo.length; i++) {
        const m = hilo[i];
        if (m.direccion === "Saliente") {
          if (evaluado) sugeridos.push(m.id);
          continue;
        }
        entrantesVistos++;
        const txt = String(m.contenido ?? "");
        const t = txt.toLowerCase();
        const intn = m.intn ?? null;
        const siguienteSaliente = hilo.slice(i + 1).find((x) => x.direccion === "Saliente");
        // Qué habría recogido el agente de ESTE texto (solo lo que el texto dice).
        const campos = {};
        let queja = false, malestar = false, urgencia = false;
        let aplazar = null, esperaDias = null, entregar = null;
        if (tema === "cita") {
          campos.nombre_completo = lead?.nombre ?? null;
          campos.tratamiento_o_molestia = trat;
          if (/por la tarde/.test(t)) campos.disponibilidad = /esta semana/.test(t) ? "esta semana por la tarde" : "por la tarde";
          if (/resérvalo|allí estaré|me viene bien/.test(t)) { campos.disponibilidad = campos.disponibilidad ?? "la propuesta"; campos.urgencia = "sin prisa"; entregar = "cita"; }
          if (/cuánto cost|precio|financiación/.test(t) && !/tarde/.test(t)) aplazar = "precio_descuento";
          if (/muela|duele|dolor/.test(t)) { campos.urgencia = "dolor ahora"; campos.tratamiento_o_molestia = "dolor de muela"; urgencia = true; }
          if (/hablar con una persona|nadie me dice/.test(t)) { queja = true; malestar = true; }
        } else if (tema === "presupuesto") {
          if (intn === "Acepta sin condiciones") { campos.decision = "acepta"; entregar = "presupuesto"; }
          if (intn === "Acepta pero pregunta pago") { campos.decision = "acepta"; campos.como_pagar = null; aplazar = "plan_pago"; entregar = "presupuesto"; }
          if (intn === "Pide oferta/descuento") { campos.decision = null; campos.que_le_frena = "el precio"; aplazar = "precio_descuento"; }
          if (intn === "Tiene duda sobre tratamiento") { campos.decision = null; aplazar = /incluye|revisiones/.test(t) ? "garantia_condiciones" : "duda_clinica"; }
          if (intn === "Quiere pensarlo") { campos.decision = "se lo piensa"; campos.cuando_retomar = /semana que viene/.test(t) ? "la semana que viene" : "en unos días"; esperaDias = 7; }
          if (intn === "Rechaza") { campos.decision = "rechaza"; campos.motivo_rechazo = txt.slice(0, 80); }
          if (/me interesa mucho|cómo pido cita/.test(t)) { campos.decision = "acepta"; campos.disponibilidad_primera_cita = null; }
        } else {
          campos.nombre = null; campos.es_paciente = "no";
          if (/cuánto cuesta|precio/.test(t)) aplazar = "precio_descuento";
          if (/horario|abrís/.test(t)) campos.motivo = "horario";
        }
        const payload = {
          v: 1, tema, peticionOQueja: queja, malestar, urgenciaMedica: urgencia, mencionaAntecedenteMedico: false,
          vuelveSobreAplazado: null, camposRecogidos: { [tema]: campos }, hiloTruncado: false, borradorDescartado: null,
          respuesta: siguienteSaliente ? String(siguienteSaliente.contenido) : "",
          esperaHasta: esperaDias ? dias(m.ts, esperaDias) : null,
          presupuestoReferidoId: pres?.id ?? null,
          // El coste del turno (31-08): tokens realistas de un turno en haiku.
          usage: { inputTokens: 1600 + (entrantesVistos * 137) % 900, outputTokens: 180 + (i * 31) % 160, cacheEscritura: 0, cacheLectura: 1200 },
          modelo: MODELO,
        };
        await evento({ caso_id: telefono, evento: "evaluacion", evaluacion_json: JSON.stringify(payload), mensaje_id: m.id, created_at: seg(m.ts, 2) });
        nEval++; evaluado = true;
        if (aplazar) {
          await evento({ caso_id: telefono, evento: "aplazado", clave_aplazado: aplazar, motivo_texto: `«${txt.slice(0, 120)}»`, mensaje_id: m.id, created_at: seg(m.ts, 3) });
          nAplaz++;
        }
        if (esperaDias) {
          await evento({ caso_id: telefono, evento: "espera_fijada", hasta: dias(m.ts, esperaDias), motivo_texto: `«${txt.slice(0, 120)}»`, mensaje_id: m.id, created_at: seg(m.ts, 3) });
          nEspera++;
        }
        // Entregas: la causa ES el texto. Una por hilo (no se revierte).
        let causa = null;
        if (queja) causa = "peticion_queja";
        else if (urgencia) causa = "urgencia";
        else if (tema === "identificar" && entrantesVistos >= 2) causa = "insistencia";
        else if (entregar) causa = "caso_completo";
        if (causa && !entregado) {
          await evento({
            caso_id: telefono, evento: "derivado", causa_derivacion: causa,
            malestar: causa === "peticion_queja" ? malestar : null,
            objetivo_activo: entregar ?? tema, motivo_texto: `«${txt.slice(0, 120)}»`, mensaje_id: m.id, created_at: seg(m.ts, 4),
          });
          nDeriv++; entregado = true;
        }
      }
    }
    if (sugeridos.length) {
      await db.query(`update mensajes_whatsapp set sugerido_por_ia = true where cliente = 'DEMO' and id = any($1::text[])`, [sugeridos]);
    }
    // Envíos que caducaron AYER (la línea «desde ayer» del Inicio los cuenta).
    {
      const abiertos = presRows.filter((p) => !["ACEPTADO", "PERDIDO"].includes(p.estado)).slice(0, 3);
      const ayer = dPlus(-1, 10).toISOString();
      for (const p of abiertos) {
        const pac = msgs.find((m) => m.presupuesto_id === p.id);
        await ins("cola_envios", {
          presupuesto_ref: p.id, paciente_nombre: null, telefono: pac?.telefono ?? null,
          contenido: `Seguimiento del presupuesto de ${p.tratamiento_nombre ?? "tratamiento"}.`,
          tipo: "Recordatorio 1", estado: "Caducado", programado_para: ayer,
          plantilla_usada: "Seguimiento de presupuesto", origen: "seguimiento_presupuesto",
          tratamiento: p.tratamiento_nombre ?? null, importe: p.importe ?? null,
        });
      }
    }
    console.log(`log del agente: ${nEval} evaluaciones · ${nDeriv} entregas · ${nAplaz} aplazados · ${nEspera} esperas · ${sugeridos.length} borradores del agente enviados por el equipo`);

    // INVARIANTE (§15) — el log es COHERENTE con los hilos por construcción, y
    // esto lo comprueba: ningún evento sin un entrante anterior en su hilo,
    // toda entrega con objetivo, todo aplazado con clave, todo borrador del
    // agente con su evaluación antes. Y que haya de cada cosa: un Inicio con
    // el bloque 2 en blanco es un seed que miente por omisión.
    {
      const { rows: [inv] } = await db.query(`select
        (select count(*) from eventos_automatizacion e where e.cliente = 'DEMO' and e.tipo_caso = 'conversacion'
           and not exists (select 1 from mensajes_whatsapp m where m.cliente = 'DEMO' and m.telefono = e.caso_id
                             and m.direccion = 'Entrante' and m."timestamp" <= e.created_at))::int as sin_entrante,
        (select count(*) from eventos_automatizacion where cliente = 'DEMO' and evento = 'derivado' and objetivo_activo is null)::int as entrega_sin_objetivo,
        (select count(*) from eventos_automatizacion where cliente = 'DEMO' and evento in ('aplazado','aplazado_resuelto') and clave_aplazado is null)::int as aplazado_sin_clave,
        (select count(*) from mensajes_whatsapp m where m.cliente = 'DEMO' and m.sugerido_por_ia = true
           and not exists (select 1 from eventos_automatizacion e where e.cliente = 'DEMO' and e.evento = 'evaluacion'
                             and e.caso_id = m.telefono and e.created_at <= m."timestamp"))::int as borrador_sin_evaluacion,
        (select count(*) from eventos_automatizacion where cliente = 'DEMO' and evento = 'evaluacion')::int as evaluaciones,
        (select count(*) from eventos_automatizacion where cliente = 'DEMO' and evento = 'derivado' and causa_derivacion = 'caso_completo')::int as completos,
        (select count(*) from eventos_automatizacion where cliente = 'DEMO' and evento = 'derivado' and causa_derivacion <> 'caso_completo')::int as otras_entregas,
        (select count(distinct clave_aplazado) from eventos_automatizacion where cliente = 'DEMO' and evento = 'aplazado')::int as claves`);
      const malas = [];
      if (inv.sin_entrante) malas.push(`${inv.sin_entrante} evento(s) sin entrante previo en su hilo`);
      if (inv.entrega_sin_objetivo) malas.push(`${inv.entrega_sin_objetivo} entrega(s) sin objetivo`);
      if (inv.aplazado_sin_clave) malas.push(`${inv.aplazado_sin_clave} aplazado(s) sin clave`);
      if (inv.borrador_sin_evaluacion) malas.push(`${inv.borrador_sin_evaluacion} borrador(es) del agente sin evaluación previa`);
      if (!inv.evaluaciones || inv.completos < 3 || inv.otras_entregas < 2 || inv.claves < 3) malas.push(`poco log: ${JSON.stringify(inv)}`);
      if (malas.length) throw new Error(`[seed] log del agente incoherente: ${malas.join(" · ")}`);
      console.log(`  log coherente con los hilos: ${inv.completos} entregas completas · ${inv.otras_entregas} por queja/urgencia/insistencia · ${inv.claves} claves de aplazado`);
    }
  }

  // INVARIANTE (§15) — mensajería: todo saliente declara quién lo escribió, y
  // todo teléfono va en E.164. Lo segundo es la CLAVE DEL HILO de la bandeja:
  // si el seed y el webhook guardan formatos distintos, la misma persona sale
  // como dos conversaciones y se ve en pantalla, no en un test.
  {
    const { rows } = await db.query(
      `select
         count(*) filter (where direccion = 'Saliente' and autor is null)::int sin_autor,
         count(*) filter (where telefono not like '+%')::int sin_e164
       from mensajes_whatsapp where cliente = 'DEMO'`,
    );
    const { sin_autor: sinAutor, sin_e164: sinE164 } = rows[0];
    if (sinAutor || sinE164) {
      throw new Error(
        `[seed] mensajería inconsistente: ${sinAutor} saliente(s) sin autor, ` +
          `${sinE164} teléfono(s) fuera de E.164`,
      );
    }
  }

  // INVARIANTE (§15): ninguna plantilla puede quedar con una sola llave ni sin
  // categoría. Se comprueba AQUÍ, dentro de la transacción, para que un seed
  // que rompa el vocabulario reviente en el próximo `demo:reset` en vez de
  // pasar meses enseñando "{nombre}" en una demo.
  {
    const { rows } = await db.query(
      `select nombre, categoria, contenido from plantillas_mensaje where cliente = 'DEMO'`,
    );
    const CATS = new Set(["cobranza", "lead_seguimiento", "cita_recordatorio"]);
    const malas = rows.filter(
      (r) => !CATS.has(r.categoria) || /(^|[^{])\{[a-zA-Z_]+\}([^}]|$)/.test(r.contenido),
    );
    if (malas.length) {
      throw new Error(
        `[seed] ${malas.length} plantilla(s) con vocabulario inválido — categoría fuera del catálogo ` +
          `o variables de una sola llave, que el renderizador no sustituye: ` +
          malas.map((m) => m.nombre).join(", "),
      );
    }
  }

  // INVARIANTE (§15, 031): citas.estado del VOCABULARIO CERRADO, declarado a
  // mano — que ampliar el union sin pensar en el seed (o al revés) reviente en
  // el próximo `demo:reset` con un error legible, no con un abort críptico del
  // CHECK a mitad de transacción. Y la demo tiene que ENSEÑAR el vocabulario:
  // sin ningún No_show, los KPIs de no-show de Analíticas quedan a cero y
  // parecen rotos.
  {
    const { rows } = await db.query(
      `select estado, count(*)::int n from citas where cliente = 'DEMO' group by estado`,
    );
    const VOCAB_ESTADO_CITA = new Set(["Programada", "Confirmada", "Completado", "Cancelado", "No_show"]);
    const fuera = rows.filter((r) => !VOCAB_ESTADO_CITA.has(r.estado));
    if (fuera.length) {
      throw new Error(
        `[seed] citas con estado fuera del vocabulario (031): ` +
          fuera.map((f) => `${f.estado} (${f.n})`).join(", "),
      );
    }
    if (!rows.some((r) => r.estado === "No_show")) {
      throw new Error("[seed] la demo quedó sin ninguna cita No_show — los KPIs de no-show saldrían a cero");
    }
    // G2.6 — coherencia con la agenda: ninguna cita sembrada puede caer fuera
    // del horario configurado de su doctor (era el «rayado donde no toca»).
    const fueraHorario = await db.query(`
      select count(*)::int n from citas c
       where c.cliente = 'DEMO' and c.profesional_id is not null
         and exists (select 1 from horarios_staff h where h.staff_id = c.profesional_id)
         and not exists (
           select 1 from horarios_staff h
            where h.staff_id = c.profesional_id
              and h.dia_semana = extract(isodow from c.hora_inicio at time zone 'Europe/Madrid')::int
              and to_char(c.hora_inicio at time zone 'Europe/Madrid', 'HH24:MI') >= h.inicio
              and to_char(c.hora_inicio at time zone 'Europe/Madrid', 'HH24:MI') < h.fin)`);
    if (fueraHorario.rows[0].n > 0) {
      throw new Error(`[seed] ${fueraHorario.rows[0].n} cita(s) fuera del horario de su doctor — el seed tiene que sembrar dentro de las franjas`);
    }
  }

  // notificaciones, alertas, llamadas, copilot, informes, lista_espera
  for (let i = 0; i < 10; i++) await ins("notificaciones", { usuario: "todos", tipo: "Sistema", titulo: ["Nuevo lead", "Respuesta de paciente", "Presupuesto aceptado", "Cita confirmada"][i % 4], mensaje: "Tienes una novedad en tu bandeja.", link: "/seguimiento", leida: i > 3, fecha_creacion: dISO(-(i % 5)) });
  const adminId = (await db.query("select id from usuarios where cliente='DEMO' and rol='admin' limit 1")).rows[0]?.id;
  const coordId = (await db.query("select id from usuarios where cliente='DEMO' and rol='coordinacion' limit 1")).rows[0]?.id;
  for (let i = 0; i < 8; i++) await ins("alertas_enviadas", { clinica_id: [CENTRO, NORTE, SUR, ESTE][i % 4], tipo_alerta: "cobro_vencido_7d", admin_origen_id: adminId, coordinadora_destino_id: coordId, mensaje: "Hay cobros pendientes vencidos que requieren atención.", error: false });
  // `tipo_llamada` del vocabulario real: era "recordatorio", que no está en
  // `TipoLlamada`, y por eso la columna "Tipo" de /llamadas salía VACÍA en las
  // 12 filas. Mismo desajuste que tumbaba Operativo; aquí solo borraba una
  // columna, sin avisar a nadie.
  for (let i = 0; i < 12; i++) { const pac = pacientes[i]; await ins("llamadas_vapi", { paciente_id: pac.id, tipo_llamada: "confirmacion_cita", estado: i % 4 === 3 ? "fallida" : "completada", resultado: i % 4 === 3 ? "no_contesta" : "confirmada", iniciada_at: dISO(-(i % 6)), finalizada_at: dISO(-(i % 6)), duracion_segundos: i % 4 === 3 ? 0 : 45 + i, resumen: i % 4 === 3 ? "No contestó" : "Cita confirmada por el paciente.", coste_usd: i % 4 === 3 ? 0 : 0.12 }); }
  for (let i = 0; i < 3; i++) await ins("conversaciones_copilot", { usuario_id: coordId, clinica_id: CENTRO, titulo: ["Resumen del día", "Cobros vencidos", "Leads sin contactar"][i], mensajes: "[]", mensaje_count: 2 + i, modelo_usado: "claude", activa: true, updated_at: dISO(-i), resumen: "Consulta al copiloto" });
  for (let i = 0; i < 2; i++) await ins("informes_guardados", { tipo: i === 0 ? "semanal_ia" : "noshow", clinica_id: null, periodo: mesAct, titulo: i === 0 ? "Resumen semanal" : "Informe de no-shows", contenido_json: "{}", texto_narrativo: "La conversión mejoró un 8% respecto a la semana anterior.", generado_en: dISO(-1), generado_por: "IA" });
  for (let i = 0; i < 6; i++) { const pac = pacientes[30 + i]; await ins("lista_espera", { clinica_id: pac.cid, paciente_id: pac.id, tratamiento_id: tratamientos[i % tratamientos.length].id, dias_permitidos: "LUN,MAR,MIE,JUE,VIE", estado: "ACTIVE", prioridad: ["ALTA", "MEDIA", "BAJA"][i % 3], urgencia_nivel: "MED", permite_fuera_rango: false, notas: "Quiere hueco lo antes posible." }); }

  // ── Presupuestos SIN CONTACTO (cohorte "Nuevos" de Seguimiento) ──────
  // Aprobado 2026-07-26: 3 presupuestos presentados hace 1-2 días sin ningún
  // movimiento (ni hilo, ni acción, ni fecha_ultima_respuesta) para que la
  // cohorte Nuevos de la vista Presupuestos cuente su historia en la demo.
  // Son la EXCEPCIÓN EXPLÍCITA de la invariante "todo presupuesto tiene
  // hilo": se registran aquí y la invariante los excluye POR ID — la regla
  // general no se relaja.
  const PRESUS_SIN_CONTACTO = [];
  {
    const SIN_CONTACTO = [
      { pi: 3, tnom: "Ortodoncia invisible", importe: 3400, altaOff: -1 },
      { pi: 11, tnom: "Corona sobre implante", importe: 1650, altaOff: -1 },
      { pi: 19, tnom: "Blanqueamiento LED", importe: 420, altaOff: -2 },
    ];
    for (const s of SIN_CONTACTO) {
      const pac = pacientes[s.pi];
      const pid = await ins("presupuestos", {
        paciente_id: pac.id, clinica_id: pac.cid, tratamiento_nombre: s.tnom,
        estado: "PRESENTADO", importe: s.importe,
        fecha_alta: fecha10(s.altaOff), fecha: fecha10(s.altaOff),
        doctor: docEn(pac.cid).nombre, tipo_paciente: "Nuevo", tipo_visita: "Primera visita",
        paciente_telefono: pac.tel, contact_count: 0,
        fase_seguimiento: "Inicial",
      });
      PRESUS_SIN_CONTACTO.push(pid);
    }
  }

  // Tipos EN LOS PACIENTES. Inventado POR DISEÑO y dicho: el campo es nuevo y en
  // producción se rellena con el uso, pero sin él la demo no puede enseñar la
  // mezcla privado/aseguradora ni el desglose del portal. Reparto ~55/45 con una
  // cola de pacientes SIN tipo, que es lo que de verdad se ve en una clínica que
  // acaba de empezar a rellenarlo (y lo que las pantallas declaran aparte).
  {
    const TIPOS_MEZCLA = ["Privado", "Privado", "Privado", "Adeslas", "Sanitas", "DKV", null];
    const todos = (await db.query("select id from pacientes where cliente='DEMO' order by id")).rows;
    let n = 0;
    for (const p of todos) {
      const t = TIPOS_MEZCLA[n++ % TIPOS_MEZCLA.length];
      if (t) await db.query("update pacientes set tipo_paciente=$2 where id=$1 and cliente='DEMO'", [p.id, t]);
    }
    const conTipo = (await db.query("select count(*)::int n from pacientes where cliente='DEMO' and tipo_paciente is not null")).rows[0].n;
    console.log(`tipos de paciente: catálogo 1 propio + 3 aseguradoras · ${conTipo}/${todos.length} pacientes con tipo (el resto, sin tipo a propósito)`);
  }

  // ── KPIs (report de coherencia — vocabulario del dinero 2026-07-23) ──
  const aceptadoTot = (await db.query("select coalesce(sum(importe),0) s from presupuestos where cliente='DEMO' and estado='ACEPTADO'")).rows[0].s;
  const cobradoTot = (await db.query("select coalesce(sum(importe),0) s from pagos_paciente where cliente='DEMO'")).rows[0].s;
  // MEJORAS 28 paso 2 — el pendiente se DERIVA (no había otra cosa que
  // comparar: la columna cache que se leía aquí ya no existe).
  const pendiente = Number(aceptadoTot) - Number(cobradoTot);
  const nLeads = (await db.query("select count(*) n from leads where cliente='DEMO'")).rows[0].n;
  const nConv = (await db.query("select count(*) n from leads where cliente='DEMO' and estado='Convertido'")).rows[0].n;
  // Invariante dura del seed: NINGÚN paciente puede haber pagado más de lo que
  // tiene firmado. Antes se comparaba la caché contra su propio derivado —una
  // tautología desde que la caché se backfilleaba con la misma fórmula—; esta
  // sí caza un seed descorrelacionado (pagos que no cuelgan de un aceptado).
  const negativos = (await db.query(`
    select p.id, p.nombre,
      coalesce((select sum(x.importe) from presupuestos x where x.paciente_id=p.id and x.cliente='DEMO' and x.estado='ACEPTADO'),0) firmado,
      coalesce((select sum(g.importe) from pagos_paciente g where g.paciente_id=p.id and g.cliente='DEMO'),0) cobrado
    from pacientes p where p.cliente='DEMO'`)).rows
    .filter((r) => Number(r.cobrado) > Number(r.firmado));
  if (negativos.length) {
    throw new Error(`Seed descorrelacionado: ${negativos.length} paciente(s) con más cobrado que firmado (p.ej. ${negativos[0].nombre}: ${negativos[0].cobrado} > ${negativos[0].firmado})`);
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
  // Excepción declarada: los PRESUS_SIN_CONTACTO no tienen hilo A PROPÓSITO
  // (cohorte Nuevos de Seguimiento). Se excluyen por id, no por condición.
  const iPres = (await db.query(`select count(*)::int n from presupuestos p where cliente='DEMO'
    and not exists(select 1 from mensajes_whatsapp m where m.presupuesto_id=p.id)
    and not (p.id::text = any($1::text[]))`, [PRESUS_SIN_CONTACTO.map(String)])).rows[0].n;
  const iFur = (await db.query(`select count(*)::int n from presupuestos p where cliente='DEMO'
    and p.fecha_ultima_respuesta::timestamptz is distinct from (select max(m.timestamp) from mensajes_whatsapp m
      where m.presupuesto_id=p.id and m.direccion='Entrante')`)).rows[0].n;
  const iPerd = (await db.query(`select count(*)::int n from presupuestos p where cliente='DEMO' and estado='PERDIDO'
    and not exists(select 1 from historial_acciones h where h.presupuesto_id=p.id and h.tipo='cambio_estado')`)).rows[0].n;
  if (iNuevo || iNoNuevo || iPres || iFur || iPerd) {
    throw new Error(`Seed incoherente: nuevosConConversacion=${iNuevo} · noNuevosSinHilo=${iNoNuevo} · presupuestosSinHilo=${iPres} · fechaRespuestaDescorrelacionada=${iFur} · perdidosSinHistorial=${iPerd}`);
  }

  // Invariantes duras de VOLUMEN (MEJORAS nº 31):
  //   A) Los TRES buckets de Cobros están poblados — misma regla que
  //      lib/cobros (plazo global 90; vencido >7d sin liquidación;
  //      por vencer ≤7d; estancado >2.000€, >30d y cero pagos).
  //   B) La serie mensual no tiene huecos: cada uno de los últimos 6 meses
  //      tiene aceptados, pagos y leads (la historia no puede tener meses
  //      muertos). Si algo descorrelaciona, el seed revienta.
  const agg = (await db.query(`
    with f as (select paciente_id, sum(importe) firmado,
                      min(coalesce(fecha_aceptado, fecha_alta)) fmin
               from presupuestos where cliente='DEMO' and estado='ACEPTADO' and paciente_id is not null
               group by paciente_id),
         pg as (select paciente_id, coalesce(sum(importe),0) pagado, count(*) n,
                       bool_or(tipo='Liquidacion') liq
                from pagos_paciente where cliente='DEMO' group by paciente_id)
    select f.paciente_id, f.firmado, (current_date - f.fmin::date) dias,
           coalesce(pg.pagado,0) pagado, coalesce(pg.n,0) npagos, coalesce(pg.liq,false) liq
    from f left join pg on pg.paciente_id = f.paciente_id`)).rows;
  let bVenc = 0, bPorVencer = 0, bEstanc = 0;
  for (const r of agg) {
    const pend = Math.max(0, Number(r.firmado) - Number(r.pagado));
    if (pend <= 0) continue;
    const dias = Number(r.dias);
    if (dias - 90 > 7 && !r.liq) bVenc++;
    else if (dias >= 83 && dias <= 90 && !r.liq) bPorVencer++;
    else if (Number(r.firmado) > 2000 && dias > 30 && Number(r.npagos) === 0) bEstanc++;
  }
  if (bVenc < 5 || bPorVencer < 4 || bEstanc < 3) {
    throw new Error(`Buckets de Cobros mal poblados: vencidos=${bVenc} (≥5) · porVencer=${bPorVencer} (≥4) · estancados=${bEstanc} (≥3)`);
  }
  const serie = (await db.query(`
    select to_char(d.mes, 'YYYY-MM') mes,
      (select count(*) from presupuestos where cliente='DEMO' and estado='ACEPTADO'
        and to_char(fecha_aceptado::date, 'YYYY-MM') = to_char(d.mes, 'YYYY-MM')) aceptados,
      (select coalesce(sum(importe),0) from pagos_paciente where cliente='DEMO'
        and to_char(fecha_pago, 'YYYY-MM') = to_char(d.mes, 'YYYY-MM')) cobrado,
      (select count(*) from leads where cliente='DEMO'
        and to_char(created_at, 'YYYY-MM') = to_char(d.mes, 'YYYY-MM')) leads
    from generate_series(date_trunc('month', current_date) - interval '5 months',
                         date_trunc('month', current_date), interval '1 month') d(mes)
    order by 1`)).rows;
  const mesesMalos = serie.filter((s) => Number(s.aceptados) < 1 || Number(s.cobrado) <= 0 || Number(s.leads) < 5);
  if (mesesMalos.length) {
    throw new Error(`Serie mensual con huecos: ${mesesMalos.map((s) => `${s.mes}(acept=${s.aceptados},cobrado=${s.cobrado},leads=${s.leads})`).join(" · ")}`);
  }
  //   C) La serie de PRESENTADOS no tiene un escalón absurdo en el mes en curso
  //      (MEJORAS 46). Era 15 → 48: +220 % mes contra mes, así que cualquier
  //      comparativa de la cabecera de /presupuestos o de la gráfica de /red se
  //      leía como una locura aunque la fórmula fuese correcta. La causa era que
  //      los casos VIVOS nacían todos en las últimas dos semanas; ahora se
  //      reparten (ver PESOS_REPARTO). El tope se compara contra el mismo TRAMO
  //      del mes anterior, no contra el mes entero: a día 5 el mes en curso
  //      lleva cinco días y compararlo con 30 sería la trampa de siempre.
  const pres = (await db.query(`
    select to_char(d.mes,'YYYY-MM') mes,
      (select count(*) from presupuestos where cliente='DEMO'
        and to_char(fecha,'YYYY-MM') = to_char(d.mes,'YYYY-MM')
        and extract(day from fecha) <= $1) n
    from generate_series(date_trunc('month', current_date) - interval '5 months',
                         date_trunc('month', current_date), interval '1 month') d(mes)
    order by 1`, [new Date().getDate()])).rows;
  const nAct = Number(pres[pres.length - 1].n);
  const nPrev = Number(pres[pres.length - 2].n);
  const salto = nPrev > 0 ? nAct / nPrev : Infinity;
  // A principios de mes el «mismo tramo» son pocos días y pocos casos: 4 → 9
  // es ruido de números pequeños, no un escalón (este seed se cayó el 4 de
  // septiembre por esto — §16, corolario: los bugs de ciertos días se simulan,
  // no se sufren). El tope ×2 se pensó para decenas de casos: con menos de 7
  // días de tramo o menos de 8 casos de base, no hay comparativa que valga —
  // se dice y se omite.
  const diasDeTramo = new Date().getDate();
  if (diasDeTramo < 7 || nPrev < 8) {
    console.log(`  presentados en el tramo: ${nPrev} → ${nAct} con ${diasDeTramo} día(s) de mes — comparativa omitida (tramo o base demasiado pequeños)`);
  } else if (salto > 2) {
    throw new Error(
      `Presentados apilados en el mes en curso (MEJORAS 46): ${nPrev} → ${nAct} en el mismo tramo (×${salto.toFixed(1)}, tope ×2). ` +
      `Serie: ${pres.map((p) => `${p.mes}:${p.n}`).join(" · ")}`,
    );
  }
  //   D) NINGUNA columna de vocabulario cerrado guarda un valor que el producto
  //      no conozca. Es la invariante que evita la CUARTA vez:
  //        · jul-27 (MEJORAS 41): motivos de descarte en texto libre → la
  //          columna agrupaba mal y el panel afirmaba un motivo que no era.
  //        · jul-30 (MEJORAS 77): `"Primera Visita"` vs `"Primera visita"` →
  //          un KPI a cero que tapaba que el corte no existía.
  //        · jul-31: `tipo_evento:"seguimiento"` REVENTABA Automatizaciones →
  //          Operativo entera, y `tipo_llamada:"recordatorio"` dejaba la
  //          columna "Tipo" de /llamadas vacía en las 12 filas.
  //      Las tres se cazaron mirando una pantalla, nunca un test. Un seed que
  //      no respeta el vocabulario real no son "datos de prueba": es una demo
  //      que miente — y a veces una demo que se cae.
  //
  //      El vocabulario se declara AQUÍ, a mano y a propósito: es una copia
  //      deliberada de los tipos de `app/lib`, para que cambiar el union sin
  //      pensar en el seed reviente en el próximo `demo:reset` en vez de en una
  //      demo. Si un valor nuevo es legítimo, se añade en los dos sitios.
  const VOCABULARIO = [
    // tabla                     columna           valores admitidos (unión de app/lib)
    ["secuencias_automaticas", "tipo_evento", ["presupuesto_inactivo", "portal_visto_sin_respuesta", "reactivacion_programada", "presupuesto_aceptado_notificacion"]],
    ["secuencias_automaticas", "estado", ["pendiente", "enviado", "descartado"]],
    ["secuencias_automaticas", "canal_sugerido", ["whatsapp", "email", "interno"]],
    // Los tres tonos que mide la tabla A/B de /kpis (tonos-stats). Un cuarto
    // no rompe nada: se descarta en silencio, que es peor.
    ["secuencias_automaticas", "tono_usado", ["directo", "empatico", "urgencia"]],
    ["llamadas_vapi", "tipo_llamada", ["confirmacion_cita", "reactivacion", "recuperacion_presupuesto"]],
    ["llamadas_vapi", "estado", ["pendiente", "iniciada", "en_curso", "completada", "fallida", "cancelada"]],
    ["llamadas_vapi", "resultado", ["confirmada", "reagenda_solicitada", "cancelada", "no_contesta", "escalado_humano", "sin_resultado"]],
    ["presupuestos", "estado", ["PRESENTADO", "INTERESADO", "EN_DUDA", "EN_NEGOCIACION", "ACEPTADO", "PERDIDO"]],
    ["leads", "motivo_no_interes", ["No_Asistio", "No_Contesta", "Horarios", "Precio", "Otra_Clinica", "Ya_No_Necesita"]],
    ["acciones_automatizacion", "resultado", ["success", "error", "pendiente_integracion", "skipped_cooldown", "skipped_optout", "skipped_horario", "skipped_test", "skipped_dedupe"]],
    ["mensajes_whatsapp", "direccion", ["Entrante", "Saliente"]],
    // El log del agente (31-08): copia deliberada de lib/db/types.ts.
    ["eventos_automatizacion", "evento", ["quiebre_reconocido", "asumido", "asumido_manual", "mensaje_enviado", "aplazado", "aplazado_resuelto", "derivado", "evaluacion", "resuelto_manual", "soltado", "espera_fijada", "espera_levantada"]],
    ["eventos_automatizacion", "causa_derivacion", ["peticion_queja", "insistencia", "urgencia", "caso_completo", "antecedente_medico"]],
    ["eventos_automatizacion", "clave_aplazado", ["precio_descuento", "plan_pago", "cobertura_seguro", "cambio_tratamiento", "garantia_condiciones", "dato_presupuesto", "agenda_disponibilidad", "dato_cita", "duda_clinica", "otro"]],
    ["eventos_automatizacion", "objetivo_activo", ["identificar", "cita", "presupuesto", "cobro"]],
    ["citas", "confirmada_por", ["agente_voz", "recordatorio", "persona"]],
    ["cola_envios", "estado", ["Pendiente", "Enviado", "Fallido", "Cancelado", "Caducado"]],
  ];
  const fueraDeVocabulario = [];
  for (const [tabla, columna, admitidos] of VOCABULARIO) {
    const filas = (await db.query(
      `select ${columna} v, count(*)::int n from ${tabla}
       where cliente='DEMO' and ${columna} is not null and ${columna} <> ''
       group by 1`,
    )).rows;
    for (const f of filas) {
      if (!admitidos.includes(f.v)) fueraDeVocabulario.push(`${tabla}.${columna}="${f.v}" (${f.n} filas; admitidos: ${admitidos.join("|")})`);
    }
  }
  if (fueraDeVocabulario.length) {
    throw new Error(
      `El seed escribe valores que el producto no conoce:\n    ` +
      fueraDeVocabulario.join("\n    ") +
      `\n  Añade el valor al union en app/lib Y a VOCABULARIO aquí, o usa uno existente.`,
    );
  }
  console.log(`  vocabulario: ${VOCABULARIO.length} columnas comprobadas, cero valores fuera del union`);

  console.log("  serie 6 meses:", serie.map((s) => `${s.mes}: ${s.leads}L/${s.aceptados}A/${Number(s.cobrado).toLocaleString("es")}€`).join(" · "));
  console.log(`  presentados (mismo tramo del mes): ${pres.map((p) => `${p.mes}:${p.n}`).join(" · ")} → salto ×${salto.toFixed(1)}`);
  console.log(`  buckets Cobros: vencidos=${bVenc} · por vencer=${bPorVencer} · estancados=${bEstanc}`);

  await db.query("commit");
  console.log("\n✓ SEED RICO commit.");
  console.log(`  KPIs: aceptado(firmado)=${Number(aceptadoTot).toLocaleString("es")}€ · cobrado(pagos)=${Number(cobradoTot).toLocaleString("es")}€ · pendiente=${Number(pendiente).toLocaleString("es")}€ · conversión=${Math.round(nConv / nLeads * 100)}% (${nConv}/${nLeads})`);
} catch (e) {
  await db.query("rollback");
  console.error("✗ SEED FALLÓ (rollback):", e.message, e.detail ?? "");
  process.exit(1);
} finally { await db.end(); }
