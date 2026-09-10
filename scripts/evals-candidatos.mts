// scripts/evals-candidatos.mts
//
// REVISIÓN de los casos candidatos del eval (plan maestro 2.7, MEJORAS 182):
// lo que las coordinadoras marcan con «el agente se equivocó aquí» llega
// aquí, y una persona decide qué entra en la vara. Acumular es automático;
// adoptar es una decisión (PLAN-AGENTE fase 4).
//
//   npm run evals:candidatos -- --cliente DEMO                  # pendientes, resumidos
//   npm run evals:candidatos -- --cliente DEMO --md             # con la entrada renderizada, para anotar
//   npm run evals:candidatos -- --cliente DEMO --estado todos   # pendiente | aceptado | descartado | todos
//   npm run evals:candidatos -- --cliente DEMO --aceptar <id> [--nota "…"]
//   npm run evals:candidatos -- --cliente DEMO --descartar <id> [--nota "…"]
//
// El cliente es EXPLÍCITO (§6): un script no tiene sesión de la que derivarlo.
// Lo que sale por aquí es texto de conversación real: la copia a evals/ se
// hace a mano y ANONIMIZADA (nombres, teléfonos, importes reconocibles) — el
// repo no es sitio para datos de pacientes. Lo sintético y lo real no se
// mezclan al medir: el caso que entre lleva `origen: real` (evals/README).

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: false });
import { runWithCliente } from "../app/lib/airtable";
import type { Cliente } from "../app/lib/cliente-contexto";
import { listarCandidatos, revisarCandidato } from "../app/lib/agente/candidatos-eval";
import { etiquetaFallo, ETIQUETA_ESTADO_CANDIDATO, type EstadoCandidato } from "../app/lib/agente/candidatos-eval.tipos";
import { ETIQUETA_CAUSA } from "../app/components/agente/etiquetas-agente";

const arg = (nombre: string): string | null => {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const flag = (nombre: string) => process.argv.includes(nombre);

const cliente = arg("--cliente");
if (cliente !== "RB" && cliente !== "INDEP" && cliente !== "DEMO") {
  console.error("Falta --cliente RB|INDEP|DEMO (explícito: un script no tiene sesión).");
  process.exit(2);
}
const estadoArg = arg("--estado") ?? "pendiente";
if (!["pendiente", "aceptado", "descartado", "todos"].includes(estadoArg)) {
  console.error(`--estado ${estadoArg} no vale: pendiente | aceptado | descartado | todos`);
  process.exit(2);
}
const estado = estadoArg as EstadoCandidato | "todos";

const corto = (s: string | null, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const fecha = (iso: string) => iso.slice(0, 16).replace("T", " ");

async function main() {
  await runWithCliente(cliente as Cliente, async () => {
    const aceptar = arg("--aceptar");
    const descartar = arg("--descartar");
    if (aceptar || descartar) {
      const id = (aceptar ?? descartar)!;
      await revisarCandidato(id, aceptar ? "aceptado" : "descartado", arg("--nota"));
      console.log(`${aceptar ? "Aceptado" : "Descartado"} ${id}${arg("--nota") ? ` — ${arg("--nota")}` : ""}`);
      return;
    }

    const lista = await listarCandidatos({ estado });
    if (!lista.length) {
      console.log(`Sin candidatos ${estado === "todos" ? "" : estado + "s "}en ${cliente}.`);
      return;
    }
    console.log(`${lista.length} candidato${lista.length === 1 ? "" : "s"} (${estado}) en ${cliente}\n`);

    for (const c of lista) {
      const hizo = c.decision === "entrego" ? `lo pasó a una persona (${ETIQUETA_CAUSA[c.causaEntrega ?? ""] ?? c.causaEntrega ?? "sin causa"})` : "siguió él";
      if (!flag("--md")) {
        console.log(`${c.id}  ${fecha(c.en)}  ${c.origen}  clínica ${c.clinicaId ?? "—"}  ${ETIQUETA_ESTADO_CANDIDATO[c.estado]}`);
        console.log(`   paciente: «${corto(c.mensajePaciente, 90)}»`);
        console.log(`   agente:   ${hizo}${c.borrador ? ` · «${corto(c.borrador, 70)}»` : ""}`);
        console.log(`   falló:    ${etiquetaFallo(c.fallo, c.decision)}${c.correccion ? ` — ${corto(c.correccion, 120)}` : ""}  (${c.porNombre ?? "?"})`);
        if (c.notaRevision) console.log(`   revisión: ${c.notaRevision}`);
        console.log("");
        continue;
      }
      console.log(`## ${c.id} · ${fecha(c.en)} · ${c.origen} · ${ETIQUETA_ESTADO_CANDIDATO[c.estado]}`);
      console.log(`- **Mensaje del paciente:** «${(c.mensajePaciente ?? "").trim()}»`);
      console.log(`- **Qué hizo el agente:** ${hizo}`);
      if (c.borrador) console.log(`- **Borrador:** «${c.borrador.trim()}»`);
      console.log(`- **Qué falló (${c.porNombre ?? "?"}):** ${etiquetaFallo(c.fallo, c.decision)}`);
      if (c.correccion) console.log(`- **Corrección:** ${c.correccion}`);
      const v = c.version as { evaluador?: string; juez?: string } | null;
      if (v?.evaluador) console.log(`- **Versión:** evaluador ${v.evaluador} · control ${v.juez ?? "?"}`);
      if (c.notaRevision) console.log(`- **Revisión:** ${c.notaRevision}`);
      if (c.entrada) {
        console.log("\n<details><summary>Lo que vio el modelo</summary>\n");
        console.log("```\n" + c.entrada.trim() + "\n```\n</details>");
      }
      console.log("");
    }
    if (estado === "pendiente") {
      console.log("Para decidir: --aceptar <id> | --descartar <id> [--nota \"…\"]. La copia a evals/ va anonimizada y con el origen del candidato: real, o sintetico si el hilo es jugado (nunca entra como real).");
    }
  });
}

main().catch((e) => {
  console.error("✗ no pude comprobar:", e instanceof Error ? e.stack : e);
  process.exit(2);
});
