"use client";

import Image from "next/image";
import { useState } from "react";

export default function HomePage() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!mailchimpAction || mailchimpAction === "#") return;

    const form = e.currentTarget;
    const fd = new FormData(form);

    try {
      setSubmitting(true);

      await fetch(mailchimpAction, {
        method: "POST",
        mode: "no-cors",
        body: fd,
      });

      // No podemos leer respuesta por CORS,
      // pero si action y fields están bien, Mailchimp lo guarda.
      setSubmitted(true);
      form.reset();
    } catch (err) {
      alert("No se pudo enviar. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-white">
      {/* HERO */}
      <section className="border-b border-slate-100 bg-[radial-gradient(1200px_600px_at_20%_0%,rgba(37,99,235,0.18),transparent_60%),radial-gradient(900px_520px_at_90%_10%,rgba(6,182,212,0.18),transparent_55%),linear-gradient(to_bottom,rgba(241,245,249,0.75),#ffffff)]">
  <div
    className="mx-auto max-w-7xl px-4 pt-8 pb-6 sm:px-6 lg:px-8"
    style={{ minHeight: "calc(90vh - var(--nav-h,72px))" }}
  >
    {/* TITULO ARRIBA CENTRADO */}
  <div className="-mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 text-center">
  <h1 className="text-[40px] font-extrabold tracking-tight text-slate-900 leading-[1.02] sm:text-5xl lg:text-[58px] xl:text-[60px]">
  La inteligencia artificial que se encarga de tu{" "}
  <span className="fyllio-text-gradient">agenda clínica y personal</span>.
</h1>

</div>



    {/* 2 COLUMNAS: TEXTO + IMAGEN */}
    <div className="mt-6 grid items-center gap-8 lg:grid-cols-2">
      {/* COLUMNA IZQUIERDA */}
      <div className="mx-auto w-full max-w-2xl lg:mx-0">
        <p className="mt-4 max-w-2xl text-sm text-slate-600 sm:text-base">
          FYLLIO automatiza y optimiza tu agenda para mejorar la ocupación, reducir
          capacidad no utilizada y disminuir el tiempo operativo.
          <br className="hidden sm:block" />
          Te da orden y previsión para identificar ventanas de agenda aprovechables y
          recuperar tiempo personal sin perder eficiencia.
        </p>

        <div className="mt-5 space-y-3">
          <p className="text-lg font-semibold text-slate-900 sm:text-xl">
            ¿Cansado de reprogramaciones, cancelaciones de último minuto y capacidad no
            utilizada inesperada en la agenda?
          </p>
          <p className="text-lg font-semibold text-slate-900 sm:text-xl">
            ¿Cansado de no poder proteger tu tiempo personal porque la agenda se
            desordena y termina controlando tu día?
          </p>

          <p className="pt-1 text-sm text-slate-700 sm:text-base">
            No son excluyentes: con FYLLIO puedes ser{" "}
            <span className="font-semibold">más rentable y eficiente</span>, y a la vez{" "}
            <span className="font-semibold">mantener el balance</span> entre tu vida
            profesional y personal gracias a una agenda{" "}
            <span className="font-semibold">optimizada, ordenada y bajo control</span>.
          </p>
        </div>
      </div>

      {/* COLUMNA DERECHA: IMAGEN */}
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

    {/* CTA ABAJO CENTRADO */}
    <div className="mt-6 text-center">
      <a href="#acceso" className="btn-fyllio inline-flex">
        Estoy interesado
      </a>

      <p className="mt-3 text-sm font-semibold text-slate-900">
        ¿Qué esperas para recuperar el control de tu agenda?
      </p>

      <p className="mt-2 text-xs text-slate-500">
        Fase temprana. Buscamos clínicas piloto y feedback real.
      </p>
    </div>
  </div>
</section>


      {/* BLOQUE ÚNICO: problema → impacto → FYLLIO (valores) */}
<section
  id="que-es"
  className={`${anchorOffset} border-b border-slate-100 bg-[radial-gradient(1100px_540px_at_15%_0%,rgba(37,99,235,0.10),transparent_60%),radial-gradient(900px_520px_at_90%_10%,rgba(6,182,212,0.10),transparent_55%),linear-gradient(to_bottom,rgba(241,245,249,0.75),#ffffff)]`}
>
  <div className="mx-auto flex min-h-[72vh] max-w-7xl flex-col justify-center px-4 py-14 sm:px-6">
    <h2 className="text-center text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
      El{" "}
      <span className="fyllio-text-gradient">problema</span> no es la agenda.
      <span className="block">
        Es el{" "}
        <span className="fyllio-text-gradient">poco control</span> sobre ella.
      </span>
    </h2>

    <div className="mx-auto mt-10 grid w-full max-w-5xl gap-6 md:grid-cols-3 items-stretch">
      {/* PILL 1 */}
      <div className="h-full rounded-2xl bg-[linear-gradient(90deg,rgba(37,99,235,0.70),rgba(6,182,212,0.70),rgba(37,99,235,0.70))] bg-[length:200%_200%] p-[1px] animate-gradient">
        <div className="h-full rounded-2xl bg-white/70 p-7 ring-1 ring-slate-200/70 backdrop-blur-xl shadow-[0_18px_55px_rgba(2,6,23,0.08)] flex flex-col">
          <p className="text-base leading-relaxed text-slate-700">
            Cuando la agenda no está bajo control, la clínica pierde claridad. Aparecen{" "}
            <span className="font-semibold">ventanas de agenda sin plan</span>, cambios de último minuto,
            reprogramaciones constantes y decisiones que se toman “sobre la marcha”.
            <br />
            <br />
            El día deja de ser previsible, el <span className="font-semibold">tiempo operativo aumenta</span> y la{" "}
            <span className="font-semibold">rentabilidad</span> depende más de reaccionar que de planificar.
          </p>
        </div>
      </div>

      {/* PILL 2 */}
      <div className="h-full rounded-2xl bg-[linear-gradient(90deg,rgba(37,99,235,0.70),rgba(6,182,212,0.70),rgba(37,99,235,0.70))] bg-[length:200%_200%] p-[1px] animate-gradient">
        <div className="h-full rounded-2xl bg-white/70 p-7 ring-1 ring-slate-200/70 backdrop-blur-xl shadow-[0_18px_55px_rgba(2,6,23,0.08)] flex flex-col">
          <p className="text-base leading-relaxed text-slate-700">
            La falta de control no solo afecta a la ocupación.
            <br />
            Afecta al equipo, al foco y a tu <span className="font-semibold">tiempo personal</span>.
            <br />
            <br />
            Cuando todo depende de estar corrigiendo la agenda en tiempo real, la clínica nunca se detiene… y tú
            tampoco.
          </p>
        </div>
      </div>

      {/* PILL 3 */}
      <div className="h-full rounded-2xl bg-[linear-gradient(90deg,rgba(37,99,235,0.70),rgba(6,182,212,0.70),rgba(37,99,235,0.70))] bg-[length:200%_200%] p-[1px] animate-gradient">
        <div className="h-full rounded-2xl bg-white/70 p-7 ring-1 ring-slate-200/70 backdrop-blur-xl shadow-[0_18px_55px_rgba(2,6,23,0.08)] flex flex-col">
          <p className="text-base leading-relaxed text-slate-700">
            <span className="font-extrabold fyllio-text-gradient">Somos FYLLIO.</span>
            <br />
            <br />
            Creemos que una clínica bien gestionada no solo es más rentable, sino también más saludable para quienes
            la hacen funcionar.
            <br />
            <br />
            Nuestro compromiso es ayudarte a crecer con{" "}
            <span className="font-semibold">orden, previsión y control</span>, cuidando tanto de tu clínica como de tu{" "}
            <span className="font-semibold">tiempo personal</span>.
          </p>
        </div>
      </div>
    </div>
  </div>
</section>


{/* POR QUÉ ESCOGER FYLLIO */}
<section
  id="antes-despues"
  className={`${anchorOffset} border-b border-slate-100 bg-[radial-gradient(1100px_540px_at_15%_0%,rgba(37,99,235,0.10),transparent_60%),radial-gradient(900px_520px_at_90%_10%,rgba(6,182,212,0.10),transparent_55%),linear-gradient(to_bottom,rgba(241,245,249,0.75),#ffffff)]`}
>
  <div className="mx-auto flex min-h-[85vh] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6">
    <h2 className="text-center text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
      Por qué escoger FYLLIO
    </h2>

    <p className="mx-auto mt-4 max-w-3xl text-center text-sm text-slate-600 sm:text-base">
      Tu agenda antes y después de tener control sobre ella
    </p>

    <div className="mt-12 grid gap-10 md:grid-cols-2 items-start">
      {/* ANTES */}
      <div className="min-w-0">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Antes 😵‍💫</h3>
        <div className="space-y-4">
          <div className={cardSoft}>
            Capacidad no utilizada que se pierde por falta de tiempo y reacción
          </div>
          <div className={cardSoft}>
            Gran parte del tiempo se dedica a reprogramar y actuar frente a imprevistos
          </div>
          <div className={cardSoft}>
            La agenda se construye “sobre la marcha”, llamada a llamada
          </div>
          <div className={cardSoft}>
            Poca visibilidad de cómo quedará el día hasta que sucede
          </div>
          <div className={cardSoft}>
            La agenda domina el día y se extiende fuera del horario laboral
          </div>
        </div>
      </div>

      {/* DESPUÉS */}
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
              Mayor ocupación y rentabilidad gracias a la activación inteligente de ventanas de agenda
            </span>
          </div>

          <div className={cardGlow}>
            <span className="relative z-10">
              Menos tiempo operativo: el trabajo pasa de reaccionar a{" "}
              <b>supervisar y decidir</b>
            </span>
          </div>

          <div className={cardGlow}>
            <span className="relative z-10">
              La creación de la agenda se automatiza y se mantiene optimizada ante cambios, incluso fuera del horario
              laboral
            </span>
          </div>

          <div className={cardGlow}>
            <span className="relative z-10">
              Control y previsión: sabes cómo será el día y cómo reaccionar ante cambios antes de que ocurran
            </span>
          </div>

          <div className={cardGlow}>
            <span className="relative z-10">
              Más control sobre tu tiempo y el de tu equipo, sin perder eficiencia ni rentabilidad
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
              {submitted ? (
                <div className="rounded-2xl bg-white/80 p-8 text-center">
                  <h3 className="text-2xl font-bold text-slate-900">¡Listo! ✅</h3>
                  <p className="mt-3 text-slate-600">Gracias — te contactaremos pronto.</p>

                  <button
                    type="button"
                    className="btn-fyllio mt-6"
                    onClick={() => setSubmitted(false)}
                  >
                    Enviar otra respuesta
                  </button>
                </div>
              ) : (
                <form className="grid gap-4" onSubmit={handleSubmit}>
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
                    disabled={submitting || mailchimpAction === "#"}
                    className={
                      submitting
                        ? "btn-fyllio mt-2 w-full opacity-70 cursor-not-allowed"
                        : "btn-fyllio mt-2 w-full"
                    }
                  >
                    {submitting ? "Enviando..." : "Enviar"}
                  </button>

                  <p className="text-center text-xs text-slate-500">
                    Al enviar, aceptas que te contactemos para una breve conversación. Sin spam.
                  </p>

                  {mailchimpAction === "#" ? (
                    <p className="mt-2 text-center text-xs text-amber-700">
                      ⚠️ Falta configurar Mailchimp: define{" "}
                      <b>NEXT_PUBLIC_MAILCHIMP_ACTION_URL</b>.
                    </p>
                  ) : null}
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
