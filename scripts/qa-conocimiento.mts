#!/usr/bin/env tsx
// QA del CONOCIMIENTO DE CLÍNICA (fase D, grupo 2) — determinista, SIN modelo.
//
//   npx tsx scripts/qa-conocimiento.mts   (= npm run qa:conocimiento)
//
//   A · parseConocimiento: NULL/vacío → vacío en silencio; ilegible LANZA
//       (jamás cae al default); forma estricta campo a campo.
//   B · EL ASSERT DEL PLAN BÁSICO (condición dictada 22-08, desde el PRIMER
//       commit): el prompt ensamblado con config vacía es BYTE A BYTE el
//       mismo que sin configuración. Si esto rompe, el plan básico se
//       degradó sin que nadie lo eligiera.
//   C · renderConocimiento con datos: precios tal cual, aviso «sin precio
//       publicado», la frontera (adaptar se anota) en cabecera.
//
// Puro de punta a punta: sin DB, sin red. Salidas §9: 0 · 1.

import {
  parseConocimiento,
  renderConocimiento,
  esConocimientoVacio,
  capacidadesDe,
  plazosParaReloj,
  horarioLegible,
  CONOCIMIENTO_VACIO,
  ConocimientoIlegibleError,
} from "../app/lib/agente/conocimiento";

