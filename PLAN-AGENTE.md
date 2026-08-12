# PLAN-AGENTE.md

> **Plan de producto, no hoja de ruta comprometida. Cada fase requiere aprobación antes de arrancar.**
>
> Nada de este documento es una especificación y **nada se implementa sin decisión explícita**
> anotada en [`DECISIONES.md`](DECISIONES.md). De las cinco fases de abajo, **solo la 0 y la 1
> están decididas**; las demás describen lo que se construiría *si* se decide, y las fechas de la
> tabla final son secuencia, no compromiso.

Plan de desarrollo de la capa de automatización de Fyllio. Cinco fases, cada una con qué se espera ver y cómo se pone a prueba.

Complementa a [`docs/arquitectura-agente-quiebre.html`](docs/arquitectura-agente-quiebre.html)
(dónde está el punto de quiebre) y
[`docs/arquitectura-app-automatizacion.html`](docs/arquitectura-app-automatizacion.html)
(cómo se reorganiza la aplicación). Los dos se abren en el navegador; son documentos de
discusión y no forman parte de la aplicación.

**Fecha:** 1 de agosto de 2026. **Añadido al repo:** 3 de agosto de 2026.

---

## Dónde encaja este documento

Tres archivos y tres preguntas distintas. Si algo de aquí contradice a los otros dos, mandan ellos:

| Documento | Responde a |
|---|---|
| [`MERCADO.md`](MERCADO.md) | **Por qué** esto tiene sentido: la evidencia, las hipótesis y lo que aún no sabemos |
| [`DECISIONES.md`](DECISIONES.md) | **Qué** se decide y qué se arregla. Una fase pasa a estar decidida cuando aparece ahí, no aquí |
| **Este plan** | **Qué se construiría** si se decide, en qué orden y cómo se pone a prueba |
| [`PLAN-AGENTE-OFENSIVO.md`](PLAN-AGENTE-OFENSIVO.md) | **Cómo se comporta** el agente (reactivo → orientado a objetivo) y qué arrastra en la app. Manda en comportamiento; este manda en orden y dependencias |

Lo detectado pero no aprobado sigue yendo a [`MEJORAS-PENDIENTES.md`](MEJORAS-PENDIENTES.md).

---

## Estado de las fases

| Fase | Qué es | Estado |
|---|---|---|
| **0** · El trámite | Registro fiscal, Meta Business, número de prueba, plantillas | ✅ **Decidida** — bloqueante declarado en [`ESTADO.md`](ESTADO.md) |
| **1** · Estado de automatización y cola de quiebre | La tercera coordenada de cada caso, su cohorte en Seguimiento, **la tasa de coincidencia agente-humano** y **el conjunto de evaluación** | ✅ **Decidida** — no depende de WhatsApp |
| **2** · Clasificador completo + simulador | **Enganchar el clasificador de leads** (existe; solo falta el disparador — medio día) y **los 3 disparadores que faltan**, ambos medidos contra los evals. Más el simulador | ⬜ **No decidida** |
| **3** · Modo B — el agente envía lo rutinario | **Conectar** el envío/recepción (ya construidos) y **construir el catálogo de 11 plantillas** | ⬜ **No decidida** — reescrita el 3 ago tras censar el código |
| **4** · Modo C, configuración e **entrenamiento continuo** | Autonomía hasta el quiebre, matriz por intención, y el bucle que aprende de las correcciones **sin cobrar por configurar**. El **cambio de modelo del agente** (reactivo → orientado a objetivo) vive en [`PLAN-AGENTE-OFENSIVO.md`](PLAN-AGENTE-OFENSIVO.md), y **sus fases A-F corren en modo A: no esperan a Meta** | ⬜ **No decidida** |
| **5** · Tech Provider y alta de clientes | Embedded Signup, una WABA por clínica | ⬜ **No decidida** |

---

## El principio que ordena las fases

**Nada de lo que se construye en las primeras fases depende de que WhatsApp funcione.** El trámite de la API corre en paralelo y no bloquea nada hasta la fase 3. Esto es deliberado: el trámite tiene plazos que no controlas, y no puedes tener el desarrollo esperando a Meta.

Y hay una consecuencia buena: **la fase 1 mejora el modo A, que ya funciona hoy.** Aunque el agente no envíe nada nunca, la coordinadora gana un sitio donde ve qué exige criterio y qué no.

---

## Fase 0 · El trámite — empieza hoy, corre solo

**Decidida.** No es desarrollo. Es lo único que tiene plazos ajenos, así que arranca antes que nada.

**Qué hay que hacer, en orden:**

1. **Comprobar la situación fiscal.** Meta acepta para España el Modelo 036/037 con NIF. Si no estás dado de alta como autónomo ni tienes Fyllio S.L. constituida, **este es el camino crítico de todo el proyecto**, no el código.
2. **Email de dominio propio.** Meta rechaza o retrasa las verificaciones hechas con Gmail. Necesitas `algo@fyllio.com` — lo que enlaza con el pendiente del dominio, que ya estaba en la lista por otra razón.
3. **Crear la cuenta de Meta Business** con el nombre legal exacto, la dirección fiscal exacta y el NIF. Cualquier discrepancia con los documentos es rechazo automático.
4. **Coger el número de prueba** — gratis, inmediato, con una plantilla ya aprobada y hasta 5 destinatarios. Sirve para desarrollar y para demostrar.
5. **Enviar las plantillas de utilidad a aprobación.** Gratis. La aprobación va de minutos a 48 h y la mayoría en menos de 24. Son **once**, todas de utilidad —la categoría más barata y la que menos se rechaza— y están listadas con su cadencia y sus variables en el **catálogo de plantillas de la fase 3**. Es el paso que marca el calendario, así que se envían el primer día aunque el resto no esté.
6. **Verificación de empresa.** Cuando el paso 1 esté resuelto. Sin ella: 250 destinatarios únicos por 24 h y solo plantillas de utilidad y autenticación — que para un piloto de una clínica es suficiente.

**Dónde corta de verdad la dependencia** (importa para no declarar un bloqueo más grande del que es):

**Sin registro fiscal se puede hacer todo esto:** crear la app de Meta Business, obtener el número
de prueba con su plantilla ya aprobada, montar el webhook y **enviar y recibir mensajes reales a
cinco destinatarios**. Es decir: **se puede construir la fase 3 entera**, probarla de punta a punta
y demostrarla. El desarrollo no espera a Hacienda ni un día.

