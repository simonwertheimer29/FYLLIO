# Análisis R1 — acuerdo entre la anotación de Simon y la sellada

**Fecha:** 2026-08-13. Simon anotó a ciegas; la sellada (`.esperado.jsonl`) se abrió DESPUÉS.
Regla de método: **la vara es la anotación de Simon**, no la sellada — la sellada existe para
medir acuerdo y localizar fronteras, no para ganar discusiones.

## El número

**Acuerdo exacto: 32/39 (82 %)** sobre las respuestas únicas y definidas. Fuera del cálculo:
3 «?» (casos 4, 25, 46) y 3 respuestas dobles «A/D» (casos 14, 20, 24), que no son indecisión —
son la frontera A/D sin resolver, ver abajo.

## Dónde está el desacuerdo (no está repartido: son tres familias)

**1 · La frontera A/D — la grande.** Sellada D, Simon A: casos **9** (embarazo+implante) y
**23** (color del diente). Y sus tres dobles (14, 20, 24) son todos casos que la sellada también
dudó. Pero Simon mantuvo D en **19** (medicación, «igual hay problema») y **6** («¿me lo tengo que
hacer sí o sí?»). La lectura que hace consistentes sus seis respuestas:

> **D = la respuesta clínica CONDICIONA la decisión de compra o la seguridad del plan** (sin ella
> no se puede avanzar). **A = duda clínica que un doctor contesta después, y mientras tanto la
> conversación puede seguir** (se anota, como el dinero).

No se re-litiga aquí: la tanda conversacional C1 lleva una familia de casos de esta frontera y
**la anotación a ciegas de Simon sobre ellos ES la decisión de producto**, igual que la familia
«¿un intento o dos?» del conjunto viejo.

**2 · Rechazo y desgaste → R, más agresivo que la sellada.** Casos **18** («Al final creo que
no» → R), **16** («mi marido dice que le parece mucho» → R), **49** («opiniones de todo» → R).
Simon quiere una persona pronto cuando el caso se está muriendo — no un cierre administrativo.
Nota para el modelo: esto NO contradice `cierre_pendiente` (el motivo lo anota una persona);
cambia CUÁNDO la ve. ⚠ Posible inconsistencia a retest: **3** («mi hermana le costó menos» → A)
y **16** (→ R) son la misma familia (objeción de precio vía tercero) con respuestas opuestas —
la diferencia puede ser los 8 días y los dos toques del 16 (desgaste), pero conviene un retest.

**3 · Dos sueltos.** **35** («¿Con quién hablo de esto?» tras el enlace del portal → A, sellada
R): para Simon es navegación, no «quiere una persona». Y **1** (¿con IVA o sin? → S, sellada A):
S implica que el agente responde de ley general (sanidad exenta). ⚠ Ojo: la exención NO cubre
todo (estética/blanqueamiento pueden llevar IVA) — la respuesta limpia sigue siendo la columna
`incluye_iva` (MEJORAS 89); hasta que exista, un S aquí obliga a que el prompt distinga
tratamiento sanitario de estético, o se equivocará justo en los caros.

## Qué queda como vara

- **Puntuables: los 32 acordados + los 7 donde manda Simon** (1→S, 9→A, 16→R, 18→R, 23→A,
  35→A, 49→R) = **39 casos con verdad única**.
- **Fuera, pendientes de decisión de producto:** 4, 25, 46 («?») y 14, 20, 24 (frontera A/D).
  Mismo tratamiento que los ⊘ del conjunto viejo: señalados, no borrados.
