// scripts/qa-ofertas.mts — lo PURO del bucle de ofertas (17-09, 060), sin base
// ni modelo ($0): caducidad y su tope, gracia, elección tardía, la lectura
// de la elección del modelo y los textos al paciente (que no se muevan sin
// querer: son plantillas aprobadas).
//
//   npm run qa:ofertas

import { caducaEn, estadoEfectivo, eleccionTardia, PLAZO_OFERTA_MS, GRACIA_MS, TOPE_ANTES_DEL_HUECO_MS } from "../app/lib/agenda/ofertas";
import { textoOferta, textoSeOcupo, textoTodasOcupadas, textoSinHuecos, textoDesambiguacion, textoAcuse, alternativaCorta } from "../app/lib/agenda/ofertas-textos";
import { canonizarEleccionOferta } from "../app/lib/agente/evaluador";
import { clinicaAbierta } from "../app/lib/seguimiento/tiempo-laborable";

let rojos = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) rojos++;
};
const H = 3_600_000;

const alt = (fecha: string, hora: string, doctor = "Dra. Ana Villalba") => ({ fecha, hora, fin: "", doctorId: doctor, doctorNombre: doctor, clinicaId: "c1", clinicaNombre: "Clínica Demo Centro" });

console.log("══ caducidad");
{
  // Enviada un lunes a las 10:00 (hora Madrid = UTC+2 en septiembre).
  const enviada = new Date("2026-09-21T08:00:00Z");
  const lejos = caducaEn([alt("2026-09-24", "10:00"), alt("2026-09-25", "12:00")], enviada);
  ok(lejos.getTime() === enviada.getTime() + PLAZO_OFERTA_MS, "con huecos lejanos vence a las 24 h");
  const cerca = caducaEn([alt("2026-09-21", "18:00"), alt("2026-09-25", "12:00")], enviada);
  ok(cerca.toISOString() === "2026-09-21T14:00:00.000Z", `tope: la primera alternativa menos 2 h (${cerca.toISOString()})`);
  const inminente = caducaEn([alt("2026-09-21", "11:00")], enviada);
  ok(inminente.getTime() === enviada.getTime() + 30 * 60_000, "una oferta no nace muerta: mínimo media hora");
  ok(estadoEfectivo({ estado: "abierta", caducaEn: lejos }, new Date(lejos.getTime() - 1)) === "abierta", "antes de vencer sigue abierta");
  ok(estadoEfectivo({ estado: "abierta", caducaEn: lejos }, new Date(lejos.getTime() + 1)) === "caducada", "al vencer, caducada (calculado al leer)");
  ok(estadoEfectivo({ estado: "elegida", caducaEn: lejos }, new Date(lejos.getTime() + H)) === "elegida", "una elegida no caduca");
}

console.log("══ elección tardía y gracia");
{
  const vence = new Date("2026-09-22T08:00:00Z");
  const o = { estado: "abierta" as const, caducaEn: vence, alternativas: [alt("2026-09-24", "10:00"), alt("2026-09-25", "12:00")] };
  ok(!eleccionTardia(o, new Date(vence.getTime() - H), 0), "a tiempo: no es tardía");
  ok(!eleccionTardia(o, new Date(vence.getTime() + 2 * H), 0), "2 h después de vencer: dentro de la gracia de 4 h");
  ok(eleccionTardia(o, new Date(vence.getTime() + GRACIA_MS + 1), 0), "pasada la gracia: tardía");
  const justa = { ...o, alternativas: [alt("2026-09-22", "13:00")] }; // 11:00Z; tope 09:00Z (vence 08:00Z)
  ok(eleccionTardia(justa, new Date("2026-09-22T09:30:00Z"), 0), "dentro de la gracia pero a menos de 2 h del hueco: tardía");
  ok(eleccionTardia({ ...o, estado: "reemplazada" }, new Date(vence.getTime() - H), 0), "sobre una oferta reemplazada SIEMPRE es tardía (contestó a una lista que ya no tiene delante)");
  ok(TOPE_ANTES_DEL_HUECO_MS === 2 * H && GRACIA_MS === 4 * H, "constantes: tope 2 h, gracia 4 h");
}

console.log("══ la elección del modelo");
{
  ok(JSON.stringify(canonizarEleccionOferta({ indice: 2, ambigua: false })) === JSON.stringify({ indice: 1, ambigua: false }), "el modelo numera desde 1; el código desde 0");
  ok(JSON.stringify(canonizarEleccionOferta({ indice: "3" })) === JSON.stringify({ indice: 2, ambigua: false }), "índice como texto se admite");
  ok(JSON.stringify(canonizarEleccionOferta({ indice: null, ambigua: true })) === JSON.stringify({ indice: null, ambigua: true }), "ambigua sin índice");
  ok(canonizarEleccionOferta(null) === null && canonizarEleccionOferta({ indice: 0 }) === null && canonizarEleccionOferta("2") === null, "sin forma → null (nunca se reserva de una lectura dudosa)");
}

