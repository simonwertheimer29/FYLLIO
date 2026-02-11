"use client";

import { useState } from "react";
import TrackedCta from "@/components/TrackedCta";

export default function EarlyAccessPage() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const mailchimpAction = process.env.NEXT_PUBLIC_MAILCHIMP_ACTION_URL || "#";

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
      setSubmitted(true);
      form.reset();
    } catch {
      alert("No se pudo enviar. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-white">
      <section className="bg-[radial-gradient(1200px_600px_at_20%_0%,rgba(37,99,235,0.18),transparent_60%),radial-gradient(900px_520px_at_90%_10%,rgba(6,182,212,0.18),transparent_55%),linear-gradient(to_bottom,rgba(241,245,249,0.75),#ffffff)]">
        <div className="mx-auto flex min-h-[92vh] max-w-3xl flex-col justify-center px-6 text-center">
          <h1 className="text-5xl font-extrabold tracking-tight text-slate-900 sm:text-6xl">
            Estás justo a tiempo.
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-base text-slate-600">
            FYLLIO está en desarrollo y estamos seleccionando un grupo reducido de clínicas para probar la primera demo.
          </p>

          <p className="mx-auto mt-3 max-w-xl text-base text-slate-600">
            Si la agenda es un problema en tu clínica, deja tu correo y te avisamos cuando esté lista.
          </p>

          <div className="mx-auto mt-10 w-full max-w-md">
            {submitted ? (
              <div className="rounded-2xl bg-white/80 p-8 ring-1 ring-slate-200 backdrop-blur">
                <h3 className="text-xl font-bold text-slate-900">¡Listo! ✅</h3>
                <p className="mt-2 text-slate-600">Te avisaremos cuando la demo esté lista.</p>
                <TrackedCta href="/" source="early-access-back" className="btn-fyllio mt-6 inline-flex w-full justify-center">
                  Volver
                </TrackedCta>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="rounded-2xl bg-white/70 p-6 ring-1 ring-slate-200 backdrop-blur">
                <label className="mb-2 block text-left text-xs font-semibold text-slate-600">
                  Correo profesional
                </label>

                <input
                  name="EMAIL"
                  type="email"
                  required
                  placeholder="tu@clinica.com"
                  className="w-full rounded-xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-900 outline-none focus:border-sky-300"
                />

                <button
                  type="submit"
                  disabled={submitting || mailchimpAction === "#"}
                  className={submitting ? "btn-fyllio mt-4 w-full opacity-70 cursor-not-allowed" : "btn-fyllio mt-4 w-full"}
                >
                  {submitting ? "Enviando..." : "Quiero estar en la lista piloto"}
                </button>

                <p className="mt-3 text-xs text-slate-500">
                  Las primeras clínicas tendrán acceso prioritario.
                </p>

                {mailchimpAction === "#" ? (
                  <p className="mt-3 text-xs text-amber-700">
                    ⚠️ Falta configurar Mailchimp: define <b>NEXT_PUBLIC_MAILCHIMP_ACTION_URL</b>.
                  </p>
                ) : null}
              </form>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
