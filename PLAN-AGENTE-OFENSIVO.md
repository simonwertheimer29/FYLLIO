# PLAN-AGENTE-OFENSIVO.md

> **Plan de producto, no hoja de ruta comprometida. Cada fase requiere aprobación antes de arrancar.**
>
> Nada de este documento es una especificación y **nada se implementa sin decisión explícita**
> anotada en [`DECISIONES.md`](DECISIONES.md).

Replanteamiento del modelo de agente y de todo lo que arrastra: mensajería, seguimiento, la reorganización de ventanas y la configuración por clínica.

**Fecha:** 12 de agosto de 2026.
**Estado:** plan de producto. Cada fase requiere aprobación antes de arrancar.

---

## Cómo se relaciona con `PLAN-AGENTE.md`

Los dos documentos hablan del mismo agente, así que hay que decir cuál manda en qué o acabarán
contradiciéndose:

| | [`PLAN-AGENTE.md`](PLAN-AGENTE.md) | Este documento |
|---|---|---|
| **Qué es** | El plan por fases 0-5: el trámite de Meta, la infraestructura, el envío | El **modelo de comportamiento** del agente y lo que arrastra en la app |
| **Manda en** | Qué se construye, en qué orden, y las dependencias externas (Meta, alta fiscal) | **Cómo se comporta el agente** y qué ve la coordinadora |
| **Sus fases** | 0-5, con dependencias de calendario ajenas | A-F, todas dentro del modo A |

**Regla para cuando choquen:** en comportamiento del agente manda **este**; en orden de construcción
y dependencias externas manda **el otro**. La sección «El cambio de modelo» de su fase 4 queda
**resumida allí y desarrollada aquí** — si divergen, esta es la buena.

**Y las dos numeraciones conviven a propósito.** Las fases 0-5 del plan original están atadas a
plazos que no controlamos (Meta, Hacienda); las A-F de aquí **no dependen de nadie de fuera** y
corren en modo A. Renumerarlas juntas daría una secuencia falsa: parecería que la A va después de la
5, y va antes.

---

## 0 · Qué cambia, en una frase

Hoy el agente sabe **cuándo callarse**. En el modelo nuevo sabe **qué está intentando conseguir**.

Las reglas de quiebre eran defensivas: aparece algo que no puede resolver, para todo, y el caso salta a una persona con la conversación a medias. El modelo nuevo es ofensivo: el agente trabaja hacia un objetivo, anota lo que no puede resolver, y entrega el caso cuando está listo — con todo recogido y una lista de lo que queda por decidir.

**La consecuencia práctica:** la coordinadora deja de recibir conversaciones interrumpidas y empieza a recibir casos cocinados.

---

## 1 · Qué deriva el caso a una persona

> **Sustituido el 14 de agosto de 2026.** El modelo anterior tenía tres tipos de quiebre
> (aplazable / detiene el guion / rompe ya). Las tandas R1 y C1 del eval enseñaron que el del
> medio era mudo y el tercero, demasiado ancho. Este es el modelo vigente.

**Nada tapona por sí mismo.** El agente siempre anota lo que no puede resolver y sigue
recogiendo datos. No existe el estado mudo: el agente en espera **acompaña** — calma, orienta,
dice el siguiente paso — y lo único que deja de hacer es empujar al cierre.

Solo cuatro cosas derivan el caso a una persona *(corregido el 14-08: petición y queja son
disparador propio, no una lectura ancha de la insistencia)*:

| Disparador | Qué es | Cola |
|---|---|---|
| **Petición o queja** | Pide hablar con una persona, o se queja del trato, la espera o el servicio. Deriva al **primer** toque. **Queja ≠ insatisfacción**: «me parece caro» es una objeción y el agente la trabaja; «llevo dos días esperando y esto es un desastre» deriva. Esta distinción va explícita en el prompt — es donde el modelo se equivocará, y derivar cada objeción de precio mata la conversación que el producto existe para tener | **Prioritaria si hay malestar**; normal si la petición es rutinaria («que me llame alguien para cerrar la cita») — no todo lo que menciona a una persona es un incendio |
| **Insistencia** | Vuelve sobre un tema que el agente no puede resolver. **Umbral: 2 toques sobre el mismo tema, no 1** — repetir una vez es preguntar otra vez, no insistir. Configurable con tope (§6) | Normal |
| **Urgencia médica** | Dolor agudo, rotura, infección, «hoy» | **Prioritaria — el asesor responde ya** |
| **Caso completo** | El objetivo activo está cubierto. **Incluye el rechazo**: la decisión está recogida, el motivo se pide en el mismo turno | Normal |

