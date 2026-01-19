"use client";
import Image from "next/image";
import { useState } from "react";


export default function HomePage() {

    const [submitted, setSubmitted] = useState(false);


  const mailchimpAction = process.env.NEXT_PUBLIC_MAILCHIMP_ACTION_URL || "#";

  const cardSoft =
    "fyllio-card-soft bg-white/70 p-6 text-base text-slate-700 ring-1 ring-slate-200";

  const cardGlow =
    "relative overflow-hidden fyllio-card-soft p-6 text-base text-slate-800 " +
    "bg-white/35 backdrop-blur-xl border border-sky-200/60 " +
    "shadow-[0_14px_46px_rgba(37,99,235,0.16)] " +
    "after:content-[''] after:absolute after:inset-0 after:pointer-events-none " +
    "after:bg-[radial-gradient(700px_240px_at_20%_0%,rgba(56,189,248,0.32),transparent_60%),radial-gradient(600px_260px_at_90%_20%,rgba(37,99,235,0.26),transparent_55%)] " +
    "after:opacity-70";

  const anchorOffset = "scroll-mt-[calc(var(--nav-h,72px)+32px)]";

  return (
    <main className="min-h-screen bg-white">
      {/* HERO */}
      <section className="border-b border-slate-100 bg-[radial-gradient(1200px_600px_at_20%_0%,rgba(37,99,235,0.18),transparent_60%),radial-gradient(900px_520px_at_90%_10%,rgba(6,182,212,0.18),transparent_55%),linear-gradient(to_bottom,rgba(241,245,249,0.75),#ffffff)]">
        <div
          className="mx-auto grid min-h-[calc(92vh-var(--nav-h,72px))] max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2"
          style={{ minHeight: "calc(92vh - var(--nav-h,72px))" }}
        >
          <div className="w-full">
            <div className="inline-flex items-center rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
              IA para ordenar, accionar y optimizar agendas clínicas
            </div>

            {/* Título un poco más chico para que “La inteligencia artificial” se vea más compacto */}
            <h1 className="mt-6 text-[42px] font-extrabold tracking-tight text-slate-900 leading-[1.06] sm:text-5xl lg:text-[58px] xl:text-[60px]">
              La inteligencia artificial{" "}
              <span className="block">que se encarga de tu</span>
              <span className="block">
                <span className="fyllio-text-gradient">agenda clínica</span>.
              </span>
            </h1>

            <p className="mt-5 max-w-2xl text-sm text-slate-600 sm:text-base">
              FYLLIO crea, ajusta y mantiene tu agenda automáticamente: confirma
              citas, gestiona cancelaciones, acciona sobre huecos y reduce
              no-shows, para que tu equipo se enfoque en el paciente, no en el
              caos.
            </p>

            <div className="mt-7 space-y-4">
              <p className="text-xl font-semibold text-slate-900 sm:text-2xl">
                ¿Cansado de reprogramar, llamadas constantes y vacíos inesperados en la agenda?
              </p>
              <p className="text-xl font-semibold text-slate-900 sm:text-2xl">
                Gestionar la agenda clínica día a día es frustrante. FYLLIO lo resuelve con IA.
              </p>
            </div>

            <div className="mt-8">
              <a href="#acceso" className="btn-fyllio">
                Estoy interesado
              </a>
              <p className="mt-3 text-xs text-slate-500">
                Fase temprana. Buscamos clínicas piloto y feedback real.
              </p>
            </div>
          </div>

          <div className="w-full">
            <div className="relative mx-auto w-full max-w-xl">
              <div className="absolute -inset-6 rounded-[28px] bg-[radial-gradient(500px_220px_at_20%_10%,rgba(56,189,248,0.25),transparent_60%),radial-gradient(500px_220px_at_90%_20%,rgba(37,99,235,0.22),transparent_55%)] blur-2xl" />
              <div className="relative overflow-hidden rounded-[24px] border border-slate-200/60 bg-white/40 p-3 shadow-[0_18px_55px_rgba(2,6,23,0.10)] backdrop-blur-xl">
                <div className="relative aspect-[16/10] w-full">
                  <Image
                    src="/fyllio-laptop.png"
                    alt="FYLLIO en agenda clínica"
                    fill
                    className="object-contain"
                    priority
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BLOQUE ÚNICO: problema → solución → FYLLIO */}
      <section
        id="que-es"
        className={`${anchorOffset} border-b border-slate-100 bg-[radial-gradient(1100px_540px_at_15%_0%,rgba(37,99,235,0.10),transparent_60%),radial-gradient(900px_520px_at_90%_10%,rgba(6,182,212,0.10),transparent_55%),linear-gradient(to_bottom,rgba(241,245,249,0.75),#ffffff)]`}
      >
        <div className="mx-auto flex min-h-[78vh] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6">
          <h2 className="text-center text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            El problema no es la agenda.
            <span className="block">
              Es la <span className="fyllio-text-gradient">carga diaria</span> que crea.
            </span>
          </h2>

          <p className="mx-auto mt-5 max-w-3xl text-center text-sm text-slate-600 sm:text-base">
            La agenda clínica no falla por falta de pacientes: falla porque todo depende de decisiones humanas
            constantes, interrupciones y reacción en tiempo real.
          </p>

          <div className="mx-auto mt-10 grid w-full max-w-5xl gap-6 md:grid-cols-3">
            <div className="fyllio-card-soft p-7">
              <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">
                El problema real
              </p>
              <p className="mt-3 text-base leading-relaxed text-slate-700">
                Reprogramaciones, llamadas y mensajes constantes, huecos que aparecen sin aviso, no-shows y
                una agenda que se corrige “sobre la marcha”.
              </p>
            </div>

            <div className="fyllio-card-soft p-7">
              <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">
                La solución
              </p>
              <p className="mt-3 text-base leading-relaxed text-slate-700">
                Un sistema que entiende reglas, recursos y prioridades, y mantiene la agenda ordenada ante cambios,
                generando acciones claras para proteger el día.
              </p>
            </div>

            <div className="fyllio-card-soft p-7">
              <p className="text-sm font-extrabold uppercase tracking-wide text-slate-500">
                ¿Qué es FYLLIO?
              </p>
              <p className="mt-3 text-base leading-relaxed text-slate-700">
                FYLLIO es una IA diseñada para encargarse de la agenda clínica: crea una planificación óptima,
                la mantiene viva cuando hay cambios y propone o ejecuta accionables inteligentes con control humano.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ANTES vs DESPUÉS */}
      <section
        id="antes-despues"
        className={`${anchorOffset} border-b border-slate-100 bg-[radial-gradient(1100px_540px_at_15%_0%,rgba(37,99,235,0.10),transparent_60%),radial-gradient(900px_520px_at_90%_10%,rgba(6,182,212,0.10),transparent_55%),linear-gradient(to_bottom,rgba(241,245,249,0.75),#ffffff)]`}
      >
        <div className="mx-auto flex min-h-[85vh] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6">
          <h2 className="text-center text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Antes vs Después: la agenda como{" "}
            <span className="fyllio-text-gradient">sistema activo</span>
          </h2>

          <p className="mx-auto mt-4 max-w-3xl text-center text-sm text-slate-600 sm:text-base">
            La agenda deja de ocupar tiempo efectivo de trabajo. Ya no se construye “sobre la marcha”: se entiende
            desde el inicio y se gestiona con foco.
          </p>

          {/* items-start para que arranquen alineadas arriba */}
          <div className="mt-12 grid gap-10 md:grid-cols-2 items-start">
            <div className="min-w-0">
              <h3 className="mb-4 text-lg font-semibold text-slate-900">Antes 😵‍💫</h3>
              <div className="space-y-4">
                <div className={cardSoft}>La agenda se crea conforme llegan llamadas y mensajes</div>
                <div className={cardSoft}>No hay visión clara de cómo quedará el día hasta que llega</div>
                <div className={cardSoft}>Huecos que se pierden por falta de tiempo para actuar</div>
                <div className={cardSoft}>Automatizaciones inexistentes o hechas manualmente</div>
                <div className={cardSoft}>Mucho esfuerzo operativo, poco control</div>
              </div>
            </div>

            <div className="min-w-0">
              <div className="mb-4 flex items-center gap-3">
                <h3 className="text-lg font-semibold text-slate-900">Después 😌</h3>
                <span className="rounded-full bg-sky-50 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider text-sky-700 ring-1 ring-sky-200">
                  Con FYLLIO
                </span>
              </div>

              <div className="space-y-4">
                <div className={cardGlow}>
                  <span className="relative z-10">
                    La agenda se genera sola de forma optimizada desde el inicio
                  </span>
                </div>
                <div className={cardGlow}>
                  <span className="relative z-10">
                    El trabajo pasa de crear a <b>supervisar y decidir</b>
                  </span>
                </div>
                <div className={cardGlow}>
                  <span className="relative z-10">
                    Ya no tienes que preocuparte por encontrar soluciones a cancelaciones repentinas o huecos. FYLLIO
                    genera accionables inteligentes que se encargan de encontrar la mejor solución posible.
                  </span>
                </div>
                <div className={cardGlow}>
                  <span className="relative z-10">
                    Automatizaciones activas: confirmaciones, reagendamientos, recordatorios
                  </span>
                </div>
                <div className={cardGlow}>
                  <span className="relative z-10">
                    Orden incluso con cambios: el día se mantiene claro y estable
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CÓMO FUNCIONA */}
      <section
        id="como-funciona"
        className={`${anchorOffset} border-b border-slate-100 bg-[radial-gradient(900px_520px_at_15%_10%,rgba(6,182,212,0.14),transparent_55%),radial-gradient(1100px_560px_at_85%_0%,rgba(37,99,235,0.12),transparent_60%),linear-gradient(to_bottom,#ffffff,rgba(241,245,249,0.75))]`}
      >
        <div className="mx-auto flex min-h-[75vh] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6">
          <h2 className="text-center text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            ¿Cómo funciona <span className="fyllio-text-gradient">FYLLIO</span>?
          </h2>

          <div className="mt-12 grid gap-8 md:grid-cols-4">
            <div className="fyllio-card-soft p-8 text-center">
              <p className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
                1 · Entiende tu clínica
              </p>
              <p className="text-base text-slate-700">
                Horarios, reglas, recursos, tipos de cita y forma real de operar.
              </p>
            </div>

            <div className="fyllio-card-soft p-8 text-center">
              <p className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
                2 · Crea la agenda
              </p>
              <p className="text-base text-slate-700">
                Genera una agenda optimizada desde el inicio, con orden y visión previa.
              </p>
            </div>

            <div className="fyllio-card-soft p-8 text-center">
              <p className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
                3 · Detecta riesgos
              </p>
              <p className="text-base text-slate-700">
                Detecta huecos, cambios y riesgos a medida que ocurren.
              </p>
            </div>

            <div className="fyllio-card-soft p-8 text-center">
              <p className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
                4 · Acciona o recomienda
              </p>
              <p className="text-base text-slate-700">
                Automatiza o sugiere acciones. El equipo supervisa y decide.
              </p>
            </div>
          </div>

          <p className="mt-10 text-center text-sm text-slate-600">
            <b>La IA hace el trabajo pesado.</b> El humano mantiene el control.
          </p>
        </div>
      </section>

      {/* FORM FINAL */}
      <section
        id="acceso"
        className={`${anchorOffset} bg-[radial-gradient(900px_520px_at_20%_0%,rgba(37,99,235,0.16),transparent_60%),radial-gradient(900px_520px_at_90%_10%,rgba(6,182,212,0.14),transparent_55%),linear-gradient(to_bottom,#ffffff,rgba(241,245,249,0.85))]`}
      >
        <div className="mx-auto flex min-h-[80vh] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <h2 className="text-center text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
              Quiero ver cómo funcionaría{" "}
              <span className="fyllio-text-gradient">FYLLIO</span> en mi clínica
            </h2>

            <p className="mt-4 text-center text-sm text-slate-600 sm:text-base">
              Estamos construyendo FYLLIO junto a clínicas reales. Déjanos tus datos y te contactamos para entender tu
              caso y mostrarte cómo encajaría.
            </p>

            <div className="mt-10 fyllio-card-soft p-8 sm:p-10">
              <form
  action={mailchimpAction}
  method="post"
  target="mailchimp_hidden_iframe"
  className="grid gap-4"
  onSubmit={() => {
    setSubmitted(true);
    window.setTimeout(() => setSubmitted(false), 5000);
  }}
