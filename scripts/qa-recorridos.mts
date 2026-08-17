#!/usr/bin/env tsx
// RECORRIDOS COMPLETOS (fase B, aprobado 2026-08-17): la vara de flujos.
//
//   npx tsx scripts/qa-recorridos.mts   (= npm run qa:recorridos)
//
// La vara vieja (qa:evals-evaluador) mide MENSAJES SUELTOS y sigue viva como
// regresión. Esta mide lo que el recorrido de Simon encontró en 20 minutos y
// 69 casos anotados no vieron: FLUJOS — «al terminar, ¿alguien de la clínica
// tiene un caso en la mano, con qué datos, y llegó a la cola correcta?».
//
// Cada recorrido: construye su MINI-MUNDO (paciente/presupuesto propios, no
// los actores del seed), ejecuta pasos —entrantes por el bucle REAL (modelo
// incluido), acciones de persona, saltos de tiempo con `hoy` inyectado
// (§14)— y afirma RESULTADOS, no textos: derivaciones (cuántas, causa,
// cola), push, semáforo, campos entregados, esperas, y prohibiciones de
// texto (art. 9). La varianza del modelo no puede hacer flaky una aserción
// de resultado.
//
// LOS ROJOS SON EL PUNTO: los fallos del recorrido del 17-08 entran aquí
// ANTES de arreglarse. La primera pasada TIENE que dar rojos donde el
// diagnóstico dijo — si un rojo sale verde, el recorrido está mal escrito.
//
// Coste: ~13 turnos de modelo ≈ $0.10/pasada. Limpieza: admin (eventos) +
// app (mini-mundos). Salidas §9: 0 = todos verdes · 1 = hay rojos ·
// 2 = el harness no pudo correr.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

process.env.DATA_BACKEND_PG_CLIENTES = process.env.DATA_BACKEND_PG_CLIENTES || "DEMO";

import pg from "pg";
import { runWithCliente } from "../app/lib/airtable";
import { getServicioMensajeria } from "../app/lib/presupuestos/mensajeria";
import { evaluarEntranteConversacion } from "../app/lib/agente/evaluar-entrante";
import { registrarEvento } from "../app/lib/automatizacion/pg";
import { semaforoDeContacto, type MotivoRojo } from "../app/lib/automatizacion/semaforo";
import { colaDeDerivacion, type CausaDerivacion } from "../app/lib/automatizacion/estado";
import { generarColaDelDia } from "../app/lib/presupuestos/generar-cola";
import { hoyISO } from "../app/lib/time";
import type { PayloadEvaluacion } from "../app/lib/agente/persistir-turno";

for (const v of ["SUPABASE_DB_URL_APP", "SUPABASE_DB_URL_ADMIN", "ANTHROPIC_API_KEY"]) {
  if (!process.env[v]) {
    console.error(`✗ Falta ${v} — no puedo correr recorridos.`);
    process.exit(2);
  }
}

const app = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_APP, ssl: { rejectUnauthorized: false } });
await app.connect();

