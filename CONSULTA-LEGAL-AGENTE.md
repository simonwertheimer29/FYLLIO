# Consulta legal — el agente conversacional (una página, antes de RB)

Lo que el abogado tiene que decidir o confirmar antes del piloto con datos reales. Cuatro
puntos, cada uno con **qué hace hoy el sistema**, **qué implica** y **qué costaría cambiarlo**.
Salen de la auditoría del agente del 2026-09-05 (MEJORAS 127, 147, 148 y 108). Nada de esto se
toca sin la respuesta.

Contexto que lo enmarca: Fyllio trata **datos de salud** (art. 9 RGPD) de pacientes de la
clínica, como **encargado** (art. 28) de la clínica, y usa a **Anthropic** como
sub-encargado para el modelo de lenguaje. El Reglamento europeo de IA está **en vigor desde el
2 de agosto de 2026**.

---

## 1 · Lo que viaja a Anthropic (y la anonimización que no anonimiza)

**Hoy.** Cada mensaje del paciente se manda íntegro a la API de Anthropic para evaluarlo, con
su nombre de pila, los tratamientos y los importes de sus presupuestos, y lo que él escriba
(síntomas, medicación, embarazo). La única «anonimización» del código sustituye el **nombre de
la clínica** por «Clínica A» — y en el camino de producción ni eso, porque el nombre no se pasa.
El modelo es `claude-haiku-4-5` (Anthropic, servidores en EE. UU./UE según región del
contrato); los prompts no se usan para entrenar bajo los términos comerciales de la API.

**Implica.** Anthropic es sub-encargado con acceso a datos de salud. Hace falta: (a) que el
contrato art. 28 con la clínica lo nombre y lo autorice; (b) el DPA de Anthropic firmado y la
base de la transferencia internacional (cláusulas tipo / DPF) documentada; (c) decidir si se
exige **retención cero** (ZDR) en la API — hoy no está activada.

**Costaría.** Papel: DPA de Anthropic + anexo al art. 28 (un día de abogado). Código: nada si
se acepta el flujo; si se exigiera seudonimizar de verdad (nombres, importes, tratamientos
sustituidos por tokens antes de enviar y restaurados después), **dos o tres días** y una
pérdida medible de calidad del agente que habría que remedir con el eval.

## 2 · Retención y borrado de lo que el agente guarda

**Hoy.** Se guardan sin límite de tiempo: los mensajes (`mensajes_whatsapp`), los juicios del
agente sobre cada mensaje (`eventos_automatizacion.evaluacion_json`, que incluye el texto
recogido: «tratamiento_o_molestia: me sangran las encías»), y las frases del paciente que
motivaron un aplazamiento. **No existe ningún camino de borrado**: borrar la ficha del paciente
no toca los mensajes ni los eventos, que van por teléfono y no por id.

**Implica.** Sin política de retención ni mecanismo de supresión, no se puede atender el
derecho de supresión (art. 17) ni cumplir la limitación del plazo de conservación (art. 5.1.e).
El abogado tiene que fijar **cuánto** se conserva (¿la conversación mientras el paciente sea
paciente + N años? ¿los juicios del agente, menos?) y **quién** ejecuta la supresión.

**Costaría.** Un día: un borrado por teléfono (mensajes + eventos + copia en el log de
auditoría), un cron de caducidad con el plazo que se decida, y la anotación de la supresión
sin el contenido. Diseñarlo sin el plazo es diseñarlo dos veces.

**Añadido el 6-sep (pregunta, no problema): el registro de incidencias.** Desde hoy los fallos
técnicos se guardan en nuestra base (`incidencias`): tipo, motivo, origen, el id del mensaje o
cita afectado (nunca el teléfono ni el texto) y un **resumen técnico del error, redactado**: se
eliminan los fragmentos entrecomillados, los correos y las tiras de dígitos, y se trunca a 160
caracteres («invalid input syntax for type integer: "…"», «connect ETIMEDOUT»). Sin ese resumen
una incidencia de base de datos no se puede investigar. Caducan a los 90 días (o al plazo de
conversaciones si es menor) y se borran con el derecho de supresión. **Pregunta:** ¿ese resumen
redactado, unido a un id de mensaje, se considera dato personal y exige algo más que la
caducidad y el borrado ya previstos?

## 3 · Transparencia: decir que es un sistema automático

**Hoy.** Ningún texto que llega al paciente identifica un sistema automático. El agente
redacta; en modo A (el único hoy) **una persona pulsa enviar** y el mensaje sale con la firma
de la clínica. En modo B (previsto) el sistema enviaría solo. Al retomar el caso, la persona se
presenta con su nombre sin decir que antes hablaba un asistente. Las once plantillas de Meta
tampoco lo dicen (y cambiar una plantilla aprobada la devuelve a revisión).

**Implica.** El art. 50 del Reglamento de IA obliga a informar cuando una persona interactúa
con un sistema de IA, salvo que sea evidente. Las preguntas para el abogado: **(a)** en modo
A, con una persona enviando cada mensaje, ¿hay «interacción con un sistema de IA» o es una
herramienta de redacción? **(b)** en modo B, ¿basta decirlo en el primer mensaje de cada
conversación, o también al reanudar tras 24 h y en cada plantilla? **(c)** ¿qué fórmula vale
(«te escribe el asistente automático de la clínica») y dónde va?