Lo demás se anota y la conversación sigue. La cola no se persiste: se guarda el hecho (causa, y
el juicio de malestar en petición/queja) y la cola se deriva — si mañana cambia la política de
colas, el histórico no se pierde.

**La derivación no se revierte.** Una vez derivado, el caso es de la persona: el agente no
vuelve a entrar aunque el paciente escriba de otro tema — sin esto hay dos voces hablando con
el mismo paciente. Consecuencia aceptada: derivar por insistencia arrastra a manos humanas los
demás objetivos abiertos del caso. Es el precio correcto, y la razón del umbral de 2.

**Urgencia — regla dura, no configurable por nadie:** ante una urgencia médica el agente
**nunca orienta clínicamente**. Deriva, dice que alguien contacta de inmediato, y nada más. No
sugiere qué hacer, no valora gravedad, no recomienda acudir a ningún sitio por criterio propio.
Lo configurable por clínica (fase D) son tres campos: **(a)** qué considera urgencia (partiendo
de un default razonable); **(b)** si atiende urgencias o no; **(c)** si NO atiende, un texto
fijo escrito por la clínica que el agente **reproduce literal, sin generar** — «no atendemos
urgencias» a secas ante alguien con dolor es inaceptable, y dejar que el modelo improvise ahí
es exactamente donde no queremos que improvise. La clínica decide qué se dice y asume ese texto.

**El aplazamiento es una promesa, y la promesa transfiere.** «Un asesor te contactará» obliga:
con el caso listo o una promesa pendiente, la siguiente pregunta del paciente es del asesor, no
del agente. Si el paciente escribe el martes y le contestan el jueves, el agente ha empeorado
la situación — por eso la primera métrica del §10 mide exactamente ese tiempo.

---

## 2 · "Caso listo" — la pieza que hoy no existe

El agente necesita saber cuándo ha terminado. Hoy clasifica intenciones sueltas; ahora tiene que evaluar en cada turno si ya tiene lo necesario para entregar.

**Definición por etapa, configurable por clínica.** Ejemplo de partida:

- **Lead** — nombre, tratamiento de interés, urgencia percibida, disponibilidad horaria, preferencia de doctor si la tiene.
- **Presupuesto** — decisión (acepta / lo piensa / rechaza), y si acepta, cómo quiere pagar.
- **Cobro** — confirmación de que va a pagar y por qué vía.

Cada clínica ajusta qué necesita antes de que le pasen un caso. Es lo que decide cuánto trabajo hace el agente y cuánto la persona.

**Ojo con el pago, que es donde alguien lo va a implementar mal.** «Cómo quiere pagar» está en la
definición de caso listo del presupuesto, y el pago es a la vez lo que dispara el quiebre
**aplazable** del §1. No es una contradicción: **recoger cómo quiere pagar el paciente no es
negociar el pago.** Anotar «pregunta si se puede fraccionar a 8 meses» es recoger; contestar «sí, te
lo fraccionamos» es decidir, y eso no sale de A. La frontera del §6 vale entera aquí: el agente
informa de lo que ya está decidido —una tabla de planes publicada— y anota todo lo demás.

---

## 3 · Seguimiento — la cola se reordena

Hoy la cola es "lo que exige criterio ahora". Pasa a ser "lo que te toca cerrar", con lo urgente arriba.

**Tres cohortes, en este orden** (criterio, 18-08 — sustituye a las cuatro del 17-08). La regla de
entrada: **solo entra lo que exige que una PERSONA haga algo.** Todo lo demás es filtro, o es
Mensajería, o es consulta (Tablas).

