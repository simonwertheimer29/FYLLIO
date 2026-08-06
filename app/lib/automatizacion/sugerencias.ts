// app/lib/automatizacion/sugerencias.ts
//
// Las categorías que el modelo propone cuando ninguna del catálogo encaja.
//
// ─── La barrera, y por qué es estructural ───────────────────────────────────
//
// Estas categorías **no entran solas al catálogo**. Se acumulan aquí con su
// recuento; para que una pase a ser categoría estable hace falta una migración
// que la añada al enum — y esa migración **rompe la compilación** en
// `presupuestos/intenciones` hasta que alguien decida qué significa (si cuenta
// como cierre, qué puntúa, si dispara alguna recomendación).
//
// Sin esa barrera, cada mensaje puede inventar su etiqueta y en un mes hay
// doscientas que no sirven para contar nada. Con ella, el valor que sí aporta
// —que cada clínica acabe teniendo el mapa de qué le preguntan sus pacientes—
// se acumula sin ensuciar ni el dato ni el histórico.
//
// Nunca lanza: una sugerencia perdida no vale un mensaje sin clasificar. Pero
// se loguea (§9), porque si fallara siempre la tabla estaría vacía sin decir
// por qué.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { requireCliente } from "../cliente-contexto";

/**
 * Normaliza para agrupar: «Pide Factura» y «pide factura» son la misma
 * sugerencia. Sin esto, la tabla de revisión tendría tres filas por variante
 * ortográfica y el recuento —que es lo único que la hace útil— no diría nada.
 */
export function normalizarSugerencia(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function acumularSugerencia(args: {
  texto: string;
  /** Un mensaje real que la provocó: sin ejemplo, una etiqueta no se puede juzgar. */
  ejemplo?: string | null;
}): Promise<void> {
  const texto = args.texto.trim().slice(0, 60);
  const norm = normalizarSugerencia(texto);
  // Una sugerencia de una palabra genérica («otra», «duda») no aporta nada al
  // mapa y sí ensucia la revisión.
  if (norm.length < 4) return;

  try {
    const cliente = requireCliente("acumularSugerencia");
    await runWithClienteDb(cliente, (trx) =>
      sql`insert into sugerencias_categoria (cliente, texto_norm, texto, ejemplo)
          values (${cliente}, ${norm}, ${texto}, ${args.ejemplo?.slice(0, 300) ?? null})
          on conflict (cliente, texto_norm) do update
            set veces = sugerencias_categoria.veces + 1,
                ultima_vez = now()`.execute(trx),
    );
  } catch (err) {
    console.error(
      "[automatizacion] no se pudo acumular la sugerencia de categoría",
      norm,
      err instanceof Error ? err.message : err,
    );
  }
}

export type SugerenciaCategoria = {
  texto: string;
  veces: number;
  ejemplo: string | null;
  primeraVez: string;
  ultimaVez: string;
};

/** Las pendientes de revisar, la más repetida primero. */
export async function sugerenciasPendientes(limite = 50): Promise<SugerenciaCategoria[]> {
  const cliente = requireCliente("sugerenciasPendientes");
  const r: any = await runWithClienteDb(cliente, (trx) =>
    sql`select texto, veces, ejemplo, primera_vez, ultima_vez
        from sugerencias_categoria
        where estado = 'pendiente'
        order by veces desc, ultima_vez desc
        limit ${limite}`.execute(trx),
  );
  return (r.rows ?? []).map((x: any) => ({
    texto: String(x.texto),
    veces: Number(x.veces),
    ejemplo: x.ejemplo ?? null,
    primeraVez: new Date(x.primera_vez).toISOString(),
    ultimaVez: new Date(x.ultima_vez).toISOString(),
  }));
}
