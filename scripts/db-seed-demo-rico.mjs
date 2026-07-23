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

  // ── LEADS (38) por estado + acciones (esperando respuesta) ───────────
  const LEAD_MSG = {
    interesado: "Hola! Vi vuestra promo de implantes en Instagram, me interesa mucho. ¿Cómo pido cita?",
    duda_precio: "Buenas, me pasaron el presupuesto de ortodoncia invisible pero 3.500€ se me va un poco… ¿tenéis financiación?",
    objecion: "Me lo estoy pensando, la verdad es que me da bastante respeto la endodoncia.",
    listo_para_agendar: "Perfecto, me viene bien el jueves por la tarde. ¿A qué hora tenéis hueco?",
  };
  const estadosLead = [
    ...Array(8).fill("Nuevo"), ...Array(9).fill("Contactado"), ...Array(4).fill("Citado"),
    ...Array(2).fill("Citados Hoy"), ...Array(9).fill("Convertido"), ...Array(6).fill("No Interesado")];
  const MOTIVOS_NO = ["Se fue a otra clínica más barata", "No le convenció el tratamiento", "Problema de horarios", "Precio fuera de presupuesto"];
  const TRATS_INT = ["Implante unitario", "Ortodoncia invisible", "Blanqueamiento LED", "Endodoncia molar", "Limpieza dental", "Corona sobre implante"];
  const leadNombresExtra = ["Yolanda Ríos", "Tomás Benítez", "Lorena Cuevas", "Álvaro Méndez", "Noelia Ibáñez",
    "Gabriel Rojas", "Verónica Nieves", "Samuel Arias", "Lidia Palma", "Mario Esteban", "Celia Duarte", "Ismael Rubio",
    "Rosa Domínguez", "Guillermo Sáez", "Ainhoa Vicente", "Daniel Roldán", "Marina Cortés", "Sergio Bermúdez",
    "Eva Montero", "Ángel Carrasco", "Vanesa Gimeno", "Joaquín Ledesma", "Miriam Salas", "Pablo Escobar",
    "Nerea Aparicio", "Rubén Caballero", "Sandra Quintana", "Iker Robledo", "Amparo Gil", "Cristian Vázquez"];
  let nlNi = 0;
  const leads = [];
  for (let i = 0; i < estadosLead.length; i++) {
    const est = estadosLead[i];
    const cid = clis[i % clis.length];
    const conv = est === "Convertido";
    const pac = conv ? pacientes[20 + (i % 20)] : null; // convertidos apuntan a pacientes existentes
    const esperando = est === "Contactado" && i % 2 === 0; // último acción SALIENTE
    const nombre = conv ? pac.nombre : leadNombresExtra[nlNi++ % leadNombresExtra.length];
    const lid = await ins("leads", {
      nombre, telefono: tel(), email: null, tratamiento_interes: TRATS_INT[i % TRATS_INT.length],
      canal_captacion: CANALES[i % CANALES.length], estado: est, clinica_id: cid,
      doctor_asignado_id: docEn(cid).id, tipo_visita: "Primera visita",
      fecha_cita: (est === "Citado" || est === "Citados Hoy") ? fecha10(est === "Citados Hoy" ? 0 : 2) : null,
      hora_cita: (est === "Citado" || est === "Citados Hoy") ? "16:30" : null,
      llamado: est !== "Nuevo", whatsapp_enviados: est === "Nuevo" ? 0 : 1 + (i % 3),
      motivo_no_interes: est === "No Interesado" ? MOTIVOS_NO[i % MOTIVOS_NO.length] : null,
      intencion_detectada: esperando ? "duda_precio" : null,
      convertido_a_paciente: conv, paciente_id: conv ? pac.id : null,
      ultima_accion: est === "Nuevo" ? null : (esperando ? "WhatsApp_Saliente" : "Llamada"),
    });
    leads.push({ id: lid, est, cid, esperando, nombre });
    // acciones del lead
    if (est !== "Nuevo") {
      await ins("acciones_lead", { lead_id: lid, tipo_accion: "Llamada", resumen: "Primer contacto telefónico", timestamp: dISO(-(i % 6) - 1), detalles: "No contesta, se deja WhatsApp." });
      if (esperando) await ins("acciones_lead", { lead_id: lid, tipo_accion: "WhatsApp_Saliente", resumen: "Enviado mensaje de seguimiento", timestamp: dISO(0), detalles: "Esperando respuesta del paciente." });
    }
  }
  console.log(`leads: ${leads.length}`);

  // ── PRESUPUESTOS (34): cada estado + estancados + perdidos ───────────
  const EST_PRES = [["PRESENTADO", 7], ["INTERESADO", 5], ["EN_DUDA", 5], ["EN_NEGOCIACION", 4], ["ACEPTADO", 8], ["PERDIDO", 5]];
  const TRAT_PRES = [["Implante unitario", 2800], ["Ortodoncia invisible", 3500], ["Corona sobre implante", 950],
    ["Endodoncia molar", 480], ["Blanqueamiento LED", 300], ["Implante unitario", 4200], ["Férula de descarga", 220],
    ["Limpieza dental", 90], ["Ortodoncia invisible", 3800], ["Corona sobre implante", 1200]];
  const MOTIVOS_PERD = ["Precio", "Se fue a otra clínica", "Sin respuesta tras 3 contactos", "Cambió de opinión"];
  const presupuestos = []; let np = 0; let idxAcept = 0;
  const IMPORTES_ACEPT = [2800, 3500, 4200, 3800, 3850, 2100, 1200, 950]; // Σ = 22.400 (facturado mes)
  for (const [estado, n] of EST_PRES) {
    for (let k = 0; k < n; k++) {
      const pac = pacientes[np % pacientes.length]; np++;
      const [tnom, imp0] = TRAT_PRES[np % TRAT_PRES.length];
      const importe = estado === "ACEPTADO" ? IMPORTES_ACEPT[idxAcept++] : imp0;
      const estancado = estado !== "ACEPTADO" && estado !== "PERDIDO" && k === 0; // 1 estancado por estado abierto
      const altaOff = estancado ? -(9 + k) : -(1 + (np % 5));
      const fechaAceptado = estado === "ACEPTADO" ? fecha10(-(np % 10)) : null;
      const pid = await ins("presupuestos", {
        paciente_id: pac.id, clinica_id: pac.cid, tratamiento_nombre: tnom, estado, importe,
        fecha_alta: fecha10(altaOff), fecha: fecha10(altaOff),
        fecha_aceptado: fechaAceptado,
        doctor: docEn(pac.cid).nombre, tipo_paciente: "Nuevo", tipo_visita: "Primera visita",
        paciente_telefono: pac.tel, contact_count: estado === "ACEPTADO" ? 2 : (estancado ? 4 : 1),
        motivo_perdida: estado === "PERDIDO" ? MOTIVOS_PERD[k % MOTIVOS_PERD.length] : null,
        motivo_perdida_texto: estado === "PERDIDO" ? "El paciente indicó que era demasiado caro." : null,
        // Cerrados → "Cerrado" (lo que escribe la app al aceptar/perder desde
        // el fix del cierre completo); abiertos → según narrativa, y los 12
        // con hilo WhatsApp se re-correlacionan tras sembrar los mensajes.
        fase_seguimiento: estado === "ACEPTADO" || estado === "PERDIDO" ? "Cerrado"
          : estado === "PRESENTADO" ? "Esperando respuesta" : (estancado ? "Reactivar" : null),
        ultima_accion_registrada: dISO(altaOff), ultimo_contacto: fecha10(altaOff),
        urgencia_intervencion: estancado ? "alta" : (estado === "EN_NEGOCIACION" ? "media" : "baja"),
        accion_sugerida: estado === "EN_DUDA" ? "Ofrecer financiación" : (estancado ? "Llamar para reactivar" : "Enviar recordatorio"),
      });
      presupuestos.push({ id: pid, estado, importe, pac, fechaAceptado });
      // contactos del presupuesto
      const nc = estado === "ACEPTADO" ? 2 : (estancado ? 3 : 1);
      for (let c = 0; c < nc; c++) await ins("contactos_presupuesto", {
        presupuesto_id: pid, tipo_contacto: c === 0 ? "Llamada" : "WhatsApp", resultado: c === 0 ? "No contesta" : "Enviado",
        fecha_hora: dISO(altaOff + c), nota: c === 0 ? "Primer intento de contacto." : "Mensaje de seguimiento enviado.",
        registrado_por: "Coordinación", mensaje_ia_usado: c > 0, tono_usado: "cercano",
      });
    }
  }
  console.log(`presupuestos: ${presupuestos.length}`);

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

  // ── MENSAJES WhatsApp (12 conversaciones bidireccionales, IA) ────────
  let mensajesN = 0;
  const convs = presupuestos.slice(0, 12);
  const INTENCIONES = ["interesado", "duda_precio", "objecion", "listo_para_agendar"];
  for (let i = 0; i < convs.length; i++) {
    const p = convs[i]; const intn = INTENCIONES[i % 4];
    const guion = [
      { dir: "Saliente", txt: `Hola ${p.pac.nombre.split(" ")[0]}, soy del equipo de la clínica 😊 ¿Has podido pensar sobre el presupuesto de ${p.estado === "ACEPTADO" ? "tu tratamiento" : "tu tratamiento"}?`, off: -3 },
      { dir: "Entrante", txt: LEAD_MSG[intn], off: -2, intn },
      { dir: "Saliente", txt: intn === "duda_precio" ? "¡Claro! Trabajamos con financiación hasta 24 meses sin intereses. ¿Te preparo una simulación?" : "Genial, te reservo un hueco esta semana. ¿Te viene mejor mañana o el jueves?", off: -1 },
    ];
    if (intn === "listo_para_agendar") guion.push({ dir: "Entrante", txt: "El jueves perfecto, gracias!", off: 0, intn: "listo_para_agendar" });
    for (const m of guion) {
      await ins("mensajes_whatsapp", {
        paciente_id: p.pac.id, presupuesto_id: p.id, telefono: p.pac.tel, direccion: m.dir,
        contenido: m.txt, timestamp: dISO(m.off), fuente: "Modo_A_manual", procesado_por_ia: m.dir === "Entrante",
        intencion_detectada: m.intn ?? null,
      }); mensajesN++;
    }
    // Correlación fase⟷hilo (bug "esperando respuesta" con el último mensaje
    // del paciente): en abiertos, la fase refleja quién tiene la pelota según
    // el ÚLTIMO mensaje — Saliente → "Esperando respuesta"; Entrante →
    // "En intervención" (hay respuesta del paciente por atender).
    if (p.estado !== "ACEPTADO" && p.estado !== "PERDIDO") {
      const ultimo = guion[guion.length - 1];
      await db.query("update presupuestos set fase_seguimiento=$1 where id=$2 and cliente='DEMO'", [
        ultimo.dir === "Entrante" ? "En intervención" : "Esperando respuesta", p.id,
      ]);
    }
  }
  console.log(`mensajes_whatsapp: ${mensajesN}`);

  // ── PAGOS derivados de los presupuestos ACEPTADO ─────────────────────
  // Cada aceptado genera su pago: señal/parcial (lo común en dental) o
  // liquidación completa. El pago nace del presupuesto — nunca de un campo
  // manual del paciente — para que Aceptado (Σ presupuestos), Cobrado
  // (Σ pagos) y Pendiente (resta) cuadren en toda la app por construcción.
  let pagosN = 0;
  const PCT_PAGO = [0.4, 1, 0.3, 0.6, 1, 0.5, 1, 0.8]; // 5 parciales · 3 liquidados
  const pagadoPorPaciente = new Map();
  for (const p of presupuestos.filter((x) => x.estado === "ACEPTADO")) {
    const pct = PCT_PAGO[pagosN % PCT_PAGO.length];
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

  await db.query("commit");
  console.log("\n✓ SEED RICO commit.");
  console.log(`  KPIs: aceptado(firmado)=${Number(aceptadoTot).toLocaleString("es")}€ · cobrado(pagos)=${Number(cobradoTot).toLocaleString("es")}€ · pendiente=${Number(pendiente).toLocaleString("es")}€ · conversión=${Math.round(nConv / nLeads * 100)}% (${nConv}/${nLeads})`);
} catch (e) {
  await db.query("rollback");
  console.error("✗ SEED FALLÓ (rollback):", e.message, e.detail ?? "");
  process.exit(1);
} finally { await db.end(); }
