"use client";
// app/presupuesto/[token]/page.tsx
// Portal público del paciente — sin auth del CRM
// El layout app/presupuesto/layout.tsx tapa el header de Fyllio con z-[60]

import { useState, useEffect, use } from "react";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Estado =
  | "loading"
  | "not_found"
  | "expired"
  | "portal"
  | "aceptando"
  | "rechazando"
  | "done_aceptado"
  | "done_rechazado";

interface PortalPublico {
  patientName: string;
  treatments: string[];
  amount?: number;
  clinica?: string;
  clinicaTelefono?: string;
  doctor?: string;
  tipoPaciente?: string;
  descripcionHumanizada?: string;
  expiresAt: string;
  respondido: boolean;
  respuesta?: "aceptado" | "rechazado";
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const MOTIVOS = [
  { value: "precio_alto",           label: "El precio es alto para mí ahora" },
  { value: "sin_urgencia",          label: "Quiero pensarlo más tiempo" },
  { value: "otra_clinica",          label: "Voy a consultar en otra clínica" },
  { value: "miedo_tratamiento",     label: "El tratamiento no me convence" },
  { value: "necesita_financiacion", label: "No es urgente para mí" },
  { value: "otro",                  label: "Otro motivo" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFecha(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit", month: "long", year: "numeric",
  });
}

function formatEuro(n: number): string {
  return `€${n.toLocaleString("es-ES")}`;
}

// ─── FAQ data ─────────────────────────────────────────────────────────────────

const FAQS = [
  {
    q: "¿Duele el tratamiento?",
    a: "La mayoría de los tratamientos dentales se realizan con anestesia local. Podrías sentir una leve molestia posterior, pero normalmente se controla con analgésicos comunes.",
  },
  {
    q: "¿Cuánto tiempo dura el proceso?",
    a: "Depende del tratamiento. Tu equipo clínico te explicará con detalle el número de visitas y el tiempo estimado en tu caso concreto.",
  },
  {
    q: "¿Qué pasa si no me lo hago ahora?",
    a: "En muchos tratamientos, esperar puede complicar el problema y encarecer la solución a futuro. Tu especialista puede orientarte sobre la urgencia en tu caso.",
  },
  {
    q: "¿Ofrecéis financiación?",
    a: "Sí. Contacta con la clínica y te explicarán las opciones de pago aplazado disponibles. Muchos tratamientos se pueden financiar a 12 o 24 meses.",
  },
];

// ─── Componentes internos ─────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-0 pb-4 last:pb-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left flex items-start justify-between gap-3 py-1"
      >
        <span className="text-[17px] font-medium text-slate-800 leading-snug">{q}</span>
        <span className={`text-violet-500 text-lg shrink-0 mt-0.5 transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <p className="mt-2 text-[16px] text-slate-500 leading-relaxed">{a}</p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <div className="min-h-screen bg-violet-50 flex items-center justify-center">
      <div className="animate-spin w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full" />
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

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
        if (d.error === "expired")   { setEstado("expired"); return; }
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

  async function responder(accion: "aceptar" | "rechazar", opts: { firmaTexto?: string; motivo?: string } = {}) {
    setEnviando(true);
    try {
      const res = await fetch(`/api/portal/${token}/responder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, ...opts }),
      });
      const d = await res.json();
      if (d.error === "ya_respondido" || res.ok) {
        setEstado(accion === "aceptar" ? "done_aceptado" : "done_rechazado");
        return;
      }
      throw new Error(d.error ?? "Error");
    } catch {
      alert("Ha ocurrido un error. Por favor, inténtalo de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (estado === "loading") return <Spinner />;

  // ── Error screens ────────────────────────────────────────────────────────
  if (estado === "not_found" || estado === "expired") {
    const clinica = data?.clinica;
    const tel = data?.clinicaTelefono;
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-3xl mb-6">🔒</div>
        <h1 className="text-[22px] font-bold text-slate-900 mb-3">
          {estado === "expired" ? "Este enlace ha expirado" : "Este enlace no es válido"}
        </h1>
        <p className="text-[17px] text-slate-500 max-w-sm mb-8 leading-relaxed">
          {estado === "expired"
            ? "El enlace ha caducado. Contacta con la clínica para solicitar uno nuevo."
            : "Este enlace no existe o ya no está disponible."}
        </p>
        {(clinica || tel) && (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-6 py-4 text-left w-full max-w-sm">
            {tel && <p className="text-[17px] text-slate-700 mb-1">📞 {tel}</p>}
            {clinica && <p className="text-[17px] text-slate-700">📍 {clinica}</p>}
          </div>
        )}
      </div>
    );
  }

  // ── Done screens ─────────────────────────────────────────────────────────
  if (estado === "done_aceptado" && data) {
    const firstName = data.patientName.split(" ")[0];
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center text-4xl mb-6">✅</div>
        <h1 className="text-[24px] font-bold text-slate-900 mb-3">¡Gracias, {firstName}!</h1>
        <p className="text-[17px] text-slate-600 max-w-sm mb-2 leading-relaxed">
          Has aceptado tu presupuesto de {data.treatments[0] ?? "tratamiento dental"}.
        </p>
        <p className="text-[17px] text-slate-500 max-w-sm mb-8 leading-relaxed">
          Nos pondremos en contacto contigo en las próximas 24 horas para concretar tu primera cita.
        </p>
        {(data.clinica || data.clinicaTelefono) && (
          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-6 py-4 text-left w-full max-w-sm mb-6">
            <p className="text-[15px] text-slate-400 uppercase font-semibold tracking-wide mb-2">Tu clínica</p>
            {data.clinicaTelefono && <p className="text-[17px] text-slate-700 mb-1">📞 {data.clinicaTelefono}</p>}
            {data.clinica && <p className="text-[17px] text-slate-700">📍 {data.clinica}</p>}
          </div>
        )}
        <p className="text-[15px] text-slate-400 max-w-sm leading-relaxed">
          Si tienes dudas antes, llámanos o escríbenos por WhatsApp.
        </p>
      </div>
    );
  }

  if (estado === "done_rechazado") {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-3xl mb-6">👋</div>
        <h1 className="text-[22px] font-bold text-slate-900 mb-3">Respuesta registrada</h1>
        <p className="text-[17px] text-slate-500 max-w-sm leading-relaxed">
          Gracias por tu respuesta. Si en algún momento cambias de opinión, no dudes en contactar con la clínica.
        </p>
      </div>
    );
  }

  if (!data) return null;

  const firstName = data.patientName.split(" ")[0];

  // ── Pantalla 2 — Confirmación de aceptación ──────────────────────────────
  if (estado === "aceptando") {
    return (
      <div className="min-h-screen bg-white flex flex-col px-5 py-8 max-w-lg mx-auto">
        <button
          onClick={() => setEstado("portal")}
          className="text-[17px] text-slate-400 mb-8 flex items-center gap-1 hover:text-slate-600"
        >
          ← Volver al presupuesto
        </button>

        <h2 className="text-[22px] font-bold text-slate-900 mb-6">Confirmación</h2>

        {/* Resumen */}
        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-5 py-4 mb-6">
          <p className="text-[14px] text-slate-400 uppercase font-semibold tracking-wide mb-2">Estás aceptando:</p>
          <p className="text-[17px] font-semibold text-slate-800 mb-0.5">{data.treatments.join(" + ")}</p>
          {data.amount != null && (
            <p className="text-[17px] text-slate-600">
              {formatEuro(data.amount)}{data.doctor ? ` · ${data.doctor}` : ""}
            </p>
          )}
          {data.clinica && <p className="text-[15px] text-slate-400 mt-0.5">{data.clinica}</p>}
        </div>

        {/* Input firma */}
        <label className="block text-[17px] font-semibold text-slate-700 mb-2">
          Para confirmar, escribe tu nombre completo:
        </label>
        <input
          type="text"
          value={firma}
          onChange={(e) => setFirma(e.target.value)}
          placeholder={data.patientName}
          className="w-full border-2 border-slate-200 focus:border-violet-500 rounded-2xl px-4 py-3.5 text-[17px] text-slate-900 outline-none mb-4"
          autoFocus
        />

        <p className="text-[15px] text-slate-400 leading-relaxed mb-8">
          Al confirmar, indicas que has leído y aceptas este presupuesto.
        </p>

        <div
          className="sticky bottom-0 bg-white pt-3 pb-[env(safe-area-inset-bottom,12px)]"
          style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
        >
          <button
            onClick={() => responder("aceptar", { firmaTexto: firma.trim() })}
            disabled={enviando || !firma.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-bold text-[17px] rounded-2xl transition-colors"
            style={{ minHeight: "56px" }}
          >
            {enviando ? "Enviando…" : "Confirmar aceptación"}
          </button>
        </div>
      </div>
    );
  }

  // ── Pantalla 3b — Motivo de rechazo ──────────────────────────────────────
  if (estado === "rechazando") {
    return (
      <div className="min-h-screen bg-white flex flex-col px-5 py-8 max-w-lg mx-auto">
        <div className="flex-1">
          <div className="mb-8">
            <h2 className="text-[22px] font-bold text-slate-900 mb-2">
              Entendemos que quizás no es el momento.
            </h2>
            <p className="text-[17px] text-slate-500 leading-relaxed">
              ¿Puedes contarnos el motivo? Nos ayuda a mejorar.
            </p>
          </div>

          <div className="flex flex-col gap-3 mb-8">
            {MOTIVOS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMotivoSeleccionado(m.value)}
                className={`w-full text-left px-5 py-4 rounded-2xl border-2 text-[17px] font-medium transition-colors ${
                  motivoSeleccionado === m.value
                    ? "border-violet-500 bg-violet-50 text-violet-900"
                    : "border-slate-200 text-slate-700"
                }`}
                style={{ minHeight: "56px" }}
              >
                <span className={`inline-flex w-5 h-5 rounded-full border-2 mr-3 items-center justify-center shrink-0 ${
                  motivoSeleccionado === m.value ? "border-violet-500 bg-violet-500" : "border-slate-300"
                }`}>
                  {motivoSeleccionado === m.value && (
                    <span className="w-2 h-2 rounded-full bg-white" />
                  )}
                </span>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="sticky bottom-0 bg-white pt-3 flex flex-col gap-3"
          style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
        >
          <button
            onClick={() => responder("rechazar", { motivo: motivoSeleccionado })}
            disabled={enviando || !motivoSeleccionado}
            className="w-full bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white font-bold text-[17px] rounded-2xl transition-colors"
            style={{ minHeight: "56px" }}
          >
            {enviando ? "Enviando…" : "Enviar y cerrar"}
          </button>
          <button
            onClick={() => responder("rechazar", {})}
            disabled={enviando}
            className="w-full text-center text-[15px] text-slate-400 hover:text-slate-600 py-2"
          >
            Omitir y cerrar
          </button>
        </div>
      </div>
    );
  }

  // ── Pantalla 1 — Vista principal del presupuesto ─────────────────────────
  return (
    <div className="min-h-screen bg-slate-50" style={{ fontSize: "17px" }}>
      {/* Header clínica */}
      <div className="bg-white px-5 pt-8 pb-4">
        <p className="text-[15px] text-slate-400 font-medium">{data.clinica ?? "Tu clínica"}</p>
      </div>

      {/* Hero morado */}
      <div className="bg-violet-700 px-5 pt-6 pb-8">
        <p className="text-violet-300 text-[15px] mb-1">Tu presupuesto está listo para revisar con calma</p>
        <h1 className="text-[28px] font-bold text-white leading-tight">Hola, {firstName}</h1>
      </div>

      <div className="px-4 -mt-4 pb-40">
        {/* Card importe */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-5 py-5 mb-4">
          <p className="text-[13px] font-bold text-slate-400 uppercase tracking-wide mb-1">Importe total</p>
          <p className="text-[40px] font-extrabold text-slate-900 leading-none mb-1">
            {data.amount != null ? formatEuro(data.amount) : "—"}
          </p>
          {data.doctor && (
            <p className="text-[16px] text-slate-500">Tratante: {data.doctor}</p>
          )}
          {/* Mutua desglose — solo si es Adeslas */}
          {data.tipoPaciente === "Adeslas" && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-1">
              <div className="flex justify-between text-[16px]">
                <span className="text-slate-500">Tu mutua cubre:</span>
                <span className="text-slate-600 font-semibold">Consultar</span>
              </div>
              <div className="flex justify-between text-[16px]">
                <span className="text-slate-500">Tu parte:</span>
                <span className="text-slate-900 font-bold">{data.amount != null ? formatEuro(data.amount) : "—"}</span>
              </div>
            </div>
          )}
        </div>

        {/* Card tratamiento */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-5 py-5 mb-4">
          <p className="text-[13px] font-bold text-slate-400 uppercase tracking-wide mb-2">Tu tratamiento</p>
          <p className="text-[18px] font-bold text-slate-900 mb-2">{data.treatments.join(" + ")}</p>
          {data.descripcionHumanizada ? (
            <p className="text-[16px] text-slate-500 leading-relaxed">{data.descripcionHumanizada}</p>
          ) : (
            <p className="text-[16px] text-slate-400 italic leading-relaxed">
              Tu especialista te explicará todos los detalles en consulta.
            </p>
          )}
        </div>

        {/* FAQs */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-5 py-5 mb-6">
          <p className="text-[13px] font-bold text-slate-400 uppercase tracking-wide mb-4">Preguntas frecuentes</p>
          <div className="flex flex-col gap-4">
            {FAQS.map((faq) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </div>

      {/* Botones fijos en la parte inferior */}
      <div
        className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-100 px-4 pt-4 flex flex-col gap-3"
        style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
      >
        <button
          onClick={() => setEstado("aceptando")}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[17px] rounded-2xl transition-colors"
          style={{ minHeight: "56px" }}
        >
          ✓ Acepto el presupuesto
        </button>
        <div className="flex items-center justify-between px-1 pb-1">
          <button
            onClick={() => setEstado("rechazando")}
            className="text-[15px] text-slate-400 hover:text-slate-600"
          >
            No me interesa por ahora →
          </button>
          <span className="text-[13px] text-slate-300">
            Válido hasta {formatFecha(data.expiresAt)}
          </span>
        </div>
      </div>
    </div>
  );
}
