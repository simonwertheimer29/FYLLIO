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
//   · webhook WhatsApp  → phone_number_id → cliente (mapa por env, uno por WABA)
//   · portal público    → guardar el cliente en el token (KV) al generarlo y leerlo
//   · webhook Vapi      → guardar el cliente en la metadata de la llamada al iniciarla
//   · crons             → iterar por CADA cliente (RB, INDEP, …) en vez de PILOT_CLIENTE
// ────────────────────────────────────────────────────────────────────────────

import type { Cliente } from "./airtable";

/**
 * Cliente del piloto vivo. TEMPORAL: válido solo mientras RB es el único cliente
 * con datos de negocio. Ver cabecera de este archivo.
 */
export const PILOT_CLIENTE: Cliente = "RB";
