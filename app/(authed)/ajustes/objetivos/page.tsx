// app/(authed)/ajustes/objetivos/page.tsx
//
// Objetivos del mes. Primer paso de la fusión /ajustes + /automatizaciones
// (MEJORAS 13): este editor es el ÚNICO de objetivos mensuales que hay, y vivía
// escondido en la pestaña «Reglas y objetivos» de /automatizaciones.
//
// El acceso (sesión + rol admin) lo resuelve el layout de /ajustes, así que
// aquí no se repite: una sola puerta por sección.

import { ObjetivosMesPanel } from "../../../components/ajustes/ObjetivosMesPanel";

export const dynamic = "force-dynamic";

export default function AjustesObjetivosPage() {
  return <ObjetivosMesPanel />;
}