1. **Necesita respuesta** — hay una persona (paciente o equipo) esperando una acción humana:
   quiebre, caso entregado, entrante sin responder. Incluye como **detalles** el lead nuevo sin
   conversación (primer contacto humano mientras no haya cadencia de leads) y el agotado al que
   toca llamar.
2. **Listos para cerrar** — el agente terminó. Aquí estará el volumen. Un caso listo CON
   aplazados va aquí, y los aplazados se ven **dentro de la ficha**, no como cohorte.
3. **Fuera de plazo** — le tocaba a una persona y no se hizo dentro del umbral. Con el agente y
   las cadencias corriendo nadie se enfría solo: llegar aquí es un **fallo del equipo** — el censo
   de rojos viejos hecho cohorte. El umbral es un **compromiso de servicio de la clínica**, distinto
   por tipo, configurable en la pantalla del agente (fase D, §6 — no en Ajustes). Defaults en
   código mientras tanto: **urgencia 30 min · paciente esperando respuesta 2 h · caso listo para
   cerrar 4 h · lead nuevo sin contactar 1 h**. Y el reloj **solo corre en horario de la clínica**:
   si corriera de noche, la cohorte se llenaría cada mañana y dejaría de significar nada.

**«Pendientes de resolver» se eliminó** (18-08): si el agente sigue trabajando el caso, no hay nada
que una persona tenga que hacer — eso es supervisión, no cola de trabajo, y vive en Mensajería >
En curso. **Citados** tampoco están en la cola: su único pendiente es el recordatorio automático, y
si de ahí surge una duda el agente la trabaja y la entrega por la puerta normal. «¿Quién viene esta
semana?» se contesta con la **agenda** (feature dependiente del nivel de integración — nivel 2,
lectura), no con un filtro en la cola de trabajo.

**El push es para lo que no puede esperar, no para lo que hay que hacer** (criterio, 14-08).
Notificación push **solo para la cola prioritaria**: urgencia, antecedente médico con cita próxima,
y petición/queja con malestar. Todo lo demás —incluido derivar por caso completo, que es donde
estará el volumen— llega a la bandeja sin interrumpir a nadie: una coordinadora con veinte avisos
al día deja de mirarlos, y ahí se pierden los que importan. Si algún día se quiere avisar de casos
listos, será un **resumen periódico**, nunca un aviso por caso.

**La cohorte de quiebre de la fase 1 no se tira: se reparte.** Lo que rompe de verdad va a la primera; lo aplazado, a la tercera.

**EL SEMÁFORO DE CONTACTO** (criterio, 17-08 · construido en la 026). Un solo criterio y lo miran
los dos lados — el evaluador antes de contestar y las cadencias/automatizaciones antes de
dispararse: **rojo ⇔ hay un asunto derivado sin resolver con una persona, o un «este hilo es mío»
sin soltar, o una espera vigente.** El disparador de la vuelta no es un mensaje, es **el cierre del
asunto**: un hecho del sistema (la cita creada, el cobro registrado, el presupuesto cerrado) o el
botón «resuelto» — uno solo para todas las causas; la causa ya está en el log. Sin expiración por
tiempo: caducar tapa el fallo en vez de enseñarlo — la presión es el **censo de rojos con su edad**
(`npm run semaforo` / `GET /api/automatizacion/semaforo`), que además es la alarma del único punto
por el que el producto entero puede enmudecer en silencio.

**La espera («sin contacto hasta [fecha]»)** resuelve dos casos con una pieza: el paciente que pide
plazo («el viernes te digo») y el acuerdo por teléfono invisible para el sistema. La fija el agente
—solo con fecha CONCRETA extraída del texto del paciente, tope 14 días; por encima, una persona— o
una persona a mano. Suspende **también** las cadencias, por el mismo semáforo. Al vencer, solo se
levanta la pausa: nada dispara solo. Y el agente sigue contestando entrantes durante la espera —
responder a quien escribe no es contactar.

**Recordatorios de CITA: exentos del semáforo** (criterio, 17-08). La cita es un compromiso
existente del paciente, no un contacto comercial — y son los mensajes RGPD-limpios. Todo lo demás
que toca al paciente (cadencias de presupuesto, reactivaciones, reglas con plantilla) pasa por el
semáforo sin excepción.

---