/** Horario válido de referencia para los checks del grupo 4 (con sábado). */
const dia = { activo: true, inicio: "09:00", fin: "20:00" };
const HORARIO_QA = {
  lunes: { ...dia }, martes: { ...dia }, miercoles: { ...dia }, jueves: { ...dia },
  viernes: { ...dia }, sabado: { activo: true, inicio: "10:00", fin: "14:00" },
  domingo: { activo: false, inicio: "10:00", fin: "14:00" },
};
import { renderEntrada, type EntradaEvaluador } from "../app/lib/agente/evaluador";

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? " — " + extra : ""}`);
  if (!c) fallos++;
};
const lanza = (raw: string): boolean => {
  try {
    parseConocimiento(raw);
    return false;
  } catch (e) {
    return e instanceof ConocimientoIlegibleError;
  }
};

// ─── A · El parser ─────────────────────────────────────────────────────────
console.log("\nA · parseConocimiento: vacío en silencio, ilegible lanza");

ok("NULL → vacío en silencio (el estado normal de una clínica sin configurar)",
  esConocimientoVacio(parseConocimiento(null)) && esConocimientoVacio(parseConocimiento("")));
ok("JSON roto LANZA ConocimientoIlegibleError — jamás cae al default",
  lanza("{esto no es json"));
ok("forma equivocada (array, o tratamiento sin nombre) LANZA",
  lanza("[1,2]") && lanza(JSON.stringify({ tratamientos: [{ precio: "600 €" }] })));
ok("un enlace sin http(s) LANZA — un enlace roto en boca del agente es peor que ninguno",
  lanza(JSON.stringify({ enlaces: [{ etiqueta: "Reserva", url: "javascript:alert(1)" }] })));

const bueno = parseConocimiento(JSON.stringify({
  tratamientos: [
    { nombre: "Ortodoncia invisible", precio: "desde 35 €/mes", nota: "financiación 24 meses" },
    { nombre: "Blanqueamiento", precio: null, nota: null },
  ],
  politicas: [{ titulo: "Seguros", texto: "Trabajamos con Sanitas y Adeslas" }],
  plazos: { horario: HORARIO_QA },
  enlaces: [{ etiqueta: "Reserva online", url: "https://clinica.example/reserva" }],
}));
ok("una config válida se parsea entera, con los textos recortados",
  bueno.tratamientos.length === 2 && bueno.tratamientos[0].precio === "desde 35 €/mes" &&
    bueno.politicas.length === 1 && bueno.plazos.horario != null && bueno.enlaces.length === 1);
ok("campos ausentes = secciones vacías, no error (se publica por partes)",
  !lanza(JSON.stringify({ enlaces: [] })) &&
    parseConocimiento(JSON.stringify({ enlaces: [] })).tratamientos.length === 0);
ok("agenda: ausente → nivel 1 (sin conexión), el único que existe",
  parseConocimiento(JSON.stringify({ enlaces: [] })).agendaNivel === 1);
ok("agenda: nivel 2 guardado HOY se rechaza — prometería huecos que el agente no ve (MEJORAS 97)",
  lanza(JSON.stringify({ agendaNivel: 2 })) && lanza(JSON.stringify({ agendaNivel: 3 })));

// Grupos 1 y 3 (22-08):
ok("grupo 3: umbral de insistencia CON TOPE — 0 y 5 se rechazan, 1–4 pasan",
  lanza(JSON.stringify({ alcance: { umbralInsistencia: 0 } })) &&
    lanza(JSON.stringify({ alcance: { umbralInsistencia: 5 } })) &&
    parseConocimiento(JSON.stringify({ alcance: { umbralInsistencia: 3 } })).alcance.umbralInsistencia === 3);
ok("grupo 3: «no atendemos urgencias» SIN texto literal se rechaza — el modelo no improvisa ese mensaje",
  lanza(JSON.stringify({ alcance: { urgencias: { atiende: false } } })) &&
    parseConocimiento(JSON.stringify({ alcance: { urgencias: { atiende: false, textoNoAtiende: "Llama al 112" } } }))
      .alcance.urgencias?.textoNoAtiende === "Llama al 112");
ok("grupo 1: trato solo tu | usted",
  lanza(JSON.stringify({ quienesSois: { trato: "vos" } })) &&
    parseConocimiento(JSON.stringify({ quienesSois: { trato: "usted" } })).quienesSois.trato === "usted");
ok("grupo 4: umbrales con TOPE (urgencia 5 y 200 se rechazan; 45 pasa)",
  lanza(JSON.stringify({ plazos: { urgenciaMin: 5 } })) &&
    lanza(JSON.stringify({ plazos: { urgenciaMin: 200 } })) &&
    parseConocimiento(JSON.stringify({ plazos: { urgenciaMin: 45 } })).plazos.urgenciaMin === 45);
ok("grupo 4: un horario que cierra antes de abrir, o sin ningún día activo, se rechaza",
  lanza(JSON.stringify({ plazos: { horario: { ...HORARIO_QA, lunes: { activo: true, inicio: "20:00", fin: "09:00" } } } })) &&
    lanza(JSON.stringify({ plazos: { horario: Object.fromEntries(Object.keys(HORARIO_QA).map((d) => [d, { activo: false, inicio: "09:00", fin: "20:00" }])) } })));
{
  const p = parseConocimiento(JSON.stringify({ plazos: { respuestaMin: 480, horario: HORARIO_QA } }));
  const reloj = plazosParaReloj(p);
  ok("grupo 4: plazosParaReloj mapea umbrales por obligación y entrega el horario",
    reloj.umbralesMin.respuesta === 480 && reloj.umbralesMin.urgencia === undefined &&
      reloj.horario?.sabado.activo === true);
}
ok("horarioLegible agrupa días contiguos con el mismo tramo y omite los cerrados",
  horarioLegible(HORARIO_QA) === "lun–vie 9:00–20:00 · sáb 10:00–14:00" &&
    horarioLegible({ ...HORARIO_QA, miercoles: { activo: false, inicio: "09:00", fin: "20:00" } }) ===
      "lun–mar 9:00–20:00 · jue–vie 9:00–20:00 · sáb 10:00–14:00");

// ─── B · EL ASSERT DEL PLAN BÁSICO ─────────────────────────────────────────
console.log("\nB · plan básico: prompt con config vacía ≡ prompt de hoy, byte a byte");

const entradaBase: EntradaEvaluador = {
  nombre: "Elena García",
  esPacienteConocido: true,
  objetivosAbiertos: [],
  presupuestosVivos: [{ id: "p1", tratamiento: "Endodoncia", importe: 650 }],
  pendienteCobro: 0,
  hilo: [
    { direccion: "Entrante", contenido: "Hola, ¿cuánto cuesta una limpieza?", timestamp: "2026-08-22T10:00:00Z" },
  ],
  aplazadosPendientes: [],
  aplazadosPorClave: {},
  yaDerivado: false,
  hoy: "2026-08-22",
};
const sinCampo = renderEntrada(entradaBase).texto;
const conVacio = renderEntrada({ ...entradaBase, conocimiento: CONOCIMIENTO_VACIO }).texto;
const conNull = renderEntrada({ ...entradaBase, conocimiento: null }).texto;
ok("conocimiento ausente ≡ CONOCIMIENTO_VACIO ≡ null — ni un byte de diferencia",
  sinCampo === conVacio && sinCampo === conNull);
ok("y el prompt de hoy NO menciona lo publicado (sonda del assert: si esto falla, el assert no afirma nada)",
  !sinCampo.includes("LO PUBLICADO POR LA CLÍNICA"));

// ─── C · El render con datos ───────────────────────────────────────────────
console.log("\nC · con datos: lo publicado entra tal cual, con su frontera");

const conDatos = renderEntrada({ ...entradaBase, conocimiento: bueno }).texto;
ok("el bloque aparece con la frontera en cabecera (afirmar sí; adaptar se anota)",
  conDatos.includes("LO PUBLICADO POR LA CLÍNICA") && conDatos.includes("se anota siempre"));
ok("el precio publicado viaja TAL CUAL («desde 35 €/mes» — texto, no number)",
  conDatos.includes("Ortodoncia invisible: desde 35 €/mes"));
ok("un tratamiento sin precio lo dice: «sin precio publicado — no des cifra»",
  conDatos.includes("Blanqueamiento (sin precio publicado — no des cifra)"));
ok("horario (DERIVADO del único dato; 23-08: se presenta como APERTURA, no como huecos), políticas y enlaces presentes",
  conDatos.includes("Horario de APERTURA (cuándo abre la clínica): lun–vie 9:00–20:00 · sáb 10:00–14:00") &&
    conDatos.includes("NO son huecos libres") &&
    conDatos.includes("Sanitas") &&
    conDatos.includes("https://clinica.example/reserva"));
ok("y el resto del prompt no cambió (todo lo de antes sigue: presupuesto, hilo, calendario)",
  conDatos.includes("Endodoncia") && conDatos.includes("CALENDARIO") &&
    conDatos.includes("cuánto cuesta una limpieza"));

// ─── D · Grupos 1 y 3 en el render ─────────────────────────────────────────
console.log("\nD · identidad y alcance en el bloque");

const conIdentidad = parseConocimiento(JSON.stringify({
  quienesSois: { presentacion: "Clínica familiar en Chamberí, 20 años en el barrio", trato: "usted" },
  alcance: { urgenciaDefinicionExtra: "dolor postoperatorio de implante" },
}));
const rIdentidad = renderConocimiento(conIdentidad).join("\n");
ok("la identidad va PRIMERO (quién habla antes de qué afirma) y el trato de usted se dice",
  rIdentidad.startsWith("QUIÉNES SOIS") && rIdentidad.includes("USTED"));
ok("la urgencia extra SE SUMA a la base («además de la definición base»)",
  rIdentidad.includes("además de la definición base") && rIdentidad.includes("dolor postoperatorio"));
ok("sin nada PUBLICADO, la cabecera «LO PUBLICADO» no aparece — un título sin contenido es ruido",
  !rIdentidad.includes("LO PUBLICADO POR LA CLÍNICA"));
ok("y el assert del plan básico SIGUE: los campos nuevos en null no emiten ni un byte",
  renderConocimiento(parseConocimiento(JSON.stringify({ quienesSois: {}, alcance: {} }))).length === 0);

// ─── D3 · Dónde estáis (12-09) ─────────────────────────────────────────────
// Lo que el modelo inventaba sin campo («hay opciones cerca» de parking,
// «abrimos sábados»): si consta, entra en LO PUBLICADO tal cual; si no, nada.
console.log("\nD3 · dónde estáis: dirección, cómo llegar y parking entran tal cual; en blanco no emiten nada");

const conUbicacion = parseConocimiento(JSON.stringify({
  ubicacion: {
    direccion: "C/ Alcalá 120, 28009 Madrid",
    comoLlegar: "Metro Goya (L2, L4)",
    parking: "  Parking público en Felipe II, a 3 min; no tenemos propio  ",
  },
}));
const rUbicacion = renderConocimiento(conUbicacion);
ok("los tres entran bajo LO PUBLICADO, cada uno en su línea y recortados",
  rUbicacion[0]!.startsWith("LO PUBLICADO POR LA CLÍNICA") &&
    rUbicacion.includes("· Dirección de la clínica: C/ Alcalá 120, 28009 Madrid") &&
    rUbicacion.includes("· Cómo llegar: Metro Goya (L2, L4)") &&
    rUbicacion.includes("· Parking: Parking público en Felipe II, a 3 min; no tenemos propio"));
const soloParking = renderConocimiento(parseConocimiento(JSON.stringify({ ubicacion: { parking: "Zona azul en la calle" } })));
ok("solo parking: la cabecera y UNA línea — sin dirección ni cómo llegar inventados",
  soloParking.length === 2 && soloParking[1] === "· Parking: Zona azul en la calle");
ok("plan básico intacto: ubicacion ausente, vacía o en blanco no emite ni un byte y sigue siendo «vacío»",
  renderConocimiento(parseConocimiento(JSON.stringify({ ubicacion: {} }))).length === 0 &&
    renderConocimiento(parseConocimiento(JSON.stringify({ ubicacion: { direccion: "", parking: null } }))).length === 0 &&
    esConocimientoVacio(parseConocimiento(JSON.stringify({ ubicacion: { comoLlegar: "   " } }))));
ok("ubicacion ilegible LANZA: un número, una lista, o un texto por encima del tope (300)",
  lanza(JSON.stringify({ ubicacion: { parking: 5 } })) &&
    lanza(JSON.stringify({ ubicacion: [] })) &&
    lanza(JSON.stringify({ ubicacion: { direccion: "x".repeat(301) } })));
ok("capacidades: con parking guardado PUEDE decirlo; sin nada guardado NO PUEDE, y la pantalla lo dice",
  capacidadesDe(conUbicacion).puede.some((p) => p.includes("parking")) &&
    capacidadesDe(parseConocimiento(null)).noPuede.some((p) => p.includes("parking")));

// ─── D2 · La política de cobro (F5) ────────────────────────────────────────
console.log("\nD2 · política de cobro: topes del parser y defaults 7/30");

const { politicaCobro, POLITICA_COBRO_DEFAULT } = await import("../app/lib/agente/conocimiento");
ok("sin configurar → los defaults dictados (7 días vencido, 30 a Fuera de plazo)",
  politicaCobro(parseConocimiento(null)).vencidoDias === 7 &&
  politicaCobro(parseConocimiento(null)).fueraDePlazoDias === 30 &&
  POLITICA_COBRO_DEFAULT.vencidoDias === 7);
ok("configurada → la de la clínica (14/60)",
  (() => { const c = parseConocimiento(JSON.stringify({ plazos: { cobroVencidoDias: 14, cobroFueraDePlazoDias: 60 } }));
    return politicaCobro(c).vencidoDias === 14 && politicaCobro(c).fueraDePlazoDias === 60; })());
ok("fuera de tope se RECHAZA (61 días vencido; 181 escalada) — fail-closed, no se recorta",
  (() => { try { parseConocimiento(JSON.stringify({ plazos: { cobroVencidoDias: 61 } })); return false; } catch { }
    try { parseConocimiento(JSON.stringify({ plazos: { cobroFueraDePlazoDias: 181 } })); return false; } catch { return true; } })());
ok("escalada ≤ vencido se RECHAZA (30/30): escalar antes de vencer no significa nada",
  (() => { try { parseConocimiento(JSON.stringify({ plazos: { cobroVencidoDias: 30, cobroFueraDePlazoDias: 30 } })); return false; } catch { return true; } })());
ok("el plan básico NO cambia: los campos nuevos en null no emiten ni un byte al prompt",
  renderConocimiento(parseConocimiento(JSON.stringify({ plazos: { cobroVencidoDias: 10, cobroFueraDePlazoDias: 40 } }))).length === 0);

// ─── E · El veto determinista de agenda (23-08) ────────────────────────────
//
// El fallo «tenemos disponibilidad…» volvió TRES veces por tres puertas; la
// tercera fue el ECO DEL HORARIO («Tenemos disponibilidad por las tardes de
// lunes a viernes, de 17:00 a 20:00») — el generador convertía la apertura en
// huecos y el juez lo eximía porque el rango constaba. El cierre de raíz es
// CÓDIGO: estas frases-firma no salen nunca en nivel 1, obedezca quien
// obedezca. Los tres casos históricos se prueban LITERALES.
console.log("\nE · veto determinista de agenda: las frases-firma no salen");

const { vetoAgendaDeterminista } = await import("../app/lib/agente/juez-borrador");
const veta = (b: string) => vetoAgendaDeterminista(b) != null;

ok("caso 1 (huecos inventados): «tenemos hueco el martes a las 16:00» → vetado",
  veta("Tenemos hueco el martes a las 16:00, ¿te viene bien?"));
ok("caso 2 (eco de disponibilidad): «tenemos disponibilidad los martes y jueves» → vetado",
  veta("¡Perfecto! Tenemos disponibilidad los martes y jueves por la tarde."));
ok("caso 3, LA CAPTURA DEL 23-08 (eco del horario): «Tenemos disponibilidad por las tardes de lunes a viernes, de 17:00 a 20:00» → vetado",
  veta("Tenemos disponibilidad por las tardes de lunes a viernes, de 17:00 a 20:00. ¿Qué día te viene bien?"));
ok("variantes: «hay disponibilidad a partir de las 16:00» y «nos queda un hueco» → vetadas",
  veta("Hay disponibilidad a partir de las 16:00.") && veta("Nos queda un hueco el jueves."));
ok("reservar-él: «te cierro la cita» y «queda agendada» → vetadas SIEMPRE",
  veta("Dime qué día y te cierro la cita.") && veta("Queda agendada tu cita para el martes."));
ok("la apertura dicha COMO apertura pasa: «abrimos de 17:00 a 20:00» no es afirmar huecos",
  !veta("Abrimos de lunes a viernes de 17:00 a 20:00. ¿Qué días y franjas te vienen bien?"));
ok("recoger la disponibilidad DE LA PERSONA pasa: preguntar no es afirmar",
  !veta("¿Qué disponibilidad tienes esta semana?") &&
  !veta("En cuanto me digas tu disponibilidad, se lo paso al equipo."));
ok("anunciar al EQUIPO pasa: «el equipo te confirma la cita» no la reserva el agente",
  !veta("Se lo paso al equipo y te confirman la cita enseguida.") &&
  !veta("Te buscamos hueco por las tardes y te decimos algo hoy."));
ok("nivel 2 (huecosConstan): la disponibilidad se permite, reservar-él se veta IGUAL",
  vetoAgendaDeterminista("Tenemos hueco el martes a las 16:00.", { huecosConstan: true }) == null &&
  vetoAgendaDeterminista("Te reservo el martes a las 16:00.", { huecosConstan: true }) != null);

console.log("\nE1b · la CITA INVENTADA (12-09): confirmar una cita concreta que no consta se veta");
ok("Nuria, tres hilos: «Tenemos tu cita para el sábado 19 de septiembre por la mañana» → vetado",
  veta("Perfecto, Nuria. Tenemos tu cita para el sábado 19 de septiembre por la mañana para la extracción."));
ok("variantes: «tienes cita el martes a las 10», «tu cita queda el jueves», «cita confirmada», «te esperamos mañana a las 9» → vetadas",
  veta("Tienes cita el martes a las 10.") && veta("Tu cita queda el jueves por la tarde.") &&
  veta("Cita confirmada para el 19.") && veta("Te esperamos mañana a las 9."));
ok("con cita que CONSTA (citaConsta): «te esperamos mañana» y «tu cita es el martes» pasan; reservar-él se veta igual",
  vetoAgendaDeterminista("Te esperamos mañana a las 9.", { citaConsta: true }) == null &&
  vetoAgendaDeterminista("Tu cita es el martes a las 10, como quedamos.", { citaConsta: true }) == null &&
  vetoAgendaDeterminista("Te la reservo para el martes.", { citaConsta: true }) != null);
ok("anunciar al equipo y preguntar siguen pasando: «el equipo te contacta para concretar día y hora», «¿tienes ya cita con nosotros?»",
  !veta("Ya tengo todo. El equipo te contacta para concretar día y hora.") &&
  !veta("¿Tienes ya cita con nosotros o es la primera vez?") &&
  !veta("Te esperamos cuando quieras, sin compromiso."));

// ─── E2 · El veto determinista de SERVICIO NO PUBLICADO (MEJORAS 229, 11-09) ──
console.log("\nE2 · veto determinista de servicio: «sí, hacemos X» solo si X consta o es habitual");
{
  const { vetoServicioDeterminista } = await import("../app/lib/agente/juez-borrador");
  const sinPublicar = "Presupuesto emitido: ninguno.\nHorario: abrimos de 9 a 20.";
  const conLaser = `${sinPublicar}\nTratamiento publicado: blanqueamiento con láser (250 €)`;
  const vs = (b: string, pub = sinPublicar) => vetoServicioDeterminista(b, pub);
  ok("«Sí, hacemos sedación consciente para extracciones» sin que conste → VETO (el caso de Nuria)",
    vs("¡Hola Nuria! Sí, hacemos sedación consciente para extracciones y es una opción muy común.") != null);
  ok("«ofrecemos láser» sin que conste → veto; con el láser publicado → pasa",
    vs("Ofrecemos láser para el blanqueamiento.") != null && vs("Ofrecemos láser para el blanqueamiento.", conLaser) == null);
  ok("«contamos con cirugía guiada» → veto", vs("Contamos con cirugía guiada por ordenador.") != null);
  ok("lo HABITUAL pasa: revisiones de ortodoncia, limpiezas, extracciones, urgencias",
    vs("Sí, hacemos revisiones de ortodoncia.") == null && vs("Hacemos limpiezas y extracciones.") == null && vs("Sí, tenemos urgencias.") == null);
  ok("lenguaje, no servicio: «hacemos lo posible», «tenemos que», «tenemos disponibilidad» (agenda) → no veta",
    vs("Hacemos lo posible por verte pronto.") == null && vs("Tenemos que valorarlo.") == null && vs("Tenemos disponibilidad por las tardes.") == null);
  ok("remitir no es afirmar: «te lo confirma la clínica» → pasa",
    vs("Lo de la sedación te lo confirma la clínica enseguida; lo anoto para el doctor.") == null);
  ok("la frase devuelta es la firma exacta", (vs("Sí, hacemos sedación consciente.") ?? "").toLowerCase().startsWith("sí, hacemos sedación"));
  ok("12-09 (pase de tres hilos): lo RECOGIDO y una conjunción a la cabeza no son un servicio — «tenemos tu nombre y…», «tenemos y cuál es…» pasan",
    vs("Perfecto, Nuria. Tenemos tu nombre y que prefieres un sábado.") == null &&
    vs("La mejor forma de saber si la tenemos y cuál es la más adecuada es que te vea el doctor.") == null &&
    vs("Ya tenemos todos tus datos; el equipo te contacta.") == null &&
    vs("Tenemos sedación consciente para extracciones.") != null);
}
// MEJORAS 136 (auditoría 2026-09-05): el veto es léxico — sin firmas en
// catalán e inglés, un hilo en otro idioma pasaba de largo.
ok("catalán: «tenim disponibilitat dimarts» y «et reservo» → vetados",
  veta("Tenim disponibilitat dimarts a la tarda.") && veta("Digue'm quin dia i et reservo la cita."));
ok("inglés: «we have a slot on Tuesday» y «I'll book it for you» → vetados",
  veta("We have a slot on Tuesday at 4pm.") && veta("Tell me a day and I'll book it for you."));
ok("inglés/catalán: recoger disponibilidad de la persona pasa",
  !veta("What days and times work best for you?") && !veta("Quins dies et van bé?"));

// ─── E3 · LAS GUARDAS DEL MODELO LIBRE (12-09) ─────────────────────────────
//
// El censo de 79 mensajes reales del agente: los vetos de agosto disparaban 2
// veces, y CERO sobre los 12 del modelo libre con clínica configurada — el
// prompt aprendió a no decir esas frases exactas y el modelo dice lo mismo con
// otras palabras. Cada caso de aquí sale de un mensaje REAL del corpus, y los
// que tienen que PASAR pesan tanto como los que tienen que vetar: un juez que
// mata «¿te viene bien que te la agendemos?» mata la mejor frase del hilo.
console.log("\nE3 · guardas del modelo libre: precio en rango, plazo inventado, «lo valora la doctora», acción imposible, dato no pedido");
{
  const { vetoDeterminista } = await import("../app/lib/agente/juez-borrador");
  const PUBLICADO_NORTE = [
    "LO PUBLICADO POR LA CLÍNICA",
    "· Tratamientos publicados:",
    "  - Implante unitario: desde 1.100 € — implante + corona",
    "  - Higiene bucodental (limpieza): 60 €",
  ].join("\n");
  const v = (b: string, pub = PUBLICADO_NORTE) => vetoDeterminista(b, pub);

  // 1 · EL PRECIO INVENTADO EN RANGO — el peor del corpus y el que el juez DEJÓ PASAR.
  ok("«puede rondar desde 800 hasta 2500 euros» → vetado como económica (el juez lo dejaba pasar)",
    v("Un implante puede rondar desde 800 hasta 2500 euros según lo que necesites.")?.categoria === "economica");
  ok("«ronda los 1.500 €», «unos 900 euros» y «2000 € más o menos» → vetados",
    v("El tratamiento ronda los 1.500 €.") != null && v("Son unos 900 euros.") != null && v("Serían 2000 € más o menos.") != null);
  ok("la cifra que SÍ consta pasa: «desde 1.100 €» está publicado",
    v("Un implante unitario parte desde 1.100 €, pero el precio final se cierra en la valoración.") == null);
  ok("y sin nada publicado, esa misma cifra se veta", v("Un implante parte desde 1.100 €.", "") != null);

  // 2 · EL PLAZO Y LA DURACIÓN INVENTADOS (Carlos, 12-09).
  ok("«la valoración dura unos 20 minutos» y «en 20 minutos tienes el presupuesto» → vetados como promesa",
    v("La valoración dura unos 20 minutos.")?.categoria === "promesa" &&
    v("En 20 minutos tienes el presupuesto exacto.")?.categoria === "promesa");
  ok("«te da el presupuesto exacto en el acto» → vetado", v("El doctor te da el presupuesto exacto en el acto.") != null);
  ok("una duración PUBLICADA pasa", v("La primera visita dura unos 30 minutos.", "  - Primera visita: 30 minutos, sin coste") == null);

  // 3 · «LO VALORA LA DOCTORA» — la regresión del 12-09, reproducida 3/3.
  const PUB_ESTE = "· Tratamientos publicados:\n  - Extracción: desde 60 € — muelas del juicio: se valora en consulta";
  ok("«la sedación consciente es algo que la Dra. Ana Gil valora en consulta» → vetado como clínica",
    v("La sedación consciente es algo que la Dra. Ana Gil valora en consulta según cada caso.", PUB_ESTE)?.categoria === "clinica");
  ok("valorar el CASO de la persona NO es ofrecer un servicio — «la Dra. valora tu caso» pasa",
    v("La Dra. Ana Gil valora tu caso en consulta y te explica las opciones.", PUB_ESTE) == null &&
    v("El doctor valora cada caso y te explica todo.", PUB_ESTE) == null);
  ok("y un servicio que SÍ consta pasa: «la Dra. valora la extracción»",
    v("La Dra. Ana Gil valora la extracción en consulta.", PUB_ESTE) == null);

  // 4 · ACCIONES QUE EL AGENTE NO PUEDE HACER.
  ok("«te cancelo la cita», «te la cambio», «te mando el presupuesto» y «te llamo yo» → vetados",
    v("Te cancelo la cita del martes.") != null && v("Te la cambio al jueves sin problema.") != null &&
    v("Te mando el presupuesto por aquí.") != null && v("Te llamo yo esta tarde.") != null);
  ok("anunciar el trabajo del EQUIPO sigue pasando (no es una acción del agente)",
    v("El equipo te llama esta tarde para cerrarlo.") == null && v("Se lo paso al equipo y te contactan.") == null);

  // 5 · PEDIR UN DATO QUE NO HACE FALTA (la regla 3 miraba lo que VUELCA, no lo que PIDE).
  ok("pedir teléfono, DNI o historial → vetado (por WhatsApp ya se tiene el teléfono)",
    v("¿Cuál es tu teléfono de contacto?")?.categoria === "datos_sensibles" &&
    v("Necesito tu DNI para la ficha.") != null && v("¿Me das tu historia clínica?") != null);
  ok("pedir el nombre, la molestia o la disponibilidad sigue pasando",
    v("¿Me dices tu nombre completo?") == null && v("¿Qué días y franjas te vienen mejor?") == null);

  // 6 · RESERVAR EN PLURAL, con la excepción de la INVITACIÓN.
  ok("«te agendamos para el martes 2026-09-15» → vetado como agenda",
    v("Te agendamos para el martes 2026-09-15 a última hora.")?.categoria === "agenda");
  ok("LOS TRES FALSOS POSITIVOS del 12-09 PASAN — pesan tanto como los vetos:",
    // (a) la invitación que el propio prompt del juez declara correcta
    v("¿Te viene bien que te la agendemos?") == null &&
    v("¿Te agendamos la valoración para los próximos días?") == null &&
    // (b) remitir al equipo con los días que pidió ELLA
    v("Paso tu solicitud al equipo para que te confirmen hueco el miércoles o jueves sobre las 17:00 y cierren tu cita.") == null &&
    // (c) el equipo informa del hueco: no lo afirma el agente
    v("Te paso con el equipo. Ellos te dirán qué tardes tenemos libres en los próximos días.") == null);
  ok("pero afirmarlo el agente en la misma frase SIGUE vetado — la excepción es por oración, no por mensaje",
    v("Tenemos libres el martes y el jueves. El equipo te lo confirmará.") != null);

  // 7 · EL PERDÓN — los falsos positivos del JUEZ (un modelo) se corrigen en
  // código, igual que sus omisiones. Medido con el juez vivo el 12-09: sin
  // esto, haiku seguía tumbando dos de los tres pese a decirlo el prompt.
  const { falsoPositivoDelJuez } = await import("../app/lib/agente/juez-borrador");
  ok("«ellos te dirán qué tardes tenemos libres» marcado agenda → PERDONADO (informa el equipo)",
    falsoPositivoDelJuez("agenda", "Ellos te dirán qué tardes tenemos libres en los próximos días.", "") === "informa_el_equipo");
  ok("«paso tu solicitud al equipo… el miércoles o jueves» → PERDONADO solo si ESOS días los pidió ella",
    falsoPositivoDelJuez("agenda", "Paso tu solicitud al equipo para que te confirmen hueco el miércoles o jueves.", "el miércoles o el jueves por la tarde") === "remite_con_los_dias_que_pidio" &&
    falsoPositivoDelJuez("agenda", "Paso tu solicitud al equipo para que te confirmen hueco el lunes.", "el miércoles o el jueves") == null);
  ok("«anotamos que alguien te llame para hablar de sedación» → PERDONADO (232: remitir puede nombrar el servicio)",
    falsoPositivoDelJuez("clinica", "Anotamos que alguien te llame para hablar de sedación consciente para tu extracción.", "") === "remite_nombrando_el_servicio");
  ok("el perdón NO tapa una afirmación: «el equipo te confirma que hacemos sedación» y «tenemos hueco el jueves, te lo confirman» NO se perdonan",
    falsoPositivoDelJuez("clinica", "El equipo te confirma que hacemos sedación consciente.", "") == null &&
    falsoPositivoDelJuez("agenda", "Paso tu solicitud al equipo; tenemos hueco el jueves y te lo confirman.", "el jueves") == null);
  ok("ni perdona una categoría que no es suya: un precio inventado marcado «economica» nunca se perdona",
    falsoPositivoDelJuez("economica", "Ellos te dirán que son unos 900 euros.", "") == null);
}

// ─── F · rangos de la config (MEJORAS 137): lo absurdo no se publica ────────
console.log("\nF · rangos: precio y horario absurdos se rechazan; lo publicado real pasa");
{
  const { motivoPrecioAbsurdo, esHoraValida } = await import("../app/lib/agente/conocimiento");
  ok("«desde 35 €/mes», «600–900 € según caso» y «gratis» pasan",
    motivoPrecioAbsurdo("desde 35 €/mes") == null && motivoPrecioAbsurdo("600–900 € según caso") == null && motivoPrecioAbsurdo("primera visita gratuita") == null);
  ok("«0 €» y «250.000 €» se rechazan", motivoPrecioAbsurdo("0 €") != null && motivoPrecioAbsurdo("250.000 €") != null);
  ok("«24 meses sin intereses» no es un precio (cifra pequeña sin moneda) → pasa", motivoPrecioAbsurdo("financiación 24 meses sin intereses") == null);
  ok("hora: «25:00» y «09:60» se rechazan; «23:59» y «09:00» pasan",
    !esHoraValida("25:00") && !esHoraValida("09:60") && esHoraValida("23:59") && esHoraValida("09:00"));
  const conHoraMala = JSON.stringify({ plazos: { horario: {
    lunes: { activo: true, inicio: "09:00", fin: "25:00" }, martes: { activo: false, inicio: "09:00", fin: "20:00" },
    miercoles: { activo: false, inicio: "09:00", fin: "20:00" }, jueves: { activo: false, inicio: "09:00", fin: "20:00" },
    viernes: { activo: false, inicio: "09:00", fin: "20:00" }, sabado: { activo: false, inicio: "09:00", fin: "20:00" },
    domingo: { activo: false, inicio: "09:00", fin: "20:00" } } } });
  let lanzo = false;
  try { parseConocimiento(conHoraMala); } catch { lanzo = true; }
  ok("el parser LANZA con «25:00» en el horario (antes pasaba la regex de formato)", lanzo);
  let lanzoPrecio = false;
  try { parseConocimiento(JSON.stringify({ tratamientos: [{ nombre: "Implante", precio: "0 €", nota: null }] })); } catch { lanzoPrecio = true; }
  ok("el parser LANZA con un precio de 0 €", lanzoPrecio);
}

// ─── G · LA PODA: quitar la frase, no el mensaje (12-09) ───────────────────
console.log("\nG · poda: la frase fuera y el mensaje dentro, salvo cuando la frase ERA el mensaje");
{
  const { podarBorrador, esSoloCortesia } = await import("../app/lib/agente/juez-borrador");
  const PUBLICADO = "Tratamientos: Ortodoncia invisible — 2.400 €. Horario: L-V 9:00-20:00.";

  // G1 · el caso normal: cuatro frases, una infringe, salen tres.
  {
    const b = "Hola Ana, gracias por escribirnos. La ortodoncia invisible cuesta entre 800 y 2500 euros. ¿Prefieres que te llamemos por la mañana o por la tarde?";
    const p = podarBorrador(b, "La ortodoncia invisible cuesta entre 800 y 2500 euros.", {
      ultimoEntrante: "¿Cuánto cuesta la ortodoncia invisible?", publicado: PUBLICADO,
    });
    // Ella preguntó el precio: lo que queda tiene su interrogación pero no
    // contesta ni remite → era_la_respuesta, y ahí entra la reescritura.
    ok("preguntó el precio y lo que queda no lo contesta → era_la_respuesta (no basta con dejar una pregunta)",
      p.motivo === "era_la_respuesta", p.podado ? p.texto : "");
  }

  // G2 · el cotejo es tolerante: el juez devuelve la frase con otra puntuación
  //      y otras tildes. Si exigiéramos byte a byte, la poda no dispararía
  //      casi nunca y nadie lo notaría (se caería sola a la plantilla).
  {
    const b = "Hola Nuria. Tenemos tu cita para el sábado 19 por la mañana. Un asesor te confirma todo enseguida.";
    const p = podarBorrador(b, "tenemos tu cita para el sabado 19 por la manana", { publicado: PUBLICADO });
    ok("localiza la frase sin tildes, sin mayúsculas y sin punto final",
      p.podado && !p.texto.includes("sábado"), p.podado ? p.texto : p.motivo);
  }

  // G3 · lo que NO se puede podar cae a lo de hoy (la plantilla), con motivo.
  {
    const b = "Hola Ana. Te lo dejo en 400 euros.";
    ok("frase que no está en el borrador → no_localizada (no se toca nada)",
      podarBorrador(b, "el implante cuesta 900 euros", { publicado: PUBLICADO }).motivo === "no_localizada");
    ok("la frase ERA todo el mensaje → era_todo",
      podarBorrador("Te la reservo para el martes a las diez.", "Te la reservo para el martes a las diez.", { publicado: PUBLICADO }).motivo === "era_todo");
    const soloCortesia = podarBorrador(
      "Hola Ana. Sí, hacemos sedación consciente. Un saludo.",
      "Sí, hacemos sedación consciente.", { ultimoEntrante: "¿Hacéis sedación consciente?", publicado: PUBLICADO });
    ok("lo que queda es saludo y cierre → solo_cortesia", soloCortesia.motivo === "solo_cortesia", soloCortesia.podado ? soloCortesia.texto : "");
  }

  // G4 · la frase ERA la respuesta: ella preguntó y lo que queda no contesta,
  //      ni pregunta, ni remite a nadie. Ahí la poda sería contestar con
  //      evasivas — peor que la plantilla, que al menos lo admite.
  {
    const b = "Buenos días, Ana. Sí, hacemos sedación consciente. Abrimos de lunes a viernes de nueve a ocho.";
    const p = podarBorrador(b, "Sí, hacemos sedación consciente.", {
      ultimoEntrante: "¿Hacéis sedación consciente?", publicado: PUBLICADO });
    ok("preguntó y lo que queda ni contesta ni remite → era_la_respuesta", p.motivo === "era_la_respuesta", p.podado ? p.texto : "");

    const conRemite = podarBorrador(
      "Buenos días, Ana. Sí, hacemos sedación consciente. Anotamos que un asesor te lo confirme hoy mismo.",
      "Sí, hacemos sedación consciente.", { ultimoEntrante: "¿Hacéis sedación consciente?", publicado: PUBLICADO });
    ok("…pero si lo que queda REMITE a una persona, sí se poda (§17: remitir es contestar)",
      conRemite.podado, conRemite.podado ? conRemite.texto : conRemite.motivo);
  }

  // G5 · quitar una oración deja otra al descubierto: el veto devuelve la
  //      PRIMERA firma, no todas. Se vuelve a pasar (cuesta cero).
  {
    const b = "Hola Ana. La ortodoncia cuesta entre 800 y 2500 euros. Te la reservo para el martes. Un asesor te confirma todo.";
    const p = podarBorrador(b, "La ortodoncia cuesta entre 800 y 2500 euros.", {
      ultimoEntrante: "¿Cuánto cuesta y qué día tenéis?", publicado: PUBLICADO });  // lo que queda remite al asesor
    ok("poda en dos vueltas: cae el precio inventado y también «te la reservo»",
      p.podado && !p.texto.includes("2500") && !p.texto.includes("reservo"), p.podado ? p.texto : p.motivo);
  }

  // G6 · lo que queda se APOYA en lo que se fue.
  {
    const p = podarBorrador(
      "Hola Nuria. Tenemos tu cita para el sábado 19 por la mañana. Por eso te escribimos con tiempo.",
      "Tenemos tu cita para el sábado 19 por la mañana.", { publicado: PUBLICADO });
    ok("«Por eso te escribimos» sin la frase anterior es un mensaje roto → queda_colgando",
      p.motivo === "queda_colgando", p.podado ? p.texto : "");
  }

  // G6b · EL MENSAJE QUE SEGUÍA AFIRMANDO LO VETADO (13-09, hallazgo de la
  //       medición sobre conversaciones). «La Dra. Ana Gil valora en consulta»
  //       se partía en dos por el punto de la abreviatura: se quitaba «…la
  //       Dra.» y quedaba «Ana Gil valora en consulta según cada caso» —
  //       justo lo que se quería quitar—, en un mensaje que parecía revisado.
  {
    const b = "Hola Nuria, es normal tener dudas. La sedación consciente es algo que la Dra. Ana Gil valora en consulta según cada caso. ¿Te gustaría pedir cita?";
    const f = "La sedación consciente es algo que la Dra. Ana Gil valora en consulta según cada caso.";
    const p = podarBorrador(b, f, { ultimoEntrante: "¿Hacéis sedación consciente?", publicado: PUBLICADO });
    ok("«Dra.» no parte la oración: se va entera o no se va",
      !p.podado || !p.texto.includes("valora en consulta"), p.podado ? p.texto : p.motivo);
    // La INVARIANTE, que es lo que de verdad protege: un texto podado nunca
    // conserva un trozo largo de la frase que se fue. La red de seguridad de
    // `podarBorrador` es de cinturón y tirantes —con el troceo arreglado casi
    // no se alcanza—, así que se afirma el resultado, no la rama.
    const casos: [string, string, string][] = [
      [b, f, "¿Hacéis sedación consciente?"],
      ["Hola Ana. La valoración dura unos 20 minutos y el Dr. Pérez te da el presupuesto en el acto. ¿Te agendamos?", "La valoración dura unos 20 minutos y el Dr. Pérez te da el presupuesto en el acto.", "¿Cuánto dura?"],
      ["Perfecto. Te la reservo para el martes a las 10. Un asesor te confirma todo.", "Te la reservo para el martes a las 10.", "¿Qué día tenéis?"],
    ];
    const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    const conResiduo = casos.filter(([bb, ff, uu]) => {
      const r = podarBorrador(bb, ff, { ultimoEntrante: uu, publicado: PUBLICADO });
      if (!r.podado) return false;
      const nf = norm(ff), nt = norm(r.texto);
      for (let i = 0; i + 30 <= nf.length; i++) if (nt.includes(nf.slice(i, i + 30))) return true;
      return false;
    });
    ok("INVARIANTE: lo podado nunca conserva 30 caracteres seguidos de la frase que se fue",
      conResiduo.length === 0, conResiduo.map(([, ff]) => ff.slice(0, 40)).join(" | "));
  }

  // G7 · el detector de cortesía, que es quien decide si queda mensaje.
  {
    ok("«Gracias por tu mensaje, Ana.» es cortesía", esSoloCortesia("Gracias por tu mensaje, Ana."));
    ok("«Un saludo.» y «Hola Ana.» son cortesía", esSoloCortesia("Un saludo.") && esSoloCortesia("Hola Ana."));
    ok("«Seguimos por aquí para lo que necesites.» es cortesía", esSoloCortesia("Seguimos por aquí para lo que necesites."));
    ok("«La primera visita es gratuita.» NO es cortesía", !esSoloCortesia("La primera visita es gratuita."));
    ok("«¿Qué día te viene bien?» NO es cortesía", !esSoloCortesia("¿Qué día te viene bien?"));
  }
}

// ─── H · MEJORAS 233: dos descartes seguidos son un callejón ───────────────
console.log("\nH · segundo descarte seguido: plantilla distinta, cola normal, y el contador se reinicia solo");
{
  const { plantillaPasaAPersona, plantillaNeutra } = await import("../app/lib/agente/juez-borrador");
  const { colaDeDerivacion } = await import("../app/lib/automatizacion/estado");
  const { avanzarSesion, SESION_NUEVA } = await import("../app/lib/agente/sesion-prueba");

  const p1 = plantillaPasaAPersona("Nuria");
  ok("la plantilla del segundo descarte NO es la neutra (era el bucle de Nuria)", p1 !== plantillaNeutra("Nuria"));
  ok("dice que le escribe una persona y usa su nombre", /persona del equipo/.test(p1) && p1.includes("Nuria"));
  ok("sin nombre real (un teléfono) no inventa vocativo", !plantillaPasaAPersona("+34600000000").includes("+34"));
  ok("en catalán y en inglés, cada uno en su idioma",
    /l'equip/.test(plantillaPasaAPersona("Nuria", "ca")) && /from the team/.test(plantillaPasaAPersona("Nuria", "en")));
  ok("es un callejón del agente, no una urgencia de la paciente → cola normal",
    colaDeDerivacion("sin_respuesta_valida", null) === "normal" && colaDeDerivacion("sin_respuesta_valida", true) === "normal");

  // El contador entre turnos: la sesión del banco lo lleva con la MISMA regla
  // que producción persiste (§25) — el turno escribe su cuenta, la sesión la
  // guarda, y un turno que no descarta la pone a cero.
  const base = { decision: "sigue" as const, aplazamientos: [], esperaHasta: null, esperaLevantar: false };
  const turno = { instante: "2026-09-12T10:00:00.000Z", entrante: "hola" };
  const s1 = avanzarSesion(SESION_NUEVA, { ...base, descartesSeguidos: 1 }, turno);
  ok("un descarte deja la sesión en 1", s1.descartesSeguidos === 1);
  const s2 = avanzarSesion(s1, { ...base, descartesSeguidos: 2 }, turno);
  ok("dos seguidos, en 2 (es el turno que entrega el caso)", s2.descartesSeguidos === 2);
  const s3 = avanzarSesion(s2, { ...base, descartesSeguidos: 0 }, turno);
  ok("un turno que NO descarta reinicia el contador a 0", s3.descartesSeguidos === 0);
  const s4 = avanzarSesion(s2, { ...base, sinJuicio: true, decision: "deriva", causa: "no_legible" }, turno);
  ok("un turno sin juicio (audio) tampoco arrastra el callejón", s4.descartesSeguidos === 0);
  ok("un fallo del modelo no toca la sesión (producción no persiste nada)",
    avanzarSesion(s2, { ...base, fallback: true }, turno).descartesSeguidos === 2);
}


// ─── EL ALCANCE: qué papel tiene el agente (13-09) ─────────────────────────
{
  const { renderAlcance, CONOCIMIENTO_VACIO } = await import("../app/lib/agente/conocimiento");
  const OBJ = { etapa: "cita", proposito: "Recoger lo necesario para poder cerrarle una cita sin volver a preguntar." };

  const nivel1 = renderAlcance(CONOCIMIENTO_VACIO, OBJ).join("\n");
  ok("nivel 1: el papel dice que la agenda la lleva el equipo, no que esté prohibido hablar de ella",
    /la disponibilidad la tiene el equipo/i.test(nivel1) && /pas[áa]rselo al equipo para que la reserven/i.test(nivel1));
  ok("nivel 1: el horario publicado se declara como APERTURA, no como disponibilidad",
    /horario publicado es cu[áa]ndo ABRE/i.test(nivel1));
  // MEJORAS 237 (14-09) — LAS TRES REGLAS DEL REDACTOR. Se afirma cada una por
  // su propiedad, no por su literal entero: lo que no puede desaparecer sin que
  // esto se ponga rojo es la SITUACIÓN que describen.
  // 237/1 · versión de Simon (14-09): lo explícito va DELANTE — lo que no
  // puede hacer, y que ni siquiera sabe qué huecos hay.
  ok("237/1 · el papel dice de entrada que NO reserva, NO agenda y NO sabe qué huecos hay",
    /no reservas ni agendas nada y no sabes qu[ée] huecos hay/i.test(nivel1));
  // Y lo que se quitó a propósito de su borrador: un PLAZO. «Lo antes posible»
  // es lo único de esa frase que se puede incumplir.
  ok("237/1 · y NO promete ningún plazo (eso sí se incumple si la coordinadora tarda)",
    !/lo antes posible|en breve|enseguida|hoy mismo/i.test(nivel1));
  ok("237/2 · el día lo pone la persona, y se le devuelve tal cual: ni más concreto, ni más amplio",
    /el d[íi]a y la hora los pone la persona/i.test(nivel1) && /ni m[áa]s concretos, ni m[áa]s amplios/i.test(nivel1));
  ok("237/2 · con los DOS incisos: si no lo ha dicho, PREGUNTAR (sin esto la regla lo vuelve mudo)",
    /si no los ha dicho, preg[úu]ntaselos/i.test(nivel1));
  // 237/3 · LA PRUEBA YA NO ESTÁ AQUÍ: se fue al paso 6 del procedimiento
  // (14-09). Se afirma que NO está duplicada — con la regla en los dos sitios
  // no se sabría cuál hizo efecto— y el paso 6 se prueba abajo, con el prompt.
  ok("237/3 · la prueba antes de enviar ya NO está en el papel (es un paso, no una regla)",
    !/no hubiera hueco donde ella ped[íi]a/i.test(nivel1));
  // Y lo que NO puede entrar: un ejemplo de cómo decirlo. MEJORAS 236 — un
  // ejemplo en un prompt es una regla, y saldría literal en cien conversaciones.
  ok("237 · y NINGUNA frase-modelo que copiar (un ejemplo en un prompt es una regla)",
    !/por ejemplo|p\. ej\.|«apunto tu preferencia/i.test(nivel1));
  // El recorte deliberado: la regla 1 es más estrecha que el papel del 13-09, y
  // sustituirla del todo habría metido una segunda corrección de tapadillo.
  ok("237 · no se ha perdido recoger lo que hace falta para poder CERRAR la cita",
    /lo que haga falta para poder cerrarle la cita/i.test(nivel1));
  ok("el objetivo entra como PROPÓSITO en una frase", nivel1.includes(OBJ.proposito));
  // La prueba de que esto no es un formulario con otro nombre: ninguna CLAVE
  // de campo puede asomar por aquí. (Se buscan las claves, no las palabras:
  // «disponibilidad» es además español normal y sale en el papel del nivel 1.)
  ok("y NINGUNA clave de campo asoma (si no, es el formulario otra vez)",
    !/nombre_completo|tratamiento_o_molestia|confirma_pago|via_pago|fecha_pago|motivo_no_cita|disponibilidad_primera_cita|que_necesita|es_paciente/.test(nivel1));
  // 14-09 — LA DOCTRINA CAMBIÓ, y el test con ella. Hasta hoy se le escondía QUÉ
  // tenía que conseguir («no hay una lista que rellenar») porque la lista lo
  // volvía un formulario. Medido: con el permiso de agrupar preguntas ya dado y
  // sin saber qué le faltaba, preguntaba 0,55 cosas por mensaje y NUNCA dos.
  // Corrección de Simon: la lista dice QUÉ; el criterio pone CÓMO.
  ok("la lista dice QUÉ y el criterio pone CÓMO (la doctrina de Simon, 14-09)",
    /lo que tienes que llegar a saber/i.test(nivel1) && /c[ÓO]MO se pide lo juzgas t[úu]/i.test(nivel1));

  // EL ESTADO DEL CONTRATO: lo que consta va primero (para NO preguntarlo) y lo
  // que falta va en prosa, nunca en viñetas — un modelo imita la forma de su
  // entrada, y una lista sale como lista.
  {
    const conContrato = renderAlcance(CONOCIMIENTO_VACIO, {
      ...OBJ,
      sabido: ["nombre completo (consta en su ficha)"],
      falta: ["dolor ahora, esta semana, o sin prisa", "qué días y franjas le vienen bien"],
    }).join("\n");
    ok("lo que YA se sabe se dice para no preguntarlo, y va antes que lo que falta",
      conContrato.indexOf("YA SABES") > 0 && conContrato.indexOf("YA SABES") < conContrato.indexOf("TE FALTA"));
    ok("lo que falta entra en PROSA, sin viñetas ni signos de pregunta que copiar",
      /TE FALTA[^\n]*qué días y franjas le vienen bien/.test(conContrato) && !/\n\s+- (dolor|qué días)/.test(conContrato) && !/¿/.test(conContrato.split("TE FALTA")[1] ?? ""));
    ok("y se le dice que la lista es lo que hay que SABER, no cómo preguntarlo",
      /no las palabras con las que preguntarlo/i.test(conContrato));
    const sinContrato = renderAlcance(CONOCIMIENTO_VACIO, OBJ).join("\n");
    ok("sin contrato (hilo antiguo o sin objetivo) no se inventa ninguna de las dos líneas (§4)",
      !/YA SABES|TE FALTA/.test(sinContrato));
  }
  // EL ORDEN DENTRO DEL PAPEL (13-09): un papel sin orden lo elige el modelo, y
  // el que elegía era recoger primero. Se afirma la propiedad —contestar antes
  // que recoger— y que «pasa el caso» NO sea lo último pegado al propósito.
  ok("el papel declara el ORDEN: primero contestar, después recoger",
    /primero contestas lo que te han preguntado/i.test(nivel1) && /recoger va despu[ée]s/i.test(nivel1));
  ok("y se permite no recoger nada este turno (sin eso, «después» se lee como «siempre»)",
    /si no encaja, este turno no pides nada/i.test(nivel1));
  ok("el orden va ANTES del cierre (que era lo pegado al propósito)",
    nivel1.indexOf("primero contestas") < nivel1.indexOf("pasas el caso"));
  // 13-09 noche — el CIERRE, y la licencia acotada por el final y no por el goteo.
  ok("el papel manda CERRAR en el mismo mensaje en cuanto tiene lo que hace falta",
    /EN CUANTO tengas lo que hace falta, cierras en ESE MISMO mensaje/.test(nivel1) && /no lo alargues un turno m[áa]s/i.test(nivel1));
  ok("y ya NO limita a una cosa por mensaje (era lo que creaba el gota a gota)",
    !/pides UNA cosa/i.test(nivel1));
  // 13-09 noche (Carlos): cerrar tiene DOS motivos. El segundo es la regla de
  // insistencia dicha como papel — sin enumerar «precio», «horarios» ni nada.
  ok("cerrar tiene un SEGUNDO motivo: «ya no puedo avanzar yo»",
    /ya no puedo avanzar yo/i.test(nivel1) && /vuelve sobre algo que ya le contestaste/i.test(nivel1));
  ok("y dice qué hacer con ello: pasarlo a quien sí pueda y cerrar ahí, sin repetirse",
    /p[áa]saselo a quien s[íi] pueda y cierra ah[íi]/i.test(nivel1) && /tercera vez/i.test(nivel1));

  const sinObjetivo = renderAlcance(CONOCIMIENTO_VACIO, null).join("\n");
  ok("sin caso abierto NO se inventa nada que recoger", /no hay nada pendiente que recoger/i.test(sinObjetivo) && !sinObjetivo.includes(OBJ.proposito));

  const sinUrgencias = renderAlcance(
    { ...CONOCIMIENTO_VACIO, alcance: { ...CONOCIMIENTO_VACIO.alcance, urgencias: { atiende: false, textoNoAtiende: "Aquí no atendemos urgencias; llama al 112." } } },
    OBJ,
  ).join("\n");
  ok("una clínica que no atiende urgencias manda su texto LITERAL", sinUrgencias.includes("Aquí no atendemos urgencias; llama al 112."));
  ok("y una que sí las atiende no dice nada de eso", !renderAlcance(CONOCIMIENTO_VACIO, OBJ).join("\n").includes("NO atiende urgencias"));
}

// ─── El prompt del decisor «alcance» = el libre menos la veda de agenda ────
{
  const { SYSTEM_PROMPT_SOMBRA_LIBRE, SYSTEM_PROMPT_SOMBRA_ALCANCE } = await import("../app/lib/agente/sombra");
  ok("el prompt del alcance NO lleva la prohibición de agenda (la cubre el papel)",
    SYSTEM_PROMPT_SOMBRA_LIBRE.includes("Ni huecos ni días libres") && !SYSTEM_PROMPT_SOMBRA_ALCANCE.includes("Ni huecos ni días libres"));
  ok("y sí lleva el paso que le manda mirar hasta dónde llega su papel",
    SYSTEM_PROMPT_SOMBRA_ALCANCE.includes("HASTA DÓNDE LLEGA TU PAPEL"));
  // Lo demás IDÉNTICO: si la diferencia fuera más ancha, lo medido no sería
  // la idea del alcance sino «más texto».
  // 13-09 noche: DOS líneas, y la segunda es deliberada — el paso 5 cambia solo
  // en su cadencia («una pregunta como mucho» → las que encajen). El límite de
  // una por mensaje era lo que creaba el gota a gota, así que quitarlo de la
  // cláusula del alcance y dejarlo en el paso 5 mediría obediencia, no la idea.
  // El LIBRE no se toca: es el control, y sin él la comparación pierde su suelo.
  // 14-09: TRES, y la tercera es el paso 6 — la prueba antes de enviar, que
  // vino del papel y no se duplica (ver arriba).
  const soloEsas = SYSTEM_PROMPT_SOMBRA_ALCANCE.split("\n").filter((l) => !SYSTEM_PROMPT_SOMBRA_LIBRE.includes(l));
  ok("y las ÚNICAS líneas distintas son el paso 4, la cadencia del paso 5 y el paso 6", soloEsas.length === 3, `${soloEsas.length} líneas nuevas`);
  // EL PASO 6 ES UN PASO, y eso es todo el cambio: va numerado, dentro del
  // procedimiento, después del 5. Si alguien lo devuelve a una lista de
  // contexto, esto se pone rojo.
  ok("237/3 · la prueba vive AHORA como paso 6, numerada y después del 5",
    /\n6\. ANTES DE DARLO POR BUENO/.test(SYSTEM_PROMPT_SOMBRA_ALCANCE) &&
      SYSTEM_PROMPT_SOMBRA_ALCANCE.indexOf("\n6. ANTES DE DARLO POR BUENO") > SYSTEM_PROMPT_SOMBRA_ALCANCE.indexOf("\n5. Solo entonces escribe"));
  ok("237/3 · y es el MISMO test de falsabilidad que usa el juez de agenda",
    /no hubiera hueco donde ella ped[íi]a/.test(SYSTEM_PROMPT_SOMBRA_ALCANCE) && /se vuelve mentira, reescr[íi]belo/.test(SYSTEM_PROMPT_SOMBRA_ALCANCE));
  // La guarda contra el fallo que se le ve venir: cumplir «reescríbelo»
  // callándose es el mismo daño con otra cara.
  ok("237/3 · y dice que reescribir NO es borrar (si no, la prudencia lo vuelve mudo)",
    /no lo borres/i.test(SYSTEM_PROMPT_SOMBRA_ALCANCE));
  ok("el LIBRE sigue sin paso 6: es el control", !/ANTES DE DARLO POR BUENO/.test(SYSTEM_PROMPT_SOMBRA_LIBRE));
  ok("el libre conserva su tope de una pregunta (es el control)", SYSTEM_PROMPT_SOMBRA_LIBRE.includes("Una pregunta como mucho."));
  ok("y el alcance deja el número al juicio del modelo", !SYSTEM_PROMPT_SOMBRA_ALCANCE.includes("Una pregunta como mucho.")
    && /encajan juntas y no parece un interrogatorio/.test(SYSTEM_PROMPT_SOMBRA_ALCANCE));
  // §25 — la versión tiene que cubrir TODO el diseño del decisor. La tercera
  // pieza del alcance viaja en la ENTRADA: si la versión fuera solo el system,
  // cambiar esa plantilla dejaría dos agentes distintos con la misma etiqueta.
  const { versionSombra } = await import("../app/lib/agente/sombra");
  const { hashVersion } = await import("../app/lib/agente/version");
  ok("la versión del alcance NO es solo su system: incluye la plantilla del alcance",
    versionSombra("alcance") !== hashVersion(SYSTEM_PROMPT_SOMBRA_ALCANCE));
  ok("y la del libre sí es su system (no tiene pieza en la entrada)",
    versionSombra("libre") === hashVersion(SYSTEM_PROMPT_SOMBRA_LIBRE));
}

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s)`);
  process.exit(1);
}
console.log("\n✓ conocimiento: parser fail-closed, plan básico intacto byte a byte, y lo publicado entra tal cual");
