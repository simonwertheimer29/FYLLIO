#!/usr/bin/env tsx
// scripts/qa-agenda-juicio.mts — LA VARA DE LA COMPARACIÓN (= npm run qa:agenda-juicio)
//
// Determinista, SIN modelo y SIN base (coste 0, milisegundos): prueba la
// función que decide cómo se lee el corpus de agenda, no el juicio en sí.
//
// LO QUE PROTEGE, y es la condición de Simon del 14-09: los «ninguno» se
// cuentan APARTE. El caso 1 es la reproducción del error que esta separación
// evita — un juicio que falla TODA la vara y acierta todos los descartes
// enseña un global altísimo. Si alguien mete los «ninguno» en `vara`, aquí se
// pone rojo; sin este caso, se descubriría leyendo un 86 % como si fuera bueno.
//
// Qué NO prueba: si el juicio acierta. Eso no lo puede decir un test —lo dice
// el corpus etiquetado y se mide con `npm run agenda:juicio`, que sí gasta
// modelo. Aquí solo se comprueba que el recuento no mienta.
//
// Salidas (§9): 0 = bien · 1 = el recuento miente.

import {
  compararAgenda,
  gravedadDelPar,
  type EtiquetaAgenda,
  type FilaComparada,
} from "../app/lib/agente/agenda-enrutador";
import { parsearJuicioAgenda } from "../app/lib/agente/juicio-agenda";

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? " — " + extra : ""}`);
  if (!c) fallos++;
};

/** Una fila mínima: solo lo que mira `compararAgenda`. El resto del candidato
 *  no participa en el recuento y rellenarlo escondería qué se está probando. */
const fila = (
  etiqueta: EtiquetaAgenda | null,
  juicio: EtiquetaAgenda | null,
  extra: { seArroga?: boolean | null; juicioSeArroga?: boolean | null } = {},
): FilaComparada =>
  ({
    clave: `k${Math.random()}`,
    etiqueta,
    seArroga: extra.seArroga ?? null,
    juicio: { etiqueta: juicio, seArroga: extra.juicioSeArroga ?? null, porQue: null, version: null, modelo: null, en: null },
  }) as unknown as FilaComparada;

console.log("\n1 · EL CASO QUE JUSTIFICA LA SEPARACIÓN: fallar toda la vara y acertar todo el descarte");
{
  // 10 falsables, todos mal. 90 «ninguno», todos bien. El global sale al 90 %.
  const filas = [
    ...Array.from({ length: 5 }, () => fila("afirma", "repite")),
    ...Array.from({ length: 5 }, () => fila("repite", "afirma")),
    ...Array.from({ length: 90 }, () => fila("ninguno", "ninguno")),
  ];
  const c = compararAgenda(filas);
  ok("la vara dice 0 %", c.vara.pct === 0, `vara=${c.vara.acuerdo}/${c.vara.n}`);
  ok("el descarte dice 100 % y va aparte", c.descarte.pct === 100 && c.descarte.n === 90);
  ok("el global halaga (90 %) — por eso no es la nota", c.global.pct === 90);
  ok("los «ninguno» NO están en la vara", c.vara.n === 10);
  ok("deja pasar 5 afirmaciones falsas", c.vara.dejaPasar === 5);
  ok("veta de más 5 veces", c.vara.vetaDeMas === 5);
}

console.log("\n2 · los tres errores de la vara se nombran por lo que cuestan");
{
  const c = compararAgenda([
    fila("afirma", "repite"), // llega al paciente
    fila("afirma", "ninguno"), // llega al paciente igual
    fila("repite", "afirma"), // calla al agente
    fila("repite", "ninguno"), // no veta nada, pero no lo entendió
    fila("ninguno", "afirma"), // ruido
  ]);
  ok("dejaPasar cuenta los DOS modos de dejar pasar", c.vara.dejaPasar === 2);
  ok("vetaDeMas = 1", c.vara.vetaDeMas === 1);
  ok("seLoSalta = 1", c.vara.seLoSalta === 1);
  ok("el ruido vive en el bloque del descarte, no en la vara", c.descarte.ruido === 1 && c.vara.n === 4);
  ok("gravedad: afirma→repite es deja_pasar", gravedadDelPar("afirma", "repite") === "deja_pasar");
  ok("gravedad: repite→afirma es veta_de_mas", gravedadDelPar("repite", "afirma") === "veta_de_mas");
  ok("gravedad: ninguno→afirma es ruido", gravedadDelPar("ninguno", "afirma") === "ruido");
  ok("coincidir no es un desacuerdo", gravedadDelPar("afirma", "afirma") === null);
  ok("sin juicio no es un desacuerdo", gravedadDelPar("afirma", null) === null);
}

console.log("\n3 · lo incomparable no entra en ningún porcentaje");
{
  const c = compararAgenda([
    fila("afirma", "afirma"),
    fila("repite", null), // etiquetado, sin juicio
    fila(null, "afirma"), // juzgado, sin etiquetar
    fila(null, null), // ni lo uno ni lo otro
  ]);
  ok("comparables = 1", c.comparables === 1);
  ok("sinJuicio = 1", c.sinJuicio === 1);
  ok("sinEtiqueta = 1", c.sinEtiqueta === 1);
  ok("el total incluye lo que falta (un % sobre media lista miente)", c.total === 4);
  ok("la vara no cuenta lo que le falta una mitad", c.vara.n === 1 && c.vara.pct === 100);
}

console.log("\n4 · la segunda pregunta tiene SU denominador (es opcional al etiquetar)");
{
  const c = compararAgenda([
    fila("afirma", "afirma", { seArroga: true, juicioSeArroga: true }),
    fila("afirma", "afirma", { seArroga: true, juicioSeArroga: false }),
    fila("afirma", "afirma", { seArroga: false, juicioSeArroga: true }),
    fila("afirma", "afirma", { seArroga: null, juicioSeArroga: true }), // él no contestó
  ]);
  ok("solo cuenta donde contestaron los dos", c.reserva.n === 3);
  ok("acuerdo = 1", c.reserva.acuerdo === 1);
  ok("se la arroga y el juicio no lo ve = 1", c.reserva.seLaArrogaYNoLoVe === 1);
  ok("se alarma sin motivo = 1", c.reserva.alarmaDeMas === 1);
  ok("no contamina la vara", c.vara.n === 4 && c.vara.acuerdo === 4);
}

console.log("\n5 · la matriz cuadra con los bloques");
{
  const filas = [fila("afirma", "repite"), fila("afirma", "afirma"), fila("ninguno", "afirma"), fila("repite", "repite")];
  const c = compararAgenda(filas);
  const suma = (Object.keys(c.matriz) as EtiquetaAgenda[]).reduce(
    (s, m) => s + (Object.keys(c.matriz[m]) as EtiquetaAgenda[]).reduce((t, j) => t + c.matriz[m][j], 0),
    0,
  );
  ok("la matriz suma los comparables", suma === c.comparables && suma === 4);
  ok("matriz[afirma][repite] = 1", c.matriz.afirma.repite === 1);
  ok("matriz[ninguno][afirma] = 1", c.matriz.ninguno.afirma === 1);
}

console.log("\n6 · el borde del juicio: se canoniza y lo que no encaja se CUENTA (§19)");
{
  const r = parsearJuicioAgenda('{"porQue":"afirma un hueco","etiqueta":"AFIRMA","seArroga":true}');
  ok("«AFIRMA» → «afirma»", r?.etiqueta === "afirma");
  ok("seArroga booleano se conserva", r?.seArroga === true);
  ok("sin descartes", r?.descartes.length === 0);
}
{
  const r = parsearJuicioAgenda('Claro:\n```json\n{"porQue":"x","etiqueta":" Repite ","seArroga":false}\n```');
  ok("con fences y espacios alrededor → «repite»", r?.etiqueta === "repite");
}
{
  const r = parsearJuicioAgenda('{"porQue":"x","etiqueta":"ningún","seArroga":false}');
  ok("fuera de vocabulario → null Y contado", r?.etiqueta === null && r.descartes.some((d) => d.startsWith("juicioAgenda.etiqueta:")));
}
{
  const r = parsearJuicioAgenda('{"porQue":"x","etiqueta":"afirma","seArroga":"sí"}');
  ok("seArroga no booleano → null Y contado", r?.etiqueta === "afirma" && r.seArroga === null && r.descartes.some((d) => d.startsWith("juicioAgenda.seArroga:")));
}
{
  const r = parsearJuicioAgenda('{"porQue":"x","etiqueta":"afirma"}');
  ok("seArroga ausente → null SIN contar", r?.seArroga === null && r.descartes.length === 0);
}
{
  ok("sin JSON → null (no se inventa un veredicto)", parsearJuicioAgenda("no puedo contestar") === null);
  ok("JSON roto → null", parsearJuicioAgenda('{"etiqueta":"afirma"') === null);
}

// ─── MEJORAS 239 · LA CLAVE LLEVA EL TEXTO DENTRO ──────────────────────────
//
// Lo que protege: que rejugar un hilo NO pueda heredar la etiqueta de Simon.
// Es el fallo más caro de los posibles aquí porque es invisible — el número
// cambia y nadie ha tocado el juez.
console.log("\n5 · la clave de un candidato lleva la huella de su texto (rejugar no hereda etiquetas)");
{
  const { claveCandidato, leerClave } = await import("../app/lib/agente/agenda-corpus");
  const { huellaTexto } = await import("../app/lib/agente/version");
  const ID = "guion:caso_completo:alcance:2";

  const a = claveCandidato(ID, "codigo", "Te anotamos el jueves 17 por la tarde.");
  const b = claveCandidato(ID, "codigo", "Apunto tu preferencia de jueves por la tarde.");
  ok("EL CASO QUE JUSTIFICA TODO: mismo turno y mismo decisor, otro texto → OTRA clave", a !== b);
  ok("y el mismo texto da siempre la misma clave (si no, nada se podría reetiquetar)",
    a === claveCandidato(ID, "codigo", "Te anotamos el jueves 17 por la tarde."));

  const l = leerClave(a);
  ok("la clave se puede deshacer: mensajeId, fuente y huella", l?.mensajeId === ID && l?.fuente === "codigo");
  ok("y la huella es la del texto (12 hex de sha256, sin normalizar — la migración 055 calcula la misma)",
    l?.huella === huellaTexto("Te anotamos el jueves 17 por la tarde.") && /^[0-9a-f]{12}$/.test(l!.huella));

  // La forma VIEJA deja de leerse a propósito: una etiqueta que llegue hoy con
  // clave sin huella es una clave inventada (la migración 055 convirtió las 91).
  ok("una clave de la forma vieja ya NO se lee (`textoDeClave` la rechaza y no se escribe nada)",
    leerClave(`${ID}|codigo`) === null);
  ok("ni una con una huella que no lo es", leerClave(`${ID}|codigo|NOESUNHASH`) === null);
  ok("ni una con una fuente inventada", leerClave(`${ID}|modelo_inventado|${huellaTexto("x")}`) === null);

  // Se lee de DERECHA a izquierda: un mensaje_id de la sombra puede llevar «|».
  const raro = "wamid|con|barras";
  const c = claveCandidato(raro, "modelo_libre", "hola");
  ok("un mensajeId con «|» dentro se sigue leyendo entero", leerClave(c)?.mensajeId === raro && leerClave(c)?.fuente === "modelo_libre");
}

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s) — el recuento del corpus de agenda miente`);
  process.exit(1);
}
console.log("\n✓ los «ninguno» van aparte, los errores se nombran por su coste, el borde cuenta lo que descarta y la clave lleva su texto");
