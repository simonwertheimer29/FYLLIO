// Mandamiento §1 a nivel de REPOSITORIO: una escritura por id que no toca
// ninguna fila no es un éxito.
//
// Nos lo enseñó el portal del paciente (2026-07-29): `update presupuestos …
// where id = ?` ejecutado bajo el cliente equivocado —el token no llevaba
// cliente y el portal resolvía siempre a `PILOT_CLIENTE`— lo filtraba RLS, así
// que la sentencia afectaba a CERO filas y no lanzaba nada. La ruta seguía
// adelante, marcaba el token como respondido y devolvía `{ok:true}`: el
// paciente leía "gracias por aceptar" y el kanban no se enteraba nunca. El
// orden de escritura era correcto; lo que faltaba era comprobar que la
// escritura escribió.
//
// Cuándo NO usar esto: cuando cero filas es un resultado legítimo — un opt-out
// por teléfono que no pertenece a ningún paciente, un "marcar todas leídas" sin
// nada pendiente, una limpieza periódica. Ahí la ausencia de filas no es un
// fallo y convertirla en error sería ruido que acaba silenciado con un catch,
// que es peor que no tener la comprobación.

/** Una escritura que se dio por hecha sin tocar ninguna fila. */
export class EscrituraSinEfecto extends Error {
  constructor(
    readonly tabla: string,
    readonly id: string,
  ) {
    super(
      `No se escribió nada en ${tabla} (id ${id}): la fila no existe o el cliente activo no la puede ver.`,
    );
    this.name = "EscrituraSinEfecto";
  }
}

/** Lo mínimo que necesitamos de un update de kysely: su recuento de filas. */
type ConRecuento = {
  executeTakeFirst(): Promise<{ numUpdatedRows: bigint } | undefined>;
};

/**
 * Ejecuta un `updateTable(...).where("id","=",id)` y AFIRMA que tocó una fila.
 * Lanza `EscrituraSinEfecto` si no tocó ninguna — el caller no puede confirmar
 * un éxito que no ocurrió.
 */
export async function actualizarUna(
  qb: ConRecuento,
  tabla: string,
  id: string,
): Promise<void> {
  const r = await qb.executeTakeFirst();
  if (Number(r?.numUpdatedRows ?? 0) === 0) throw new EscrituraSinEfecto(tabla, id);
}
