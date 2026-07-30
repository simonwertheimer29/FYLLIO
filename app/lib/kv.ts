// EL ÚNICO SITIO desde el que Fyllio habla con Vercel KV.
//
// Por qué existe: el singleton `kv` de `@vercel/kv` lee `KV_REST_API_URL` y
// `KV_REST_API_TOKEN` a pelo de `process.env`, y en Vercel las variables de este
// proyecto llevan **prefijo obligatorio** (`FYLLIO_`). Diez archivos importaban
// ese singleton, así que diez archivos habrían dejado de encontrar sus
// credenciales sin que nadie tocara una línea de código — exactamente la forma
// de la avería de Airtable (§11): el entorno cambia de nombre y el código cambia
// de comportamiento en silencio.
//
// Aquí se nombran UNA vez. `import { kv } from "../kv"` en vez de
// `from "@vercel/kv"`, y nada más cambia: la superficie es la misma.
//
// No hay "una u otra": los nombres viejos NO se leen. Un fallback a `KV_REST_*`
// sería un camino que funciona en local y no en producción (o al revés), y esa
// es justo la clase de rama que hace que un entorno degrade sin avisar.

import { createClient, type VercelKV } from "@vercel/kv";

const URL_VAR = "FYLLIO_KV_REST_API_URL";
const TOKEN_VAR = "FYLLIO_KV_REST_API_TOKEN";

/** ¿Está KV configurado? La ÚNICA pregunta sobre su entorno en todo el código.
 *  La usa el rate limiter del login para degradarse a memoria con log en vez de
 *  tumbar la puerta principal (matiz del §3, ya pagado en `ba9daea`). */
export function kvConfigurado(): boolean {
  return Boolean(process.env[URL_VAR] && process.env[TOKEN_VAR]);
}

let cliente: VercelKV | null = null;

function resolver(): VercelKV {
  if (cliente) return cliente;
  const url = process.env[URL_VAR];
  const token = process.env[TOKEN_VAR];
  if (!url || !token) {
    // Se lanza al USAR, no al importar: el contrato de entorno declara KV como
    // requisito FUNCIONAL (la app arranca, el portal del paciente no existe), y
    // hacer estallar el import tumbaría rutas que no tienen nada que ver.
    throw new Error(
      `[kv] falta ${!url ? URL_VAR : TOKEN_VAR}: el portal del paciente no puede generar ni leer enlaces.`,
    );
  }
  cliente = createClient({ url, token });
  return cliente;
}

/** Mismo objeto que exponía `@vercel/kv`, con nuestras variables. Perezoso por
 *  la razón de arriba: se resuelve en la primera operación real. */
export const kv: VercelKV = new Proxy({} as VercelKV, {
  get(_t, prop) {
    const real = resolver() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? v.bind(real) : v;
  },
});
