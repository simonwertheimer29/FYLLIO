---
name: fyllio-esencia-producto
description: Estándar de PRODUCTO y FLUJOS de Fyllio (CRM dental). Gobierna cómo se PIENSA y DISEÑA cada feature, flujo, automatización o módulo, y actúa como LENTE DE AUDITORÍA del producto ya existente. Úsalo SIEMPRE que se diseñe, proponga, construya, mantenga, arregle O SIMPLEMENTE SE TOQUE cualquier feature, flujo, automatización, módulo o zona del producto — aunque sea un fix pequeño o mantenimiento, para que la lente de auditoría actúe sobre esa zona. Hermano de fyllio-estandar-visual: aquel gobierna cómo se VE; este, cómo FUNCIONA y para qué sirve.
---

# Esencia de producto de Fyllio

Fyllio es un CRM vertical para clínicas dentales. Lo usa una **coordinadora no técnica**,
a menudo desde el móvil entre paciente y paciente. Este estándar es el hermano del
[estándar visual](../fyllio-estandar-visual/SKILL.md): el visual dice cómo se ve; este dice
**qué se construye, para qué, y cómo se piensa el flujo antes de tocar código**.

Regla mental antes de diseñar o tocar nada: **¿esto ayuda a convertir más pacientes, a
perder menos, o a que la coordinadora trabaje con más orden y menos esfuerzo?** Si la
respuesta a las tres es "no", no se construye — por muy interesante que sea.

Este skill también es una **lente**: cada vez que trabajes en una zona del producto, la
evalúas contra los principios 1-5 y **reportas** lo que no cumpla (§6). Nunca ejecutas esas
mejoras por tu cuenta.

## 1. La misión que todo debe servir

Fyllio ordena **todo el flujo del paciente ANTES de ser paciente** —
`lead → presupuesto → conversión`— y **maximiza cuántos se convierten**. Ese es el negocio
de la clínica y el de Fyllio.

Cada feature se justifica contra **tres palancas**, y tiene que servir al menos a una:

1. **Convertir más** — que más leads y presupuestos acaben en tratamiento.
2. **Perder menos** — que ningún caso se quede en el aire (lead sin contactar, presupuesto
   parado, cita olvidada).
3. **Orden y facilidad** — que la coordinadora trabaje con menos pasos, menos memoria y
   menos estrés.

Si una idea no mueve ninguna de las tres, **no se construye** (o se propone eliminarla).
"Es una feature bonita" no es una razón; "reduce presupuestos perdidos" sí lo es.

## 2. "Parece fácil aunque sea difícil"

La complejidad la absorbe **el sistema**, nunca el usuario. Un flujo puede ser dificilísimo
por dentro (scoring, IA, idempotencia, aislamiento) y aun así presentarse como un botón que
la coordinadora entiende sin que nadie se lo explique.

Preguntas **obligatorias** en cualquier flujo, antes de codear:

- ¿La coordinadora lo entiende **sin explicación**? (si necesita un manual, está mal diseñado)
- ¿**Reduce** pasos o los añade? (un flujo nuevo que suma clics tiene que justificarse muy bien)
- ¿Queda claro **qué hace**, **para qué sirve** y **qué pasó** después de usarlo?

El listón es **satisfacción inmediata y cero fricción**. Bien resuelto: arrastrar un lead a
"Citado" **abre solo** el modal de fecha/hora en vez de dejar una cita fantasma
(`LeadsView.tsx:191`). Mal resuelto: pedirle a la coordinadora que pegue un *record ID* de
paciente en una caja de texto (`MotorReglasView.tsx` — "Paciente de prueba").

## 3. Experiencia de lujo: el sistema piensa, la coordinadora ejecuta

La experiencia debe ser **fluida, cómoda y que se anticipa**: la app te dice **la siguiente
acción**, no te obliga a buscarla. El usuario no debería tener que preguntarse "¿y ahora qué
hago con este lead?".

El **modelo de referencia es "Actuar hoy"** (y la cola de intervención de Presupuestos):
el sistema **precalcula** (prioridad, probabilidad de cierre, mensaje sugerido), muestra
**una acción de un clic**, y **confirma qué pasó**. La coordinadora solo ejecuta.

