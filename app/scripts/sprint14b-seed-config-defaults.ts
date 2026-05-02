// app/scripts/sprint14b-seed-config-defaults.ts
//
// Sprint 14b Bloque 0 — seed de defaults globales (Clinica_Link=null)
// para Configuraciones_Clinica. Idempotente: si ya existe la opcion
// (por categoria + valor + scope global), skip.
//
// Defaults:
//   Metodos_Pago: Tarjeta, Efectivo, Transferencia, Bizum, Financiación externa
//   Plazos_Liquidacion: 90 (dias)
//   Razones_No_Interesado: Precio alto, Distancia, Decidió otra clínica,
//                          Sin presupuesto, Quiere esperar, Otro
//
// Plantillas_Scope no se seedea aqui (lo cubre Bloque 4 con plantillas
// recordatorio_senal/_cuota/_liquidacion en Plantillas_Mensaje).

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { base, TABLES, fetchAll } from "../lib/airtable";

const APPLY_PROD = process.argv.includes("--apply-prod");
const PROD_BASE_ID = "appfUJcyGnkZ16Fhr";
const BASE_ID = process.env.AIRTABLE_BASE_ID ?? "?";
if (BASE_ID === PROD_BASE_ID && !APPLY_PROD) {
  console.error(`✖ Prod requiere --apply-prod explicito.`);
  process.exit(1);
}

type DefaultEntry = {
  categoria: string;
  valor: string;
  orden: number;
};

const DEFAULTS: DefaultEntry[] = [
  // Metodos_Pago — orden refleja el uso esperado en R2b.
  { categoria: "Metodos_Pago", valor: "Tarjeta", orden: 1 },
  { categoria: "Metodos_Pago", valor: "Efectivo", orden: 2 },
  { categoria: "Metodos_Pago", valor: "Transferencia", orden: 3 },
  { categoria: "Metodos_Pago", valor: "Bizum", orden: 4 },
  { categoria: "Metodos_Pago", valor: "Financiación externa", orden: 5 },

  // Plazos_Liquidacion — un solo valor escalar (dias) por defecto.
  { categoria: "Plazos_Liquidacion", valor: "90", orden: 1 },

  // Razones_No_Interesado — frases tipicas que la coordinadora
  // selecciona al transicionar lead a "No Interesado".
  { categoria: "Razones_No_Interesado", valor: "Precio alto", orden: 1 },
  { categoria: "Razones_No_Interesado", valor: "Distancia", orden: 2 },
  { categoria: "Razones_No_Interesado", valor: "Decidió otra clínica", orden: 3 },
  { categoria: "Razones_No_Interesado", valor: "Sin presupuesto", orden: 4 },
  { categoria: "Razones_No_Interesado", valor: "Quiere esperar", orden: 5 },
  { categoria: "Razones_No_Interesado", valor: "Otro", orden: 6 },
];

async function main() {
  const target = BASE_ID === PROD_BASE_ID ? "Prod" : "Dev";
  console.log(
    `Sprint 14b Bloque 0 — seed defaults globales · base ${BASE_ID} (${target})`,
  );

  // Cargo lo existente para idempotencia.
  const existentes = await fetchAll(
    base(TABLES.configuracionesClinica as any).select({
      fields: ["Clinica_Link", "Categoria", "Valor"],
    }),
  );
  const yaExiste = (cat: string, val: string) =>
    existentes.some((r) => {
      const f = r.fields as any;
      const links = (f["Clinica_Link"] ?? []) as string[];
      const isGlobal = links.length === 0;
      return isGlobal && String(f["Categoria"]) === cat && String(f["Valor"]) === val;
    });

  const aCrear = DEFAULTS.filter((d) => !yaExiste(d.categoria, d.valor));
  console.log(
    `  Defaults presentes: ${DEFAULTS.length - aCrear.length}/${DEFAULTS.length}. A crear: ${aCrear.length}.`,
  );
  if (aCrear.length === 0) {
    console.log("  Idempotente · nada que hacer.");
    return;
  }

  for (let i = 0; i < aCrear.length; i += 10) {
    const slice = aCrear.slice(i, i + 10);
    await base(TABLES.configuracionesClinica as any).create(
      slice.map((d) => ({
        fields: {
          Resumen: `${d.categoria} · ${d.valor} · global`,
          Categoria: d.categoria,
          Valor: d.valor,
          Activo: true,
          Orden: d.orden,
          Created_At: new Date().toISOString(),
        },
      })),
    );
  }
  console.log(`✔ Defaults globales creados: ${aCrear.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
