// app/lib/automatizacion/clinica-de-envio.ts
//
// LA SEDE DE UN EVENTO `mensaje_enviado` (la coincidencia agente-humano), como
// fragmento SQL compartido por la serie diaria (metricas/diarias) y el bloque
// de confianza (agente/confianza): dos lectores, UNA regla — si cada uno
// escribiera la suya, el mismo envío contaría en sedes distintas según la
// pantalla (esencia §6, patrones paralelos).
//
// La regla: un envío de conversación es de la sede donde ESTÁ el hilo (el
// último mensaje con clínica, como el resto del log del agente); uno de
// presupuesto o de lead, de la sede del caso. Otro tipo → sin sede (solo lo
// ve la red; no se inventa una).

import { sql, type RawBuilder } from "kysely";

export function sqlClinicaDeEnvio(alias: string): RawBuilder<string | null> {
  const e = (col: string) => sql.ref(`${alias}.${col}`);
  return sql<string | null>`(case ${e("tipo_caso")}
    when 'conversacion' then (select m.clinica_id from mensajes_whatsapp m
                               where m.telefono = ${e("caso_id")} and m.clinica_id is not null
                               order by m."timestamp" desc limit 1)
    when 'presupuesto' then (select p.clinica_id from presupuestos p where p.id = ${e("caso_id")})
    when 'lead' then (select l.clinica_id from leads l where l.id = ${e("caso_id")})
    else null end)`;
}