Señales de que una zona alcanza este nivel (ejemplos reales que SÍ lo hacen):

- La cola de Presupuestos ordena por `scoreFinal`, precalcula el mensaje y ofrece "Enviar
  WhatsApp" de un clic (`IntervencionView.tsx:689`, `:242`).
- Al enviar, la card se atenúa y el botón pasa a "WhatsApp enviado" — se ve que funcionó
  (`IntervencionView.tsx:245`).
- El Copilot arranca con plantillas accionables ("Resumen del día", "Cobros vencidos") para
  que la coordinadora no tenga que pensar qué pedirle (`FyllioCopilot.tsx:722`).

Anti-modelo (real): en la cola de leads de "Actuar hoy" la prioridad es un heurístico fijo
disfrazado de IA **y la lista ni siquiera se ordena por ella** (`ActuarHoyView.tsx:227`), y
enviar WhatsApp desde esa card **no da ningún feedback**. Eso no es lujo: es una lista que
no piensa y no confirma.

## 4. Tecnología con propósito (no FOMO interno)

Fyllio usa **la mejor tecnología e IA disponible** — pero **solo cuando sirve a la misión
del §1**. La vanguardia es una **promesa de marca hacia el cliente** ("con Fyllio no se te
pierde nada, vas por delante"), **no** un criterio interno para añadir features novedosas
sin retorno.

- **Primero el problema, luego la tecnología. Nunca al revés.** No se parte de "usemos este
  modelo/esta API nueva" y se busca dónde meterlo; se parte de "este caso se pierde / esto
  cuesta esfuerzo" y se elige la mejor herramienta para resolverlo.
- Una feature con IA que no mueve conversión/orden/facilidad es peor que no tenerla: añade
  superficie, coste y confusión. Ejemplo real de retorno difuso: una "Siguiente acción IA"
  cuyo único botón hace `scrollIntoView` a otro panel (`PatientDrawer.tsx:356`).
- Si algo es IA, cumple además la identidad de IA del estándar visual (icono de chispas +
  azul) y **confirma** lo que hizo (preview + Confirmar, como en el Copilot).

## 5. Checklist antes de construir cualquier feature, flujo o automatización

Antes de escribir código, todo esto tiene que estar en verde:

- [ ] **Sirve a la misión**: convierte más, pierde menos o da orden/facilidad (§1).
- [ ] **Se entiende sin explicación** por una coordinadora no técnica (§2).
- [ ] **Reduce pasos** (o el paso extra está justificadísimo) (§2).
- [ ] **El flujo completo está claro ANTES de codear**: qué **entra**, qué **pasa** por
  dentro, qué **ve** el usuario en cada momento, qué **sale**. Si no lo puedes dibujar en 4
  frases, todavía no está listo para construir.
- [ ] **Genera confianza de que funcionó**: hay feedback visible (toast/estado) coherente
  con el resto de la app.
- [ ] **Es coherente con los flujos existentes**: reutiliza los patrones y servicios que ya
  hay; **no inventa un camino paralelo** para algo ya resuelto (§6 y estándar visual §7).

## 6. Lente de auditoría del producto existente

**El producto actual NO cumple estos principios en todas partes.** Este skill sirve también
para **detectarlo mientras trabajas** — no hay que hacer una auditoría aparte.

**Regla de funcionamiento (obligatoria):** cada vez que toques una zona del producto —
feature nueva, rediseño, mantenimiento o un fix pequeño— **evalúa esa zona contra los
principios 1-5** y reporta lo que no cumpla como una **lista corta de mejoras propuestas**.
Cada propuesta lleva:

- **Qué principio incumple** (misión / facilidad / anticipación / feedback / coherencia).
- **La mejora concreta** que propones (accionable, no vaga).
- **Impacto estimado** en conversión / pérdida evitada / facilidad (alto·medio·bajo, con una
  frase de por qué).

**Nunca ejecutes esas mejoras por tu cuenta.** El protocolo es **detecta siempre, propón
siempre, ejecuta solo lo que el fundador apruebe**. Estás ahí para tocar lo que te pidió;
las mejoras que descubras de paso se **proponen**, no se cuelan en el mismo cambio (evita
diffs enormes fuera de alcance y decisiones de producto sin dueño).

**Dónde se anotan:** toda propuesta que el fundador no apruebe en el momento se registra en
**`MEJORAS-PENDIENTES.md` en la raíz del repo**, para que no se pierda. Formato por entrada:
zona · principio incumplido · mejora propuesta · impacto estimado · fecha. Si el archivo no
existe, créalo; si ya está la misma propuesta, no la dupliques.

### Catálogo de "olores" a buscar (anclado en el producto real)

Úsalo como checklist de auditoría; son incumplimientos reales detectados hoy:

- **Promesa falsa de inteligencia** — algo se presenta como "priorizado por IA" pero es un
  heurístico fijo, o ni siquiera ordena la lista por su propio score
  (`ActuarHoyView.tsx:227`, `:354`). Incumple §1/§3.
- **Acción sin confirmación** — una mutación (enviar WhatsApp, llamar) que no deja rastro de
  que ocurrió. La misma acción tiene **tres feedbacks distintos** según la pantalla: toast en
  el panel (`LeadAccionPanel.tsx:296`), card atenuada en Presupuestos
  (`IntervencionView.tsx:245`) y **nada** en Actuar hoy (`ActuarHoyView.tsx:451`). Incumple §2/§5.
- **"El sistema piensa" vacío** — la "acción sugerida" solo aparece en casos raros; el lead
  recién captado no trae ninguna (`ActuarHoyView.tsx:544`). Incumple §3.
- **Escritura silenciosa sin preguntar** — arrastrar a "No Interesado" fija un motivo por
  defecto sin consultar (`LeadsView.tsx:199`), mientras el caso gemelo en Presupuestos SÍ
  pregunta el motivo (`MotivoPerdidaModal`). Incumple §2/§6.
- **Promete lote, entrega manual** — el "bulk send" obliga a pulsar "Enviar a X" uno por uno
  y abre una pestaña por paciente (`IntervencionView.tsx:328`). Incumple §2/§3.
- **Jerga o IDs crudos en superficie de coordinadora** — pedir un *record ID* en una caja de
  texto (`MotorReglasView.tsx` "Paciente de prueba"), nombres de función crudos en el trace
  del Copilot (`FyllioCopilot.tsx:917`), atajos tipo `Ctrl+Shift+L` expuestos. Incumple §2
  (y el estándar visual §5).
- **Patrones paralelos** (lo más caro a largo plazo) — reinventar algo ya resuelto:
  - **Dos maneras de enviar WhatsApp**: el servicio central con idempotencia/telemetría
    (`mensajeria.ts`) vs ~13 componentes que hacen `window.open("wa.me/…")` a mano.
  - **Tres generadores de mensaje IA** con etiquetas de tono que ni coinciden
    (`IAMensajePanel`, `IAGeneradorDrawer`, editor de `LeadAccionPanel`).
  - **Tres fuentes de "siguiente acción"** distintas para el mismo concepto.
  - Dos cabeceras "Cola de hoy" duplicadas, dos kanban de @dnd-kit distintos, tres sistemas
    de notificación (sonner, `DemoToast`, banners `setError`).
  - Cada patrón paralelo es una propuesta de "unificar en el que ya está bien hecho".

## 7. Cómo trabajar cuando aplicas este estándar

- **Diseña el flujo antes que el código.** Escribe las 4 frases (entra/pasa/ve/sale) y el
  feedback antes de tocar un archivo. Si no cuadran, no empieces.
- **Reutiliza el camino bueno**, no abras uno nuevo: si vas a enviar WhatsApp, generar un
  mensaje IA, mostrar una cola o notificar, usa el servicio/patrón que ya existe y funciona;
  si el que existe es malo, **propón unificar** (§6), no añadas un cuarto.
- **Detecta, propón, no ejecutes.** Las mejoras que veas de paso van a
  `MEJORAS-PENDIENTES.md` y a un resumen para el fundador; solo se implementan las que apruebe.
- **Coordina con el estándar visual.** Este define el *qué/para qué*; el visual, el *cómo se
  ve*. Una feature no está lista hasta cumplir los dos.
- **Ante una decisión de producto no cubierta aquí** (priorizar una palanca sobre otra,
  cambiar un flujo central), **pregunta al fundador** en vez de decidir por tu cuenta.
