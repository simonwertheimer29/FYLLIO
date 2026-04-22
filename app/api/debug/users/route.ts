// app/api/debug/users/route.ts
//
// Dev-only: lista usuarios del nuevo sistema Sprint 7.
// Doble protección: NODE_ENV !== "production" Y header x-debug-token.
// Si falla cualquiera → 404 (no 401/403) para no filtrar existencia del endpoint.
// Shape sin email, password_hash, ni pin_hash.

import { NextResponse } from "next/server";
import { listUsuarios, listClinicaIdsForUser, listClinicas } from "../../../lib/auth/users";

export const dynamic = "force-dynamic";

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return notFound();

  const expected = process.env.DEBUG_TOKEN;
  if (!expected) return notFound();

  const provided = req.headers.get("x-debug-token");
  if (provided !== expected) return notFound();

  const [usuarios, clinicas] = await Promise.all([listUsuarios(), listClinicas()]);
  const clinicaNombreById = new Map(clinicas.map((c) => [c.id, c.nombre]));

  const payload = await Promise.all(
    usuarios.map(async (u) => {
      const clinicaIds = u.rol === "admin" ? ["*"] : await listClinicaIdsForUser(u.id);
      return {
        id: u.id,
        nombre: u.nombre,
        rol: u.rol,
        activo: u.activo,
        clinicas:
          u.rol === "admin"
            ? [{ id: "*", nombre: "Todas las clínicas" }]
            : clinicaIds.map((cid) => ({ id: cid, nombre: clinicaNombreById.get(cid) ?? "?" })),
      };
    })
  );

  return NextResponse.json({ usuarios: payload });
}
