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

Lo detectado pero no aprobado sigue yendo a [`MEJORAS-PENDIENTES.md`](MEJORAS-PENDIENTES.md).

---

## Estado de las fases

| Fase | Qué es | Estado |
|---|---|---|
| **0** · El trámite | Registro fiscal, Meta Business, número de prueba, plantillas | ✅ **Decidida** — bloqueante declarado en [`ESTADO.md`](ESTADO.md) |
| **1** · Estado de automatización y cola de quiebre | La tercera coordenada de cada caso y su cohorte en Seguimiento | ✅ **Decidida** — no depende de WhatsApp |
| **2** · El simulador | Modo demostración del embudo entero | ⬜ **No decidida** |
| **3** · Modo B — el agente envía lo rutinario | Envío y recepción reales por WhatsApp | ⬜ **No decidida** |
| **4** · Modo C y configuración por clínica | Autonomía hasta el quiebre, matriz por fase | ⬜ **No decidida** |
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
5. **Enviar las plantillas de utilidad a aprobación.** Gratis. La aprobación va de minutos a 48 h y la mayoría en menos de 24. Las tuyas son todas de utilidad (recordatorio de cita, seguimiento de presupuesto, recordatorio de pago), que es la categoría más barata y la que menos se rechaza.
6. **Verificación de empresa.** Cuando el paso 1 esté resuelto. Sin ella: 250 destinatarios únicos por 24 h y solo plantillas de utilidad y autenticación — que para un piloto de una clínica es suficiente.

**Dónde corta de verdad la dependencia** (importa para no declarar un bloqueo más grande del que es):

- Los pasos 3-5 **no** necesitan registro fiscal: el número de prueba y las plantillas se consiguen sin verificación de empresa. Con eso se desarrolla y se demuestra.
- El registro fiscal es lo que desbloquea la **verificación de empresa**, y la verificación es lo que quita el techo de 250 destinatarios únicos / 24 h, abre el escalado de tiers y es requisito de la fase 5 (Tech Provider).
- Traducción: sin registro fiscal se puede *probar*, pero no se puede sostener un piloto que crezca ni incorporar a un segundo cliente. Por eso está declarado como bloqueo con dependencia en [`ESTADO.md`](ESTADO.md).

**Qué se espera ver:** un mensaje enviado desde Fyllio y recibido en un WhatsApp real, aunque sea a tu propio número.

**Cómo se pone a prueba:** enviar la plantilla de prueba a tu móvil y recibir la respuesta en el webhook.

---

## Fase 1 · El estado de automatización y la cola de quiebre

**Decidida.** No depende de WhatsApp ni del trámite.

**Lo que se construye:** la tercera coordenada de cada caso — quién lo lleva — y su consecuencia en la cola de trabajo.

- Estado de automatización por caso: trabajando · esperando · quebrado · en manos de alguien · agotado · manual · cerrado.
- **La cohorte de quiebre en Seguimiento**, primera y arriba, con el motivo escrito: *«pregunta si hay descuento»*.
- Distintivo visual del estado en cada tarjeta, en todas las ventanas.
- **Devolver al agente o quedárselo**, con registro de quién decidió qué.
- **El estado «agotado»**: cuando la cadencia se acaba sin respuesta, el caso pasa a la cola con la llamada telefónica como acción recomendada.

**Por qué esta fase primero:** mejora el modo A que ya existe. Hoy el producto genera mensajes y la coordinadora los envía; con esto, además, sabe cuáles puede mandar sin pensar y cuáles exigen que se pare a leer.

**Qué se espera ver:** abrir Seguimiento y que lo primero sean los casos que necesitan criterio humano, con el motivo, ordenados por dinero. Y que la barra del día se mueva.

**Cómo se pone a prueba:**
- Censo: todo caso activo tiene exactamente un estado de automatización, ninguno en dos, ninguno sin.
- Inyectar respuestas con cada uno de los seis disparadores universales y verificar que el caso quiebra.
- Inyectar respuestas neutras y verificar que **no** quiebra.
- Agotar una cadencia y verificar que aparece la recomendación de llamada.
- Devolver al agente y verificar que la cadencia se reanuda donde estaba.

---

## Fase 2 · El simulador

**No decidida.** Requiere aprobación explícita antes de arrancar.

**Lo que se construye:** un modo demostración donde un caso recorre el embudo entero delante de quien mires, con interacciones que no son reales pero sí realistas.

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

**No decidida.** **Depende de:** la fase 0 completada y las plantillas aprobadas.

**Lo que se construye:**
- Envío real por WhatsApp Business API de lo que no admite discusión: recordatorios de cita, confirmaciones, avisos de vencimiento de pago.
- Recepción de respuestas por webhook y clasificación en vivo.
- El quiebre funcionando de verdad: llega una respuesta con disparador y el caso sube a la cola.
- Todo lo enviado por el agente queda en el mismo hilo que lo enviado por la coordinadora.

**Qué se espera ver:** un paciente real recibe un recordatorio que nadie escribió, responde, y su respuesta aparece clasificada en la cola de la coordinadora.

**Cómo se pone a prueba:**
- Con el número de prueba y 5 destinatarios controlados, recorrer los seis disparadores en conversaciones reales.
- Verificar que ningún mensaje sale sin plantilla aprobada fuera de la ventana de 24 h.
- Verificar que el contenido no revela tratamiento ni importe (ver la restricción de datos de salud en el anexo).
- Verificar que un fallo de envío no marca el caso como enviado.

---

## Fase 4 · Modo C y configuración por clínica

**No decidida.** Requiere aprobación explícita antes de arrancar.

**Lo que se construye:**
- El agente autónomo hasta el quiebre en las fases donde la clínica lo autorice.
- **La matriz de configuración**: fase × modo, por clínica.
- Cadencias, umbrales y horarios configurables.
- Disparadores propios que se pueden añadir — nunca quitar los de dinero ni los clínicos.

**Qué se espera ver:** dos clínicas con el mismo producto y comportamientos distintos, sin tocar código.

**Cómo se pone a prueba:** configurar dos tenants con perfiles opuestos (uno todo en A, otro todo en C) y verificar que ninguno se comporta como el otro.

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
| Cuando Meta apruebe | ⬜ Fase 3 · modo B real | Fase 0 completa + decisión |
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
