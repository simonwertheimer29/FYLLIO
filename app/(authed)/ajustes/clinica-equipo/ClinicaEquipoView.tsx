"use client";

// Sprint 7 Fase 6 — gestión de clínicas y equipo.
// Dos tablas (clínicas + usuarios) con modales de crear/editar y
// un modal de "PIN generado, copia ahora" tras crear/regenerar.

import { useCallback, useState } from "react";

type Clinica = {
  id: string;
  nombre: string;
  ciudad: string | null;
  telefono: string | null;
  activa: boolean;
};

type Usuario = {
  id: string;
  nombre: string;
  email: string | null;
  rol: "admin" | "coordinacion";
  activo: boolean;
  pinLength: 4 | 6 | null;
  clinicas: Array<{ id: string; nombre: string }>;
};

type Props = {
  initialClinicas: Clinica[];
  initialUsuarios: Usuario[];
};

export function ClinicaEquipoView({ initialClinicas, initialUsuarios }: Props) {
  const [clinicas, setClinicas] = useState<Clinica[]>(initialClinicas);
  const [usuarios, setUsuarios] = useState<Usuario[]>(initialUsuarios);

  const [modalClinica, setModalClinica] = useState<Clinica | "new" | null>(null);
  const [modalUsuario, setModalUsuario] = useState<Usuario | "new" | null>(null);
  const [pinShown, setPinShown] = useState<{ pin: string; nombre: string; rol: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const refreshClinicas = useCallback(async () => {
    const res = await fetch("/api/admin/clinicas");
    if (res.ok) {
      const d = await res.json();
      setClinicas(d.clinicas ?? []);
    }
  }, []);
  const refreshUsuarios = useCallback(async () => {
    const res = await fetch("/api/admin/usuarios");
    if (res.ok) {
      const d = await res.json();
      setUsuarios(d.usuarios ?? []);
    }
  }, []);

  async function toggleClinicaActiva(c: Clinica) {
    setError(null);
    const res = await fetch(`/api/admin/clinicas/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activa: !c.activa }),
    });
    if (!res.ok) {
      setError("No se pudo actualizar la clínica");
      return;
    }
    await refreshClinicas();
  }

  async function toggleUsuarioActivo(u: Usuario) {
    setError(null);
    const res = await fetch(`/api/admin/usuarios/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: !u.activo }),
    });
    if (!res.ok) {
      setError("No se pudo actualizar el usuario");
      return;
    }
    await refreshUsuarios();
  }

  async function regenerarPin(u: Usuario) {
    setError(null);
    const res = await fetch(`/api/admin/usuarios/${u.id}/regenerar-pin`, {
      method: "POST",
    });
    if (!res.ok) {
      setError("No se pudo regenerar el PIN");
      return;
    }
    const d = await res.json();
    setPinShown({ pin: d.pin, nombre: u.nombre, rol: u.rol });
    await refreshUsuarios();
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <header>
        <h1 className="text-xl font-extrabold text-slate-900">Clínica y equipo</h1>
        <p className="text-sm text-slate-500 mt-1">
          Gestiona las clínicas activas y los usuarios con acceso al sistema.
        </p>
      </header>

      {error && (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      {/* ─── Clínicas ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Clínicas ({clinicas.length})</h2>
          <button
            type="button"
            onClick={() => setModalClinica("new")}
            className="rounded-xl bg-violet-600 text-white text-xs font-bold px-3 py-1.5 hover:bg-violet-700"
          >
            + Añadir clínica
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Nombre</th>
                <th className="text-left font-semibold px-3 py-2">Ciudad</th>
                <th className="text-left font-semibold px-3 py-2">Teléfono</th>
                <th className="text-left font-semibold px-3 py-2">Estado</th>
                <th className="text-right font-semibold px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {clinicas.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-slate-900">{c.nombre}</td>
                  <td className="px-3 py-2 text-slate-600">{c.ciudad ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{c.telefono ?? "—"}</td>
                  <td className="px-3 py-2">
                    {c.activa ? (
                      <span className="inline-flex rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold">
                        Activa
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-slate-100 text-slate-500 border border-slate-200 px-2 py-0.5 text-[10px] font-semibold">
                        Inactiva
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button
                      type="button"
                      onClick={() => setModalClinica(c)}
                      className="text-violet-700 hover:underline font-semibold"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleClinicaActiva(c)}
                      className="text-slate-600 hover:underline font-semibold"
                    >
                      {c.activa ? "Desactivar" : "Activar"}
                    </button>
                  </td>
                </tr>
              ))}
              {clinicas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    Sin clínicas. Añade una para empezar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── Equipo ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Equipo ({usuarios.length})</h2>
          <button
            type="button"
            onClick={() => setModalUsuario("new")}
            className="rounded-xl bg-violet-600 text-white text-xs font-bold px-3 py-1.5 hover:bg-violet-700"
          >
            + Añadir usuario
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Nombre</th>
                <th className="text-left font-semibold px-3 py-2">Rol</th>
                <th className="text-left font-semibold px-3 py-2">Email</th>
                <th className="text-left font-semibold px-3 py-2">Clínicas</th>
                <th className="text-left font-semibold px-3 py-2">Estado</th>
                <th className="text-right font-semibold px-3 py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-slate-900">{u.nombre}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {u.rol === "admin" ? "Administrador" : "Coordinación"}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{u.email ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {u.rol === "admin"
                      ? "Todas las clínicas"
                      : u.clinicas.map((c) => c.nombre).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {u.activo ? (
                      <span className="inline-flex rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold">
                        Activo
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-slate-100 text-slate-500 border border-slate-200 px-2 py-0.5 text-[10px] font-semibold">
                        Inactivo
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button
                      type="button"
                      onClick={() => setModalUsuario(u)}
                      className="text-violet-700 hover:underline font-semibold"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => regenerarPin(u)}
                      className="text-slate-600 hover:underline font-semibold"
                    >
                      Regenerar PIN
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleUsuarioActivo(u)}
                      className="text-slate-600 hover:underline font-semibold"
                    >
                      {u.activo ? "Desactivar" : "Activar"}
                    </button>
                  </td>
                </tr>
              ))}
              {usuarios.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    Sin usuarios.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {modalClinica && (
        <ClinicaModal
          clinica={modalClinica === "new" ? null : modalClinica}
          onClose={() => setModalClinica(null)}
          onSaved={async () => {
            setModalClinica(null);
            await refreshClinicas();
          }}
          onError={(m) => setError(m)}
        />
      )}

      {modalUsuario && (
        <UsuarioModal
          usuario={modalUsuario === "new" ? null : modalUsuario}
          clinicas={clinicas.filter((c) => c.activa)}
          onClose={() => setModalUsuario(null)}
          onSaved={async (pin) => {
            const target = modalUsuario === "new" ? null : modalUsuario;
            setModalUsuario(null);
            if (pin && target !== null) {
              setPinShown({ pin, nombre: target.nombre, rol: target.rol });
            } else if (pin) {
              // Creación nueva — mostramos el PIN con el último nombre creado.
              // El modal devuelve también usuario en onSaved vía un atajo;
              // aquí usamos el nombre introducido.
            }
            await refreshUsuarios();
          }}
          onCreated={(pin, nombre, rol) => {
            setPinShown({ pin, nombre, rol });
          }}
          onError={(m) => setError(m)}
        />
      )}

      {pinShown && <PinShownModal {...pinShown} onClose={() => setPinShown(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Modal: crear / editar clínica
// ═══════════════════════════════════════════════════════════════════════

function ClinicaModal({
  clinica,
  onClose,
  onSaved,
  onError,
}: {
  clinica: Clinica | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [nombre, setNombre] = useState(clinica?.nombre ?? "");
  const [ciudad, setCiudad] = useState(clinica?.ciudad ?? "");
  const [telefono, setTelefono] = useState(clinica?.telefono ?? "");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setSaving(true);
    try {
      const res = clinica
        ? await fetch(`/api/admin/clinicas/${clinica.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre, ciudad, telefono }),
          })
        : await fetch("/api/admin/clinicas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombre, ciudad, telefono }),
          });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        onError(d?.error ?? "No se pudo guardar");
        return;
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={clinica ? "Editar clínica" : "Añadir clínica"}>
      <form onSubmit={submit} className="space-y-3">
        <LabeledInput label="Nombre" value={nombre} onChange={setNombre} required />
        <LabeledInput label="Ciudad" value={ciudad} onChange={setCiudad} />
        <LabeledInput label="Teléfono" value={telefono} onChange={setTelefono} />
        <ModalFooter onClose={onClose} submitting={saving} label="Guardar" />
      </form>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Modal: crear / editar usuario
// ═══════════════════════════════════════════════════════════════════════

function UsuarioModal({
  usuario,
  clinicas,
  onClose,
  onSaved,
  onCreated,
  onError,
}: {
  usuario: Usuario | null;
  clinicas: Clinica[];
  onClose: () => void;
  onSaved: (pin: string | null) => void | Promise<void>;
  onCreated: (pin: string, nombre: string, rol: string) => void;
  onError: (msg: string) => void;
}) {
  const isNew = usuario === null;
  const [rol, setRol] = useState<"admin" | "coordinacion">(usuario?.rol ?? "coordinacion");
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [email, setEmail] = useState(usuario?.email ?? "");
  const [clinicasSel, setClinicasSel] = useState<Set<string>>(
    new Set(usuario?.clinicas.map((c) => c.id) ?? [])
  );
  const [saving, setSaving] = useState(false);

  function toggleClinica(id: string) {
    setClinicasSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setSaving(true);
    try {
      if (isNew) {
        const body =
          rol === "admin"
            ? { rol: "admin" as const, nombre, email: email || null }
            : { rol: "coordinacion" as const, nombre, clinicas: Array.from(clinicasSel) };
        if (rol === "coordinacion" && clinicasSel.size === 0) {
          onError("Selecciona al menos una clínica");
          setSaving(false);
          return;
        }
        const res = await fetch("/api/admin/usuarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          onError(d?.error ?? "No se pudo crear el usuario");
          return;
        }
        const d = await res.json();
        onCreated(d.pin, nombre, rol);
        await onSaved(null);
      } else {
        const res = await fetch(`/api/admin/usuarios/${usuario.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre,
            email: rol === "admin" ? email || null : undefined,
            clinicas: rol === "coordinacion" ? Array.from(clinicasSel) : undefined,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          onError(d?.error ?? "No se pudo guardar");
          return;
        }
        await onSaved(null);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      onClose={onClose}
      title={isNew ? "Añadir usuario" : `Editar ${usuario.nombre}`}
    >
      <form onSubmit={submit} className="space-y-3">
        {isNew && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Rol</label>
            <div className="flex gap-2">
              {(["admin", "coordinacion"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRol(r)}
                  className={`flex-1 text-xs font-semibold px-3 py-2 rounded-xl border ${
                    rol === r
                      ? "bg-violet-600 text-white border-violet-600"
                      : "bg-white text-slate-700 border-slate-200"
                  }`}
                >
                  {r === "admin" ? "Administrador" : "Coordinación"}
                </button>
              ))}
            </div>
          </div>
        )}

        <LabeledInput label="Nombre" value={nombre} onChange={setNombre} required />

        {rol === "admin" && (
          <LabeledInput label="Email (opcional, solo notificaciones)" value={email} onChange={setEmail} />
        )}

        {rol === "coordinacion" && (
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Clínicas asignadas
            </label>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 space-y-1">
              {clinicas.length === 0 && (
                <p className="text-xs text-slate-400 px-1">Sin clínicas activas.</p>
              )}
              {clinicas.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 text-xs text-slate-800 px-2 py-1 rounded hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={clinicasSel.has(c.id)}
                    onChange={() => toggleClinica(c.id)}
                  />
                  <span>{c.nombre}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {isNew && (
          <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            Al guardar se generará un PIN de {rol === "admin" ? "6" : "4"} dígitos. Se mostrará
            una sola vez — cópialo y entrégalo al usuario.
          </p>
        )}

        <ModalFooter
          onClose={onClose}
          submitting={saving}
          label={isNew ? "Crear usuario" : "Guardar"}
        />
      </form>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Modal: PIN generado (mostrar una vez)
// ═══════════════════════════════════════════════════════════════════════

function PinShownModal({
  pin,
  nombre,
  rol,
  onClose,
}: {
  pin: string;
  nombre: string;
  rol: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <ModalShell onClose={onClose} title={`PIN generado`}>
      <div className="space-y-4">
        <p className="text-xs text-slate-600">
          {nombre} ({rol === "admin" ? "Administrador" : "Coordinación"}). Este PIN solo se
          muestra esta vez — cópialo ahora y entrégalo al usuario.
        </p>
        <div className="rounded-2xl bg-slate-900 text-white font-mono text-4xl font-bold text-center py-6 tracking-[0.35em]">
          {pin}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="flex-1 rounded-xl bg-violet-600 text-white text-sm font-bold py-2.5 hover:bg-violet-700"
          >
            {copied ? "¡Copiado!" : "Copiar PIN"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold py-2.5 hover:bg-slate-200"
          >
            He guardado el PIN
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Componentes compartidos
// ═══════════════════════════════════════════════════════════════════════

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl bg-white border border-slate-200 shadow-xl p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-extrabold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-lg"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-600 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
      />
    </div>
  );
}

function ModalFooter({
  onClose,
  submitting,
  label,
}: {
  onClose: () => void;
  submitting: boolean;
  label: string;
}) {
  return (
    <div className="flex gap-2 pt-2">
      <button
        type="button"
        onClick={onClose}
        className="flex-1 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold py-2.5 hover:bg-slate-200"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={submitting}
        className="flex-1 rounded-xl bg-violet-600 text-white text-sm font-bold py-2.5 hover:bg-violet-700 disabled:opacity-50"
      >
        {submitting ? "Guardando…" : label}
      </button>
    </div>
  );
}
