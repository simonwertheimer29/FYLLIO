// scripts/qa-siguiente-config.mts
//
// QA de «Qué publicar para que el agente resuelva más» (2.3, MEJORAS 178),
// puro: los aplazados por tema de una ventana cruzados con lo publicado. Se
// comprueba que cada tema lleva a su sección, que lo ya publicado se declara
// cubierto (y sigue apareciendo), que lo que ninguna configuración arregla se
// dice sin botón, y el orden: accionable sin cubrir › cubierto › sin acción.
// Salida 1 = comprobé y está mal.

import { siguienteConfig } from "../app/lib/agente/siguiente-config";
import { CONOCIMIENTO_VACIO, type ConocimientoClinica } from "../app/lib/agente/conocimiento";
import type { Cubo } from "../app/lib/metricas/conversacion.tipos";

let fallos = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const ko = (m: string) => {
  fallos++;
  console.log(`  ✗ ${m}`);
};
const check = (cond: boolean, m: string) => (cond ? ok(m) : ko(m));
const cubo = (clave: string, n: number, ejemplos: string[] = []): Cubo => ({ clave, etiqueta: clave, n, previo: 0, ejemplos });

const preguntas: Cubo[] = [
  cubo("plan_pago", 14, ["¿puedo pagarlo a plazos?"]),
  cubo("agenda_disponibilidad", 9),
  cubo("precio_descuento", 6),
  cubo("duda_clinica", 4),
  cubo("dato_presupuesto", 3),
  cubo("cobertura_seguro", 0),
  cubo("lo_que_sea", 2),
];

console.log("Sin nada publicado:");
{
  const r = siguienteConfig(preguntas, CONOCIMIENTO_VACIO);
  check(r.map((x) => x.clave).join(",") === "plan_pago,agenda_disponibilidad,precio_descuento,duda_clinica,dato_presupuesto,otro", `orden: accionables por n, luego lo que no se arregla (${r.map((x) => x.clave).join(",")})`);
  check(!r.some((x) => x.clave === "cobertura_seguro"), "un tema con 0 conversaciones no aparece");
  const pp = r.find((x) => x.clave === "plan_pago")!;
  check(pp.n === 14 && pp.seccion === "politicas" && !pp.cubierto && /publica cómo se puede pagar/i.test(pp.accion ?? ""), "plan de pago: 14, sin cubrir, lleva a Políticas, con la frase de ejemplo");
  check(pp.ejemplos[0] === "¿puedo pagarlo a plazos?", "…y conserva la frase");
  const ag = r.find((x) => x.clave === "agenda_disponibilidad")!;
  check(ag.seccion === "agenda" && !ag.cubierto && /conecta tu agenda/i.test(ag.accion ?? ""), "huecos de agenda: conectar la agenda (nivel 1)");
  const dc = r.find((x) => x.clave === "duda_clinica")!;
  check(dc.accion === null && /doctor/.test(dc.porque ?? "") && dc.seccion === null, "duda clínica: sin acción, va al doctor");
  const dp = r.find((x) => x.clave === "dato_presupuesto")!;
  check(dp.accion === null && /IVA/.test(dp.porque ?? ""), "dato del presupuesto: sin acción, el sistema no guarda IVA ni validez (89)");
  const ot = r.find((x) => x.clave === "otro")!;
  check(ot.n === 2 && ot.etiqueta === "Otro", "una clave desconocida cae en «Otro»");
}

console.log("Con política de pago y agenda conectada:");
{
  const c: ConocimientoClinica = {
    ...CONOCIMIENTO_VACIO,
    agendaNivel: 2,
    politicas: [{ titulo: "Formas de pago", texto: "Financiación hasta 24 meses sin intereses." }],
  };
  const r = siguienteConfig(preguntas, c);
  const pp = r.find((x) => x.clave === "plan_pago")!;
  check(pp.cubierto && /ya publicas una política de pago/i.test(pp.accion ?? "") && pp.seccion === "politicas", "plan de pago: cubierto, sigue apareciendo con la lectura «revísala»");
  const ag = r.find((x) => x.clave === "agenda_disponibilidad")!;
  check(ag.cubierto && /conectada/.test(ag.accion ?? ""), "huecos: cubierto con la agenda en nivel 2");
  check(r[0].clave === "precio_descuento" && !r[0].cubierto, "el primero pasa a ser el accionable sin cubrir con más conversaciones (descuentos, 6)");
  const idx = (k: string) => r.findIndex((x) => x.clave === k);
  check(idx("precio_descuento") < idx("plan_pago") && idx("plan_pago") < idx("duda_clinica"), "orden: sin cubrir › cubierto › sin acción");
}

console.log("Ventana vacía:");
check(siguienteConfig([], CONOCIMIENTO_VACIO).length === 0, "sin aplazados, sin recomendaciones");

console.log(fallos ? `\n✗ ${fallos} comprobación(es) fallida(s)` : "\n✓ qa:siguiente-config en verde");
process.exit(fallos ? 1 : 0);
