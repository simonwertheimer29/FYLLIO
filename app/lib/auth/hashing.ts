// app/lib/auth/hashing.ts
//
// Fuente única para bcrypt en el sistema de auth global Sprint 7.
// Consumido por: seed, endpoints de login (admin + PIN), Ajustes (crear/regenerar).

import bcrypt from "bcryptjs";

export const BCRYPT_ROUNDS = 10;

export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

export function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_ROUNDS);
}

export function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

export function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

/** PIN aleatorio de 4 o 6 dígitos como string. */
export function genRandomPin(length: 4 | 6): string {
  const max = length === 4 ? 9999 : 999999;
  const min = length === 4 ? 1000 : 100000;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}
