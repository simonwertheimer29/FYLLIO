// Ruta legacy de enlaces por NOMBRE (bookmarks, mensajes antiguos). Desde la
// retirada de la vista por nombre (2026-08-31) aquí solo se REDIRIGE:
//
//   · UN match exacto en Pacientes → /pacientes/[id].
//   · Cero, o VARIOS con el mismo nombre → pantalla honesta. Elegir "el
//     primero de la lista" abría la ficha de OTRA persona con homónimos —
//     un error de datos clínicos, no una molestia. La identidad se resuelve
//     por id, nunca por nombre (patrón en fyllio-lecciones-ingenieria).
//
// Ningún enlace del producto entra ya por aquí (MaximaView enlaza por
// pacienteId); esto queda por retrocompat de enlaces guardados.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../../../../../lib/auth/session";
import { listPacientes } from "../../../../../lib/pacientes/pacientes";
import { runWithCliente } from "../../../../../lib/airtable";

export const dynamic = "force-dynamic";

export default async function PacientePorNombrePage({
  params,
}: {
  params: Promise<{ nombre: string }>;
}) {
  const s = await getSession();
  if (!s) redirect("/login");

  const { nombre } = await params;
  const decoded = decodeURIComponent(nombre);

  const exactos = await runWithCliente(s.cliente, async () => {
    const pacs = await listPacientes({ search: decoded });
    return pacs.filter((p) => p.nombre.toLowerCase() === decoded.toLowerCase());
  });

  if (exactos.length === 1) {
    redirect(`/pacientes/${exactos[0].id}`);
  }

  const motivo =
    exactos.length === 0
      ? `No hay ningún paciente registrado con el nombre «${decoded}».`
      : `Hay ${exactos.length} pacientes con el nombre «${decoded}» — este enlace no dice a cuál se refiere, y abrir uno al azar sería enseñar la ficha de otra persona.`;

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
        <p className="text-sm font-semibold text-[var(--color-foreground)]">
          Este enlace no identifica a un paciente
        </p>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{motivo}</p>
        <Link
          href={`/pacientes?q=${encodeURIComponent(decoded)}`}
          className="mt-4 inline-flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-medium text-[var(--color-foreground)] hover:bg-[var(--color-surface-muted)]"
        >
          Buscarlo en Pacientes
        </Link>
      </div>
    </div>
  );
}