## 4 · La ficha del caso listo — el producto de verdad

Cuando la coordinadora abre un caso de "Listos para cerrar", ve **en este orden**:

1. **Qué quiere** — "Quiere cita para ortodoncia invisible, prefiere tardes, sin preferencia de doctor."
2. **Qué falta resolver antes de cerrar** — la lista numerada de lo aplazado:
   *1. Pregunta si hay promoción este mes.
   2. Quiere saber si se puede fraccionar a 8 meses.
   3. Pregunta si aceptáis pago con cheque.*
3. **Qué recogió el agente** — los datos del "caso listo", visibles de un vistazo.
4. **La conversación**, por si quiere leerla.

**Esto es lo que convierte veinte minutos de leer un hilo en cinco de resolverlo.** Es la pieza con más valor de todo el plan y la que hay que construir mejor.

---

## 5 · Mensajería — dos vistas, no diez filtros

La bandeja actual muestra todas las conversaciones. Con el agente trabajando, hay dos públicos distintos y hay que separarlos **sin llenar la pantalla de filtros**.

**Un conmutador de dos posiciones arriba de la lista:**

- **En curso** — lo que el agente está trabajando ahora. Es la vista de supervisión: se ve al agente conversando, en vivo. Aquí es donde una clínica gana confianza para subir la automatización.
- **Para ti** — los casos ya trabajados que esperan a una persona. Es la vista de trabajo del coordinador, y refleja las mismas cohortes que Seguimiento sin repetir sus nombres: primero lo que rompió, luego lo listo.

Dentro de cada vista, el buscador y el filtro por clínica que ya existen. **Nada más.** Si hace falta un tercer nivel de filtro, el diseño está mal.

**Y se mantiene la regla:** mensajería y seguimiento son dos vistas del mismo sistema. Responder en una actualiza la otra sin que nadie marque nada.

---

## 6 · Configuración del agente por clínica

**Visible siempre, editable en parte.** Un manager que no puede ver qué le dice su agente a sus pacientes no va a subir de modo A nunca — y el objetivo del producto es que suba.

| Qué | ¿Lo edita la clínica? |
|---|---|
| Tono y personalidad | ✅ |
| Objetivos por etapa (qué es "caso listo") | ✅ |
| Base de conocimiento: tratamientos, precios publicados, políticas, horarios | ✅ |
| Alcance: qué puede informar y qué aplaza | ✅ dentro de los límites |
| Cuántas veces aplaza antes de romper (umbral de insistencia, §1) | ✅ con tope |
| Urgencias: qué se considera urgencia · si se atienden · y si no, el texto LITERAL que responde el agente (§1) | ✅ el texto lo escribe y asume la clínica |
| **Las reglas duras** — no comprometer dinero no decidido, no dar criterio clínico, no negociar, y ante urgencia médica JAMÁS orientar clínicamente | ❌ nunca |

**La frontera, que no cambia:** el agente informa de lo que ya está decidido; la persona decide lo que no lo está. Lo configurable es **cuántas cosas están decididas**, no dónde está la línea. Una clínica que publica su tabla de precios y sus planes de pago hace que el agente pueda informarlos — eso es leer, no negociar.

**Condición dura del modelo de negocio:** la configuración tiene que ser una pantalla que el cliente podría usar solo, aunque la rellenemos nosotros en el onboarding. Si requiere acceso al código, el producto deja de escalar y volvemos a ser consultoría.

**Diseño previsto de la pantalla (anotado el 13 ago 2026; no se construye ahora):**

- **Pantalla guiada, no un cuadro de texto libre.** Campos separados — personalidad y tono ·
  objetivos y punto de transferencia · información adicional · enlaces · agenda — cada uno con su
  ejemplo. La usamos nosotros en el onboarding, y el manager tiene que entender qué se configuró al
  leerla.
- **Cada campo enseña LA CONSECUENCIA, no solo el ejemplo:** «si publicas tu tabla de precios, el
  agente contesta a cuánto cuesta; si no, lo aplaza». La clínica está decidiendo cuánto trabajo hace
  la máquina y cuánto su coordinadora.
