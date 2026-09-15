// app/lib/mensajeria/clave-hilo.ts
//
// LA CLAVE DE UN HILO, en un solo sitio (15-09-2026).
//
// El hilo de WhatsApp se identifica por el teléfono en E.164 CON «+» y sin
// espacios: así está en `mensajes_whatsapp.telefono` y así es el `caso_id` de
// los eventos de conversación. Pero los teléfonos que guardan `leads`,
// `pacientes` y `presupuestos` vienen del mundo real y traen espacios
// («+34 613 751 409»).
//
// POR QUÉ EXISTE ESTE FICHERO: Seguimiento pasaba a la pantalla el teléfono
// CRUDO de esas tablas, y con él pedía el hilo y la ficha. Resultado medido el
// 15-09 abriendo un caso: el hilo volvía 404 —que `ChatEmbebido` traga a
// propósito, porque un caso puede no tener hilo— y salía vacío SIN error; y la
// ficha, que busca los eventos por `caso_id` exacto, no encontraba ninguno y
// declaraba «el agente no ha evaluado esta conversación», que era falso. Dos
// pantallas mintiendo por un espacio.
//
// La cola YA normalizaba a dígitos para sus propias cuentas
// (`mensajesPorDigitos`), pero mandaba el crudo a la UI: la normalización
// existía y no se aplicaba en el borde que importaba.

/** El teléfono tal y como lo guarda la mensajería: «+» y dígitos. null si no
 *  hay dígitos (un campo vacío o basura no se convierte en un «+»). */
export function claveDeHilo(raw: string | null | undefined): string | null {
  const digitos = (raw ?? "").replace(/[^0-9]/g, "");
  return digitos ? `+${digitos}` : null;
}
