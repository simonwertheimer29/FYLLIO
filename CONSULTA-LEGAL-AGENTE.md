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
seudonimizar o retención cero con Anthropic; (4) consentimiento y menores.