**El alta fiscal desbloquea exactamente tres cosas, ninguna de ellas de código:**

1. La **verificación de empresa** de Meta.
2. El **número de teléfono real** de la clínica (el de prueba no vale para pacientes).
3. **Salir del límite de 250 destinatarios únicos / 24 h** y entrar en el escalado de tiers.

Y por dependencia, la fase 5 (Tech Provider) también. Traducción: sin registro fiscal se construye
y se demuestra todo; lo que no se puede es **atender pacientes reales a escala**. Por eso está
declarado como bloqueo con dependencia en [`ESTADO.md`](ESTADO.md) — del piloto, no del desarrollo.

**Qué se espera ver:** un mensaje enviado desde Fyllio y recibido en un WhatsApp real, aunque sea a tu propio número.

**Cómo se pone a prueba:** enviar la plantilla de prueba a tu móvil y recibir la respuesta en el webhook.

---

## Fase 1 · El estado de automatización y la cola de quiebre

**Decidida.** No depende de WhatsApp ni del trámite.

**Lo que se construye:** la tercera coordenada de cada caso — quién lo lleva — y su consecuencia en la cola de trabajo.

- Estado de automatización por caso: **esperando · quebrado · en manos de alguien · agotado · manual · cerrado**. Seis, no siete — ver el alcance de abajo.
- **La cohorte de quiebre en Seguimiento**, primera y arriba, con el motivo escrito: *«pregunta si hay descuento»*.
- Distintivo visual del estado en cada tarjeta, en todas las ventanas.
- **Devolver al agente o quedárselo**, con registro de quién decidió qué.
- **El estado «agotado»**: cuando la cadencia se acaba sin respuesta, el caso pasa a la cola con la llamada telefónica como acción recomendada.
- **La tasa de coincidencia agente-humano** — ver abajo.
- **El conjunto de evaluación** — ver abajo.

**Por qué esta fase primero:** mejora el modo A que ya existe. Hoy el producto genera mensajes y la coordinadora los envía; con esto, además, sabe cuáles puede mandar sin pensar y cuáles exigen que se pare a leer.

### Alcance cerrado el 5 de agosto de 2026, tras censar el código

Tres recortes, los tres decididos con el censo delante y no de memoria:

**1 · «Trabajando» no entra.** Significaba «tiene el siguiente toque programado», y en modo A **no
hay nada que programe un toque**. Un estado que ningún dato puede producir es una promesa falsa en
pantalla — lo mismo que ya se retiró tres veces este año (los scores del predictor, el «precisión
0 %»). Entra en la fase 3, cuando exista la cadencia que lo produce. **Quedan seis estados.**

**2 · El quiebre corta con tres disparadores, y el producto lo dice.** La clasificación de intención
que ya existe cubre **dinero** (pide oferta/descuento, acepta pero pregunta pago), **criterio
clínico** (duda sobre tratamiento) y **ambigüedad** (sin clasificar). **Queja, pide persona y tono
negativo no se detectan**, porque el enum del clasificador responde a *«¿acepta el presupuesto?»* y
no a *«¿qué necesita esta persona?»*.

Se declara **en pantalla, no solo aquí**: si la coordinadora cree que el sistema caza quejas y no las
caza, es peor que si sabe que no las caza — deja de leer los mensajes que el sistema no marcó.
Ampliar a los seis va en la **fase 2**, después de los evals: tocar el prompt del clasificador sin el
conjunto de evaluación montado contradice esta misma fase.

**3 · Cobros recibe el distintivo, no la cola.** Seguimiento tiene hoy dos dominios (Leads y
Presupuestos) con su partición vigilada; cobros es una pantalla aparte. Meterlo en la cola es la
reorganización de cuatro ventanas, que va al final.

**4 · El quiebre por intención es SOLO de presupuestos. Los leads no quiebran por intención.**

Esto no es una decisión de alcance: es lo que hay. El webhook de WhatsApp, al recibir un mensaje de
un lead activo, lo persiste, lo anota en el timeline y **vuelve sin clasificar**
(`api/webhooks/whatsapp`). Cuando un lead responde no queda `intencion_detectada` nueva que leer, así
que no hay nada que pueda disparar un quiebre.

> **Corregida la CAUSA el 5 de agosto de 2026.** Aquí ponía que «esa mitad no se construyó». **Es
> falso, y en la dirección cara:** el clasificador de leads existe, tiene su propio enum de seis
> categorías y está en producción — lo que pasa es que **solo se dispara a mano**, desde el botón de
> IA del panel. No es que falte construirlo: es que **no está enganchado al webhook**. Son medio día
> de trabajo, no una fase, y el detalle está en la fase 2.
>
> La consecuencia práctica no cambia —en la fase 1 un lead no quiebra por intención— pero la
> estimación sí, y por eso se corrige: quien planificara contra la versión anterior habría
> presupuestado construir de cero algo que ya está escrito.

**Qué significa en la práctica, y hay que saberlo antes de probar:**

| | Presupuestos | Leads |
|---|---|---|
| Quiebre por **intención** (dinero, criterio clínico, ambigüedad) | ✅ | ❌ **no ocurre** |
| Entrada a la cola por **estado de conversación** | ✅ | ✅ |
| Entrada a la cola por **agotamiento** | ✅ | ✅ |
| Distintivo de estado en la tarjeta | ✅ | ✅ |

**Está escrito aquí porque si no, dentro de tres semanas alguien prueba el quiebre en un lead, no
pasa nada, y concluye que está roto.** No está roto: nunca se construyó esa mitad. Clasificar
respuestas de leads es trabajo propio —el enum actual responde a «¿acepta el presupuesto?», que no
es la pregunta de un lead— y va con la ampliación a los seis disparadores en la **fase 2**.

En pantalla se declara igual que los tres disparadores: la cola de leads no promete un quiebre que
no puede producir.

### Lo que se persiste, y por qué es lo único que se persiste

De los seis estados, **cuatro se derivan enteros** de datos que ya existen —`esperando` de
`estadoConversacion`, `agotado` de `reactivable` + los contadores de toques, `manual` de la
configuración, `cerrado` del estado del caso— y el quiebre deriva su *condición* de
`intencion_detectada`, ya persistida.

