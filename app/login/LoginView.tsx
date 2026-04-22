"use client";

// Panel de gestión — tarjeta Administrador (botón "Entrar") + tarjetas de clínica
// (botón "PIN" + modal 4 dígitos).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ClinicaCard = { id: string; nombre: string; ciudad: string | null };

export function LoginView({ clinicas }: { clinicas: ClinicaCard[] }) {
  const [pinClinica, setPinClinica] = useState<ClinicaCard | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo + título */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-violet-600 text-white text-3xl font-extrabold shadow-lg">
            F
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Fyllio</h1>
          <p className="text-sm text-slate-500">Panel de gestión</p>
        </div>

        {/* Tarjeta Administrador */}
        <div className="rounded-3xl bg-white border border-slate-200 shadow-sm p-5 flex items-center gap-4">
          <div className="w-12 h-12 shrink-0 rounded-2xl bg-slate-900 text-white flex items-center justify-center text-xl">
            👤
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900">Administrador</p>
            <p className="text-xs text-slate-500">Todas las clínicas</p>
          </div>
          <Link
            href="/login/admin"
            className="rounded-xl bg-slate-900 text-white text-xs font-bold px-4 py-2 hover:bg-slate-800 transition-colors"
          >
            Entrar
          </Link>
        </div>

        {/* Separador clínicas */}
        {clinicas.length > 0 && (
          <>
            <div className="flex items-center gap-3">
              <div className="h-px bg-slate-200 flex-1" />
              <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">
                Clínicas
              </span>
              <div className="h-px bg-slate-200 flex-1" />
            </div>

            <div className="space-y-3">
              {clinicas.map((c) => (
                <div
                  key={c.id}
                  className="rounded-3xl bg-white border border-slate-200 shadow-sm p-5 flex items-center gap-4"
                >
                  <div className="w-12 h-12 shrink-0 rounded-2xl bg-violet-100 text-violet-700 flex items-center justify-center text-xl">
                    🏥
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{c.nombre}</p>
                    <p className="text-xs text-slate-500 truncate">Coordinación {c.nombre}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPinClinica(c)}
                    className="rounded-xl bg-violet-600 text-white text-xs font-bold px-4 py-2 hover:bg-violet-700 transition-colors"
                  >
                    PIN
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {clinicas.length === 0 && (
          <p className="text-xs text-center text-slate-500">
            No hay clínicas activas. Contacta con el administrador.
          </p>
        )}
      </div>

      {pinClinica && (
        <PinLoginModal clinica={pinClinica} onClose={() => setPinClinica(null)} />
      )}
    </div>
  );
}

function PinLoginModal({
  clinica,
  onClose,
}: {
  clinica: ClinicaCard;
  onClose: () => void;
}) {
  const router = useRouter();
  const [digits, setDigits] = useState(["", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  function updateDigit(idx: number, value: string) {
    const clean = value.replace(/\D/g, "").slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[idx] = clean;
      return next;
    });
    if (clean && idx < 3) inputsRef.current[idx + 1]?.focus();
  }

  function handleKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 4);
    if (pasted.length !== 4) return;
    e.preventDefault();
    const next = pasted.split("");
    setDigits([next[0] ?? "", next[1] ?? "", next[2] ?? "", next[3] ?? ""]);
    inputsRef.current[3]?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const pin = digits.join("");
    if (pin.length !== 4) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/pin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicaId: clinica.id, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "PIN incorrecto");
        setDigits(["", "", "", ""]);
        inputsRef.current[0]?.focus();
        return;
      }
      router.push("/ajustes");
      router.refresh();
    } catch {
      setError("Error de red. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-white border border-slate-200 shadow-xl p-6 space-y-5"
      >
        <div className="text-center space-y-1">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-violet-100 text-violet-700 text-2xl">
            🏥
          </div>
          <h2 className="text-base font-extrabold text-slate-900">Coordinación {clinica.nombre}</h2>
          <p className="text-xs text-slate-500">Introduce tu PIN de 4 dígitos</p>
        </div>

        <div className="flex justify-center gap-2">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                inputsRef.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={d}
              onChange={(e) => updateDigit(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={i === 0 ? handlePaste : undefined}
              className="w-14 h-16 text-center text-2xl font-bold rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400"
              autoComplete="off"
            />
          ))}
        </div>

        {error && (
          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 text-center">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold py-3 hover:bg-slate-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || digits.join("").length !== 4}
            className="flex-1 rounded-xl bg-violet-600 text-white text-sm font-bold py-3 hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </div>
      </form>
    </div>
  );
}
