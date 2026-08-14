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

Solo tres cosas derivan el caso a una persona:

| Disparador | Qué es | Cola |
|---|---|---|
| **Insistencia** | El paciente vuelve sobre algo que el agente no puede resolver y deja claro que lo quiere antes de seguir. **Umbral: 2 toques sobre el mismo tema, no 1** — repetir una vez es preguntar otra vez, no insistir. Configurable con tope (§6) | Normal |
| **Urgencia médica** | Dolor agudo, rotura, infección, «hoy» | **Prioritaria — el asesor responde ya** |
| **Caso completo** | El objetivo activo está cubierto | Normal |

Lo demás se anota y la conversación sigue.

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

**Cuatro cohortes, en este orden:**

1. **Necesita respuesta** — rompió de verdad. Queja, enfado, petición de persona. Lo único que interrumpe.
2. **Listos para cerrar** — el agente terminó. Aquí estará el volumen.
3. **Pendientes de resolver** — el agente aplazó algo y **sigue trabajando**; el caso todavía no está listo pero ya acumuló preguntas.
4. **Sin actividad** — enfriados, agotados, sin contactar. Lo que ya existe.

**Regla de precedencia:** un caso listo con cosas aplazadas va a "Listos para cerrar", no a "Pendientes". Las cosas aplazadas viven **dentro** del caso, no como cohorte propia. Es el caso más común y no puede estar en dos sitios.

**La cohorte de quiebre de la fase 1 no se tira: se reparte.** Lo que rompe de verdad va a la primera; lo aplazado, a la tercera.

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
  nazca el salto de plan).
- **El prompt ensamblado es VISIBLE para el manager.** Si no ve qué se le dice a sus pacientes, no
  sube de modo A nunca.
- **El punto de transferencia lo decide la clínica, no es rígido.** Lo que no se configura es que el
  agente DETECTE bien lo que pasa; qué hacer con ello, sí.
- **Archivos y documentos, FUERA de A-F.** Subir un PDF de precios exige extraer, indexar y citar
  sin inventar: es un proyecto propio. En A-F, campos de texto estructurados y enlaces planos.
- **Los campos de un plan no contratado se muestran BLOQUEADOS Y VISIBLES, no escondidos.** Un campo
  escondido no vende nada.

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
