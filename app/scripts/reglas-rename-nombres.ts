// app/scripts/reglas-rename-nombres.ts
//
// Renombra el NOMBRE VISIBLE de las reglas de automatización al idioma de la
// coordinadora. Cambio de DATO de presentación únicamente: actualiza los campos
// Nombre y Resumen (ambos solo se muestran). NO toca Codigo, Trigger_Tipo,
// Condiciones ni Acciones — la identidad y el comportamiento de cada regla son
// exactamente los mismos. Se empareja por Codigo (la clave estable).
//
// Idempotente: si el nombre ya es el nuevo, no reescribe. Cubre las tres bases
// de negocio (RB, INDEP, DEMO) por si en el futuro las reglas se siembran en
// alguna; hoy solo existen en DEMO.
//
// Uso:
//   npx tsx app/scripts/reglas-rename-nombres.ts --dry   # muestra, no escribe
//   npx tsx app/scripts/reglas-rename-nombres.ts         # aplica

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import Airtable from "airtable";

const DRY = process.argv.includes("--dry");
const KEY = process.env.AIRTABLE_API_KEY;

// codigo (clave estable) → nombre visible en idioma de coordinadora.
const NUEVOS_NOMBRES: Record<string, string> = {
  recordatorio_cita_24h: "Recordar la cita al paciente el día antes",
  lead_sin_gestionar_2h: "Avisar de leads nuevos sin contactar",
  lead_inactivo_n_dias: "Marcar leads sin respuesta como no interesados",
  plantilla_post_presupuesto: "Enviar el presupuesto por WhatsApp al paciente",
  presupuesto_estancado_7d: "Recordar presupuestos parados más de una semana",
};

const BASES: Array<{ cliente: string; id: string | undefined }> = [
  { cliente: "RB", id: process.env.AIRTABLE_BASE_RB },
  { cliente: "INDEP", id: process.env.AIRTABLE_BASE_INDEP },
  { cliente: "DEMO", id: process.env.AIRTABLE_BASE_ID },
];

async function renombrarEnBase(cliente: string, baseId: string): Promise<void> {
  const base = new Airtable({ apiKey: KEY! }).base(baseId);
  const recs = await base("Reglas_Automatizacion")
    .select({ fields: ["Codigo", "Nombre"] })
    .all();

  let actualizadas = 0;
  let yaOk = 0;
  for (const rec of recs) {
    const codigo = String(rec.fields["Codigo"] ?? "");
    const nuevo = NUEVOS_NOMBRES[codigo];
    if (!nuevo) continue; // regla desconocida: no la tocamos
    const actual = String(rec.fields["Nombre"] ?? "");
    if (actual === nuevo) {
      yaOk++;
      continue;
    }
    if (DRY) {
      console.log(`  [dry] ${cliente}/${codigo}: "${actual}" → "${nuevo}"`);
      actualizadas++;
      continue;
    }
    // Nombre y Resumen son ambos de presentación; los dejamos coherentes.
    await base("Reglas_Automatizacion").update([
      { id: rec.id, fields: { Nombre: nuevo, Resumen: nuevo } },
    ]);
    console.log(`  ✓ ${cliente}/${codigo}: "${actual}" → "${nuevo}"`);
    actualizadas++;
  }
  console.log(
    `  ${cliente}: ${recs.length} reglas · ${actualizadas} ${DRY ? "a renombrar" : "renombradas"} · ${yaOk} ya correctas`,
  );
}

async function main() {
  if (!KEY) {
    console.error("Falta AIRTABLE_API_KEY en el entorno.");
    process.exit(1);
  }
  console.log(DRY ? "MODO DRY — no escribe nada\n" : "Renombrando nombres visibles de reglas\n");
  for (const { cliente, id } of BASES) {
    if (!id) {
      console.log(`${cliente}: (sin base configurada, se omite)`);
      continue;
    }
    console.log(`=== ${cliente} (${id}) ===`);
    await renombrarEnBase(cliente, id);
  }
  console.log("\nListo. Solo se cambió el nombre visible; comportamiento intacto.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