**Lo único que ningún dato existente puede producir es la decisión humana**: quién cogió el caso,
cuándo, y qué eligió al terminar. Eso va a **una tabla append-only**, no a una columna de estado.

**Por qué log y no columna:** una columna tendría que mantenerse en sincronía con seis señales que
cambian solas — llega un mensaje del paciente y el estado de conversación cambia sin que nadie
escriba nada, y la columna se queda mintiendo hasta que algo la reescriba. Es exactamente la
divergencia que este proyecto ya ha pagado. Un log solo acumula decisiones; el estado se **calcula**
como *derivado + último evento humano*.

**Campos nuevos, en total: una tabla y una columna de configuración**
(`toques_antes_de_agotar`, que es una decisión de la clínica y no deriva de nada).

### Cómo entra el quiebre en Seguimiento sin romper `qa:cohortes`

La invariante de partición se sostiene sobre un `switch` **exhaustivo** de `EstadoConversacion`.
El quiebre **no es un valor de ese tipo** —un caso quebrado es *además* `pendiente_responder`—, así
que añadirlo como quinto caso rompería la totalidad.

Entra como **precedencia por encima del switch**, que es el mecanismo que el módulo ya usa con
«citados»: *quebrado → citados → switch(conversación)*. El switch queda intacto y sigue siendo la
rama por defecto. Ningún caso en dos sitios (la función es total y ordenada), ninguno en ninguno
(el switch sigue cubriendo los cuatro estados). El caso quebrado **conserva su estado de
conversación** y la tarjeta pinta los dos.

### La tasa de coincidencia agente-humano

**El modo A tiene que medir, no solo preparar.** Hoy el agente redacta y la coordinadora envía, y
no queda rastro de qué pasó por el medio. Falta capturar, en cada envío, cuál de estas tres cosas
ocurrió:

- **Enviado tal cual** — el agente acertó.
- **Editado** — acertó el fondo, falló la forma. Se guarda también el texto final, que es la
  corrección con la que se mejora el prompt.
- **Reescrito entero o descartado** — el agente no servía para este caso.

Se implementa como **un campo en el momento de enviar** (comparación del texto sugerido con el
enviado, más la elección explícita cuando la coordinadora descarta) **y su contador agregado por
intención**. Por intención, no global: una tasa media del 70 % puede esconder un 95 % en
recordatorios y un 30 % en cualquier cosa que roce el precio, y son decisiones distintas.

**Para qué sirve exactamente:** es **el criterio objetivo que decide cuándo se puede subir de
modo**. Sin ella, pasar de A a B es una corazonada — y la corazonada se toma justo cuando más
ilusión hace y menos evidencia hay. Con ella, la conversación con la clínica deja de ser «¿te
fías?» y pasa a ser «de los últimos 200 recordatorios que preparó, mandaste 191 sin tocar una
coma». Enlaza con la matriz de la fase 4: cada celda tiene su umbral.

### El conjunto de evaluación

**Los evals entran aquí, no después.** Un conjunto de **30-50 conversaciones reales** —anonimizadas,
del propio histórico— con **la respuesta correcta anotada a mano**: qué debía hacer el agente
(responder / quebrar / callar), con qué intención clasificada y, cuando toca responder, qué debía
decir en lo esencial.

Contra ese conjunto pasa **cada cambio de prompt y cada cambio de regla**, antes de tocar
producción. No es opcional ni es «cuando haya tiempo»: es lo único que separa *creo que ha
mejorado* de saberlo, y **es lo único que detecta que el agente ha empeorado sin que nadie se dé
cuenta** — que es la avería silenciosa de este tipo de sistemas, porque no da error, solo peores
respuestas.

Construirlo en la fase 1 es barato (el histórico ya está en `mensajes_whatsapp` y las intenciones
ya se clasifican) y construirlo después es caro: cada semana sin evals es una semana de cambios de
prompt cuyo efecto real nadie puede reconstruir.

**Qué se espera ver:** abrir Seguimiento y que lo primero sean los casos que necesitan criterio humano, con el motivo, ordenados por dinero. Y que la barra del día se mueva. Y, en ajustes, la tasa de coincidencia por intención con su histórico.

**Cómo se pone a prueba:**
- Censo: todo caso activo tiene exactamente un estado de automatización, ninguno en dos, ninguno sin.
- Inyectar respuestas con cada uno de los seis disparadores universales y verificar que el caso quiebra.
- Inyectar respuestas neutras y verificar que **no** quiebra.
- Agotar una cadencia y verificar que aparece la recomendación de llamada.
- Devolver al agente y verificar que la cadencia se reanuda donde estaba.
- **Coincidencia:** enviar tal cual, editar y descartar tres mensajes preparados, y verificar que cada uno cae en su categoría y que el contador de su intención se mueve. Y que un mensaje escrito de cero por la coordinadora, sin sugerencia previa, **no** cuenta en el denominador.
- **Evals:** el conjunto corre entero por línea de comandos y da un número. Se degrada el prompt a propósito y el número **tiene que bajar** — si no baja, el eval no mide nada y hay que rehacerlo antes de fiarse de él.

---

## Fase 2 · El simulador

**No decidida.** Requiere aprobación explícita antes de arrancar.

**Lo que se construye:** dos cosas — la ampliación del clasificador a los seis disparadores, y el simulador.

### Enganchar el clasificador de leads — medio día, no una fase

> **Corregido el 5 de agosto de 2026 tras leer el código.** Esta sección decía que había que
> construir la clasificación de leads. **Es falso: ya existe, funciona y está en producción.**

`/api/leads/intervencion/clasificar` clasifica respuestas de leads con su **propio enum de seis
categorías**, distinto del de presupuestos a propósito y cerrado en el Sprint 10:

`Interesado` · `Pide más info` · `Pregunta precio` · `Pide cita` · `No interesado` · `Sin clasificar`

Persiste `intencion_detectada`, `accion_sugerida` y `mensaje_sugerido`, deja log en `acciones_lead`,
y `LeadAccionPanel` ya actúa sobre el resultado (si la intención es «Pide cita» y no hay fecha,
recomienda agendar). En DEMO hay **268 leads clasificados**.

**Lo único que falta es el disparador.** El clasificador **solo se ejecuta cuando la coordinadora
pulsa el botón de IA en el panel**. El webhook, al recibir un mensaje de un lead activo, lo guarda,
lo anota en el timeline y **hace `return` sin clasificar**. Enganchar la llamada dentro del `after()`
que ya existe para presupuestos es **medio día**.

