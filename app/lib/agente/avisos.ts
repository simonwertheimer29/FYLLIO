// app/lib/agente/avisos.ts
//
// LOS FALLOS DEL AGENTE DEJAN DE MORIR EN CONSOLA (auditoría 2026-09-05,
// punto 5 — MEJORAS 128). Config ilegible, contexto roto, modelo caído: cada
// uno es SISTEMÁTICO (falla el 100 % de los turnos de esa clínica mientras
// dure) y hasta hoy solo producía un `console.error` que nadie lee (§9).
//
// Aquí se convierte en una notificación de la campana, UNA por hora y motivo
// y clínica — el fallo se ve, no se repite 200 veces. Y nunca lanza: avisar
// de un fallo no puede producir otro.

import { sql } from "kysely";
import { runWithClienteDb } from "../db/context";
import { currentCliente } from "../airtable";

export type MotivoFalloAgente =
  | "modelo_no_disponible"
  | "configuracion_ilegible"
  | "contexto_no_disponible"
  | "error_inesperado";

const TITULO: Record<MotivoFalloAgente, string> = {
  modelo_no_disponible: "El agente no está evaluando: el modelo no responde",
  configuracion_ilegible: "El agente no está evaluando: la configuración no se puede leer",
  contexto_no_disponible: "El agente no está evaluando: no pudo cargar el caso",
  error_inesperado: "El agente no está evaluando: error inesperado",
};

const VENTANA_MIN = 60;

export async function avisarFalloAgente(args: {
  motivo: MotivoFalloAgente;
  detalle?: string | null;
  clinicaId?: string | null;
  telefono?: string | null;
}): Promise<void> {
  const detalle = (args.detalle ?? "").slice(0, 300);
  console.error(
    `[agente] ${args.motivo}${args.clinicaId ? ` clinica=${args.clinicaId}` : ""}${args.telefono ? ` tel=${args.telefono}` : ""}${detalle ? `: ${detalle}` : ""}`,
  );
  const cliente = currentCliente();
  if (!cliente) return; // sin contexto no hay campana que tocar; el log ya salió
  try {
    const titulo = TITULO[args.motivo];
    const reciente: any = await runWithClienteDb(cliente, (trx) =>
      sql`select 1 from notificaciones
          where tipo = 'Sistema' and titulo = ${titulo}
            and coalesce(mensaje, '') like ${`%[${args.clinicaId ?? "global"}]%`}
            and fecha_creacion > now() - make_interval(mins => ${VENTANA_MIN})
          limit 1`.execute(trx),
    );
    if (reciente.rows?.length) return;
    const { crearNotificacion } = await import("../presupuestos/notificaciones");
    await crearNotificacion({
      usuario: "todos",
      tipo: "Sistema",
      titulo,
      mensaje: `[${args.clinicaId ?? "global"}] Los mensajes entran y se guardan, pero el agente no los evalúa: revísalos en Mensajería (filtro «Sin evaluar»).${detalle ? ` Detalle: ${detalle}` : ""}`,
      link: "/mensajeria?filtro=sin-evaluar",
    });
  } catch (err) {
    console.error("[agente/avisos] no se pudo crear el aviso:", err instanceof Error ? err.message : err);
  }
}
