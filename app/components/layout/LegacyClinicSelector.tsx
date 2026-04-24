"use client";

import { useEffect, useState } from "react";

type Clinic = { id: string; recordId: string; name: string };

const STORAGE_KEY = "selectedClinicId";

export default function ClinicSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (clinicId: string) => void;
}) {
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/db/clinics")
      .then((r) => r.json())
      .then((json) => {
        const list: Clinic[] = json.clinics ?? [];
        setClinics(list);
        // If no value selected yet, default to first clinic
        if (list.length > 0 && !value) {
          const saved = localStorage.getItem(STORAGE_KEY);
          const target = list.find((c) => c.id === saved) ?? list[0];
          onChange(target.id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleChange(id: string) {
    localStorage.setItem(STORAGE_KEY, id);
    onChange(id);
  }

  if (loading || clinics.length === 0) return null;

  // Only show selector if there's more than one clinic (or always in admin mode)
  if (clinics.length < 2) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold text-slate-600">Clínica</span>
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="text-xs rounded-full border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-800"
      >
        {clinics.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