Y el enum **no hay que rediseñarlo**: la premisa de que «las preguntas de un lead no son las de un
presupuesto» ya está resuelta en el código. Para el quiebre, el de leads cubre incluso **más** —
`Pregunta precio` → dinero, `Pide más info` → criterio clínico— aunque sigue sin cubrir queja, pide
persona ni tono negativo.

**El riesgo real no es construirlo: es encenderlo sin poder medirlo.**

Clasificar en el webhook significa **una llamada al modelo por cada mensaje entrante de lead,
automática y sin que nadie la pida**, que **reescribe `intencion_detectada` sin supervisión humana**.
Hoy ese campo solo cambia cuando una persona pulsa un botón y ve el resultado; encendido, cambia
solo, en cientos de leads, y es el campo del que cuelgan las recomendaciones del panel.

Un cambio de prompt que degrade la clasificación **empeoraría cientos de leads en silencio**: no da
error, no rompe nada, solo recomienda peor. Esa avería es indetectable sin un conjunto de evaluación
— y por eso esto va **después** de los evals de la fase 1, no antes. No es una cuestión de orden
estético: sin evals no hay forma de saber si el cambio mejoró o empeoró.

### Los tres disparadores que faltan

**Queja, pide persona y tono negativo** no los detecta ninguno de los dos enums. Ampliarlos es el
trabajo de verdad de esta fase, y va con la misma condición: **con los evals delante**.

**Cómo se pone a prueba:** el conjunto de evaluación gana casos de queja, petición de persona y tono
negativo con su respuesta correcta anotada, y **la ampliación no se da por buena hasta que el número
sube sin que baje el de los que ya funcionan**. Y el aviso en pantalla de «esto todavía no se
detecta» desaparece **en el mismo cambio** que lo hace detectable — ni antes ni después.

### El simulador

Un modo demostración donde un caso recorre el embudo entero delante de quien mires, con interacciones que no son reales pero sí realistas.

- Lanzas un caso y lo ves avanzar: el agente escribe, el paciente responde, el agente sigue.
- **Tú eliges qué responde el paciente** de una lista de respuestas típicas, para enseñar cada rama: el que acepta, el que pregunta precio, el que no contesta nunca, el que se queja.
- Cada rama enseña qué hace el sistema: sigue, quiebra, agota, recomienda llamar.
- Velocidad acelerada: dos minutos para ver lo que en la vida real son tres semanas.

**Por qué importa:** es lo que te permite vender la automatización antes de tenerla operativa. Un cliente no compra «tenemos un agente»; compra ver cómo su paciente típico atraviesa el embudo y dónde le avisa el sistema.

**La regla innegociable:** el simulador declara siempre que es una simulación. En pantalla, no en el discurso. Un demo que finge ser real es exactamente lo que llevamos meses eliminando del producto.

**Qué se espera ver:** en una reunión, coger un caso, lanzarlo, y que el cliente vea el ciclo completo con sus cuatro o cinco desenlaces distintos.

**Cómo se pone a prueba:** cada rama del árbol de decisión tiene su caso simulable y ninguna rama queda sin cubrir. Si el árbol tiene un camino que el simulador no puede enseñar, es que ese camino no está diseñado.

---

## Fase 3 · Modo B — el agente envía lo rutinario

**No decidida.** **Depende de:** el número de prueba de la fase 0 (no del alta fiscal) y de las plantillas aprobadas.

> **Reescrita el 3 de agosto de 2026 tras censar el código.** La versión anterior decía «se
> construye el envío y la recepción reales». Era falso en las dos direcciones a la vez: estimaba
> **de más** lo que faltaba construir y **de menos** lo que faltaba de verdad. El censo está en
> [`DECISIONES.md`](DECISIONES.md).

### Lo que YA está construido y solo hay que conectar

Poniendo las seis variables de entorno (`WABA_PHONE_NUMBER_ID`, `WABA_BUSINESS_ACCOUNT_ID`,
`WABA_ACCESS_TOKEN`, `WABA_VERIFY_TOKEN`, `META_APP_SECRET`, `WABA_ENABLED`) funciona **sin tocar
código**:

| Pieza | Dónde |
|---|---|
| Envío de texto por Graph API v21.0, con idempotencia, rate-limit y telemetría | `lib/presupuestos/mensajeria.ts` → `ServicioMensajeriaWABA` |
| Webhook completo: challenge, firma HMAC con `timingSafeEqual`, deduplicación atómica por `WABA_message_id`, persistencia **antes** del 200, IA diferida con `after()` | `api/webhooks/whatsapp/route.ts` |
| Matching del entrante: teléfono → presupuesto (gana) → lead activo → huérfano | *ídem* |
| Clasificación de intención + notificación + subida a la cola de intervención | *ídem* |
| El conmutador manual/WABA, ya cableado en la interfaz | `IntervencionSidePanel` · `LeadAccionPanel` |
| Health check real del número y detección de token caducado | `api/presupuestos/configuracion-waba` |

**El punto de extensión ya está abierto:** `getServicioMensajeria(modo)` con dos implementaciones de
la misma interfaz y el modo en `configuracion_automatizaciones.modo_whatsapp`. No hay que abrirlo.

### Lo que falta de verdad

0. ~~**Normalizar el teléfono a E.164.**~~ ✅ **Hecho el 3 de agosto, adelantado a la fase 0** —
   no esperaba a la fase 3 porque el fallo solo se ve en el primer envío a un paciente real, que
   es el peor momento para descubrir que la carga del cliente venía sin prefijos. `lib/telefono` es
   ahora la única verdad del formato y se aplica en la **frontera de escritura** (crear y actualizar
   paciente y lead, y el importador `upsertPacienteImportPorTelefono`), no en el envío: así cubre
   cualquier importador que se escriba después sin que nadie tenga que acordarse. Lo que no se puede
   afirmar se marca **dudoso y se conserva tal cual** — no se inventa un país. **Queda una cosa por
   hacer, y es de datos, no de código:** correr `npm run qa:telefonos` contra el entorno real y
   arreglar lo ya guardado. Es requisito de entrada a la fase 3.
