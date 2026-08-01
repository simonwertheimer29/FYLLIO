"use client";

// Hook compartido por las DOS pestañas de Seguimiento (2026-08-01).
//
// Vive aquí y no dentro de cada pestaña por la razón de siempre: leads y
// presupuestos son la misma cola vista por dos lentes, y dos copias del mismo
// estado acaban divergiendo. Una sola carga, un solo `marcar`.
//
// Actualización OPTIMISTA con vuelta atrás si el servidor dice que no: marcar
// "visto" es la acción más frecuente de la pantalla y esperar un viaje de red
// por cada clic la haría inservible — pero un fallo no puede quedarse pintado
// como éxito (§5), así que se revierte y se avisa.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { cargarJSON, traeLista } from "../fetch-json";
import type { TipoCaso } from "./vistos";

type VistoDto = { tipo: TipoCaso; casoId: string; porNombre: string | null };

const clave = (tipo: TipoCaso, casoId: string) => `${tipo}:${casoId}`;

export function useVistosHoy() {
  const [vistos, setVistos] = useState<Set<string>>(new Set());
  const [cargado, setCargado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const d = await cargarJSON<{ vistos: VistoDto[] }>("/api/seguimiento/vistos", {
        validar: traeLista("vistos"),
      });
      setVistos(new Set(d.vistos.map((v) => clave(v.tipo, v.casoId))));
    } catch {
      // Un fallo aquí NO puede vaciar la cola ni marcar cosas como vistas: se
      // deja el conjunto como estaba y la pantalla sigue mostrando todo, que
      // es el lado seguro del error.
      toast.error("No se pudieron cargar los casos ya vistos hoy.");
    } finally {
      setCargado(true);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const estaVisto = useCallback(
    (tipo: TipoCaso, casoId: string) => vistos.has(clave(tipo, casoId)),
    [vistos],
  );

  const marcar = useCallback(
    async (tipo: TipoCaso, casoId: string, deshacer = false) => {
      const k = clave(tipo, casoId);
      setVistos((prev) => {
        const next = new Set(prev);
        if (deshacer) next.delete(k);
        else next.add(k);
        return next;
      });
      try {
        const res = await fetch("/api/seguimiento/vistos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipo, casoId, deshacer }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        setVistos((prev) => {
          const next = new Set(prev);
          if (deshacer) next.add(k);
          else next.delete(k);
          return next;
        });
        toast.error("No se pudo guardar. Vuelve a intentarlo.");
      }
    },
    [],
  );

  return { estaVisto, marcar, cargado, total: vistos.size };
}