- **Barrido de capacidades.** Encima de la pantalla, una lista viva de qué es capaz el agente con
  esa configuración: qué puede informar, qué aplaza, cuándo transfiere. Dos requisitos: se **DERIVA
  de la configuración**, nunca se le pregunta al modelo qué cree que puede hacer (diría que sí a
  casi todo) — hay tabla de precios cargada ⇒ informa precios; agenda en nivel 2 ⇒ dice huecos, no
  reserva. Y se muestra también **EN NEGATIVO**: «no puede decir horarios», «no puede confirmar
  cobertura de seguro» — ahí es donde la clínica ve el hueco (y donde H12 de MERCADO.md espera que
  nazca el salto de plan). Con una excepción que el barrido debe enseñar distinto: la **duda
  clínica** no es un hueco configurable — NINGUNA configuración la elimina (regla dura: el agente
  jamás da criterio clínico), así que se muestra como límite del producto, no como upgrade.
- **El prompt ensamblado es VISIBLE para el manager.** Si no ve qué se le dice a sus pacientes, no
  sube de modo A nunca.
- **El punto de transferencia lo decide la clínica, no es rígido.** Lo que no se configura es que el
  agente DETECTE bien lo que pasa; qué hacer con ello, sí.
- **Archivos y documentos, FUERA de A-F.** Subir un PDF de precios exige extraer, indexar y citar
  sin inventar: es un proyecto propio. En A-F, campos de texto estructurados y enlaces planos.
- **Los campos de un plan no contratado se muestran BLOQUEADOS Y VISIBLES, no escondidos.** Un campo
  escondido no vende nada.

**Los cuatro grupos, en el orden del onboarding (dictado 22 ago 2026)** — de lo que cualquiera sabe
contestar a lo que exige pensar: **1 · Quiénes sois** (tono y personalidad) · **2 · Qué sabe el
agente** (tratamientos, precios publicados, políticas, horarios, enlaces — aquí pasa de aplazar a
contestar) · **3 · Hasta dónde llega** (qué informa y qué aplaza, tope de aplazamientos antes de
derivar, qué considera urgencia, si atiende urgencias y el texto LITERAL si no — se reproduce, no se
genera) · **4 · Plazos de respuesta** (urgencia, paciente esperando, caso listo, lead nuevo — con el
horario laboral de la clínica, que ya existe como dato).

**5 · Cadencias y recordatorios van AQUÍ, no en Automatizaciones (dictado 22 ago 2026).** Cada
cuánto se toca un presupuesto sin respuesta, cuántas veces antes de agotarlo, cuándo se recuerda una
cita, cuándo se reactiva un caso frío. Motivo: el agente y las cadencias comparten el semáforo, los
plazos y al paciente — si la clínica configura «cada 3 días» en una pantalla y los plazos de
respuesta en otra, acaba con un agente que espera al viernes y una cadencia que escribe el martes.
Y la clínica no piensa en «automatizaciones»: piensa en «cómo perseguimos un presupuesto», que es
una sola decisión.

**El criterio de fondo, porque va a reaparecer:** las automatizaciones no son un módulo aparte —
son lo que el agente hace cuando nadie escribe. El producto es el agente; las cadencias son su
comportamiento en silencio.

**Consecuencia para la fase F (anotada, NO decidida):** si la configuración del agente absorbe las
cadencias, la ventana de Automatizaciones se queda solo con las reglas del motor viejo (Sprint 16b:
triggers/condiciones/acciones) — que probablemente sobran cuando el evaluador esté encendido.
Probablemente sobra como ventana. Se decide en fase F.

**Medición de coste pendiente (encargo 22 ago 2026):** cuando la pantalla exista, medir el coste
REAL por turno con un prompt completo (tono + precios + políticas + horarios + alcance) contra el
genérico de hoy (~$0,005/turno con juez). Reportar: por turno, por conversación de 3 turnos, y al
mes con 1.000 conversaciones. Y si el prompt caching aplica (el prompt de una clínica es idéntico
en todas sus conversaciones, debería) — hoy la llamada del evaluador NO usa `cache_control` ni
siquiera para el system fijo. Medirlo, no estimarlo: es dato del modelo de negocio.

---

## 7 · Pon a prueba tu agente

