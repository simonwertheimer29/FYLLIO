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
