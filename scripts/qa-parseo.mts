#!/usr/bin/env tsx
// QA del BORDE CANÓNICO de etiquetas (corte de raíz, 2026-08-17).
//
//   npx tsx scripts/qa-parseo.mts   (= npm run qa:parseo)
//
// Determinista y SIN modelo (coste 0, milisegundos): alimenta a
// parsearJuicio/etiquetaDelModelo con lo que Haiku devuelve cuando deriva —
// mayúsculas («CITA», el bug real de los recorridos), acentos, espacios,
// claves inventadas, JSON con fences— y afirma DOS cosas por caso: el valor
// canónico correcto Y que lo descartado quede CONTADO en `descartes` (no
// solo en un warn que nadie mira).
//
// La regla que protege: toda etiqueta del modelo se canoniza UNA vez, en el
// borde; aguas abajo solo circulan uniones canónicas. Un juicio nuevo que no
// pase por etiquetaDelModelo debe añadir aquí su caso — es parte del
// checklist de añadir un juicio.
//
// Salidas (§9): 0 = todo bien · 1 = el borde dejó pasar o tragó algo.

import { parsearJuicio } from "../app/lib/agente/evaluador";
import { etiquetaDelModelo, normalizarEtiqueta } from "../app/lib/agente/etiquetas";

let fallos = 0;
const ok = (n: string, c: boolean, extra = "") => {
  console.log(`  ${c ? "✓" : "✗ FALLO"} ${n}${extra ? " — " + extra : ""}`);
  if (!c) fallos++;
};

const json = (extra: Record<string, unknown>) =>
  JSON.stringify({
    tema: "otro", urgenciaMedica: false, peticionOQueja: false, malestar: false,
    mencionaAntecedenteMedico: false, vuelveSobreAplazado: null, aplazamientosNuevos: [],
    pideAccion: false, respondeAlMotivoDeEspera: false, esperaSolicitada: null,
    camposRecogidos: {}, respuesta: "Hola.", ...extra,
  });

console.log("\n1 · normalizarEtiqueta: mayúsculas, espacios y acentos son la misma etiqueta");
ok("«CITA» ≡ «cita»", normalizarEtiqueta("CITA") === "cita");
ok("« Cita » ≡ «cita»", normalizarEtiqueta(" Cita ") === "cita");
ok("«Precio_Descuentó» ≡ «precio_descuento»", normalizarEtiqueta("Precio_Descuentó") === "precio_descuento");

console.log("\n2 · etiquetaDelModelo: canoniza o descarta CONTANDO");
{
  const d: string[] = [];
  ok("«CLINICA» → canónica «clinica»", etiquetaDelModelo("CLINICA", ["clinica", "economica"] as const, "t", d) === "clinica" && d.length === 0);
  ok("«económica» (acento) → canónica «economica»", etiquetaDelModelo("económica", ["clinica", "economica"] as const, "t", d) === "economica" && d.length === 0);
  ok("«regla clínica» (fuera de lista) → null Y contada", etiquetaDelModelo("regla clínica", ["clinica"] as const, "t", d) === null && d.length === 1 && d[0].startsWith("t:"));
  ok("null (campo ausente) → null SIN contar", etiquetaDelModelo(null, ["clinica"] as const, "t", d) === null && d.length === 1);
}

console.log("\n3 · parsearJuicio: el bug real de «CITA» ya no puede pasar");
{
  const r = parsearJuicio(json({ camposRecogidos: { CITA: { disponibilidad: "tardes" } } }));
  ok("camposRecogidos con etapa «CITA» → aterriza en «cita»", r?.juicio.camposRecogidos.cita?.disponibilidad === "tardes");
  ok("sin descartes (era etiqueta válida mal escrita)", r?.descartes.length === 0);
}
{
  const r = parsearJuicio(json({ tema: "Cita" }));
  ok("tema «Cita» → canónico «cita»", r?.juicio.tema === "cita");
}
{
  const r = parsearJuicio(json({ tema: "facturación" }));
  ok("tema fuera de vocabulario → default «ninguno» Y contado", r?.juicio.tema === "ninguno" && r?.descartes.some((x) => x.startsWith("tema:")));
}
{
  const r = parsearJuicio(json({ vuelveSobreAplazado: "Dato_Presupuesto" }));
  ok("vuelveSobreAplazado «Dato_Presupuesto» → canónica", r?.juicio.vuelveSobreAplazado === "dato_presupuesto");
}
{
  const r = parsearJuicio(json({ aplazamientosNuevos: [
    { clave: "PLAN_PAGO", motivo: "quiere fraccionar" },
    { clave: "descuentos_verano", motivo: "inventada" },
    { clave: "duda_clinica" },
  ] }));
  ok("clave «PLAN_PAGO» → canónica y conservada", r?.juicio.aplazamientosNuevos.some((a) => a.clave === "plan_pago"));
  ok("clave inventada → descartada Y contada", r?.juicio.aplazamientosNuevos.length === 1 && r?.descartes.some((x) => x.startsWith("aplazamiento.clave:")));
  ok("clave válida SIN motivo → descartada Y contada como sin_motivo", r?.descartes.some((x) => x.startsWith("aplazamiento.sin_motivo:")));
}
{
  const r = parsearJuicio(json({ esperaSolicitada: "el viernes" }));
  ok("espera con fecha ilegible → null Y contada (se perdería una espera pedida)", r?.juicio.esperaSolicitada === null && r?.descartes.some((x) => x.startsWith("esperaSolicitada:")));
}
{
  const r = parsearJuicio("```json\n" + json({ tema: "cobro" }) + "\n```");
  ok("JSON con fences de markdown → parsea igual", r?.juicio.tema === "cobro");
}
{
  ok("texto sin JSON → null (fallback del caller, no default optimista)", parsearJuicio("no puedo ayudarte con eso") === null);
}

if (fallos > 0) {
  console.error(`\n✗ ${fallos} fallo(s) — el borde deja pasar o traga sin contar`);
  process.exit(1);
}
console.log("\n✓ borde canónico: normaliza, canoniza y CUENTA lo que descarta");
