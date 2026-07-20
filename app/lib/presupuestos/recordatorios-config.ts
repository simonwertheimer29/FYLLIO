// app/lib/presupuestos/recordatorios-config.ts
//
// FASE 1 migración — repositorio de Configuracion_Recordatorios (passthrough).

import { base, TABLES } from "../airtable";

export async function selectConfigRecordatoriosRaw(opts: Record<string, unknown>): Promise<readonly any[]> {
  return base(TABLES.configuracionRecordatorios as any).select(opts as any).all();
}
export async function updateConfigRecordatoriosRaw(id: string, fields: Record<string, unknown>): Promise<void> {
  await (base(TABLES.configuracionRecordatorios as any) as any).update(id, fields);
}
export async function createConfigRecordatoriosRaw(fields: Record<string, unknown>): Promise<any> {
  return (base(TABLES.configuracionRecordatorios as any).create as any)(fields);
}