Dos funciones, y sirve para lo mismo desde dos sitios: **dar confianza para automatizar más, y mejorar al agente sin tocar producción.**

**a) El banco de pruebas.** Una conversación de mentira con el agente, fuera de producción. Le escribes como si fueras un paciente, ves cómo responde, y si algo no te gusta se lo dices: qué estuvo mal y cómo debería haber respondido. Esa corrección se guarda.

**b) Feedback en vivo.** Sobre mensajes reales, un gesto de un segundo desde la propia conversación: bien / mal, y si es mal, qué debería haber dicho.

**Quién puede:** por defecto, coordinadoras y manager. Configurable por clínica — si una prefiere no dar ese poder a las coordinadoras, se bloquea.

**Qué se hace con las correcciones:** se acumulan y se proponen. Nunca se aplican solas. Cuando hay varias del mismo tipo, el sistema sugiere el ajuste y alguien lo aprueba.

**Y una regla de higiene que ya nos costó una vez:** lo que sale del banco de pruebas es sintético y lo que sale de producción es real. **No se mezclan al medir.** Se etiquetan por origen y se reportan por separado.

**Aislamiento de las correcciones (anotado el 13 ago 2026):** las correcciones de una clínica
afectan SOLO a esa clínica. Nunca se propagan al prompt de otra ni al prompt base. **Sin
excepciones** — si un patrón se repite en varias clínicas y merece entrar al motor, ese es un cambio
del motor: pasa por el eval y por una decisión explícita, no por propagación.

---

## 8 · La reorganización de ventanas, con este modelo encima

El modelo nuevo cambia lo que va en cada ventana, así que la reorganización entra aquí y no como fase aparte.

| Ventana | Verbo | Qué contiene con el modelo nuevo |
|---|---|---|
| **Pipeline** | Ver la forma | Kanban con selector de dominio. Cada tarjeta muestra si la lleva el agente o una persona |
| **Mensajería** | Ver qué pasa | Las dos vistas del §5 |
| **Seguimiento** | Trabajar | Las cuatro cohortes del §3 |
| **Tablas** | Consultar | Lo mismo en formato tabla, filtrable y exportable |
| **Pacientes** | Buscar a alguien | La base de datos de personas |

Y las pantallas de dirección — Red, KPIs, Informes — se mantienen, con la métrica nueva que aporta el agente: cuánto resuelve solo, cuánto entrega listo, y cuánto rompe.

**EL CICLO DEL CASO — criterio de navegación (dictado, 18-08).** Un caso vive en **Envíos** hasta
que alguien contesta; cuando contesta, entra el agente y pasa a **Seguimiento**; al cerrarse,
vuelve a Envíos. **Nunca está en los dos a la vez.** Envíos es cinta transportadora (revisar y
pulsar); Seguimiento es mesa de trabajo (leer, decidir, escribir). No se mezclan — y por eso
«citas próximas sin respuesta» NO vive en Envíos: llamar es trabajo humano y su sitio es
Seguimiento > Necesita respuesta (reestructura pendiente, MEJORAS 101).

**La barra (para la fase F, dictado 18-08):** hoy son 12 entradas y varias son la misma cosa en
distinto formato. Tres familias: **consulta** (Leads, Presupuestos, Cobros, Pacientes, Tablas) ·
**trabajo** (Seguimiento, Envíos, Mensajería) · **dirección** (Red, KPIs, Informes). Vertical
aguanta esa agrupación y el crecimiento; la horizontal ya está al límite. Pero la decisión real es
**cuántas ventanas quedan**, no dónde va la barra — y antes de proponer nada, releer la tabla de
verbos de arriba: ya está escrita y se parte de ahí.

---

## 9 · Qué hay que construir, en orden

**Fase A — el objetivo y el aplazamiento.** Definir "caso listo" por etapa, que el agente evalúe en cada turno si ya llegó, y los tres tipos de quiebre con su comportamiento. Sin esto no hay modelo nuevo.

**Fase B — el traspaso.** El resumen de entrega: qué quiere, qué falta resolver, qué se recogió. Y las cohortes nuevas en Seguimiento.

**Fase C — mensajería en dos vistas.** En curso / Para ti.