1. **El catálogo de plantillas — la pieza cara, y es su propia sección.** Ver abajo.
2. **Conectar la cadencia al envío.** Hoy nada programa un toque: el motor de reglas tiene
   `ejecutarEnviarWA` como esqueleto honesto que devuelve `pendiente_integracion` y nunca `success`
   (`WA_ENGINE_OPERATIVO = false`). Hay que enganchar el cliente WABA real y **borrar el esqueleto**,
   no dejar los dos.
3. **Multi-cliente en el webhook.** `resolveClienteFromWebhook` compara contra un único
   `phone_number_id` de entorno. Con el número de prueba basta; con dos clínicas, no.
4. **Cerrar el `fail-open` del rate limit.** Si la consulta a Postgres falla, hoy deja pasar. Con
   cuota real de Meta eso cuesta dinero.

### El catálogo de plantillas

**Es la pieza que el plan no mencionaba y la que marca el calendario**, porque no depende de
nosotros: la aprueba Meta.

**Por qué es imprescindible, y no un detalle de implementación.** WhatsApp solo deja escribir texto
libre **dentro de las 24 h siguientes al último mensaje del paciente**. Fuera de esa ventana solo
sale una plantilla aprobada. Y **todo lo que hace este producto empieza fuera de la ventana**: un
recordatorio de cita, un toque de seguimiento, un aviso de vencimiento — el paciente no ha escrito
nada. Traducción: **la plantilla es lo que abre la conversación, y el texto libre del agente solo
vive dentro de la ventana que la plantilla abrió.** Todo lo construido hoy asume la ventana ya
abierta.

**La consecuencia de producto, que hay que decidir antes de escribir el catálogo:** una plantilla es
un texto **fijo con variables**, aprobado de antemano. El mensaje personalizado que la IA redacta hoy
**no puede ser el primer toque de una cadencia**. Ya está anotado en MEJORAS #5B. El patrón que
funciona: *plantilla neutra que abre → el paciente responde → ahí sí, el agente conversa libre*.

**Y se cruza con la restricción de datos de salud** (art. 9 RGPD, anexo): **ninguna plantilla puede
nombrar el tratamiento ni el importe.** Todas apuntan al portal, donde el paciente se identifica.
Eso es lo que mide la hipótesis **H9** de [`MERCADO.md`](MERCADO.md).

#### Qué cadencia usa qué plantilla

**Escritas y revisadas el 7 de agosto de 2026 en [`PLANTILLAS-WHATSAPP.md`](PLANTILLAS-WHATSAPP.md)**,
con su texto completo, sus variables con ejemplos y qué conversación abre cada una. El texto está
**aprobado por Simon**: es criterio de negocio, no técnico.

> 🔴 **Y desde el 12 de agosto son DOS dependencias, no una.** Además del alta fiscal, el texto
> depende de la **consulta legal del Reglamento europeo de IA**: si la fórmula de transparencia va
> dentro de la plantilla, no se puede enviar el catálogo antes de saber qué dice — cambiar una
> aprobada es una **reedición que vuelve a revisión de Meta**. La consulta **no depende de Hacienda**
> y se puede lanzar hoy, así que las dos corren en paralelo. Ver la tabla de bloqueos de
> [`ESTADO.md`](ESTADO.md).
>
> ⏸️ **Tenerlas escritas NO adelanta plazo, y conviene no confundirlo.** Enviarlas a aprobación exige
> una cuenta de Meta Business con el nombre legal y el NIF, así que **el reloj de Meta no ha empezado
> a correr y no empieza hasta que se resuelva el alta fiscal**. Lo que se ha ganado es que ese día el
> envío sea de horas y no de días. Planificar la fase 3 contando con que la aprobación ya está en
> marcha daría una fecha falsa.
>
> **Ninguna está bloqueada por datos.** `seguimiento_sigue_vigente` sí lo estuvo —necesitaba el plazo
> de validez del presupuesto, que no existe ([MEJORAS 89](MEJORAS-PENDIENTES.md))— y se reescribió sin
> él en la revisión, para que las once salgan el mismo día. Cuando llegue el dato se puede afinar, y
> afinarla es **una reedición que vuelve a revisión de Meta**, no un cambio en caliente.
>
> **El tono está decidido y no es configurable: se tutea** (`DECISIONES.md`, 7 ago). Meta aprueba
> textos, no tonos, así que ofrecer el usted por clínica son **once plantillas más pasando revisión**,
> no una casilla en Ajustes. Dentro de la ventana de 24 h el agente sí puede adaptar el registro.

Resumen de las once (el detalle, en el catálogo): Todas son de categoría **utilidad** (la más barata y
la que menos se rechaza), todas en español, ninguna nombra tratamiento ni importe:

| Cadencia | Toque | Plantilla | Variables | Abre ventana para |
|---|---|---|---|---|
| **Cita** | 48 h antes | `recordatorio_cita_48h` | nombre · clínica · fecha · hora | reagendar, cancelar, preguntar |
| **Cita** | 24 h antes | `confirmacion_cita_24h` | nombre · fecha · hora | confirmar asistencia |
| **Cita** | al reagendar | `cita_reagendada` | nombre · fecha · hora nuevas | confirmar |
| **Cita** | hueco liberado | `hueco_disponible` | nombre · fecha · hora | aceptar el hueco |
| **Presupuesto** | toque 1 (~3 días) | `seguimiento_info_disponible` | nombre · clínica · enlace portal | **toda la conversación de la cadencia** |
| **Presupuesto** | toque 2 (~10 días) | `seguimiento_sigue_vigente` | nombre · clínica · enlace | dudas, precio → **quiebre** |
| **Presupuesto** | toque 3 / reactivación | `reactivacion_sin_reproche` | nombre · clínica · enlace | reabrir el caso |
| **Cobro** | 3 días antes | `pago_proximo` | nombre · fecha · enlace portal | aplazar → **quiebre** |
| **Cobro** | al vencer | `pago_vencido` | nombre · enlace portal | negociar → **quiebre** |
| **Cobro** | al recibir | `pago_recibido` | nombre | agradecer, siguiente paso |
| **Lead** | lead de formulario | `lead_primer_contacto` | nombre · clínica · **origen** | **toda la captación** |

**Once plantillas.** Las cuatro de cita y `pago_recibido` son las que menos riesgo de rechazo tienen;
las de seguimiento y cobro son las delicadas de tono.

