#!/usr/bin/env tsx
// QUIÉN HACE CADA TRATAMIENTO, CONTRA LA BASE DEMO (062, MEJORAS 265, 26-09).
//
//   npm run qa:quien-lo-hace
//
// Solo lectura, sin modelo ($0). Recorre `huecosDelCaso`, la función por la
// que pasan el selector «Proponer horas», la oferta, el repuesto y la
// comprobación de que una hora sigue libre, con el catálogo que siembra
// `db-seed-agenda-catalogo.mjs`:
//  · una limpieza en Centro solo ofrece a Ferrer (Molina es implantólogo);
//  · un implante en Centro solo a Molina;
//  · una ortodoncia en Centro no ofrece a nadie y lo dice (Villalba es de Sur);
//  · la urgencia, sin especialidad, ofrece a los dos;
//  · si la persona pide a Molina para una limpieza, no se filtra por él y se
//    dice (`doctorNoLoHace`).
// Salida: 0 = verde · 1 = algún rojo · 2 = el catálogo DEMO no es el esperado
// (sin sembrar): no se pudo comprobar.

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { runWithCliente } from "../app/lib/airtable";
import { runWithClienteDb } from "../app/lib/db/context";
import { huecosDelCaso } from "../app/lib/agenda/huecos-del-caso";

let rojos = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${msg}`);
  if (!cond) rojos++;
};

await runWithCliente("DEMO", async () => {
  const centro = await runWithClienteDb("DEMO", (trx) =>
    trx.selectFrom("clinicas").select("id").where("nombre", "=", "Clínica Demo Centro").executeTakeFirst());
  const sembrado = await runWithClienteDb("DEMO", (trx) =>
    trx.selectFrom("tratamientos").select("nombre").where("nombre", "=", "Limpieza dental").where("especialidad_id", "is not", null).executeTakeFirst());
  if (!centro || !sembrado) {
    console.error("✗ el catálogo DEMO no tiene Centro o la limpieza sin especialidad: corre `node scripts/db-seed-agenda-catalogo.mjs`");
    process.exit(2);
  }
  // Por id, como cuando la coordinadora lo elige en el selector: el casado por
  // texto pide elegir si dos nombres comparten palabra («implante», «dental»).
  const idDe = new Map((await runWithClienteDb("DEMO", (trx) => trx.selectFrom("tratamientos").select(["id", "nombre"]).execute()))
    .map((t) => [t.nombre ?? "", t.id]));
  const caso = (tratamiento: string, doctorPedidoTexto: string | null = null) =>
    huecosDelCaso({ preferencia: null, tratamientoTexto: null, tratamientoId: idDe.get(tratamiento) ?? "∅", doctorId: null, doctorPedidoTexto, clinicaId: centro.id, modo: "todos" });
  const doctoresDe = (r: Awaited<ReturnType<typeof caso>>) => [...new Set(r.huecos.map((h) => h.doctorNombre))].sort().join(" · ");

  console.log("══ Clínica Demo Centro (Ferrer: general · Molina: implantes)");
  const limpieza = await caso("Limpieza dental");
  ok(limpieza.huecos.length > 0 && doctoresDe(limpieza) === "Dra. Lucía Ferrer", `limpieza: solo Ferrer (${doctoresDe(limpieza) || "sin huecos"})`);
  ok(limpieza.doctores.map((d) => d.nombre).join(" · ") === "Dra. Lucía Ferrer", "limpieza: el filtro a mano solo lista a Ferrer");

  const implante = await caso("Implante unitario");
  ok(implante.huecos.length > 0 && doctoresDe(implante) === "Dr. Andrés Molina", `implante: solo Molina (${doctoresDe(implante) || "sin huecos"})`);

  const orto = await caso("Ortodoncia invisible");
  ok(orto.huecos.length === 0, "ortodoncia en Centro: ningún hueco (Villalba es de Sur)");
  ok((orto.nota ?? "").startsWith("En esta clínica nadie hace Ortodoncia invisible (Ortodoncia)"), `ortodoncia en Centro: lo dice («${orto.nota}»)`);

  const urgencia = await caso("Urgencia dental");
  ok(doctoresDe(urgencia) === "Dr. Andrés Molina · Dra. Lucía Ferrer", `urgencia sin especialidad: los dos (${doctoresDe(urgencia) || "sin huecos"})`);

  const pideMolina = await caso("Limpieza dental", "con el doctor Molina");
  ok(pideMolina.doctorNoLoHace === "Dr. Andrés Molina", `pide a Molina para una limpieza: se dice que no la hace (${pideMolina.doctorNoLoHace})`);
  ok(pideMolina.doctorFiltrado == null && doctoresDe(pideMolina) === "Dra. Lucía Ferrer", "…y se ofrece a quien sí la hace, sin filtrar por él");

  const pideFerrer = await caso("Limpieza dental", "con la doctora Ferrer");
  ok(pideFerrer.doctorFiltrado?.nombre === "Dra. Lucía Ferrer" && pideFerrer.doctorNoLoHace == null, "pide a Ferrer para una limpieza: filtra por ella, sin aviso");
});

console.log(rojos ? `\n✗ ${rojos} rojos` : "\n✓ todo verde");
process.exit(rojos ? 1 : 0);
