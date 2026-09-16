#!/usr/bin/env tsx
// QA DEL JUICIO «respuestaACita» (17-09, paso 3b), con modelo (~$0,02).
//
//   npm run qa:hueco-rechazado
//
// Cuatro turnos sintéticos con una cita CONFIRMADA por WhatsApp en el
// contexto: rechaza / contrapropone / acepta / habla de otra cosa. Se mide
// (1) el juicio del modelo, (2) que rechazar o contraproponer DERIVA con
// causa hueco_rechazado a la cola prioritaria y la respuesta es la plantilla
// de código, y (3) que aceptar u otra cosa NO deriva por esto. Y un quinto
// turno SIN cita confirmada: el juicio tiene que ser null.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { evaluarTurno, type EntradaEvaluador, type MensajeHilo } from "../app/lib/agente/evaluador";
import { OBJETIVOS_POR_DEFECTO } from "../app/lib/automatizacion/objetivos";
import { plantillaHuecoRechazado } from "../app/lib/agente/plantillas-hueco";

const T = (i: number) => `2026-09-17T10:${String(i).padStart(2, "0")}:00Z`;
const E = (c: string, i: number): MensajeHilo => ({ direccion: "Entrante", contenido: c, timestamp: T(i) });
const S = (c: string, i: number): MensajeHilo => ({ direccion: "Saliente", contenido: c, timestamp: T(i) });
const CITA = { fecha: "2026-09-24", hora: "10:00", doctor: "Dra. Marta Villalba" };
const CONFIRMACION = "Hola, Carla. Te confirmamos tu cita en Clínica Norte: jueves, 24 de septiembre a las 10:00 con Dra. Marta Villalba. Si no te viene bien, dínoslo por aquí y buscamos otra hora.";
const base = (ultimo: string, conCita = true): EntradaEvaluador => ({
  nombre: "Carla",
  esPacienteConocido: false,
  // Con cita confirmada no hay objetivo abierto (el contexto ya no abre «cita»
  // y «mover_cita» solo si el texto lo pide); sin cita, «cita» sigue abierta.
  objetivosAbiertos: conCita ? [] : [OBJETIVOS_POR_DEFECTO.find((o) => o.etapa === "cita")!],
  presupuestosVivos: [],
  pendienteCobro: 0,
  hilo: conCita
    ? [E("Hola, quería cita para una limpieza, mejor los jueves por la mañana", 0), S(CONFIRMACION, 1), E(ultimo, 2)]
    : [E("Hola, quería cita para una limpieza, mejor los jueves por la mañana", 0), S("¡Claro! ¿Te va bien por la mañana cualquier día?", 1), E(ultimo, 2)],
  aplazadosPendientes: [],
  aplazadosPorClave: {},
  yaDerivado: false,
  diasHastaProximaCita: conCita ? 7 : null,
  citaConfirmada: conCita ? CITA : null,
});

const CASOS: Array<{ id: string; entrada: EntradaEvaluador; juicio: "acepta" | "rechaza" | "contrapropone" | null; deriva: boolean }> = [
  { id: "rechaza", entrada: base("Uy, ese día no me viene bien, no voy a poder."), juicio: "rechaza", deriva: true },
  { id: "contrapropone", entrada: base("¿Y el viernes por la tarde podría ser?"), juicio: "contrapropone", deriva: true },
  { id: "acepta", entrada: base("Perfecto, allí estaré. ¡Gracias!"), juicio: "acepta", deriva: false },
  { id: "otra_cosa", entrada: base("¿Tenéis parking cerca de la clínica?"), juicio: null, deriva: false },
  { id: "sin_cita_confirmada", entrada: base("Los jueves no me viene bien, mejor viernes", false), juicio: null, deriva: false },
];

let rojos = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  ✓" : "  ✗"} ${m}`); if (!c) rojos++; };
let usd = 0;
for (const c of CASOS) {
  const r = await evaluarTurno(c.entrada, { sinControlDelBorrador: true } as any);
  if (r.usage) usd += (r.usage.inputTokens ?? 0) / 1e6 + ((r.usage.outputTokens ?? 0) * 5) / 1e6;
  const j = r.respuestaACita ?? null;
  console.log(`[${c.id}] juicio=${j} decision=${r.decision} causa=${r.causa ?? "—"} cola=${r.cola ?? "—"}`);
  ok(j === c.juicio, `juicio esperado ${c.juicio}`);
  if (c.deriva) {
    ok(r.decision === "deriva" && r.causa === "hueco_rechazado" && r.cola === "prioritaria", "deriva con hueco_rechazado, prioritaria");
    const esperado = plantillaHuecoRechazado({ nombre: "Carla", tipo: c.juicio as "rechaza" | "contrapropone", cita: CITA, idioma: "es" });
    ok(r.respuesta === esperado, "la respuesta es la plantilla de código");
    if (r.respuesta === esperado) console.log(`     «${r.respuesta}»`);
  } else {
    ok(r.causa !== "hueco_rechazado", "no deriva por hueco_rechazado");
  }
}
console.log(`\ncoste ~$${usd.toFixed(4)}`);
console.log(rojos ? `✗ ${rojos} rojos` : "✓ todo verde");
process.exit(rojos ? 1 : 0);