**El coste real, que es de calendario y no de código:**

- Escribir y categorizar las once: **medio día**. Es redacción, y la ortografía impecable y el
  objetivo único por mensaje son lo que evita el rechazo.
- Enviarlas a aprobación: gratis. **De minutos a 48 h**, la mayoría en menos de 24.
- **La causa nº 1 de rechazo es la categoría equivocada, no el contenido.** Once plantillas de
  utilidad bien categorizadas deberían pasar; presupuestar igualmente **una ronda de rechazo y
  reenvío**.
- Una vez aprobada, se puede editar **10 veces en 30 días**. Reenviar una rechazada sin cambiarla a
  fondo **penaliza la calidad de la cuenta** — no se itera a lo bruto.
- **En código**, en cambio, es barato: `enviarPlantilla` ya está implementado en `mensajeria.ts` y
  hoy tiene **cero llamadas**. Falta el catálogo (nombre aprobado ↔ plantilla de Fyllio ↔ variables)
  y llamarlo desde la cadencia. **Uno o dos días.**

**Estimación honesta de la fase 3 entera:** ~**1 semana de código** (catálogo, cadencia, los cuatro
arreglos de arriba) **más el tiempo de Meta**, que corre en paralelo y conviene empezar el primer
día. Lo que no cabe es dar por hecha la aprobación en una fecha comprometida con un cliente.

**Qué se espera ver:** un paciente real recibe un recordatorio que nadie escribió, responde, y su respuesta aparece clasificada en la cola de la coordinadora — con el hilo entero, plantilla y texto libre juntos.

**Cómo se pone a prueba:**
- Con el número de prueba y 5 destinatarios controlados, recorrer los seis disparadores en conversaciones reales.
- **Que ningún mensaje salga sin plantilla aprobada fuera de la ventana de 24 h.** Se prueba al revés, que es como se prueba de verdad: forzar un envío de texto libre con la ventana cerrada y verificar que el sistema **se niega**, en el servidor. Si solo se niega la interfaz, no está probado.
- **Que ninguna plantilla del catálogo nombre tratamiento ni importe.** Invariante automática sobre el catálogo, no revisión a ojo: el día que alguien añada la número doce, tiene que romper.
- Que un fallo de envío **no** marque el caso como enviado, y que un fallo *sin respuesta* de Meta no dispare un reintento (mismo criterio que `EnvioWhatsAppError`).
- Que el teléfono sale en E.164 con prefijo: `npm run qa:telefonos` **en verde sobre los teléfonos reales del cliente**, no sobre los del seed. Distingue «no pude comprobar» (salida 2) de «comprobé y está mal» (salida 1), así que un entorno mal configurado no puede pasar por aprobado.

---

## Fase 4 · Modo C y configuración por clínica

**No decidida.** Requiere aprobación explícita antes de arrancar.

**Lo que se construye:**
- El agente autónomo hasta el quiebre en lo que la clínica autorice.
- **Los tres modos A/B/C, que hoy NO existen** — censado el 5 ago de 2026. Lo único que hay es
  `modo_whatsapp: manual | waba`, que es el **transporte** (enlace de WhatsApp frente a envío por
  API), no la autonomía. La sección 05 de `arquitectura-app-automatizacion.html` los daba por
  construidos y era falso; queda corregida.
- **La matriz de configuración**: **intención × modo**, agrupada por fase. Ver abajo.
- **El entrenamiento continuo**, que es producto y no servicio. Ver abajo.
- Cadencias, umbrales y horarios configurables.
- Disparadores propios que se pueden añadir — nunca quitar los de dinero ni los clínicos.

### El cambio de modelo: de reactivo a orientado a objetivo

> **Desarrollado en [`PLAN-AGENTE-OFENSIVO.md`](PLAN-AGENTE-OFENSIVO.md) (12 ago 2026), que es el
> documento que manda en el comportamiento del agente.** Aquí queda el resumen y su encaje con las
> fases; el detalle vive allí. Si los dos divergen, manda el otro — dos versiones del mismo modelo
> es el patrón paralelo de siempre, aplicado a documentos.

Hasta aquí, todo lo diseñado describe un agente que **reacciona**: llega un mensaje, lo clasifica,
decide si contesta o quiebra. Sabe cuándo callarse — que no es poco, y es lo que se midió en la
fase 1. Lo que no sabe es **qué está intentando conseguir**.

Cuatro piezas, todas detalladas en el documento nuevo:

- **«Caso listo» por etapa** — qué datos hacen falta para que una persona pueda cerrar.
  Configurable por clínica.
- **El quiebre se parte en tres** — aplazable (lo anota y sigue), detiene el guion (para sin urgir),
  rompe ya (sube a la cola). Solo uno interrumpe.
- **El resumen de traspaso** — qué se recogió, a qué punto llegó, y la lista numerada de lo pendiente
  de decidir. Es la pieza de más valor.
- **El aplazamiento como promesa**, con insistencia acotada. Nunca infinita.

**Y una consecuencia de calendario que importa para este plan:** las fases A-F del documento nuevo
**corren todas en modo A**, o sea que **no dependen de Meta ni del alta fiscal**. Las fases 0-5 de
aquí sí. Por eso las dos numeraciones conviven en vez de fundirse: fundirlas daría una secuencia
falsa en la que el modelo nuevo parece venir después de la fase 5, cuando puede empezar hoy.

**Qué NO cambia con el modelo nuevo.** El techo de la tabla de abajo. Un agente orientado a objetivo
tiene más margen para **recoger**, no más para **decidir**: «cualquier cosa que roce el precio» y las
preguntas clínicas siguen sin salir de A, y los disparadores de dinero y clínicos siguen sin poder
quitarse. Recoger el dato de que alguien quiere fraccionar no es negociar el fraccionamiento.

### La autonomía se concede por intención, no por fase entera

La matriz de la primera versión era **fase × modo**, y es demasiado gruesa. «Seguimiento de
presupuestos» no es una cosa: dentro conviven *confirmar que el presupuesto sigue vigente* —que
tiene una respuesta correcta conocida y no compromete nada— y *cualquier cosa que roce el precio*,
que no debe ser autónoma **nunca**, en ninguna clínica, con ningún nivel de confianza. Obligar a
elegir un solo modo para las dos es obligar a elegir mal: o se frena lo inofensivo o se suelta lo
peligroso.