**Fase D — configuración por clínica.** La pantalla, con la separación de qué se edita y qué no.

**Fase E — pon a prueba tu agente.** Banco de pruebas y feedback en vivo, con el bucle de propuestas.

**Fase F — la reorganización de ventanas.** Al final, cuando las anteriores hayan asentado qué va en cada una.

**Todo lo anterior funciona en modo A** — sin envío real. El agente prepara, la persona envía. Lo que cambia es que ahora prepara con objetivo y entrega casos cocinados. El envío automático llega con la fase 3 del plan original, bloqueada por la verificación de Meta.

---

## 10 · Lo que hay que medir para saber si funciona

- **Tiempo desde que el agente entrega un caso hasta la primera respuesta humana, por cola
  (prioritaria / normal).** Es la primera de todas: la única que detecta que el producto esté
  EMPEORANDO la situación — el paciente ha recibido una promesa que sin agente no habría
  recibido, y si esa cifra sube, el agente hace daño por bien que clasifique. (Derivable ya:
  evento de derivación → primer saliente con `autor='persona'`.)
- **Cuántos casos llegan listos** frente a cuántos rompen. Es la métrica del modelo entero.
- **Cuánto tarda un caso listo en cerrarse** — si el agente entrega bien, esto tiene que bajar.
- **Cuántas veces se aplaza antes de romper** — si sube mucho, el agente está esquivando.
- **La coincidencia agente-humano**, que ya se mide.
- **Cuántas correcciones llegan del banco de pruebas y del feedback en vivo**, y si bajan con el tiempo.

Y el eval sigue siendo la vara: cada cambio de prompt pasa por él antes y después.

---

## 11 · Pendientes que este modelo hace urgentes

- **La obligación de identificarse como IA.** El Reglamento europeo de IA aplica desde el 2 de agosto: quien habla con un sistema de IA tiene derecho a saberlo. "Soy asesor de la clínica" probablemente no basta. Afecta al primer mensaje de cada conversación y entra en la consulta legal pendiente.
- **La agenda.** Un paciente que pregunta por horarios es el caso más frecuente y hoy el agente no tiene el dato. Decisión por clínica: o se conecta la disponibilidad, o preguntar por horarios es de lo que se aplaza.
- **La verificación de Meta**, que sigue bloqueando el envío real.

---

## 12 · El portal del paciente — pieza prevista, no fase

Anotado el 13 de agosto de 2026. No se construye ahora; se diseña con él presente.

**Dentro de A-F:** consultar presupuestos y cobros, y **aceptar un presupuesto**.
**Fuera de A-F:** pagar. Pasarela, PCI y conciliación son otro proyecto y ninguna clínica lo ha
pedido todavía. Se decide en el piloto.

**La consecuencia de diseño que importa desde ya:** si el paciente acepta un presupuesto en el
portal, ese objetivo se cierra **sin que el agente participe**, y el agente tiene que enterarse al
turno siguiente o perseguirá algo ya resuelto. Esto ya funciona, verificado el 13-08: el portal
escribe `Estado: ACEPTADO` por el gate del dominio comprobando que la escritura tocó una fila
(`api/portal/[token]/responder`), y el contexto del agente deriva sus objetivos del estado en cada
turno — un presupuesto aceptado deja de estar «vivo» sin que nadie avise a nadie. Ninguna pieza
nueva puede romper esta cadena: **el portal escribe donde el agente lee, y el estado se deriva,
nunca se copia.**

**La ficha de la fase B distingue quién cerró:** «lo cerró el paciente» se deriva del historial
(`portal_aceptado`/`portal_rechazado`, escritos con `obligatorio: true` — son la firma); lo demás es
«lo recogió el agente» o «lo cerró una persona». No es cosmética: a la coordinadora le cambia la
llamada que viene después.

**Y la restricción del art. 9 RGPD aplica también aquí:** el enlace al portal ES el mecanismo que
permite que el recordatorio sea neutro — el detalle (tratamiento, importe) vive detrás del enlace,
no en el mensaje. Si la asesoría exige identificación antes de mostrar el detalle, se resuelve en el
portal, no re-metiendo el dato en el WhatsApp.
