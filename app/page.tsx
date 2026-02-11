"use client";

import Image from "next/image";
import { useState } from "react";
import TrackedCta from "@/components/TrackedCta";


export default function HomePage() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const mailchimpAction = process.env.NEXT_PUBLIC_MAILCHIMP_ACTION_URL || "#";

  const cardBad =
  "flex items-center gap-3 rounded-2xl bg-rose-50/70 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200";

const cardGood =
  "flex items-center gap-3 rounded-2xl bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200";


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

  const IconX = () => (
  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-100 ring-1 ring-rose-200">
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-rose-600" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  </span>
);

const IconCheck = () => (
  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 ring-1 ring-emerald-200">
    <svg viewBox="0 0 24 24" className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" d="M20 6L9 17l-5-5" />
    </svg>
  </span>
);


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
    className="mx-auto max-w-7xl px-4 pt-12 pb-10 sm:px-6 lg:px-8"
    style={{ minHeight: "calc(92vh - var(--nav-h,72px))" }}
  >
    {/* TITULO ARRIBA CENTRADO */}
    <div className="-mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 text-center">
      <h1 className="text-[40px] font-extrabold tracking-tight text-slate-900 leading-[1.02] sm:text-5xl lg:text-[58px] xl:text-[60px]">
        La inteligencia artificial que se encarga de tu{" "}
        <span className="fyllio-text-gradient">agenda clínica y personal</span>.
      </h1>
    </div>

    {/* 2 COLUMNAS: TEXTO + IMAGEN */}
    <div className="mt-12 grid items-center gap-10 lg:grid-cols-2">
      {/* COLUMNA IZQUIERDA */}
      <div className="mx-auto w-full max-w-2xl lg:mx-0">
        <p className="mt-6 max-w-2xl text-sm text-slate-600 sm:text-base">
          FYLLIO automatiza y optimiza tu agenda para mejorar la ocupación, reducir
          capacidad no utilizada y disminuir el tiempo operativo.
          <br className="hidden sm:block" />
          Te da orden y previsión para identificar ventanas de agenda aprovechables y
          recuperar tiempo personal sin perder eficiencia.
        </p>

        <div className="mt-8 space-y-4">
          <p className="text-lg font-semibold text-slate-900 sm:text-xl">
            ¿Cansado de reprogramaciones, cancelaciones de último minuto y capacidad no
            utilizada inesperada en la agenda?
          </p>

          <p className="text-lg font-semibold text-slate-900 sm:text-xl">
            ¿Cansado de no poder proteger tu tiempo personal porque la agenda se
            desordena y termina controlando tu día?
          </p>

          <p className="pt-2 text-sm text-slate-700 sm:text-base">
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
    <div className="mt-12 text-center">
      <TrackedCta href="/early-access" source="hero" className="btn-fyllio inline-flex">
  Estoy interesado
</TrackedCta>



      <p className="mt-4 text-sm font-semibold text-slate-900">
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
  Por qué escoger{" "}
  <span className="fyllio-text-gradient">FYLLIO</span>
</h2>


    <p className="mx-auto mt-4 max-w-3xl text-center text-sm text-slate-600 sm:text-base">
      Tu agenda antes y después de tener control sobre ella
    </p>

   <div className="mt-12">
  <p className="mx-auto max-w-2xl text-center text-sm text-slate-600 sm:text-base">
    De gestión manual a control automático.
  </p>

  <div className="mx-auto mt-10 max-w-4xl">
    <div className="grid gap-6 md:grid-cols-2">
      {/* ANTES */}
      <div className="min-w-0">
        <div className="mb-4 flex items-center gap-3">
          <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-bold text-rose-700 ring-1 ring-rose-200">
            Antes
          </span>
        </div>

        <div className="space-y-3">
          <div className={cardBad}><IconX />Llamadas manuales</div>
          <div className={cardBad}><IconX />Gestión reactiva</div>
          <div className={cardBad}><IconX />Cancelaciones desordenadas</div>
          <div className={cardBad}><IconX />Tiempo perdido en reorganizar</div>
        </div>
      </div>

      {/* CON FYLLIO */}
      <div className="min-w-0">
        <div className="mb-4 flex items-center gap-3">
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
            Con FYLLIO
          </span>
        </div>

        <div className="space-y-3">
          <div className={cardGood}><IconCheck />Recordatorios automáticos</div>
          <div className={cardGood}><IconCheck />Reasignación inteligente</div>
          <div className={cardGood}><IconCheck />Más estabilidad en el día</div>
          <div className={cardGood}><IconCheck />Más control operativo</div>
        </div>
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
      <div className="fyllio-card-soft p-8 text-left">

        <p className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
          Se integra y entiende tu clínica
        </p>
        <p className="text-base text-slate-700">
          Horarios, sillones, profesionales, tipos de cita, reglas y prioridades.
          {" "}
<span className="fyllio-text-gradient font-semibold">FYLLIO</span>{" "}
se adapta a tu forma real de operar para optimizar sin romper tu flujo.
        </p>
      </div>

    <div className="fyllio-card-soft p-8 text-left">

        <p className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
          Crea la agenda por ti
        </p>
        <p className="text-base text-slate-700">
          Genera una agenda optimizada desde el inicio y automatiza la comunicación
          básica con el paciente (confirmaciones, cambios y recordatorios).
          Puedes generar y ajustar citas a cualquier hora, sin cargar al equipo.
        </p>
      </div>

     <div className="fyllio-card-soft p-8 text-left">

        <p className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
          Detecta oportunidades y riesgos
        </p>
        <p className="text-base text-slate-700">
          Identifica ventanas de agenda aprovechables para aumentar ocupación
          o proteger tiempo personal.
          Detecta riesgos como cancelaciones o no-shows y activa acciones
          para mantener el día estable.
        </p>
      </div>
<div className="fyllio-card-soft p-8 text-left">

        <p className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
          Mantiene la agenda junto a ti
        </p>
        <p className="text-base text-slate-700">
          Con el control recuperado, más orden y recomendaciones inteligentes,
          la agenda se mantiene optimizada incluso cuando hay cambios.
          Tú supervisas y decides;{" "}
<span className="fyllio-text-gradient font-semibold">FYLLIO</span>{" "}
se encarga del trabajo operativo.

        </p>
      </div>
    </div>

    <p className="mt-10 text-center text-sm text-slate-600">
      <span className="fyllio-text-gradient font-semibold">FYLLIO</span>{" "}
hace el trabajo operativo. Tú recuperas control y tiempo.

    </p>
  </div>
</section>


     {/* CTA FINAL (SIN TEXTO DE CORREO) */}
<section
  className={`${anchorOffset} bg-[radial-gradient(900px_520px_at_20%_0%,rgba(37,99,235,0.16),transparent_60%),radial-gradient(900px_520px_at_90%_10%,rgba(6,182,212,0.14),transparent_55%),linear-gradient(to_bottom,#ffffff,rgba(241,245,249,0.85))]`}
>
  <div className="mx-auto flex min-h-[60vh] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6 text-center">
    <h2 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
      ¿Listo para simplificar tu clínica?
    </h2>

    <div className="mt-10">
      <TrackedCta href="/early-access" source="final-cta" className="btn-fyllio inline-flex">
        Estoy interesado
      </TrackedCta>
    </div>
  </div>
</section>

    </main>
  );
}
