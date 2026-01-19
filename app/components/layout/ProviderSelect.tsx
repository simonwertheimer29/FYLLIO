"use client";

type Provider = { id: string; name: string };

export default function ProviderSelect({
  providers,
  value,
  onChange,
}: {
  providers: Provider[];
  value: string;
  onChange: (nextId: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold text-slate-600">Agenda</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs rounded-full border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-800"
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
