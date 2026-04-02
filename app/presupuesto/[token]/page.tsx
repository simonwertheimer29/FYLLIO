"use client";
// app/presupuesto/[token]/page.tsx
// Portal público para que el paciente acepte o rechace su presupuesto
// Sin auth del CRM — completamente independiente

import { useState, useEffect, use } from "react";

const MOTIVOS_RECHAZO = [
  { value: "precio_alto",         label: "El precio es demasiado alto para mí" },
  { value: "otra_clinica",        label: "He decidido ir a otra clínica" },
  { value: "sin_urgencia",        label: "Ahora mismo no me es urgente" },
  { value: "necesita_financiacion", label: "Necesito opciones de financiación" },
  { value: "miedo_tratamiento",   label: "Tengo dudas sobre el tratamiento" },
  { value: "otro",                label: "Otro motivo" },
];

type Estado = "loading" | "not_found" | "expired" | "ya_respondido" | "portal" | "aceptando" | "rechazando" | "done_aceptado" | "done_rechazado";

interface PortalPublico {
  patientName: string;
  treatments: string[];
  amount?: number;
  clinica?: string;
  doctor?: string;
  expiresAt: string;
  respondido: boolean;
  respuesta?: "aceptado" | "rechazado";
}

export default function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [estado, setEstado] = useState<Estado>("loading");
  const [data, setData] = useState<PortalPublico | null>(null);
  const [firma, setFirma] = useState("");
  const [motivoSeleccionado, setMotivoSeleccionado] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    fetch(`/api/portal/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error === "not_found") { setEstado("not_found"); return; }
        if (d.error === "expired") { setEstado("expired"); return; }
        if (d.respondido) {
          setData(d);
          setEstado(d.respuesta === "aceptado" ? "done_aceptado" : "done_rechazado");
          return;
        }
        setData(d);
        setEstado("portal");
      })
      .catch(() => setEstado("not_found"));
  }, [token]);

  async function responder(accion: "aceptar" | "rechazar") {
    setEnviando(true);
    try {
      const body: Record<string, string> = { accion };
      if (accion === "aceptar" && firma.trim()) body.firmaTexto = firma.trim();
      if (accion === "rechazar" && motivoSeleccionado) body.motivo = motivoSeleccionado;

      const res = await fetch(`/api/portal/${token}/responder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.error === "ya_respondido") { setEstado(accion === "aceptar" ? "done_aceptado" : "done_rechazado"); return; }
      if (!res.ok) throw new Error(d.error ?? "Error");
      setEstado(accion === "aceptar" ? "done_aceptado" : "done_rechazado");
    } catch {
      alert("Ha ocurrido un error. Por favor, inténtalo de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (estado === "loading") {
    return (
      <div className="min-h-screen bg-violet-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-violet-300 border-t-violet-600 rounded-full" />
      </div>
    );
  }

  // ── Not found ────────────────────────────────────────────────────────────
  if (estado === "not_found") {
    return <ErrorPage title="Enlace no encontrado" body="Este enlace no existe o ya no está disponible." />;
  }

  // ── Expired ──────────────────────────────────────────────────────────────
  if (estado === "expired") {
    return <ErrorPage title="Enlace caducado" body="Este enlace ha caducado. Contacta con la clínica para solicitar uno nuevo." />;
  }

  // ── Already responded ────────────────────────────────────────────────────
  if ((estado === "done_aceptado" || estado === "done_rechazado") && data) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl mb-6 ${estado === "done_aceptado" ? "bg-emerald-100" : "bg-slate-100"}`}>
          {estado === "done_aceptado" ? "✅" : "👋"}
        </div>
        <h1 className="text-2xl font-bold text-slate-900 text-center mb-3">
          {estado === "done_aceptado" ? "¡Presupuesto aceptado!" : "Respuesta registrada"}
        </h1>
        <p className="text-slate-500 text-center text-base max-w-sm">
          {estado === "done_aceptado"
            ? "Hemos recibido tu confirmación. El equipo de la clínica se pondrá en contacto contigo pronto para confirmar la fecha."
            : "Gracias por tu respuesta. Si en algún momento cambias de opinión, no dudes en contactar con la clínica."
          }
        </p>
        {data.clinica && (
          <p className="mt-8 text-sm text-slate-400">{data.clinica}</p>
        )}
      </div>
    );
  }

  if (!data) return null;

  const firstName = data.patientName.split(" ")[0];

  // ── Confirmar aceptación ─────────────────────────────────────────────────
  if (estado === "aceptando") {
    return (
      <div className="min-h-screen bg-white flex flex-col px-6 py-10 max-w-lg mx-auto">
        <button onClick={() => setEstado("portal")} className="text-slate-400 text-sm mb-6 flex items-center gap-1">
          ← Volver
        </button>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Confirmar aceptación</h2>
        <p className="text-slate-500 text-sm mb-6">
          Escribe tu nombre completo para confirmar que aceptas este presupuesto de forma consciente y voluntaria.
        </p>
        <label className="block text-sm font-semibold text-slate-700 mb-2">Tu nombre completo</label>
        <input
          type="text"
          value={firma}
          onChange={(e) => setFirma(e.target.value)}
          placeholder={data.patientName}
          className="w-full border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-400 mb-6"
          autoFocus
        />
        <button
          onClick={() => responder("aceptar")}
          disabled={enviando || !firma.trim()}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-2xl text-base transition-colors disabled:opacity-50"
        >
          {enviando ? "Enviando…" : "Confirmar aceptación"}
        </button>
        <p className="text-center text-xs text-slate-400 mt-4">
          Esta confirmación tiene validez de firma simbólica. La clínica se pondrá en contacto contigo.
        </p>
      </div>
    );
  }

  // ── Motivo de rechazo ────────────────────────────────────────────────────
  if (estado === "rechazando") {
    return (
      <div className="min-h-screen bg-white flex flex-col px-6 py-10 max-w-lg mx-auto">
        <button onClick={() => setEstado("portal")} className="text-slate-400 text-sm mb-6 flex items-center gap-1">
          ← Volver
        </button>
        <h2 className="text-xl font-bold text-slate-900 mb-2">¿Cuál es el motivo?</h2>
        <p className="text-slate-500 text-sm mb-6">
          Tu respuesta nos ayuda a mejorar. Puedes elegir el que más se acerque.
        </p>
        <div className="flex flex-col gap-3 mb-8">
          {MOTIVOS_RECHAZO.map((m) => (
            <button
              key={m.value}
              onClick={() => setMotivoSeleccionado(m.value)}
              className={`w-full text-left px-4 py-3.5 rounded-xl border-2 text-sm font-medium transition-colors ${
                motivoSeleccionado === m.value
                  ? "border-violet-500 bg-violet-50 text-violet-900"
                  : "border-slate-200 text-slate-700 hover:border-slate-300"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => responder("rechazar")}
          disabled={enviando || !motivoSeleccionado}
          className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-4 rounded-2xl text-base transition-colors disabled:opacity-50"
        >
          {enviando ? "Enviando…" : "Confirmar respuesta"}
        </button>
      </div>
    );
  }

  // ── Portal principal ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      {/* Header */}
      <div className="bg-violet-700 px-6 pt-12 pb-8 text-white">
        <p className="text-violet-300 text-sm font-medium mb-1">{data.clinica ?? "Tu clínica"}</p>
        <h1 className="text-2xl font-bold leading-tight">Hola, {firstName}</h1>
        <p className="text-violet-200 text-sm mt-1">Tu presupuesto está listo para revisar</p>
      </div>

      <div className="px-4 -mt-4">
        {/* Importe */}
        {data.amount != null && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-6 py-5 mb-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Importe total</p>
            <p className="text-4xl font-extrabold text-slate-900">
              €{data.amount.toLocaleString("es-ES")}
            </p>
            {data.doctor && <p className="text-sm text-slate-500 mt-1">Tratante: {data.doctor}</p>}
          </div>
        )}

        {/* Tratamientos */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-6 py-5 mb-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Tratamientos incluidos</p>
          <ul className="flex flex-col gap-2">
            {data.treatments.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-800">
                <span className="text-violet-500 mt-0.5">•</span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* FAQs */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-6 py-5 mb-6">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Preguntas frecuentes</p>
          <div className="flex flex-col gap-3">
            <FaqItem q="¿Qué incluye este presupuesto?" a="Incluye todos los tratamientos descritos arriba, el material utilizado y las visitas de seguimiento necesarias." />
            <FaqItem q="¿Puedo solicitar financiación?" a="Sí. Contacta con la clínica y te explicarán las opciones de pago aplazado disponibles." />
            <FaqItem q="¿Cuánto tiempo tiene validez?" a={`Este presupuesto es válido hasta el ${new Date(data.expiresAt).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })}.`} />
          </div>
        </div>
      </div>

      {/* Botones fijos en la parte inferior */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-100 px-4 py-4 flex flex-col gap-3 safe-area-inset-bottom">
        <button
          onClick={() => setEstado("aceptando")}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-4 rounded-2xl text-base transition-colors"
        >
          Acepto el presupuesto
        </button>
        <button
          onClick={() => setEstado("rechazando")}
          className="w-full bg-white hover:bg-slate-50 text-slate-600 font-semibold py-3.5 rounded-2xl text-sm border border-slate-200 transition-colors"
        >
          No me interesa por ahora
        </button>
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-0 pb-3 last:pb-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left flex items-center justify-between gap-2 text-sm font-medium text-slate-800"
      >
        {q}
        <span className="text-slate-400 text-xs shrink-0">{open ? "▲" : "▼"}</span>
      </button>
      {open && <p className="mt-2 text-sm text-slate-500 leading-relaxed">{a}</p>}
    </div>
  );
}

function ErrorPage({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12">
      <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-3xl mb-6">🔒</div>
      <h1 className="text-2xl font-bold text-slate-900 text-center mb-3">{title}</h1>
      <p className="text-slate-500 text-center text-base max-w-sm">{body}</p>
    </div>
  );
}
