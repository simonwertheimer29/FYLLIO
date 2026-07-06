// app/lib/auth/legacy-secret.ts
// Secreto compartido de los JWT legacy (cookies fyllio_presupuestos_token /
// fyllio_noshows_token).
//
// Sprint A / P0.4a — FAIL-CLOSED: si falta PRESUPUESTOS_JWT_SECRET NO caemos a
// una clave pública conocida ("dev-secret-change-me-in-prod"). Lanzamos, igual
// que session.ts hace con AUTH_SECRET. Firmar/verificar sesiones con una clave
// pública permitiría a cualquiera forjar tokens legacy y ver todas las clínicas.

let _encoded: Uint8Array | null = null;

/**
 * Secreto legacy codificado para jose (SignJWT / jwtVerify). Lanza si la env no
 * está fijada — nunca devuelve un fallback. Memoizado tras el primer uso.
 */
export function legacyJwtSecret(): Uint8Array {
  if (_encoded) return _encoded;
  const raw = process.env.PRESUPUESTOS_JWT_SECRET;
  if (!raw) {
    throw new Error(
      "Missing PRESUPUESTOS_JWT_SECRET env var (legacy JWT). Fail-closed: no default secret.",
    );
  }
  _encoded = new TextEncoder().encode(raw);
  return _encoded;
}
