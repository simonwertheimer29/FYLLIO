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
      <h1 className="text-[44px] font-extrabold tracking-tight text-slate-900 leading-[1.02] sm:text-6xl lg:text-[72px]">
  Deja de perder dinero
  <span className="block">por tu agenda.</span>
</h1>

    </div>

    {/* 2 COLUMNAS: TEXTO + IMAGEN */}
    <div className="mt-12 grid items-center gap-10 lg:grid-cols-2">
      {/* COLUMNA IZQUIERDA */}
      <div className="mx-auto w-full max-w-2xl lg:mx-0">
        <p className="mt-6 max-w-2xl text-base text-slate-600 sm:text-lg">
  <span className="fyllio-text-gradient font-semibold">FYLLIO</span> mantiene la ocupación, reduce cancelaciones y ahorra horas de trabajo cada día.
</p>

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
  El problema no es la agenda
</h2>
<p className="mx-auto mt-4 max-w-2xl text-center text-sm text-slate-600 sm:text-base">
  Es todo lo que la rodea y consume tu tiempo sin que lo notes.
</p>


   <div className="mx-auto mt-10 grid w-full max-w-6xl gap-6 md:grid-cols-3 items-stretch">
  {/* CARD 1 */}
  <div className="rounded-3xl bg-sky-50/55 p-8 ring-1 ring-slate-200/60 shadow-[0_18px_55px_rgba(2,6,23,0.06)] backdrop-blur-sm text-center">
    <div className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100/70 ring-1 ring-sky-200">
      {/* clock icon */}
      <svg viewBox="0 0 24 24" className="h-7 w-7 text-sky-700" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" d="M12 8v5l3 2" />
        <path strokeLinecap="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </div>

    <p className="text-lg font-extrabold text-slate-900">
      Horas perdidas en tareas manuales
    </p>
    <p className="mt-3 text-sm leading-relaxed text-slate-600">
      Reorganizar citas, llamar pacientes, cuadrar horarios... cada día.
    </p>
  </div>

  {/* CARD 2 */}
  <div className="rounded-3xl bg-sky-50/55 p-8 ring-1 ring-slate-200/60 shadow-[0_18px_55px_rgba(2,6,23,0.06)] backdrop-blur-sm text-center">
    <div className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100/70 ring-1 ring-sky-200">
      {/* users icon */}
      <svg viewBox="0 0 24 24" className="h-7 w-7 text-sky-700" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" d="M16 11a4 4 0 10-8 0 4 4 0 008 0z" />
        <path strokeLinecap="round" d="M20 21a8 8 0 00-16 0" />
      </svg>
    </div>

    <p className="text-lg font-extrabold text-slate-900">
      Pacientes que no aparecen
    </p>
    <p className="mt-3 text-sm leading-relaxed text-slate-600">
      Las ausencias desorganizan tu día y reducen ingresos.
    </p>
  </div>

  {/* CARD 3 */}
  <div className="rounded-3xl bg-sky-50/55 p-8 ring-1 ring-slate-200/60 shadow-[0_18px_55px_rgba(2,6,23,0.06)] backdrop-blur-sm text-center">
    <div className="mx-auto mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100/70 ring-1 ring-sky-200">
      {/* trending down icon */}
      <svg viewBox="0 0 24 24" className="h-7 w-7 text-sky-700" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" d="M3 7v14h18" />
        <path strokeLinecap="round" d="M21 7l-7 7-4-4-5 5" />
      </svg>
    </div>

    <p className="text-lg font-extrabold text-slate-900">
      Sin visibilidad del rendimiento
    </p>
    <p className="mt-3 text-sm leading-relaxed text-slate-600">
      No sabes qué funciona y qué no hasta que es tarde.
    </p>
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
    <h2 className="text-center text-5xl font-extrabold tracking-tight text-slate-900 sm:text-6xl">
      Cómo funciona
    </h2>

    <p className="mt-3 text-center text-base text-slate-600">
      Cuatro pasos. Sin complicaciones.
    </p>

    <div className="mt-12 grid gap-6 md:grid-cols-4">
      {/* 01 */}
      <div className="relative overflow-hidden rounded-3xl bg-white/70 p-8 ring-1 ring-slate-200/70 shadow-[0_18px_55px_rgba(2,6,23,0.06)] backdrop-blur-sm">
        <div className="absolute right-6 top-6 text-5xl font-extrabold text-slate-200/70">
          01
        </div>

        <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100/70 ring-1 ring-sky-200">
          {/* gear icon */}
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-sky-700" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
            <path strokeLinecap="round" d="M19.4 15a7.8 7.8 0 000-6l-2 1.2a6.2 6.2 0 00-1.5-1.5L17 6.6a7.8 7.8 0 00-6 0l1.2 2a6.2 6.2 0 00-1.5 1.5L6.6 9a7.8 7.8 0 000 6l2-1.2a6.2 6.2 0 001.5 1.5L9 17.4a7.8 7.8 0 006 0l-1.2-2a6.2 6.2 0 001.5-1.5L19.4 15z" />
          </svg>
        </div>

        <p className="text-lg font-extrabold text-slate-900">
          Configura tu clínica
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Añade profesionales, horarios y servicios en minutos.
        </p>
      </div>

      {/* 02 */}
      <div className="relative overflow-hidden rounded-3xl bg-white/70 p-8 ring-1 ring-slate-200/70 shadow-[0_18px_55px_rgba(2,6,23,0.06)] backdrop-blur-sm">
        <div className="absolute right-6 top-6 text-5xl font-extrabold text-slate-200/70">
          02
        </div>

        <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100/70 ring-1 ring-sky-200">
          {/* bell icon */}
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-sky-700" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="M12 22a2 2 0 002-2H10a2 2 0 002 2z" />
            <path strokeLinecap="round" d="M18 16V11a6 6 0 10-12 0v5l-2 2h16l-2-2z" />
          </svg>
        </div>

        <p className="text-lg font-extrabold text-slate-900">
          Activa recordatorios
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Tus pacientes reciben avisos automáticos de sus citas.
        </p>
      </div>

      {/* 03 */}
      <div className="relative overflow-hidden rounded-3xl bg-white/70 p-8 ring-1 ring-slate-200/70 shadow-[0_18px_55px_rgba(2,6,23,0.06)] backdrop-blur-sm">
        <div className="absolute right-6 top-6 text-5xl font-extrabold text-slate-200/70">
          03
        </div>

        <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100/70 ring-1 ring-sky-200">
          {/* bolt icon */}
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-sky-700" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
          </svg>
        </div>

        <p className="text-lg font-extrabold text-slate-900">
          Optimiza tu agenda
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          FYLLIO rellena huecos y reorganiza cancelaciones.
        </p>
      </div>

      {/* 04 */}
      <div className="relative overflow-hidden rounded-3xl bg-white/70 p-8 ring-1 ring-slate-200/70 shadow-[0_18px_55px_rgba(2,6,23,0.06)] backdrop-blur-sm">
        <div className="absolute right-6 top-6 text-5xl font-extrabold text-slate-200/70">
          04
        </div>

        <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-100/70 ring-1 ring-sky-200">
          {/* chart icon */}
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-sky-700" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" d="M4 19V5" />
            <path strokeLinecap="round" d="M8 19V9" />
            <path strokeLinecap="round" d="M12 19V12" />
            <path strokeLinecap="round" d="M16 19V7" />
            <path strokeLinecap="round" d="M20 19V4" />
          </svg>
        </div>

        <p className="text-lg font-extrabold text-slate-900">
          Mide resultados
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Consulta métricas de rendimiento en tiempo real.
        </p>
      </div>
    </div>
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