Así que el eje pasa a ser **la intención**, y la fase queda solo como agrupador visual:

| Fase | Intención | Puede llegar a |
|---|---|---|
| Captación | Pedir cita · proponer hueco · confirmar cita | **C** |
| Captación | Preguntar precio | **Nunca sale de A** |
| Recordatorios | Recordar · confirmar asistencia · reagendar | **C** |
| Recordatorios | Cancelar dando motivo | **B** (registra, no gestiona) |
| Presupuestos | **Confirmar que sigue vigente** · reenviar el enlace del portal | **C** |
| Presupuestos | Aceptar sin condiciones | **B** |
| Presupuestos | **Cualquier cosa que roce el precio** · objeción · comparación | **Nunca sale de A** |
| Presupuestos | Pregunta clínica | **Nunca sale de A** |
| Cobros | Avisar de vencimiento · confirmar pago recibido | **C** |
| Cobros | Reclamar importe vencido | **B** |
| Cobros | Aplazar · renegociar · reclamación | **Nunca sale de A** |

**Por qué encaja mejor con lo que ya está diseñado:** los disparadores de quiebre **ya son por
intención** (`arquitectura-agente-quiebre.html`), y el clasificador que existe hoy ya etiqueta
intenciones. Conceder la autonomía en la misma unidad en la que se corta significa que hay **un
solo vocabulario** para las dos mitades del sistema, en vez de traducir de fases a intenciones
cada vez. Y el techo de la tabla («nunca sale de A») es el mismo límite del producto que la
sección de disparadores no configurables — dicho una vez, aplicado en los dos sitios.

**Cómo se sube de celda:** con la tasa de coincidencia de esa intención (fase 1), no con una
sensación. Cada celda tiene su umbral y su histórico.

### El entrenamiento continuo es producto, no servicio

**Fyllio no vende configuración y no cobra por entrenar el agente.** El sistema aprende de lo que la
clínica **ya hace**, sin sesiones de entrenamiento ni equipo dedicado.

**Por qué es una decisión de negocio y no una preferencia técnica.** Cobrar por configurar es
facturar horas: no escala, y supone una clínica con alguien dispuesto a sentarse a diseñar flujos.
Una clínica de dos sillones no quiere un equipo reconfigurándole nada — quiere que deje de
perdérsele dinero. Es exactamente el hueco que deja el modelo de al lado: Zolutium cobra ~1.200 USD
de puesta en marcha **a un consultor externo** que configura y entrena los agentes
([`MERCADO.md` §2.1](MERCADO.md), observado por dentro el 5 ago de 2026).

#### El bucle, que no le pide trabajo extra a nadie

**1 · Cada corrección es una lección, y ya se está capturando.** Cuando la coordinadora edita o
reescribe un mensaje sugerido, se guardan el original y el suyo. **Esto existe desde la fase 1**: es
la distancia de edición de la tasa de coincidencia. No hay que construir la captura, solo leerla con
otra pregunta.

**2 · Cuando se acumulan correcciones del mismo tipo, el sistema PROPONE.** *«Sueles reescribir esto
de otra manera, ¿lo escribo así a partir de ahora?»*. Ella acepta o no. **Nunca se aplica solo** — la
misma barrera que las categorías propuestas de la fase 2: acumular es automático, adoptar es una
decisión humana.

**3 · Lo mismo con el quiebre, y en las dos direcciones.** Cada caso que se le pasó y **no hacía
falta** es señal de que la línea está demasiado adelante; cada caso que el agente resolvió solo y
**acabó mal**, de que está demasiado atrás. Las dos señales afinan dónde está la línea, y las dos
salen del uso normal.

#### Lo único que se pide al arrancar

**Media hora de conversación en el onboarding, no un servicio aparte:**

- Las preguntas frecuentes con sus respuestas.
- Precios y políticas.
- **Qué NO puede decir el agente.**

Nada más. Todo lo demás lo aprende de trabajar.

#### Corrección al modelo estándar / premium

**La diferencia del plan superior NO es «yo te entreno el agente».** Son los **flujos intermedios**:
el paso propio de esa clínica que el estándar no cubre —el tratamiento en pausa de Flores, la
derivación a un implantólogo externo—, que es lo que ya dice [`MERCADO.md` §1](MERCADO.md).

**Entrenar el agente con la voz de la clínica va en TODOS los planes, porque se hace solo.** Ponerlo
en el premium sería cobrar por algo que no cuesta trabajo, y además rompería el argumento: si
entrenar se paga aparte, ya somos el modelo del consultor.

#### La dependencia que hay que dejar escrita

**Nada de este bucle funciona sin conversaciones reales, y hoy hay CERO en el sistema.** RB e INDEP
están vacíos y los 349 mensajes de DEMO son 15 plantillas del seed (censo del 5 ago de 2026, ver
[`evals/README.md`](evals/README.md)). Sin correcciones reales no hay nada que acumular y el bucle
no arranca.

Es **otra razón, y de peso, para pedir el histórico de WhatsApp de RB en la misma tanda que el
contrato de tratamiento de datos** ([`REUNION-RB-DENTAL.md` §D.2 bis](REUNION-RB-DENTAL.md)). No es
solo para medir si el agente acierta: es para que pueda aprender.

**Qué se espera ver:** dos clínicas con el mismo producto y comportamientos distintos, sin tocar código. Y dentro de una misma fase, dos intenciones con autonomía distinta.

**Cómo se pone a prueba:**
- Configurar dos tenants con perfiles opuestos (uno todo en A, otro todo en C) y verificar que ninguno se comporta como el otro.
- **Entrenamiento continuo:** acumular varias correcciones del mismo tipo y verificar que el sistema **propone** el cambio en vez de aplicarlo. Rechazar la propuesta y comprobar que **no vuelve a proponerla igual** al día siguiente — una sugerencia que reaparece tras un «no» deja de ser una propuesta y pasa a ser insistencia.
- Verificar que **la clínica no ha tenido que abrir ninguna pantalla de entrenamiento** para que el bucle funcione: si hace falta, es un servicio disfrazado de producto.
- Poner «confirmar vigencia» en C y «pregunta precio» en A **en la misma clínica y la misma fase**, e inyectar una respuesta de cada tipo: la primera sale sola, la segunda para y espera a una persona.
- Intentar subir a B o C una intención marcada «nunca sale de A» **por API, no por la interfaz**: tiene que rechazarse en el servidor. Una regla que solo vive en el desplegable no es una regla.

