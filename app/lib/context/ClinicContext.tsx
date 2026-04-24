"use client";

// app/lib/context/ClinicContext.tsx
//
// Sprint 7 Fase 4 — contexto global de clínica seleccionada.
//
// Hidratación SSR-safe (regla estricta): Provider inicializa
// `selectedClinicaId: null` tanto en SSR como en primer render del cliente.
// Un useEffect posterior lee localStorage y hace setSelectedClinicaId.
// Escritura a localStorage en otro useEffect que observa el state.
//
// Para coordinación con una sola clínica: el useEffect fuerza
// selectedClinicaId = clinicasAccesibles[0] ignorando localStorage.
// Para coordinación con varias: solo permite sus clínicas.
// Para admin: puede elegir entre todas las clínicas o null ("Todas").

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Clinica = {
  id: string;
  nombre: string;
};

export type ClinicContextSession = {
  userId: string;
  nombre: string;
  rol: "admin" | "coordinacion";
  /** `["*"]` para admin, ids específicos para coord. */
  clinicasAccesibles: string[];
};

type ContextValue = {
  /** `null` = "Todas las clínicas" (solo válido para admin). */
  selectedClinicaId: string | null;
  setSelectedClinicaId: (id: string | null) => void;
  /** Todas las clínicas activas cargadas server-side. */
  clinicas: Clinica[];
  /** Clínicas que el usuario actual puede seleccionar. */
  clinicasSelectables: Clinica[];
  session: ClinicContextSession;
  /** true después del primer effect del cliente (hidratación completa). */
  isHydrated: boolean;
};

const ClinicCtx = createContext<ContextValue | null>(null);

const LS_KEY = "fyllio.selectedClinicaId";

type ProviderProps = {
  session: ClinicContextSession;
  clinicas: Clinica[];
  children: ReactNode;
};

export function ClinicProvider({ session, clinicas, children }: ProviderProps) {
  // ⚠️ SSR-safe: null en SSR y primer render cliente. Prohibido leer
  // localStorage en el initializer.
  const [selectedClinicaId, setSelectedClinicaIdState] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  const isAdmin = session.rol === "admin";
  const accesibles = session.clinicasAccesibles;

  const clinicasSelectables = useMemo(() => {
    if (isAdmin) return clinicas;
    return clinicas.filter((c) => accesibles.includes(c.id));
  }, [isAdmin, accesibles, clinicas]);

  // HIDRATACIÓN: se ejecuta una sola vez en cliente.
  useEffect(() => {
    if (!isAdmin && clinicasSelectables.length > 0) {
      // Coordinación: forzar su clínica (o la primera si tiene varias).
      // Preferimos localStorage SI está en sus clínicas permitidas.
      const stored = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
      const initial =
        stored && clinicasSelectables.some((c) => c.id === stored)
          ? stored
          : clinicasSelectables[0]?.id ?? null;
      setSelectedClinicaIdState(initial);
    } else if (isAdmin) {
      const stored = typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
      if (stored === "__all__" || stored === null) {
        // "__all__" y null ambos se mapean a null ("Todas")
        setSelectedClinicaIdState(null);
      } else if (clinicas.some((c) => c.id === stored)) {
        setSelectedClinicaIdState(stored);
      } else {
        setSelectedClinicaIdState(null);
      }
    }
    setIsHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PERSISTENCIA: escribe cada cambio (solo tras hidratar).
  useEffect(() => {
    if (!isHydrated) return;
    if (typeof window === "undefined") return;
    if (selectedClinicaId === null) {
      localStorage.setItem(LS_KEY, "__all__");
    } else {
      localStorage.setItem(LS_KEY, selectedClinicaId);
    }
  }, [selectedClinicaId, isHydrated]);

  const setSelectedClinicaId = useCallback(
    (id: string | null) => {
      // Coord: no permitir "Todas" ni clínicas fuera de sus accesibles.
      if (!isAdmin) {
        if (id === null) return;
        if (!clinicasSelectables.some((c) => c.id === id)) return;
      } else {
        // Admin: null OK; id debe existir en la lista completa.
        if (id !== null && !clinicas.some((c) => c.id === id)) return;
      }
      setSelectedClinicaIdState(id);
    },
    [isAdmin, clinicasSelectables, clinicas]
  );

  const value = useMemo<ContextValue>(
    () => ({
      selectedClinicaId,
      setSelectedClinicaId,
      clinicas,
      clinicasSelectables,
      session,
      isHydrated,
    }),
    [selectedClinicaId, setSelectedClinicaId, clinicas, clinicasSelectables, session, isHydrated]
  );

  return <ClinicCtx.Provider value={value}>{children}</ClinicCtx.Provider>;
}

export function useClinic(): ContextValue {
  const ctx = useContext(ClinicCtx);
  if (!ctx) {
    throw new Error("useClinic() usado fuera de <ClinicProvider>");
  }
  return ctx;
}
