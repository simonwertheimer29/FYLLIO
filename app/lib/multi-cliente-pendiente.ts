// app/lib/multi-cliente-pendiente.ts
//
// ⚠️ MULTI_CLIENTE_PENDIENTE — enrutado por cliente en PUNTOS SIN SESIÓN.
//
// Los puntos sin sesión (webhook de WhatsApp, crons, portal público, webhook de
// Vapi) reciben datos sin un usuario logueado, así que no pueden resolver el
// cliente desde la sesión. Mientras **RB es el ÚNICO cliente vivo**, resuelven a
// RB de forma EXPLÍCITA y TEMPORAL con `PILOT_CLIENTE`.
//
// Esto NO es un "default silencioso": donde se puede detectar el origen (p. ej. el
// número WABA que recibe el mensaje), se VERIFICA y se RECHAZA lo desconocido
// (fail-closed). `PILOT_CLIENTE` solo se usa donde, hoy, no puede existir dato de
// otro cliente (RB es el único), y siempre marcado.
//
// ────────────────────────────────────────────────────────────────────────────
// TAREA AL ENTRAR EL 2º CLIENTE (y montar su WABA) — sustituir cada uso de
// PILOT_CLIENTE por enrutado real (busca "PILOT_CLIENTE" y "MULTI_CLIENTE_PENDIENTE"):
//   · webhook WhatsApp  → HECHO (12-09-2026): el número se valida contra
//     WABA_PHONE_NUMBER_ID y el cliente se declara en WABA_CLIENTE. Ya no usa
//     PILOT_CLIENTE. Al montar un SEGUNDO número WABA, esa variable se queda
//     corta: hará falta un mapa phone_number_id → cliente.
//   · portal público    → guardar el cliente en el token (KV) al generarlo y leerlo
//   · webhook Vapi      → guardar el cliente en la metadata de la llamada al iniciarla
//   · crons             → iterar por CADA cliente (RB, INDEP, …) en vez de PILOT_CLIENTE
// ────────────────────────────────────────────────────────────────────────────

import type { Cliente } from "./airtable";

/**
 * Cliente al que resuelven los caminos sin sesión que TODAVÍA no saben elegir.
 *
 * ⚠️ OJO CON EL NOMBRE (corregido el 12-09-2026): RB **no es un cliente**. No
 * hay firma, ni piloto, ni número, ni reunión: se sembró como estructura de
 * ejemplo y su tenant está vacío. Así que esto no apunta al «piloto vivo»,
 * apunta a un tenant SIN DATOS — y un camino que resuelve aquí no falla, se
 * traga el dato en silencio (es exactamente lo que le pasó al portal del
 * paciente: el update no encontraba fila, afectaba a cero filas, y el paciente
 * leía «gracias por aceptar» mientras la clínica no se enteraba nunca).
 *
 * Cada uso que queda —portal, crons, webhook de Vapi— es deuda con esa forma.
 * El webhook de WhatsApp ya salió de aquí; ver la cabecera.
 */
export const PILOT_CLIENTE: Cliente = "RB";
