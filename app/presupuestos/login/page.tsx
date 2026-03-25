"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/presupuestos/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const d = await res.json();

      if (!res.ok || d.error) {
        setError(d.error ?? "Error al iniciar sesión");
        return;
      }

      router.push("/presupuestos");
      router.refresh();
    } catch {
      setError("Error de red. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-violet-600 text-white text-2xl font-extrabold shadow-lg">
            P
          </div>
          <h1 className="text-xl font-extrabold text-slate-900">Presupuestos</h1>
          <p className="text-sm text-slate-500">Accede con tu cuenta de clínica</p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="rounded-3xl bg-white border border-slate-200 shadow-sm p-6 space-y-4"
        >
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@clinica.com"
              required
              autoComplete="email"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
          </div>

          {error && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-violet-600 text-white text-sm font-bold py-3 hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>

        {/* Demo hint */}
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 space-y-1">
          <p className="font-semibold text-slate-600">Acceso demo:</p>
          <p>Manager: <span className="font-mono">demo@fyllio.com</span> / <span className="font-mono">demo2024</span></p>
          <p>Ventas: <span className="font-mono">ventas@demo.com</span> / <span className="font-mono">demo2024</span></p>
        </div>
      </div>
    </div>
  );
}