console.log("══ textos (plantillas aprobadas)");
{
  const alts = [alt("2026-09-24", "10:00"), alt("2026-09-25", "12:30", "Dr. Marc Ruiz")];
  const oferta = textoOferta({ nombre: "Samuel Arias", alternativas: alts, tratamiento: "Limpieza dental" });
  console.log(`  «${oferta.replace(/\n/g, " ⏎ ")}»`);
  ok(oferta.startsWith("Samuel, estas son las horas que tenemos para limpieza dental:"), "la oferta arranca con el nombre y el tratamiento");
  ok(/1\) jue 24 sept a las 10:00 con Dra\. Ana Villalba/.test(oferta) && /2\) vie 25 sept a las 12:30 con Dr\. Marc Ruiz/.test(oferta), "alternativas numeradas con día, hora y doctor");
  ok(oferta.includes("Dinos cuál te va y te la reservamos.") && !/queda reservada/.test(oferta) && !/Si ninguna/.test(oferta), "«te la reservamos» (sin contradecir el orden de confirmación) y sin la frase que da permiso a no elegir");
  ok(/por orden de confirmación/.test(oferta) && !/sujeto a cambios/i.test(oferta), "el aviso va del derecho (orden de confirmación), no como excusa");
  const seOcupo = textoSeOcupo({ nombre: "Samuel", ocupada: alts[0]!, restantes: [alts[1]!] });
  console.log(`  «${seOcupo.replace(/\n/g, " ⏎ ")}»`);
  ok(seOcupo.startsWith("Samuel, la del jueves 24 de septiembre a las 10:00 se acaba de ocupar. Te quedan estas:") && !/Vaya/.test(seOcupo), "«se acaba de ocupar» con la fecha entera y sin «Vaya» (es fallo nuestro)");
  const todas = textoTodasOcupadas({ nombre: "Samuel", nuevas: alts });
  ok(todas.startsWith("Samuel, las horas que te propusimos se han ocupado mientras tanto. Te paso otras:") && todas.endsWith("Dinos cuál y queda reservada para ti."), "todas ocupadas con horas nuevas (aprobado)");
  const sin = textoSinHuecos({ nombre: "Samuel" });
  ok(sin === "Samuel, las horas que te propusimos se han ocupado y ahora mismo no tenemos otras en los próximos días. El equipo revisa la agenda y te escribe en cuanto abra la clínica.", "sin huecos: opción b, aprobada — sin prometer «en cuanto haya hueco»");
  const des = textoDesambiguacion({ nombre: "Samuel", alternativas: alts });
  console.log(`  «${des}»`);
  ok(des === "Samuel, ¿cuál de las dos dices? La del jueves 24 a las 10:00 con la Dra. Ana Villalba o la del viernes 25 a las 12:30 con el Dr. Marc Ruiz.", "la desambiguación nombra las horas, sin números de lista ni «queda reservada» (aprobado)");
  const tres = textoDesambiguacion({ nombre: "Samuel", alternativas: [...alts, alt("2026-09-26", "09:00")] });
  ok(/¿cuál de las tres dices\? La del jueves 24 [^,]+, la del viernes 25 [^,]+ o la del sábado 26/.test(tres), "con tres: «de las tres», comas y «o» final");
  const dentro = textoAcuse({ nombre: "Samuel Arias", alternativa: alts[0]!, abierta: true });
  const fuera = textoAcuse({ nombre: "Samuel Arias", alternativa: alts[0]!, abierta: false });
  const sinHora = textoAcuse({ nombre: "Samuel", alternativa: null, abierta: false });
  console.log(`  «${dentro}»\n  «${fuera}»\n  «${sinHora}»`);
  ok(dentro === "Recibido, Samuel. Compruebo que la del jueves 24 de septiembre a las 10:00 siga libre y te lo confirmamos en un momento.", "acuse dentro de horario, con la fecha entera (dos martes a las 14:00 no se distinguen sin ella)");
  ok(fuera === "Recibido, Samuel. Compruebo que la del jueves 24 de septiembre a las 10:00 siga libre y te lo confirmamos en cuanto abra la clínica.", "acuse fuera de horario (aprobado)");
  ok(sinHora === "Recibido, Samuel. Lo comprobamos en la agenda y te lo confirmamos en cuanto abra la clínica.", "acuse sin hora conocida (no se entendió cuál / hilo asumido)");
  ok(!/\b\d{1,2}:\d{2}\b.*confirm/.test(sinHora) && !/reservad/.test(dentro), "el acuse no promete hora ni confirma nada");
  ok(alternativaCorta(alt("2026-09-26", "16:00")) === "la del sábado 26 de septiembre a las 16:00", "alternativa corta con día de la semana, número y mes");
}

console.log("══ horario de clínica");
{
  ok(clinicaAbierta(new Date("2026-09-22T09:00:00Z")), "martes 11:00 Madrid: abierta (default 09-20)");
  ok(!clinicaAbierta(new Date("2026-09-22T21:00:00Z")), "martes 23:00 Madrid: cerrada");
  ok(!clinicaAbierta(new Date("2026-09-27T10:00:00Z")), "domingo: cerrada");
}

console.log(rojos ? `\n✗ ${rojos} rojos` : "\n✓ qa:ofertas en verde");
process.exit(rojos ? 1 : 0);
