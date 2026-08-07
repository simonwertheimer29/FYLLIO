# Conjunto de evaluación del agente

Contra esto pasa **cada cambio de prompt y cada cambio de regla** antes de tocar producción. Es lo
único que separa *creo que ha mejorado* de saberlo, y lo único que detecta que el agente **empeore
sin que nadie se dé cuenta** — la avería silenciosa de este tipo de sistemas: no da error, solo
responde peor.

Fase 1 de [`PLAN-AGENTE.md`](../PLAN-AGENTE.md).

---

## ⚠️ Esto es SINTÉTICO, y hay que no olvidarlo

**Los 50 casos están escritos por nosotros. No hay ni una conversación real.** Censo del 5 de agosto
de 2026: RB e INDEP tienen **cero** mensajes, y los 349 de DEMO son **15 plantillas repetidas** por
el seed, cada una con su intención escrita por el mismo seed que escribió el mensaje. Un clasificador
que las acierte todas no ha demostrado nada.

Se arranca sintético a propósito —esperar al piloto deja la fase 2 bloqueada meses— con tres
condiciones que lo hacen honesto:

1. **Cada caso lleva su `origen`** (`sintetico` / `real`) y **el resultado se reporta por separado**.
   El día que entren conversaciones reales se verá de inmediato si el agente solo sabía aprobar
   exámenes escritos por nosotros.
2. **Quien anota no es quien escribió los casos.** Los casos los escribe Claude; la respuesta
   correcta la anota Simon, **a ciegas**, sin ver ninguna etiqueta ni saber qué se espera. Si el
   mismo que escribe el caso escribe su solución, el eval mide su memoria.
3. **El corpus real se pide en la reunión con RB**, dentro del contrato del art. 28
   (`REUNION-RB-DENTAL.md` §D.2 bis). Si no se pide ahí, no llega.

---

## Cómo se anota

**No se pregunta la etiqueta.** «¿Qué intención es esta?» es una pregunta de taxonomía y cada persona
responde distinto. Se pregunta la decisión, que es la que el producto hace de verdad:

> **¿Esto lo podía contestar el sistema solo, o querías verlo tú?**

Tres respuestas:

| | |
|---|---|
| **A** | Lo podía contestar solo |
| **B** | Quería verlo yo |
| **?** | No lo tengo claro |

**`?` no es una respuesta de segunda.** Es información: marca los casos genuinamente ambiguos, y son
los que ponen el techo real del eval.

---

## El acuerdo humano se mide ANTES que el modelo

Esto es lo que casi nadie hace, y sin ello el resto no significa nada.

**Fiabilidad consigo mismo (test-retest).** Los mismos 20 casos se anotan **dos veces, separadas en
el tiempo** y en orden distinto. Si Simon se contradice en 6 de 20, **el techo del eval es el 70 %**:
exigirle al modelo un 90 % sería exigirle acertar donde la persona que define lo correcto no se pone
de acuerdo consigo misma. Y si eso pasa, la conclusión NO es «Simon anota mal» — es que **esos casos
son ambiguos de verdad**, y eso es un hallazgo sobre el producto, no sobre el anotador.

**Acuerdo entre dos.** Claude anota los mismos casos por su cuenta y **sella su respuesta antes** de
que Simon vea nada (`.esperado.jsonl`). Al comparar salen tres grupos:

- **Coinciden** → caso sólido, entra en el eval con peso completo.
- **Discrepan** → o el caso está mal escrito, o hay una decisión de producto que no está tomada.
  Se discute; no se promedia.
- **Simon marcó `?`** → caso ambiguo declarado. Entra en el conjunto pero **no puntúa**: mide otra
  cosa (si el agente sabe reconocer que no lo tiene claro).

---

## La prueba de que el eval mide algo

**Antes de la primera medición del modelo**, se degrada el prompt a propósito y se comprueba que el
número **baja**:

| Degradación | Qué tiene que pasar |
|---|---|
| Quitar la categoría «Pide oferta/descuento» del prompt | El bloque de **dinero** se desploma; el resto casi no se mueve |
| Intercambiar las descripciones de dos categorías | Baja el total **y suben las confusiones entre esas dos** |
| Truncar el prompt a la mitad | Baja todo |

**Si el número no baja, el eval no mide — y se arregla el eval antes que ninguna otra cosa.** Es el
test del termómetro, no del paciente.

---

## Los casos que quedan fuera a propósito

Cinco casos están anotados «no lo tengo claro» y **se quedan así**: no son casos mal escritos ni
indecisión del anotador — son **decisiones de producto que no se han tomado**, y borrarlas del
conjunto sería fingir que están resueltas.

No puntúan, pero siguen en el corpus **señaladas**, y no son cinco dudas sueltas: son **tres
preguntas**.

**1 · Ambigüedad: ¿un intento o dos?** — casos **11** («Es que claro»), **26** («Lo del otro día»),
**27** («Sí pero no sé»).
El documento de arquitectura dice *«Ambigüedad — **dos intentos** sin entender qué quiere y para»*.
La fase 1 lo implementó con **uno**, el rediseño del 6 de agosto lo dejó como regla directa sin
precisarlo, y estos tres casos son exactamente el filo. **Es la pregunta más rentable de las tres:**
afecta a la cohorte de quiebre entera.

**2 · ¿Dónde acaba la logística y empieza «alguien tiene que enterarse»?** — caso **2** («Voy de
camino, llego cinco minutos tarde», con la cita hoy).
Se reescribió una vez para quitarle una contradicción y **siguió saliendo dudoso**, así que la
ambigüedad no era del texto: avisar de un retraso es logística pura, pero si nadie lo lee, el hueco
se da por perdido. La pregunta no es del clasificador, es de qué hace la clínica con ese aviso.

**3 · ¿Enfriamiento o tono negativo?** — caso **47** («Bueno, ya veremos»).
La misma frase es resignación educada o hartazgo según quién la lea. Toca el disparador de tono
negativo, que es de la fase 2 — así que hoy no se puede resolver ni midiendo.

## Archivos

| | |
|---|---|
| `casos.md` | Los 50 casos **sin etiquetas**. Es lo que lee quien anota |
| `.esperado.jsonl` | La anotación de Claude, **sellada**. No se abre hasta que Simon haya anotado |
| `anotaciones/` | Las respuestas de Simon, una por tanda |

Las tandas: **1A** (20 casos) · **1B** (los MISMOS 20, reordenados, otro día) · **2** (los 30
restantes).
