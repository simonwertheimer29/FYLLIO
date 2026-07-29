// Campo Fecha_Cierre en Leads (MEJORAS 37) — este SÍ lo permite la API de meta.
const KEY = process.env.AIRTABLE_API_KEY;
const BASES = [process.env.AIRTABLE_BASE_RB, process.env.AIRTABLE_BASE_INDEP].filter(Boolean);
const api = async (url, opts = {}) => {
  const r = await fetch(`https://api.airtable.com/v0${url}`, { ...opts, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
};
for (const base of BASES) {
  const { tables } = await api(`/meta/bases/${base}/tables`);
  const leads = tables.find((t) => /^leads$/i.test(t.name));
  if (leads.fields.some((f) => /^Fecha_Cierre$/i.test(f.name))) { console.log(`${base} · ya existe`); continue; }
  await api(`/meta/bases/${base}/tables/${leads.id}/fields`, {
    method: "POST",
    body: JSON.stringify({
      name: "Fecha_Cierre",
      type: "dateTime",
      description: "Cuándo se cerró el lead (Convertido / No Interesado). Se escribe en la transición; sin backfill histórico.",
      options: { timeZone: "Europe/Madrid", dateFormat: { name: "iso" }, timeFormat: { name: "24hour" } },
    }),
  });
  console.log(`${base} · +Fecha_Cierre`);
}