**Costaría.** Código: media hora — la frase la escribe código en el primer mensaje del hilo,
como la respuesta de urgencia, y se mide aparte para no mezclarla con la hipótesis H9 (el
mensaje neutro convierte igual). Meta: si va dentro de las plantillas, hay que decidirlo
**antes** de enviar el catálogo, porque reeditar reinicia el reloj de aprobación.

## 4 · Consentimiento y opt-out por WhatsApp

**Hoy.** El opt-out («no me escribáis más») se detecta en la conversación desde el 2026-09-05,
se guarda por teléfono y lo respetan todos los envíos automáticos; contestar a quien escribe
sigue permitido. No hay registro del **consentimiento inicial** para escribir por WhatsApp más
allá de lo que la clínica tenga en papel; Fyllio no lo pide ni lo almacena.

**Implica.** Confirmar que el consentimiento para comunicaciones por WhatsApp lo recoge la
clínica en su alta y que a Fyllio le basta con respetarlo; y si un menor escribe desde el
móvil de un padre, quién consiente (hoy el sistema no distingue, MEJORAS 140).

**Costaría.** Si hay que guardar el consentimiento en Fyllio: una columna con fecha y origen y
un bloqueo de envío sin ella (medio día). El caso del menor: un día, si el abogado dice que hay
que tratarlo distinto.

---

**Lo que necesito de vuelta, en orden:** (1) la fórmula y el momento de la transparencia
(bloquea el catálogo de Meta); (2) el plazo de retención (bloquea el borrado); (3) si se exige
seudonimizar o retención cero con Anthropic; (4) consentimiento y menores; (5) si el resumen
técnico redactado de `incidencias` (§2, añadido el 6-sep) necesita algo más que caducidad y borrado.

---

## 5 · Inventario del 14-09-2026, leído del código (no de memoria)

Actualiza y precisa el §1. **Decisión de producto de Simon: se sigue construyendo sobre el supuesto
de que el agente tiene acceso a todo.** Si la consulta dice que algo no puede salir, se anonimiza en
la capa de envío o se activa la retención cero — **esto no bloquea el producto.**

### 5.1 · La anonimización protege la marca de la clínica, no al paciente

`app/lib/anonimizacion.ts` sustituye **solo el nombre de la clínica** por «Clínica A». Nada más. Su
cabecera lo dice sin querer: «Anthropic nunca ve nombres reales de **clientes**» — y el cliente es la
clínica, no la persona. **El nombre del fichero engaña y hay que decirlo así de claro:** el paciente
nunca estuvo en el alcance de esa función.

Viajan en claro: el hilo entero, el nombre de pila, los importes y el tratamiento del presupuesto. Y
con un desconocido sin nombre de perfil de WhatsApp, la línea enviada es `Persona: +34611997001` —
**el teléfono va en el prompt**.

### 5.2 · Hoy ya mandamos datos de salud de personas identificables

No es un riesgo futuro: es el estado actual. En el prompt viajan el tratamiento de un presupuesto
vivo junto al nombre («Ortodoncia invisible (2.400 €)»), el importe pendiente, y sobre todo **el hilo
entero**, donde la persona escribe sus síntomas y sus miedos con sus palabras («me da mucho miedo la
extracción», «tengo dolor e hinchazón»). Art. 9 RGPD, persona identificable, en producción.

**Meter la ficha cambia el ORIGEN, no la categoría.** Pasaríamos de *lo que la persona escribió
voluntariamente en una conversación* a *lo que su historial clínico dice de ella* (doctor,
tratamiento en curso). Las dos cosas son Art. 9; lo que cambia es el origen y el volumen —contenido
conversacional frente a extracto de historial—. Esa es la pregunta concreta para el abogado.

### 5.3 · Las dos preguntas para Anthropic

La retención cero (ZDR) es una configuración de **organización o workspace**, no un parámetro por
petición: se activa hablando con Anthropic, no tocando código (ingeniería ≈ 0). La retención estándar
son **30 días**. Hay modelos que no admiten ZDR (los Fable/Mythos 5.x devuelven `400` en todas las
peticiones si la org está en ZDR); los que usamos hoy no están en esa lista.

1. **¿Es la retención cero compatible con el CACHÉ DE PROMPTS?** Lo usamos desde el 22-08 —el system
   se cachea, las lecturas cuestan 0,1×— y es parte del coste por turno. Si ZDR lo desactiva, la
   factura sube: hay que saber cuánto ANTES de decidir.
2. **¿Qué condiciones comerciales lleva la retención cero?** Requisitos de cuenta, acuerdo asociado,
   y si condiciona el acceso a modelos futuros.

### 5.4 · Palanca preparada, NO ejecutada: seudonimizar el identificador

El mapa de `anonimizacion.ts` ya es bidireccional (`desanonimizarTexto` restituye en la respuesta) y
hoy solo lleva el nombre de la clínica. Meterle el nombre y el teléfono de la persona son **tres
líneas**, y como el reemplazo es global sobre todo el texto también los taparía **dentro del hilo**.
Resultado: el modelo recibe síntomas y tratamientos **sin un identificador directo pegado** — sigue
siendo dato personal, pero es seudonimización de verdad y baja el riesgo un escalón.

Dos pegas a probar contra el corpus antes: un nombre corto puede colisionar con palabras del texto
(el reemplazo distingue mayúsculas: «Rosa» sí, «rosa» no), y el modelo escribe sobre el alias, que se
restituye a la salida igual que ya se hace con la clínica.

**Queda preparada y sin ejecutar.** Es lo primero que se hace al volver de la consulta.