// Patrón del pooler (MEJORAS 95): cada consulta en su transacción.
async function q(texto: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> {
  await app.query("begin");
  try {
    await app.query("select set_config('app.cliente','DEMO',true)");
    const r = await app.query(texto, params);
    await app.query("commit");
    return r as { rows: any[]; rowCount: number | null };
  } catch (e) {
    await app.query("rollback").catch(() => {});
    throw e;
  }
}

// ─── El vocabulario de un recorrido ─────────────────────────────────────────

type Paso =
  | { entra: string }
  | { pasanDias: number }
  | { persona: "crear_cita" | "resolver" | "aceptar_presupuestos" | "pagar_todo" }
  | { cadencia: true };

type Mundo = {
  /** Sin paciente = desconocido total (solo nombre de perfil de WhatsApp). */
  paciente?: { nombre: string };
  presupuesto?: { importe: number; estado: string; tratamiento: string; haceDias: number };
  /** Pago parcial ya registrado (deja cobro pendiente = importe − pago). */
  pago?: number;
};

type Esperado = {
  derivaciones: { total: number; causa?: CausaDerivacion; cola?: "prioritaria" | "normal" };
  push: number;
  semaforo: "verde" | MotivoRojo;
  /** En el ÚLTIMO payload con derivación (o el último a secas): claves con
   *  valor real dentro de la etapa. */
  camposEntregados?: { etapa: string; claves: string[] };
  esperas?: { fijadas: number; levantadas: number };
  /** El último borrador NO puede contener estos textos (art. 9: tratamiento
   *  e importes en un recordatorio de cobro) y SÍ alguno de los otros. */
  borradorFinal?: { sinTextos?: string[]; conAlguno?: string[] };
  /** Filas en cola_envios para el teléfono del flujo (la cadencia calló). */
  enColaEnvios?: number;
};

type Recorrido = {
  id: string;
  titulo: string;
  tel: string;
  nombrePerfil?: string;
  mundo: Mundo;
  pasos: Paso[];
  esperado: Esperado;
  /** Lo que el diagnóstico del 17-08 predice para HOY, antes de los fixes. */
  hoyDebeDar: "verde" | "rojo";
};

// ─── Mini-mundos ────────────────────────────────────────────────────────────

let clinicaId = "";
let doctorNombre = "Dra. Demo";

async function construirMundo(r: Recorrido): Promise<{ pacienteId: string | null; presupuestoId: string | null }> {
  if (!r.mundo.paciente) return { pacienteId: null, presupuestoId: null };
  const pac = await q(
    `insert into pacientes (cliente, nombre, telefono, clinica_id, consentimiento_whatsapp, activo)
     values ('DEMO', $1, $2, $3, true, true) returning id`,
    [r.mundo.paciente.nombre, r.tel, clinicaId],
  );
  const pacienteId = pac.rows[0].id as string;
  let presupuestoId: string | null = null;
  if (r.mundo.presupuesto) {
    const p = r.mundo.presupuesto;
    const fecha = new Date(`${hoyISO()}T10:00:00Z`);
    fecha.setUTCDate(fecha.getUTCDate() - p.haceDias);
    const pr = await q(
      `insert into presupuestos (cliente, paciente_id, clinica_id, tratamiento_nombre, estado, importe,
         fecha, fecha_alta, ${p.estado === "ACEPTADO" ? "fecha_aceptado," : ""} doctor, paciente_telefono, contact_count)
       values ('DEMO', $1, $2, $3, $4, $5, $6, $6, ${p.estado === "ACEPTADO" ? "$6," : ""} $7, $8, 1) returning id`,
      [pacienteId, clinicaId, p.tratamiento, p.estado, p.importe, fecha.toISOString().slice(0, 10), doctorNombre, r.tel],
    );
    presupuestoId = pr.rows[0].id as string;
  }
  if (r.mundo.pago != null) {
    await q(
      `insert into pagos_paciente (cliente, paciente_id, fecha_pago, importe, metodo, tipo)
       values ('DEMO', $1, now(), $2, 'Tarjeta', 'Senal')`,
      [pacienteId, r.mundo.pago],
    );
  }
  return { pacienteId, presupuestoId };
}

// ─── Ejecución de un recorrido ──────────────────────────────────────────────

const si = (b: boolean) => (b ? "✓" : "✗");

async function correr(r: Recorrido): Promise<boolean> {
  console.log(`\n━━ ${r.id} · ${r.titulo} ━━`);
  const inicio = new Date();
  const { pacienteId, presupuestoId } = await construirMundo(r);

  let hoy = hoyISO();
  let turno = 0;
  const servicio = getServicioMensajeria("waba");

  for (const paso of r.pasos) {
    if ("pasanDias" in paso) {
      const d = new Date(`${hoy}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + paso.pasanDias);
      hoy = d.toISOString().slice(0, 10);
      console.log(`  … pasan ${paso.pasanDias} días (hoy=${hoy})`);
      continue;
    }
    if ("cadencia" in paso) {
      const res = await generarColaDelDia({ clinicasPermitidas: null, hoy });
      console.log(`  … cadencia corre (hoy=${hoy}): generados=${res.generados} · en rojo=${res.enSemaforoRojo}`);
      continue;
    }
    if ("persona" in paso) {
      if (paso.persona === "crear_cita") {
        await q(
          `insert into citas (cliente, nombre, paciente_id, clinica_id, hora_inicio, hora_final, estado, origen)
           values ('DEMO', $1, $2, $3, now() + interval '2 days', now() + interval '2 days 30 minutes', 'Confirmada', 'Coordinación')`,
          [r.mundo.paciente?.nombre ?? "QA", pacienteId, clinicaId],
        );
        console.log("  … persona: crea la cita");
      } else if (paso.persona === "resolver") {
        await registrarEvento({ tipoCaso: "conversacion", casoId: r.tel, evento: "resuelto_manual", actorNombre: "qa-recorridos" });
        console.log("  … persona: marca resuelto");
      } else if (paso.persona === "aceptar_presupuestos") {
        await q(`update presupuestos set estado='ACEPTADO', fecha_aceptado=$2 where paciente_id=$1`, [pacienteId, hoy]);
        console.log("  … persona: acepta el/los presupuestos");
      } else if (paso.persona === "pagar_todo") {
        const pend = await q(
          `select coalesce((select sum(importe) from presupuestos where paciente_id=$1 and estado='ACEPTADO'),0) -
                  coalesce((select sum(importe) from pagos_paciente where paciente_id=$1),0) as p`,
          [pacienteId],
        );
        const importe = Number(pend.rows[0].p);
        if (importe > 0)
          await q(
            `insert into pagos_paciente (cliente, paciente_id, fecha_pago, importe, metodo, tipo)
             values ('DEMO', $1, now(), $2, 'Tarjeta', 'Liquidacion')`,
            [pacienteId, importe],
          );
        console.log(`  … persona: registra el pago (${importe} €)`);
      }
      continue;
    }
    // Entrante por el bucle REAL: registrar + evaluar, como el webhook.
    turno++;
    const mensajeId = `qa_rec_${r.id}_${turno}`;
    await servicio.recibirMensaje({
      telefono: r.tel,
      contenido: paso.entra,
      presupuestoId: presupuestoId ?? undefined,
      nombrePerfil: r.nombrePerfil ?? null,
      clinicaId,
      wabaMessageId: mensajeId,
    });
    await evaluarEntranteConversacion({
      telefono: r.tel,
      mensajeId,
      contenido: paso.entra,
      presupuestoId,
      clinicaId,
      hoy,
    });
    console.log(`  → paciente: «${paso.entra.slice(0, 60)}${paso.entra.length > 60 ? "…" : ""}»`);
  }

  // ── Aserciones de RESULTADO ──────────────────────────────────────────────
  const evs = (
    await q(
      `select evento, causa_derivacion, malestar, clave_aplazado, evaluacion_json, hasta, created_at
         from eventos_automatizacion where caso_id=$1 order by created_at`,
      [r.tel],
    )
  ).rows;
  const derivados = evs.filter((e) => e.evento === "derivado");
  const evaluaciones = evs.filter((e) => e.evento === "evaluacion");
  const payloads: PayloadEvaluacion[] = evaluaciones.map((e) => JSON.parse(e.evaluacion_json));
  const fijadas = evs.filter((e) => e.evento === "espera_fijada").length;
  const levantadas = evs.filter((e) => e.evento === "espera_levantada").length;
  const sem = await semaforoDeContacto(r.tel, { hoy });
  const nombreCorto = (r.mundo.paciente?.nombre ?? r.nombrePerfil ?? r.tel).split(" ")[0];
  const push = (
    await q(
      `select count(*)::int n from notificaciones
        where tipo='Intervencion_urgente' and created_at >= $1 and titulo like '%' || $2 || '%'`,
      [inicio.toISOString(), nombreCorto],
    )
  ).rows[0].n as number;
  const enCola = (
    await q(`select count(*)::int n from cola_envios where telefono=$1`, [r.tel])
  ).rows[0].n as number;

  const fallos: string[] = [];
  const ok = (nombre: string, cond: boolean, extra = "") => {
    console.log(`    ${si(cond)} ${nombre}${extra ? ` — ${extra}` : ""}`);
    if (!cond) fallos.push(nombre);
  };

  const e = r.esperado;
  ok(
    `derivaciones: ${e.derivaciones.total}`,
    derivados.length === e.derivaciones.total,
    `hay ${derivados.length}`,
  );
  if (e.derivaciones.total > 0 && derivados.length > 0) {
    const d = derivados[derivados.length - 1];
    if (e.derivaciones.causa) ok(`causa: ${e.derivaciones.causa}`, d.causa_derivacion === e.derivaciones.causa, `es ${d.causa_derivacion}`);
    if (e.derivaciones.cola) {
      const cola = colaDeDerivacion(d.causa_derivacion, d.malestar);
      ok(`cola: ${e.derivaciones.cola}`, cola === e.derivaciones.cola, `es ${cola}`);
    }
  }
  ok(`push: ${e.push}`, push === e.push, `hubo ${push}`);
  ok(
    `semáforo final: ${e.semaforo}`,
    e.semaforo === "verde" ? sem.verde : !sem.verde && sem.motivo === e.semaforo,
    sem.verde ? "verde" : `rojo (${sem.motivo})`,
  );
  if (e.camposEntregados) {
    const ultimo = payloads[payloads.length - 1];
    const campos = (ultimo?.camposRecogidos as any)?.[e.camposEntregados.etapa] ?? {};
    const conValor = e.camposEntregados.claves.filter((k) => campos[k] != null && String(campos[k]).trim() !== "" && campos[k] !== "no_aplica");
    ok(
      `campos entregados (${e.camposEntregados.etapa}): ${e.camposEntregados.claves.join(", ")}`,
      conValor.length === e.camposEntregados.claves.length,
      `con valor: [${conValor.join(", ")}]`,
    );
  }
  if (e.esperas) {
    ok(`esperas fijadas: ${e.esperas.fijadas}`, fijadas === e.esperas.fijadas, `hay ${fijadas}`);
    ok(`esperas levantadas: ${e.esperas.levantadas}`, levantadas === e.esperas.levantadas, `hay ${levantadas}`);
  }
  if (e.borradorFinal) {
    const borrador = payloads[payloads.length - 1]?.respuesta ?? "";
    for (const t of e.borradorFinal.sinTextos ?? []) {
      ok(`el borrador NO nombra «${t}» (art. 9)`, !borrador.toLowerCase().includes(t.toLowerCase()));
    }
    if (e.borradorFinal.conAlguno) {
      ok(
        `el borrador menciona el cobro (alguno de: ${e.borradorFinal.conAlguno.join("/")})`,
        e.borradorFinal.conAlguno.some((t) => borrador.toLowerCase().includes(t.toLowerCase())),
        `borrador: «${borrador.slice(0, 90)}…»`,
      );
    }
  }
  if (e.enColaEnvios != null) {
    ok(`filas en cola de envíos: ${e.enColaEnvios}`, enCola === e.enColaEnvios, `hay ${enCola}`);
  }

  const verde = fallos.length === 0;
  console.log(`  ${verde ? "🟢 VERDE" : `🔴 ROJO (${fallos.length} aserciones)`} · el diagnóstico del 17-08 predecía: ${r.hoyDebeDar.toUpperCase()}`);
  return verde;
}

// ─── LOS RECORRIDOS ─────────────────────────────────────────────────────────

const RECORRIDOS: Recorrido[] = [
  {
    id: "R1",
    titulo: "Lead nuevo → el agente recoge y ENTREGA",
    tel: "+34611998001",
    nombrePerfil: "Marcos L.",
    mundo: {},
    pasos: [
      { entra: "Hola, ¿hacéis ortodoncia invisible? Me gustaría informarme" },
      { entra: "Me llamo Marcos Lorente, nunca he ido a vuestra clínica" },
    ],
    esperado: {
      derivaciones: { total: 1, causa: "caso_completo", cola: "normal" },
      push: 0,
      semaforo: "derivado_sin_resolver",
      camposEntregados: { etapa: "identificar", claves: ["nombre", "que_necesita"] },
    },
    hoyDebeDar: "rojo", // extracción de identificar vacía + sin entrega (diagnóstico b2)
  },
  {
    id: "R2",
    titulo: "Presupuesto pendiente → acepta → ENTREGA",
    tel: "+34611998002",
    mundo: {
      paciente: { nombre: "QA Berta Rico" },
      presupuesto: { importe: 900, estado: "PRESENTADO", tratamiento: "Corona sobre implante", haceDias: 5 },
    },
    pasos: [{ entra: "Lo hemos pensado y sí, adelante con el tratamiento. Cuando queráis empezamos" }],
    esperado: {
      derivaciones: { total: 1, causa: "caso_completo", cola: "normal" },
      push: 0,
      semaforo: "derivado_sin_resolver",
      camposEntregados: { etapa: "presupuesto", claves: ["decision"] },
    },
    hoyDebeDar: "rojo", // la aceptación no entregó en el recorrido real (no_aplica a medias)
  },
  {
    id: "R3",
    titulo: "PACIENTE pide cita → debe llegar a alguien SIEMPRE",
    tel: "+34611998003",
    mundo: { paciente: { nombre: "QA Aurora Gil" } },
    pasos: [
      { entra: "Hola, soy paciente vuestra. Querría cita para una limpieza, mejor por las tardes" },
    ],
    esperado: {
      derivaciones: { total: 1, causa: "caso_completo", cola: "normal" },
      push: 0,
      semaforo: "derivado_sin_resolver",
    },
    hoyDebeDar: "rojo", // el fallo nº1: sin objetivo para pacientes, nada entrega
  },
  {
    id: "R4",
    titulo: "Urgencia → prioritaria → resuelta por hecho → el agente VUELVE",
    tel: "+34611998004",
    mundo: {
      paciente: { nombre: "QA Íñigo Sanz" },
      presupuesto: { importe: 500, estado: "PRESENTADO", tratamiento: "Endodoncia molar", haceDias: 2 },
    },
    pasos: [
      { entra: "Me sacaron una muela ayer y no para de sangrar, estoy asustado" },
      { persona: "crear_cita" },
      { entra: "Gracias, ya tengo la cita. ¿Tengo que llevar algo?" },
    ],
    esperado: {
      derivaciones: { total: 1, causa: "urgencia", cola: "prioritaria" },
      push: 1,
      // La cita creada cerró la urgencia y el agente contestó el 3er mensaje:
      // el turno queda evaluado y el semáforo en verde (nada nuevo derivó...
      // salvo que el 3er turno anote duda_clinica y siga — sigue siendo verde).
      semaforo: "verde",
    },
    hoyDebeDar: "verde", // lo probó Simon en el recorrido manual
  },
  {
    id: "R5",
    titulo: "Espera fijada → movida → levantada al responder al motivo",
    tel: "+34611998005",
    mundo: {
      paciente: { nombre: "QA Olivia Mora" },
      presupuesto: { importe: 1200, estado: "PRESENTADO", tratamiento: "Ortodoncia invisible", haceDias: 4 },
    },
    pasos: [
      { entra: "Lo tengo que consultar, dame un par de días — el viernes os digo" },
      { cadencia: true }, // con la espera vigente: NADIE le escribe
      { entra: "Al final mañana os digo algo seguro, perdona" }, // la espera SE MUEVE
      { entra: "Ya está decidido: adelante con la ortodoncia" }, // responde al motivo → se LEVANTA + entrega
    ],
    esperado: {
      derivaciones: { total: 1, causa: "caso_completo", cola: "normal" },
      push: 0,
      semaforo: "derivado_sin_resolver",
      esperas: { fijadas: 2, levantadas: 1 },
      enColaEnvios: 0,
    },
    hoyDebeDar: "rojo", // movida y levantada-por-motivo no existen aún (reglas del 17-08)
  },
  {
    id: "R6",
    titulo: "VARIOS ASUNTOS: cobro pendiente + pide cita — cierra el activo, recuerda el cobro sin art. 9, sin push",
    tel: "+34611998006",
    mundo: {
      paciente: { nombre: "QA Ramiro Vega" },
      presupuesto: { importe: 900, estado: "ACEPTADO", tratamiento: "Implante unitario", haceDias: 10 },
      pago: 300, // pendiente de cobro: 600 €
    },
    pasos: [
      { entra: "Hola, querría cita para empezar el tratamiento. Me viene bien por las tardes" },
    ],
    esperado: {
      derivaciones: { total: 1, causa: "caso_completo", cola: "normal" },
      push: 0,
      semaforo: "derivado_sin_resolver",
      borradorFinal: {
        sinTextos: ["implante", "900", "600"], // art. 9: ni tratamiento ni importes
        conAlguno: ["pago", "pendiente", "cobro", "importe"],
      },
    },
    hoyDebeDar: "rojo", // hoy el único objetivo es cobro: ni entrega la cita ni una sola derivación limpia
  },
];

// ─── Limpieza ───────────────────────────────────────────────────────────────

const TELS = RECORRIDOS.map((r) => r.tel);
const NOMBRES_QA = RECORRIDOS.map((r) => r.mundo.paciente?.nombre).filter(Boolean) as string[];
/** El paso `cadencia` genera borradores REALES para todo el DEMO (es el
 *  punto: correr la generación de verdad). Se limpian por ventana temporal —
 *  la primera pasada dejó 27 filas de otros pacientes y nadie las pidió. */
const ARRANQUE = new Date();

async function limpiar() {
  const admin = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL_ADMIN, ssl: { rejectUnauthorized: false } });
  await admin.connect();
  await admin.query(`delete from eventos_automatizacion where cliente='DEMO' and caso_id = any($1)`, [TELS]);
  await admin.end();
  await q(`delete from cola_envios where telefono = any($1) or created_at >= $2`, [TELS, ARRANQUE.toISOString()]);
  await q(`delete from mensajes_whatsapp where telefono = any($1)`, [TELS]);
  await q(`delete from notificaciones where cliente='DEMO' and created_at > now() - interval '1 hour' and (${NOMBRES_QA.map((_, i) => `titulo like '%' || $${i + 1} || '%'`).join(" or ")})`, NOMBRES_QA.map((n) => n.split(" ")[1] ?? n));
  const pacs = await q(`select id from pacientes where nombre = any($1)`, [NOMBRES_QA]);
  const ids = pacs.rows.map((x: any) => x.id);
  if (ids.length) {
    await q(`delete from citas where paciente_id = any($1)`, [ids]);
    await q(`delete from pagos_paciente where paciente_id = any($1)`, [ids]);
    await q(`delete from presupuestos where paciente_id = any($1)`, [ids]);
    await q(`delete from pacientes where id = any($1)`, [ids]);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

await limpiar(); // por si una pasada anterior murió a medias

const clin = await q(`select id, nombre from clinicas where nombre ilike '%norte%' limit 1`);
if (!clin.rows[0]) {
  console.error("✗ No hay clínica Norte en DEMO — corre demo:reset.");
  process.exit(2);
}
clinicaId = clin.rows[0].id;
const doc = await q(`select nombre from doctores_presupuestos limit 1`);
doctorNombre = doc.rows[0]?.nombre ?? "Dra. Demo";

let verdes = 0;
const resultados: { id: string; verde: boolean; predicho: string }[] = [];
await runWithCliente("DEMO", async () => {
  for (const r of RECORRIDOS) {
    try {
      const verde = await correr(r);
      if (verde) verdes++;
      resultados.push({ id: r.id, verde, predicho: r.hoyDebeDar });
    } catch (err) {
      console.error(`  ✗ ${r.id} REVENTÓ (no es un rojo, es un fallo del harness):`, err instanceof Error ? err.message : err);
      resultados.push({ id: r.id, verde: false, predicho: r.hoyDebeDar });
    }
  }
});

await limpiar();
console.log("\n  ✓ mini-mundos y eventos limpiados");

console.log(`\n══ RESULTADO: ${verdes}/${RECORRIDOS.length} recorridos en verde ══`);
const sorpresas = resultados.filter((x) => (x.verde ? "verde" : "rojo") !== x.predicho);
if (sorpresas.length) {
  console.log(`  ⚠ SORPRESAS vs el diagnóstico (revisar si el recorrido está bien escrito):`);
  for (const s of sorpresas) console.log(`    · ${s.id}: salió ${s.verde ? "VERDE" : "ROJO"}, se predijo ${s.predicho.toUpperCase()}`);
} else {
  console.log("  Los resultados coinciden con lo que el diagnóstico predijo.");
}

await app.end();
process.exit(verdes === RECORRIDOS.length ? 0 : 1);
