// instrumentation.ts
//
// Next.js llama a `register()` UNA VEZ al arrancar el servidor, antes de
// atender ninguna petición. Es el sitio donde un entorno incompleto tiene que
// hacer ruido.
//
// Por qué existe (2026-07-29): al retirar Airtable se quitaron dos variables de
// Vercel que trece archivos usaban para decidir su comportamiento. El producto
// no falló — DEGRADÓ EN SILENCIO durante semanas: escrituras que confirmaban
// éxito sin escribir, el motor de automatizaciones muerto, colas vacías con
// trabajo real dentro. En local todo iba bien porque las variables seguían en
// `.env.local`, así que la divergencia era invisible.
//
// La regla: **fallar al arrancar es barato; degradar en silencio no.**

export async function register() {
  // Solo en el runtime de Node (no en Edge, que tiene otro entorno).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { revisarEntorno, informeEntorno } = await import("./app/lib/entorno");
  const estado = revisarEntorno();
  const informe = informeEntorno(estado);

  if (!estado.ok) {
    console.error("\n╔═══ FYLLIO NO PUEDE ARRANCAR ═══\n" + informe + "\n╚════════════════════════════════\n");
    // En producción se aborta: un servidor a medias sirve pantallas que mienten.
    // En desarrollo se deja arrancar —para poder trabajar sin todo montado—
    // pero el mensaje es imposible de no ver.
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `Entorno incompleto: faltan ${estado.faltanCriticas.map((r) => r.nombre).join(", ")}`,
      );
    }
    return;
  }

  if (estado.faltanFuncionales.length > 0) {
    console.warn("\n─── Fyllio arranca con capacidades desactivadas ───\n" + informe + "\n");
  }
}