>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Nombre <span className="text-red-500">*</span>
                    </label>
                    <input
                      name="FNAME"
                      type="text"
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none ring-0 focus:border-sky-300"
                      placeholder="Tu nombre"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      name="EMAIL"
                      type="email"
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none ring-0 focus:border-sky-300"
                      placeholder="tu@email.com"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Rol <span className="text-red-500">*</span>
                    </label>
                    <select
                      name="ROLE"
                      required
                      className="w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none ring-0 focus:border-sky-300"
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Selecciona…
                      </option>
                      <option value="Dentista">Dentista</option>
                      <option value="Recepción">Recepción</option>
                      <option value="Dirección">Dirección</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      Clínica / consultorio
                    </label>
                    <input
                      name="CLINIC"
                      type="text"
                      className="w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none ring-0 focus:border-sky-300"
                      placeholder="Opcional"
                    />
                  </div>
                </div>

                <p className="text-center text-xs text-slate-500">
                  <span className="text-red-500">*</span> Los campos con asterisco son obligatorios.
                </p>

                <button
                  type="submit"
                  className="btn-fyllio mt-2 w-full"
                >
                  Enviar
                </button>

                {submitted ? (
  <p className="text-center text-sm text-slate-700">
    ✅ Listo. Gracias — te contactaremos pronto.
  </p>
) : null}


                <p className="text-center text-xs text-slate-500">
                  Al enviar, aceptas que te contactemos para una breve conversación. Sin spam.
                </p>

                {mailchimpAction === "#" ? (
                  <p className="mt-2 text-center text-xs text-amber-700">
                    ⚠️ Falta configurar Mailchimp: define <b>NEXT_PUBLIC_MAILCHIMP_ACTION_URL</b>.
                  </p>
                ) : null}

                <iframe
  name="mailchimp_hidden_iframe"
  className="hidden"
  aria-hidden="true"
/>

              </form>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