---

## Fase 5 · Tech Provider y alta de clientes

**No decidida. Cuándo:** cuando haya más de un cliente real.

Meta exige ser **Tech Provider** para incorporar a otras empresas mediante Embedded Signup. El límite inicial es de 10 clientes nuevos por semana, que sube a 200 tras completar verificación de empresa, revisión de app y verificación de acceso.

En ese modelo **cada clínica tiene su propia cuenta de WhatsApp y su propio número, y Fyllio la opera**. Eso tiene dos consecuencias buenas: la clínica es dueña de sus activos y sigue siendo la responsable del tratamiento de datos, que es lo correcto también desde el RGPD.

Para el piloto con una sola clínica no hace falta: se puede incorporar a mano.

---

## Orden real de las cosas

Secuencia y dependencias. **No son fechas comprometidas**, y las fases marcadas ⬜ ni siquiera están decididas:

| Cuándo | Qué | Depende de |
|---|---|---|
| Hoy | ✅ Fase 0 · trámite y número de prueba | Situación fiscal · dominio propio |
| Semanas 1-2 | ✅ Fase 1 · estado de automatización y cola de quiebre | Nada |
| Semana 3 | ⬜ Fase 2 · simulador | Fase 1 + decisión |
| Cuando Meta apruebe las plantillas | ⬜ Fase 3 · modo B real (~1 semana de código + espera de Meta) | Número de prueba + catálogo enviado + decisión |
| Después del piloto | ⬜ Fase 4 · modo C y configuración | Fase 3 + criterio del cliente |
| Con el segundo cliente | ⬜ Fase 5 · Tech Provider | Volumen |

---

# Anexo · WhatsApp Business API en España

> **Regla de higiene — la misma que [`MERCADO.md`](MERCADO.md).** Lo de este anexo es
> **investigación de fuentes secundarias fechada el 1 de agosto de 2026**, no evidencia de campo
> ni documentación citada del propio Meta. **Los precios, los plazos y los límites hay que
> reverificarlos en la documentación oficial antes de comprometerlos con un cliente**, en una
> propuesta o en un contrato. Nada de aquí se cita a una clínica como dato nuestro.
>
> Vale lo mismo que allí: la afirmación comercial de un tercero se anota como afirmación, nunca
> como dato. Si algo de esto se verifica contra fuente oficial, se anota con fuente y fecha —
> y si se convierte en decisión, va a [`DECISIONES.md`](DECISIONES.md).

## Cómo se empieza

Meta da, al crear una app de negocio, **un número de teléfono de prueba, una cuenta WABA de prueba y una plantilla «hola mundo» ya aprobada**, con mensajes gratis a hasta 5 destinatarios. No hace falta verificación de empresa para esto. Es suficiente para desarrollar la integración entera y para demostrarla.

## Verificación de empresa

- **Documento válido en España:** Modelo 036/037 con NIF. También escrituras de constitución o certificado del registro mercantil.
- **Sirve tanto una sociedad como un autónomo registrado.** El corte está entre estar dado de alta ante Hacienda y no estarlo.
- **Email de dominio propio**, no Gmail ni Hotmail.
- El nombre legal, la dirección fiscal y los datos deben coincidir exactamente con los documentos.
- Plazo típico: 1 a 5 días hábiles cuando todo está correcto.

**Sin verificación:** límite de 250 destinatarios únicos por 24 h, solo plantillas de utilidad y autenticación, sin escalado de tiers. Para un piloto de una clínica es suficiente.

## Plantillas

- **Tres categorías**: utilidad (transaccional), marketing (promocional) y autenticación (códigos).
- **Las de Fyllio son todas de utilidad**: recordatorio de cita, seguimiento de presupuesto, aviso de vencimiento. Es la categoría más barata y la que menos se rechaza.
- **Crear y enviar a aprobación es gratis.** Meta cobra por conversación iniciada.
- **Plazo**: de minutos a 48 h, la mayoría en menos de 24.
- **La causa principal de rechazo es la categoría equivocada**, no el contenido: una plantilla promocional enviada como utilidad es rechazo automático.
- Una plantilla aprobada se puede editar 10 veces en 30 días. Las rechazadas, sin límite.
- Reenviar la misma plantilla rechazada sin cambiarla a fondo penaliza la calidad de la cuenta.

**Buenas prácticas que evitan rechazos:** ortografía impecable, variables con ejemplos concretos, un solo objetivo por mensaje, URL completas (no acortadas), sin urgencia falsa ni mayúsculas excesivas, sin mezclar promoción en un mensaje transaccional.

## Precios orientativos para España

**Orientativos y sin verificar contra la tabla oficial de Meta — reverificar antes de usarlos en una propuesta.**

- Conversación de utilidad: ~0,02 € · de marketing: ~0,06 €.
- Las primeras 1.000 conversaciones de servicio al mes son gratuitas.
- La ventana de atención al cliente es de 24 h: dentro de ella se responde libremente; fuera, solo con plantilla aprobada.

## La restricción que condiciona el diseño

La Política de mensajes de WhatsApp Business restringe enviar o solicitar información de salud cuando la regulación aplicable lo limita. Un tratamiento dental concreto asociado a una persona es dato de salud bajo el artículo 9 del RGPD.

**Consecuencia para las plantillas de Fyllio:** no nombrar el tratamiento ni el importe en el mensaje. El patrón correcto es un mensaje neutro con enlace al portal, donde el paciente se identifica y ve su información en un entorno controlado. Está anotado como [MEJORAS 83](MEJORAS-PENDIENTES.md) y la hipótesis **H9** de [`MERCADO.md` §4](MERCADO.md) mide si el mensaje neutro convierte igual.

## Modelos de partner

| Modelo | Quién factura la mensajería | Cuándo aplica |
|---|---|---|
| **Uso propio** | Tú, a Meta | Ahora, para desarrollar y para el piloto |
| **Tech Provider** | El cliente paga a Meta; tú facturas tu software | Con varios clientes |
| **Solution Partner** | Tú, con línea de crédito de Meta, y refacturas | Con volumen alto; proceso largo |

Para Fyllio el destino natural es **Tech Provider**: cada clínica dueña de su cuenta y su número, Fyllio operándola.
