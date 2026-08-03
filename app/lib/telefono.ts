// app/lib/telefono.ts
// Una sola verdad para el formato de teléfono. E.164 con prefijo de país.
//
// POR QUÉ EXISTE (2026-08-03, auditoría de WhatsApp). Meta exige el número en
// E.164. `normalizarTelefono` de `presupuestos/waba-credentials` quita el "+" y
// los separadores pero **no añade prefijo de país**: un "667188097" guardado sin
// prefijo se manda a Meta tal cual y falla —o peor, encaja en otro país—. Y el
// fallo no aparecía hasta el PRIMER ENVÍO REAL, que es el peor momento para
// descubrir que la carga de pacientes del cliente venía sin prefijos.
//
// Así que se normaliza en la FRONTERA DE ESCRITURA (crear/actualizar paciente y
// lead), no en el envío: cubre cualquier importador que se escriba después sin
// que nadie tenga que acordarse. Y no se normaliza en silencio — §9: lo que no se
// puede afirmar se devuelve como `dudoso` para que el caller lo cuente y avise.
//
// El censo de lo YA guardado es `npm run qa:telefonos`.

/** País por defecto. España; el día del segundo país, entra por parámetro. */
const PREFIJO_POR_DEFECTO = "34";

/** Longitud de un número nacional español, sin prefijo. */
const LARGO_NACIONAL_ES = 9;

export type ResultadoTelefono =
  /** Vacío o nulo. No es un error: hay pacientes sin teléfono. */
  | { estado: "vacio"; e164: null }
  /** Ya venía en E.164. No se ha tocado. */
  | { estado: "ok"; e164: string }
  /** Se le ha añadido el prefijo con certeza razonable. `nota` explica por qué. */
  | { estado: "normalizado"; e164: string; original: string; nota: string }
  /**
   * No se puede afirmar cuál es su prefijo. **No se inventa uno**: se devuelve
   * sin `e164` para que el caller lo guarde tal cual y lo cuente como aviso.
   * Enviar a un número mal adivinado es escribirle a un desconocido.
   */
  | { estado: "dudoso"; e164: null; original: string; motivo: string };

/**
 * normalizarE164 — lleva un teléfono a `+<prefijo><numero>` cuando se puede
 * afirmar, y lo marca como dudoso cuando no.
 *
 * Ejemplos:
 *   "+34 667 18 80 97" → ok           "+34667188097"
 *   "667188097"        → normalizado  "+34667188097"  (móvil español: 9 dígitos, 6/7)
 *   "917188097"        → normalizado  "+34917188097"  (fijo español — ver `esMovil`)
 *   "34667188097"      → normalizado  "+34667188097"  (ya traía prefijo sin "+")
 *   "12345"            → dudoso       (demasiado corto)
 */
export function normalizarE164(raw: string | null | undefined): ResultadoTelefono {
  const original = (raw ?? "").trim();
  if (!original) return { estado: "vacio", e164: null };

  const digitos = original.replace(/\D/g, "");
  if (!digitos) return { estado: "dudoso", e164: null, original, motivo: "sin dígitos" };

  // Ya venía en E.164 explícito: se respeta el prefijo que trae, sea cual sea.
  if (original.trim().startsWith("+")) {
    if (digitos.length < 8 || digitos.length > 15) {
      return {
        estado: "dudoso",
        e164: null,
        original,
        motivo: `empieza por "+" pero tiene ${digitos.length} dígitos (E.164 admite 8-15)`,
      };
    }
    return { estado: "ok", e164: `+${digitos}` };
  }

  // Número nacional español sin prefijo — el caso que motivó todo esto.
  if (digitos.length === LARGO_NACIONAL_ES) {
    return {
      estado: "normalizado",
      e164: `+${PREFIJO_POR_DEFECTO}${digitos}`,
      original,
      nota: `9 dígitos sin prefijo → se asume España (+${PREFIJO_POR_DEFECTO})`,
    };
  }

  // Trae el prefijo español pegado pero sin "+".
  if (digitos.length === LARGO_NACIONAL_ES + PREFIJO_POR_DEFECTO.length && digitos.startsWith(PREFIJO_POR_DEFECTO)) {
    return {
      estado: "normalizado",
      e164: `+${digitos}`,
      original,
      nota: `ya traía el prefijo ${PREFIJO_POR_DEFECTO} sin "+"`,
    };
  }

  // Longitud plausible de E.164 pero prefijo desconocido: NO se adivina.
  // Antes (`gesden/columnMap.normalizePhone`) se le pegaba un "+" y a correr;
  // eso convierte un dato malo en un dato malo con pinta de bueno.
  if (digitos.length >= 10 && digitos.length <= 15) {
    return {
      estado: "dudoso",
      e164: null,
      original,
      motivo: `${digitos.length} dígitos sin "+": podría ya llevar prefijo de país, pero no se adivina cuál`,
    };
  }

  return {
    estado: "dudoso",
    e164: null,
    original,
    motivo: `${digitos.length} dígitos: ni número nacional (${LARGO_NACIONAL_ES}) ni E.164 (10-15)`,
  };
}

/**
 * Valor a GUARDAR. Normaliza cuando se puede y **conserva el original cuando no**:
 * un dato dudoso no se pierde ni se corrompe, se marca. Lo que avisa es
 * `normalizarE164`, que el caller llama aparte cuando quiere contar.
 */
export function telefonoParaGuardar(raw: string | null | undefined): string | null {
  const r = normalizarE164(raw);
  if (r.estado === "vacio") return null;
  if (r.estado === "dudoso") return r.original;
  return r.e164;
}

/**
 * ¿Es un móvil español? WhatsApp no entrega a fijos, así que un paciente con fijo
 * no es un error de formato pero sí un caso que la cadencia no puede tocar.
 * Devuelve `null` cuando no es español y no se puede afirmar.
 */
export function esMovilEspanol(e164: string | null): boolean | null {
  if (!e164 || !e164.startsWith(`+${PREFIJO_POR_DEFECTO}`)) return null;
  const nacional = e164.slice(1 + PREFIJO_POR_DEFECTO.length);
  if (nacional.length !== LARGO_NACIONAL_ES) return null;
  return nacional.startsWith("6") || nacional.startsWith("7");
}
