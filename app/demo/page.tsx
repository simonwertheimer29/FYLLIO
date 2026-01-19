import Link from "next/link";

export default function DemoHomePage() {
  return (
    <main className="max-w-4xl mx-auto px-6 py-14">
      <h1 className="text-3xl font-extrabold text-slate-900">Demo</h1>
      <p className="mt-2 text-slate-600">
        Elige cómo quieres probar Fyllio.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          href="/demo/analyze"
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition"
        >
          <p className="text-lg font-bold text-slate-900">Analyze</p>
          <p className="mt-1 text-sm text-slate-600">
            Parte de una agenda existente y deja que la IA la analice.
          </p>
        </Link>

        <Link
          href="/demo/generate"
          className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm hover:shadow-md transition"
        >
          <p className="text-lg font-bold text-slate-900">Generate</p>
          <p className="mt-1 text-sm text-slate-600">
            Define reglas y genera un día completo + huecos con IA.
          </p>
        </Link>
      </div>
    </main>
  );
}
