# MERCADO.md

Conocimiento de mercado de Fyllio: en qué creemos, qué hemos oído de gente real, qué estamos poniendo a prueba y qué nos falta preguntar.

**Regla de higiene — no negociable.** Todo lo que entre aquí lleva fuente y fecha. Se distingue siempre entre:

- **Evidencia de campo** — lo que dijo una persona real de una clínica real, con nombre y fecha. Es la más cara de conseguir y la que más pesa: describe a nuestro comprador, no al mercado en abstracto.
- **Evidencia documental** — dato de fuente citable (organismo oficial, informe sectorial, documentación o precio público del propio fabricante), con fuente y fecha.
- **Interpretación** — lo que nosotros deducimos de esa evidencia.
- **No-evidencia** — intuiciones, conversaciones internas, cualquier número que salga del seed de DEMO, y **la afirmación comercial de un tercero**: un competidor hablando de otro, un "+30% de aceptación" sin verificación independiente, una integración que alguien dice tener. Se puede anotar, pero etiquetada como afirmación y nunca como dato.

Los datos del seed de DEMO **son inventados**. No son evidencia de mercado y no pueden usarse para sostener ninguna hipótesis. Ya ocurrió una vez (30 jul 2026: se tomó el "52% de pacientes sin lead" del seed como si describiera el mercado) y por eso existe esta regla.

**Investigaciones externas** (fotos fechadas, no documentos vivos): [`INVESTIGACION-MERCADO-2026-07.md`](INVESTIGACION-MERCADO-2026-07.md). Sus datos con fuente están volcados abajo en §2.2; sus conclusiones, en §3 marcadas como interpretación; y sus **recomendaciones no están aprobadas** — no se implementan sin decisión explícita en [`DECISIONES.md`](DECISIONES.md).

Última actualización: 31 de julio de 2026.

---

## 1 · Fundamentos

Lo que creemos sobre el negocio y da forma al producto. Cambia poco; cuando cambia, es un giro estratégico y se anota como tal.

### Qué es Fyllio

Un sistema de **no-pérdida** para clínicas dentales. No es un CRM de captación: la captación es una de las fuentes de pérdida, no la mayor. Lo que Fyllio evita es que se escape lo que ya está en marcha — leads sin contactar, presupuestos que se enfrían, cobros que nadie reclama, tratamientos que se quedan a medias.

Esa es también la respuesta a la objeción del pago único: **la pérdida es continua, así que la defensa también lo es.**

### El ciclo, y que se puede entrar y salir por cualquier etapa

Lead → cita → asiste → presupuesto → aceptación → cobro. Pero el paciente **no siempre entra por el principio**: puede ser un lead nuevo, un paciente con historial al que se le presenta un tratamiento, o un referido. Y el ciclo **se cierra con el cobro y se reabre** cuando hay un presupuesto nuevo, repitiéndose por etapas distintas.

Principio derivado, ya en DECISIONES: no hay dos tipos de paciente. Hay pacientes, y algunos tienen un lead de origen. El lead es procedencia, no una clase distinta.

### El mercado español es de captación, no de cartera

Mercado de altísima densidad: **~3.582 clínicas dentales en Madrid**, y unas 23.000 en toda España para 43.672 dentistas colegiados (§2.2). Mayoría privadas y medianas (2-4 sillones), redes privadas tipo RB, y multinacionales o aseguradoras jugando en otro terreno. Con esa densidad se compite en precio, calidad de atención, rapidez y experiencia, y **la vía es captar**, no sostener una agenda cerrada. Mantener pacientes fieles es más difícil que en mercados más conservadores donde manda la recomendación y la confianza del círculo cercano.

Fyllio está orientado a la clínica privada española tipo RB. Que RB sea una red no cambia el encaje: **funciona igual para una sola clínica del mismo estilo**.

### Verticalidad con flujos intermedios: el modelo estándar / premium

Cada clínica trabaja distinto, pero el motor es universal: ninguna clínica quiere que un presupuesto se enfríe ni que un cobro se pierda. Lo que varía es el vocabulario, los umbrales, los roles y **los flujos intermedios** propios de cada una.

- **Estándar** — el ciclo completo, con vocabulario configurable (estados, motivos, plazos, tipos de paciente, roles).
- **Premium** — evaluación de la clínica y construcción de sus flujos intermedios y personalizaciones, sin romper el ciclo ni perder la verticalidad.

Esto convierte la rigidez señalada por Flores en argumento de venta: *"este es el producto estándar; entendemos que tú tienes esta necesidad concreta, y con el plan superior la cubrimos como flujo intermedio y el ciclo sigue funcionando"*.

Y cada flujo intermedio construido para un cliente **pasa a ser catálogo** para los siguientes: no es trabajo perdido, es producto.

#### El setup se incluye en el plan superior, no se factura aparte

**Decisión de negocio, 12 de agosto de 2026.** La configuración inicial —los flujos intermedios, el
vocabulario, y con el agente orientado a objetivo también la definición de «caso listo» de cada
etapa ([`PLAN-AGENTE.md` fase 4](PLAN-AGENTE.md))— **se incluye en el plan superior como argumento
de venta**. No hay línea de «puesta en marcha».

El argumento comercial que habilita: *«el setup lo hacemos nosotros y va incluido»* frente a
Zolutium, que cobra **~1.200 USD de puesta en marcha a un consultor externo** (§2.1, observado por
dentro el 5 ago de 2026). Convierte un coste de entrada del competidor en una razón para subir de
plan con nosotros.

**El aviso, y hay que dejarlo escrito porque la cuenta no es obvia:** incluir el setup significa
**adelantarlo**. La cuenta solo funciona si esa inversión **se recupera en 6-12 meses con la
diferencia entre planes**. Si la diferencia estándar↔premium es pequeña, o si la clínica se va antes
de ese plazo, cada alta premium pierde dinero — y lo pierde de forma silenciosa, porque en la
contabilidad aparece como una venta.

Dos números que hacen falta antes de fijar precios y que **hoy no tenemos**: cuántas horas cuesta de
verdad configurar una clínica, y cuál es la permanencia media. Sin ellos, «se recupera en 6-12
meses» es una intención, no una previsión.

#### La condición dura: la configuración es una pantalla, no una tarea de ingeniería

**El modelo entero depende de esto.** La configuración tiene que ser **una pantalla que el cliente
podría usar solo** — aunque en la práctica la rellenemos nosotros en el alta.

**Si configurar requiere tocar código, el modelo deja de escalar.** No es una preferencia técnica:

- Cada alta pasa a consumir tiempo de desarrollo, que es el recurso que no se puede contratar rápido.
- El setup deja de ser un coste conocido y pasa a ser uno variable, con lo que la cuenta de arriba
  —recuperarlo en 6-12 meses— ya no se puede hacer.
- Y se acaba en el sitio del que este modelo quería salir: **facturando horas**, que es exactamente
  lo que [`PLAN-AGENTE.md`](PLAN-AGENTE.md) descarta al decir que el entrenamiento es producto y no
  servicio.

La prueba de si se cumple es concreta y se puede hacer sin clientes: **dar de alta una clínica nueva
entera sin abrir el editor**. Si no se puede, la configuración todavía no es un producto.

### Posicionamiento — la orquesta invisible

**Tesis del fundador, 17 de agosto de 2026.**

El mercado vende agentes sueltos (la «recepcionista 24/7») o plataformas donde tú diseñas tu
automatización (HubSpot + IA, Zolutium — §2.1). Ambos cobran un **peaje de entrada**: dinero, tiempo
o experiencia para configurar. Nuestra posición: **ese peaje no existe.**

- **La clínica no orquesta agentes ni ve agentes.** Ve resultados por proceso: leads contestados a
  cualquier hora, presupuestos que no se enfrían, cobros perseguidos, y el dinero recuperado al mes.
  La orquesta es nuestra y es invisible.
- **No nos adaptamos a la clínica: llegamos sabidos.** El producto conoce el negocio dental antes
  del onboarding — qué es un presupuesto frío, un no-show, un «me lo pienso». Configurar es darle
  tus datos (precios, horarios, tono), no enseñarle tu negocio. Esto es lo que un CRM horizontal no
  puede copiar sin rehacerse. (Es la otra cara de la condición dura de arriba: llegar sabido solo
  vale si lo que queda por configurar cabe en una pantalla.)
- **Frase de posicionamiento:** *«El CRM dental que trae la IA puesta. Tú pones tu clínica; la
  orquesta ya trabaja.»*

**Secuencia de expansión** (hipótesis — cada piloto valida la siguiente, no se adelanta):

1. **WhatsApp**: captación + seguimiento + cobros (construido, fase A de
   [`PLAN-AGENTE-OFENSIVO.md`](PLAN-AGENTE-OFENSIVO.md); sin datos de piloto aún).
2. **Llamadas IA** — SOLO tras datos de recuperación del piloto WhatsApp.
3. **Recall de higiene, reactivación de dormidos, confirmación de citas** — según pidan los pilotos.

Regla de la secuencia: **una petición de un cliente es un dato; un patrón repetido es roadmap.** No
se construye para uno.

Y el **FOMO como táctica, no como promesa**: se genera enseñando resultados medidos de otros
pilotos, nunca prometiendo capacidades que no corren aún. (Exige tener la medición: la métrica
primera del agente — [`PLAN-AGENTE-OFENSIVO.md` §10](PLAN-AGENTE-OFENSIVO.md) — y la línea base
congelada de [`LINEA-BASE-CIERRE.md`](LINEA-BASE-CIERRE.md) son la infraestructura de esta táctica.)

### Recomendación de producto — el formulario web muere en un enlace a WhatsApp

**Criterio del fundador, 18 de agosto de 2026.** El formulario existe para que la clínica sepa por
qué la llaman antes de llamar — y el agente hace eso mismo mejor y sin que nadie rellene campos. La
recomendación a las clínicas: sustituir el formulario por un **enlace a WhatsApp con mensaje
predefinido** («me interesa…»), que convierte el formulario en conversación desde el primer
segundo. Además resuelve el coste: **el paciente escribe primero**, así que no hay que pagar
plantilla ni depender de la ventana de 24 h de Meta.

Para las clínicas que mantengan formulario: una **cola de formularios pendientes en LEADS**, no en
Seguimiento — un formulario sin conversación no es un caso del agente.

---

## 2 · Evidencia

### 2.1 De campo — lo que dijeron personas reales

Solo lo que dijeron. Sin conclusiones — esas van en Interpretación, marcadas.

#### Alfredo Flores — odontólogo, Lima (Perú) · 30 jul 2026

Clínica con 6-7 especialistas. Modelo conservador pero mentalidad abierta. Conversación buscada para pedir consejo, no para vender.

Lo que dijo:

- **Cada clínica es un mundo y trabaja de forma distinta.** Un producto rígido hace que el interlocutor desconecte: *"no me interesa lo que me muestras, no le va a servir a mi clínica"*.
- **La propuesta de valor tiene que hacerles sentir que ganan ellos.** Pregunta directa: *"¿por qué te pago una mensualidad si un software de pago único de 2.000 $ ya me sirve?"*.
- **Su problema real es el seguimiento de tratamientos largos con dependencias externas.** Ejemplo suyo: paciente que necesita corona, no tienen implantólogo, va fuera, deben pasar ~4 meses hasta volver para la corona, y **no cobran hasta cerrar el tratamiento**. A los 5-8 meses el paciente no vuelve, se quedó con el otro profesional, y el tratamiento y el cobro se pierden.
- **Detrás del seguimiento hay más piezas:** laboratorios, otros profesionales, capacidades distintas por clínica, formas distintas de cobrar.
- **Su cartera:** pacientes de mediana-alta edad con capacidad de pago, que traen referidos y familiares. Prefieren calidad antes que trabajar con aseguradoras y perderla.
- **Sobre a quién dirigirse:** que entienda si el objetivo son pacientes jóvenes o los de mayor edad con capacidad monetaria, que además subvencionan a hijos y familiares. Quién importa de verdad tratar, y cómo tratarlo.
- **Sobre no-shows:** el que falta, falta por una razón — **porque no le duele**. Ante una urgencia con dolor real no falta nadie y quiere cita cuanto antes. A una limpieza se falta con facilidad.
- **Sobre el ciclo:** confirmó lo mismo que RB — el paciente debe poder entrar y salir del ciclo en cualquier etapa (lead, con historial, referido) y recibir el seguimiento y cierre adecuados.

#### RB Dental — red de 10 clínicas, Madrid · en conversaciones desde jul 2026

Marcas RB Dental y Karen Dental bajo una entidad. Cliente piloto objetivo. Reunión prevista para la semana del 3 de agosto de 2026.

Lo que sabemos hasta ahora:

- **Captan por varios canales:** página web, Instagram, WhatsApp, referidos.
- **Buscan lo de los dos mundos:** un software capaz de mantener un ciclo donde el paciente entra y sale por cualquier etapa — sea lead, con historial o referido — con seguimiento y cierre adecuados.
- **Trabajan con aseguradora** (Adeslas), a diferencia del modelo de Flores.
- Feedback original que dio forma al producto: filtros por doctor prominentes, seguimiento de presupuestos como dolor principal.

*(Pendiente de completar tras la reunión.)*

#### Zolutium — plataforma CRM con IA, multivertical · 5 ago 2026

**Fuente: Simon, usando el producto por dentro** en el encargo de Pisopak. No sale de su web ni de
una demo comercial: sale de configurarlo y trabajar con él. Es la evidencia más fuerte que tenemos
sobre un competidor adyacente, y por eso está en «de campo» y no en «documental».

Lo observado:

- **Es genérica y multivertical.** No está construida para un sector concreto.
- **Los agentes se entrenan con prompts**: personalidad, objetivos e información adicional, con
  posibilidad de adjuntar documentos y calendarios. Sobre modelos de OpenAI.
- **El bucle de entrenamiento es manual y supervisado**: se conversa con un agente de prueba, se
  califica cada respuesta como buena o mala, y si es mala **se escribe la correcta y se guarda como
  pregunta frecuente**. Las lagunas de conocimiento se acumulan solas y se van rellenando.
- **Las automatizaciones se arman con workflows de arrastrar y soltar**, con disparadores según el
  plan contratado.
- Incluye **llamadas IA**, campañas de marketing, y conexión a varios **WhatsApp, Instagram y
  TikTok**, con captación y respuesta desde ahí.
- Tiene un **asistente de IA propio** para resolver dudas sobre la plataforma y crear workflows.
- **Precio observado: ~1.200 USD** por configurar y entrenar los agentes y montar la arquitectura del
  CRM, **con el trabajo hecho por un consultor externo**.

> ⚠️ **Ese precio NO es comparable con la mensualidad de Fyllio.** Es un **coste de puesta en marcha
> pagado a un consultor**, no la suscripción del software. Compararlo con los 89-149 €/mes de la
> hipótesis H10 sería comparar cosas distintas y llegar a una conclusión falsa en las dos
> direcciones. **Lo que cuesta su licencia recurrente no lo sabemos** — está en §5, preguntas
> abiertas.

*(Pendiente de confirmar desde dentro: si su agente tiene algún concepto de traspaso a una persona.
Por lo observado no lo tiene, pero «no lo he visto» no es «no existe» — ver §3 y §5.)*

### 2.2 Documental — datos con fuente citable

Todo lo de abajo entró el **31 jul 2026** desde [`INVESTIGACION-MERCADO-2026-07.md`](INVESTIGACION-MERCADO-2026-07.md); la fuente original va citada en cada línea.

**Tamaño y forma del mercado**
- **43.672 dentistas colegiados en España en 2025**, +1,9% sobre los 42.860 de 2024. El 97% ejerce en el ámbito privado. *(INE, citado por el Consejo General de Dentistas, 27 may 2026.)*
- **Madrid: ~3.582 clínicas dentales y 9.515 dentistas colegiados.** *(Corrección aportada por Simon, 31 jul 2026 — la fuente citable está pendiente de adjuntar; ver §5.)*
- **~23.000 clínicas operativas en España.** Dato frágil: las fuentes van de ~7.600 a ~23.000 según qué cuenten por "clínica". *(Recogido en el informe de jul 2026, que declara la divergencia.)*
- **71,8 visitas semanales de media por clínica en 2025**, frente a 79,2 en 2019. *(Estudio Key-Stone/Fenin sobre 448 clínicas.)*
- **Mercado odontológico español por encima de 1.200 M€.** *(Informe "Panorama y perspectiva del sector dental en España", presentado en Expodental 2026.)* Otras definiciones dan de ~970 M€ ("servicios odontológicos") a ~12.000 M€ ("gasto privado total"): la cifra depende de qué se mida.
- **Precios al paciente:** ticket medio ~150-300 €; implante ~1.640 €; ortodoncia 2.200-6.300 €.

**Gesden (Infomed, Grupo Henry Schein) — el PMS que nos vamos a encontrar**
- Declara **14.000 clínicas en España**. *(Comunicación de la propia Infomed.)*
- Dos versiones: **G5** (escritorio Windows, datos en SQL Server local) y **ONE** (cloud, servidores de Infomed).
- Su capa comercial es **seguimiento de estado** del presupuesto (presentado → aceptado → en curso → finalizado) dentro de un "módulo CRM". La automatización nativa es SMS/email; WhatsApp llega por el Pack Premium y como recordatorio.
- **No tiene API REST pública oficial.** Los integradores leen la base SQL Server con un agente Windows instalado en el servidor de la clínica, bajo NDA y contrato de encargado de tratamiento (art. 28 RGPD). *(EBROTECH lo afirma literalmente; ImaCash documenta el mismo patrón, pidiendo IP, base, instancia y credenciales de SQL Server.)*
- PMS que **sí** tienen API documentada: **Dentalink** (Healthatom, REST, de pago) y **XDental Cloud**.

**WhatsApp y datos de salud**
- La **Política de mensajes de WhatsApp Business** dice literalmente: *"No utilices WhatsApp para ofrecer telemedicina ni para enviar o solicitar información sobre salud si las regulaciones aplicables prohíben la distribución de este tipo de datos en sistemas que no cumplen con requisitos más estrictos"*.
- Un **tratamiento dental concreto vinculado a una persona es dato de salud** (art. 9 RGPD). El importe por sí solo no lo es; **tratamiento + importe juntos, sí**.
- **Recordatorio de cita** = base legal de ejecución de contrato. **Marketing** = opt-in explícito. Meta es estadounidense, así que hay que analizar transferencias internacionales (SCC).
- **No consta** una resolución pública de la AEPD específica por WhatsApp automatizado en clínica dental. Sí las hay contra clínicas dentales por otras causas: 1.200 € por grabación en gabinete, 5.000 € por denegación de acceso, y expedientes por brecha de seguridad.
- **No se ha podido confirmar** que Meta ofrezca un DPA específico válido para datos de categoría especial. La evidencia disponible es su propia Política, que traslada el riesgo al proveedor y a la clínica.

**Competencia — lo que publican ellos mismos**
- **Engrana** (engrana.es, AUVE Media Group SL, Terrassa). Se autodefine como **capa sobre el PMS, no sustituto**: *"si ya tienes Klinikare, Dentalink o Gesden (…) Engrana se le suma"*. Compatible con Gesden/Dentalink/Klinikare/Odontonet/Clinic Cloud sin migrar. **Precio público: 89 €/mes plano, sin permanencia.** Publica "Contrato Art. 28 RGPD firmable" y "BSP europeo". Su foco es no-shows, recall, reseñas y cobros.
- **Kandent Tools** (tools.kandent.es), cita literal: *"El 50% de los presupuestos que se aceptan no se aceptan en la primera visita. Se aceptan después de un seguimiento proactivo. Si no haces seguimiento, pierdes la mitad de los que iban a decir sí."* Precios 29/39/69/129 €/mes. Son herramientas sueltas, sin conexión al PMS en vivo.
- **Dentiqa** (LATAM): PMS sustituto con pipeline comercial Kanban (contactó → presupuestó → evaluando → aceptó → en tratamiento). USD 89/149/249 al mes.
- **Precio del mercado complementario:** ~29-150 €/mes por clínica (Kandent 29-129 €, Engrana 89 €, Clinicbot 55 €, Docfav 33 €/profesional).

**Canal**
- **Expodental** (IFEMA Madrid) es el evento de referencia y es **bienal**. La edición anterior: 374 expositores, más de 24.500 m² netos y cerca de 30.000 visitantes profesionales *(Gaceta Dental, dic 2025)*. La de 2026 se celebró del 11 al 13 de marzo — **ya pasó**; la siguiente es 2028. Infomed/Gesden expuso con stand de 140 m².
- **Kit Digital** financia software de gestión de clientes, con bonos por tamaño de empresa. **Infomed, Klinikare y Odontonet ya son agentes digitalizadores.** Los importes varían por convocatoria.

**Anotado como afirmación de tercero, NO como dato** *(§ regla de higiene)*
- Buena parte de las "opiniones sobre Gesden" que circulan online proceden de **competidores** (Akeito, Docfav) o de agencias, no de foros independientes.
- Los porcentajes de mejora que publican los proveedores del sector (−40% no-shows, +30% aceptación, ROI 200%) son **claims sin verificación independiente**.
- **Aimoova** afirma integración *"nativa vía API oficial"* con Gesden, lo que es difícil de sostener si Gesden no publica API. O tienen un acuerdo que no consta, o es marketing.

---

## 3 · Interpretaciones

Deducciones nuestras a partir de la evidencia. No son hechos: son lecturas que pueden caer.

**España y Perú son mercados distintos, no estrategias en conflicto.** Flores describe un mercado de cartera y confianza; España es de captación por densidad competitiva. El error habría sido reorientar Fyllio al modelo peruano por una conversación. Lo que sí aplica de él: incluso en un mercado de captación, **el paciente que ya está en la clínica sigue generando presupuestos**, así que la no-pérdida vale para los dos mundos.

**"Flexible" no significa lo que parece.** Lo que pide Flores no es "que se pueda configurar todo" — es *"que no me obligues a trabajar de una forma que no es la mía"*. Son cosas distintas: la primera lleva a un CRM genérico donde ya compiten HubSpot y similares; la segunda se resuelve con vocabulario configurable y flujos intermedios sobre un motor vertical.

**El tratamiento en pausa es un flujo intermedio, no un módulo del estándar.** Habrá clínicas que lo necesiten y clínicas que no. El producto debe poder albergarlo **sin romper el ciclo**, y eso lo convierte en candidato natural a premium.

**El tipo de tratamiento probablemente predice el no-show mejor que el historial de comportamiento.** Se deduce de la observación de Flores (se falta cuando no duele). Es un dato que ya está en cada cita y sería la variable de más señal si se reactiva el predictivo.

**Zolutium es HubSpot con IA encima, y su libertad es su debilidad frente a un vertical.** *(De la
observación directa del 5 ago 2026.)* Un lienzo en blanco de workflows exige que el cliente **sepa
qué flujo quiere**, y una clínica dental pequeña no lo sabe: sabe que se le pierden presupuestos.
Quien no sabe qué flujo quiere no compra un lienzo — compra un flujo. Fyllio lo trae puesto, y eso
**se defiende como ventaja, no como límite**: es la misma línea que ya se decidió con la rigidez que
señaló Flores («este es el producto estándar; su necesidad concreta la cubrimos como flujo
intermedio»). El corolario incómodo: cuando alguien nos diga «HubSpot ya hace esto», la respuesta no
es una lista de funciones, es *«¿y quién le ha montado el flujo?»*.

**Su modelo de negocio implica consultoría, el nuestro no puede.** Los ~1.200 USD se pagan a un
consultor externo que configura y entrena. Eso factura horas y no escala, y además supone una clínica
con alguien dispuesto a sentarse a diseñar flujos. **Es exactamente el hueco por el que entra un
vertical que no cobra por configurar** — y es la premisa del entrenamiento continuo de la fase 4 de
[`PLAN-AGENTE.md`](PLAN-AGENTE.md): el sistema aprende de lo que la clínica ya hace, sin sesiones ni
equipo dedicado.

**Su agente probablemente no tiene punto de quiebre — y si se confirma, es LA diferencia.** Su bucle
de entrenamiento («califica la respuesta, y si está mal escribe la correcta») presupone que el agente
**siempre contesta**: lo que se corrige es *qué dijo*, no *si debió decir algo*. Eso es un producto
que optimiza la respuesta; Fyllio decide **cuándo no responder**. Si se confirma, no compiten en lo
mismo. **Marcado como no confirmado a propósito**: se dedujo de usar la plataforma, no de leer su
documentación ni de preguntárselo, y una ventaja competitiva que se sostiene sobre «no lo he visto»
es exactamente la clase de afirmación que esta sección existe para no dar por buena.

**El interlocutor puede no ser joven.** Si quien decide y paga en muchas clínicas es alguien de 55-65 años, el tono de la comunicación por WhatsApp (cercano, con emojis) podría estar calibrado para el usuario equivocado.

**El hueco existe, pero es un hueco de ejecución, no de idea.** Engrana vende ya nuestra misma tesis —capa que convive con el PMS en vez de sustituirlo— a 89 €/mes, con Gesden entre sus compatibles y el cumplimiento publicado en su web. Lo que no tiene es el pipeline diario de presupuestos que se enfrían más los cobros pendientes. Es decir: **"somos una capa, no un sustituto" ya no es un diferenciador, es el precio de entrada.** El diferenciador es lo que hace la capa.

**El cumplimiento dejó de ser un argumento y pasó a ser tabla mínima.** Cuando el competidor publica "Contrato Art. 28 firmable" y "BSP europeo" en su página de precios, no tenerlo es una objeción en la primera reunión, no un extra que vender.

**La integración con Gesden es la decisión técnica más cara del año y no depende de nosotros.** Leer la base SQL Server con un agente local funciona —lo hace todo el sector— pero es frágil ante cada actualización de Gesden, y jurídicamente incómoda: la licencia del fabricante puede prohibirlo y nadie lo ha bendecido. Consecuencia incómoda: **el discurso "capa sobre tu PMS" es fácil de vender y caro de sostener**, y el coste no aparece hasta el segundo cliente, cuando hay dos versiones de Gesden que mantener.

**El mensaje neutro deja de ser una preferencia de tono para ser un requisito de diseño, y hoy no lo cumplimos.** La plantilla que servimos como ejemplo dice literalmente *"Confirmamos tu presupuesto de {{importe}}€ para {{tratamiento}}"* (`scripts/db-seed-demo-rico.mjs:1164`), y el editor de plantillas ofrece las dos variables juntas a cualquier clínica (`app/(authed)/ajustes/configuracion/ConfiguracionView.tsx:1011`). Tratamiento + importe en un WhatsApp es exactamente el caso que el art. 9 cubre y que la política de Meta restringe. Anotado como [MEJORAS 83](MEJORAS-PENDIENTES.md).

**El ROI se puede argumentar antes del piloto, pero con un número prestado.** Un implante recuperado (~1.640 €) paga casi un año a 149 €/mes. Eso sostiene la respuesta a la objeción del pago único **como argumento**, no como prueba: H1 sigue abierta hasta que el número salga de RB y no del mercado.

**La coordinadora no es solo la usuaria: es la aliada en la venta.** Decide dirección o gerencia, pero quien sufre el trabajo que Fyllio quita es ella. Encaja con la esencia del producto — si le ahorra pasos de verdad, empuja hacia dentro; si le añade una pantalla más que mirar, empuja hacia fuera.

**Que Madrid tenga 3.582 clínicas y no 9.000 no tumba el fundamento, pero sí el pitch.** Sigue siendo una densidad altísima (del orden de una clínica por cada 2.000 habitantes), así que el argumento de mercado de captación aguanta. Lo que no aguanta es decir el número en voz alta sin comprobarlo: el que se estaba usando era 2,6 veces el real, y era el único dato duro de todo el documento.

---

## 4 · Hipótesis

| # | Hipótesis | Estado | Cómo se valida |
|---|---|---|---|
| H1 | La objeción del pago único se responde con dinero recuperado, no con funcionalidades | Abierta | Al mes de piloto con RB: calcular euros recuperados de casos que se habrían enfriado. Si supera holgadamente la mensualidad, la objeción muere. Si no, es problema de precio o de producto |
| H2 | El motor es universal; lo que varía es vocabulario, umbrales, roles y flujos intermedios | Abierta | Tomar tres clínicas distintas (RB, la independiente, Flores) y listar qué habría que configurar en cada una. Si con esas palancas las tres funcionan, se sostiene. Si alguna necesita un flujo estructuralmente distinto, cae |
| H3 | El tratamiento en pausa con dependencia externa es frecuente, no una anécdota | Abierta | Preguntar a RB: cuántos tratamientos tienen parados esperando a un especialista externo o a que el paciente vuelva, y cómo los siguen hoy. Si la respuesta es "muchos, de memoria o en Excel", es un premium con demanda real |
| H4 | En el mercado español la captación pesa más que la cartera, y por eso Fyllio encaja | Abierta | Preguntar a RB qué proporción de sus presupuestos nace de captación frente a pacientes que ya tienen. Contrastar con la clínica independiente |
| H5 | El modelo estándar/premium hace pagable la mensualidad y resuelve la objeción de rigidez | Abierta | Presentar los dos planes a RB y a Flores y ver si la conversación cambia. Señal positiva: preguntan qué incluye el premium en su caso concreto |
| H6 | El tipo de tratamiento predice el no-show mejor que el historial del paciente | Abierta | Con datos reales del piloto: cruzar tasa de ausencia por tipo de tratamiento. No requiere reactivar el módulo, solo medir |
| H7 | Convivir con el PMS (no sustituirlo) es lo que hace vendible a Fyllio en una clínica que ya tiene Gesden | Abierta | Preguntar a RB si cambiarían de PMS por Fyllio. Si la respuesta es "ni de broma", la capa es obligatoria y la integración deja de ser opcional. Si es "nos lo plantearíamos", se abre una vía mucho más barata |
| H8 | El diferenciador defendible no es ser capa, sino el panel diario de presupuestos que se enfrían + cobros | Abierta | Enseñar a RB el panel al lado de la lista de estados de Gesden y ver si distinguen el valor sin que se lo expliquemos. Si no lo distinguen, el foso no existe todavía |
| H9 | **El mensaje conforme convierte lo suficiente.** «Conforme» = sin tratamiento ni importe (art. 9) **y** declarando que hay un sistema de IA detrás (Reglamento europeo de IA) | Abierta | A/B en el piloto: mismo caso, mitad con el mensaje conforme + enlace al portal, mitad con el actual. **Reformulada el 12 ago de 2026** — antes preguntaba solo por el mensaje neutro. Ver por qué abajo |
| H10 | Una red de 3-15 clínicas paga 89-149 €/mes por clínica sin que el precio sea la objeción | Abierta | Presentar el precio a RB en la reunión de agosto. Señal negativa: piden precio por red en vez de por clínica |
| H11 | Decide gerencia, pero la coordinadora puede matar la venta | Abierta | En la reunión de RB, ver quién habla y quién pregunta por el día a día. Y en el piloto, medir uso real por usuaria: si la coordinadora no entra a diario, la renovación está en riesgo aunque gerencia esté contenta |
| H12 | **El aplazamiento medido dispara el salto a premium**: la clínica ve «tu agente aplazó 47 preguntas de horario este mes» y pide conectar su agenda. El dato vende, no un comercial | Abierta | En el piloto, con el agente genérico: enseñar el recuento de aplazamientos por clave y naturaleza (la taxonomía de la migración 021 existe en parte como soporte de esta hipótesis) y ver si la clínica pide conectar su fuente. La métrica que debería probar el valor del premium: **% de conversaciones transferidas en genérico frente a configurado** — medible con lo ya construido. Añadida 13 ago 2026 |

**Refutadas** *(no se borran: evitan repetir el error)*

| # | Hipótesis | Por qué cayó |
|---|---|---|
| R1 | "El 52% de los pacientes no viene de un lead, luego el mercado es de cartera" | El dato salía del seed de DEMO, que es inventado. No describía ningún mercado. 30 jul 2026 |
| R2 | "Más de 9.000 clínicas dentales solo en Madrid" | Confusión de unidad: 9.515 son los **dentistas colegiados** de Madrid, no las clínicas. Las clínicas son ~3.582 — 2,6 veces menos. El fundamento de densidad sobrevive; el número no. 31 jul 2026 |

**Sin decidir (13 ago 2026):** los niveles de precio y qué entra exactamente en cada plan. Lo
decidido en firme del modelo de agente único (básico/premium, precio plano, la puesta a prueba en
todos los planes) está en `DECISIONES.md` con esa fecha; esto de aquí es lo que falta.

---

### Por qué H9 pregunta por el mensaje conforme y no por cada variable

**Reformulada el 12 de agosto de 2026, y conviene dejar escrito el razonamiento porque parece una
rendición y no lo es.**

El problema que la obligó: las plantillas que abren cadencia van a cambiar por **dos motivos a la
vez** — el mensaje neutro que exige el art. 9 y la **declaración de que hay un sistema de IA
detrás** (Reglamento europeo, §5). Si las dos entran en el mismo texto y se lanza el A/B, la caída
de conversión —si la hay— no se puede atribuir a ninguna de las dos. Y no hacía falta que nadie se
equivocara: el orden natural de las cosas —plantillas listas, consulta legal pendiente, alta fiscal
en curso— empujaba justo a meterlas juntas.

**Por qué separarlas no merece la pena.** Las dos son **obligatorias**. No se puede elegir no
declarar la IA, ni elegir revelar tratamiento e importe. Así que saber cuál de las dos pesa más
**no cambia ninguna decisión**: sea cual sea la respuesta, el mensaje tiene que cumplir las dos.

Lo que sí cambia decisiones es **si el mensaje que cumple funciona**. Y si no funciona, el problema
que hay que resolver no es «cuál de las dos variables pesa» sino **cómo se abre una conversación** —
que es un problema de producto, no de atribución estadística.

De ahí «convierte **lo suficiente**» en vez de «convierte **igual**»: el listón no es empatar con un
mensaje que ya no se puede enviar. El listón es que la cadencia siga siendo rentable.

**Lo que queda por fijar antes del piloto, y sí es urgente:** qué es «suficiente». Un umbral escrito
antes de ver el dato, no después — si se decide con la cifra delante, se decidirá que sí. Sale de la
cuenta de la clínica: cuántos presupuestos hay que recuperar para que la cadencia pague lo que
cuesta.

---

## 5 · Preguntas abiertas

### Para RB Dental — reunión de agosto 2026

**Sobre el negocio**
- ¿Qué proporción de vuestros presupuestos nace de captación y cuál de pacientes que ya tenéis? *(decide la narrativa — H4)*
- ¿Cuánto se os enfría al mes y cuánto vale en euros? *(es la respuesta medida a la objeción del pago único — H1)*
- ¿Con qué aseguradoras trabajáis y qué porcentaje de volumen representan?
- ¿Cuántos tratamientos tenéis parados esperando a un especialista externo o a que el paciente vuelva, y cómo los seguís hoy? *(H3)*
- ¿Qué % de vuestros tratamientos se financia o fracciona? ¿Financiáis vosotros o una financiera externa? *(decide el diseño del módulo de pagos fraccionados)*

**Sobre el PMS y la integración** *(nuevo, 31 jul 2026 — es lo que decide la arquitectura)*
- ¿Qué software de gestión usáis, y si es Gesden, **G5 o ONE**? ¿Qué versión? *(G5 = agente local sobre SQL Server; ONE = por confirmar si hay API — H7)*
- ¿Quién administra el servidor de la clínica y quién tendría que autorizar que leamos la base?
- ¿Cambiaríais de software de gestión, o Fyllio tiene que convivir con el que ya tenéis sí o sí? *(H7)*
- ¿Habéis probado alguna herramienta que se "sume" a vuestro software? ¿Qué pasó? *(mide cómo de gastado está el discurso de la capa)*

**Sobre flexibilidad**
- Las 10 clínicas, ¿trabajan igual entre sí o hay diferencias de flujo? *(primer test de flexibilidad, gratis — H2)*
- ¿Qué configuraríais si pudierais: estados, plazos, motivos, roles, vocabulario?
- ¿Qué pasos de vuestro día a día no cubre Fyllio? *(candidatos a premium)*

**Sobre datos y onboarding**
- ¿Tiene vuestro software API o exportación? ¿Expone un identificador estable de paciente? *(si no lo expone, leer de él solo sirve para consultar y la migración pasa a ser la única vía)*
- ¿Cuántos pacientes activos tenéis? ¿Os incomoda que vuestros datos vivan también en Fyllio? *(RGPD y contrato de encargado de tratamiento)*
- ¿Quién usa el producto a diario y qué edad tiene? *(calibra el tono de la comunicación — H11)*
- ¿Qué escribís hoy en los WhatsApp a pacientes: nombráis el tratamiento y el importe? *(H9, y dice cuánto duele el mensaje neutro)*

**Sobre precio**
- ¿Qué os haría pagar cada mes en lugar de una vez?
- ¿Precio por clínica o por red? *(H10)*

### Para Alfredo Flores — seguimiento en semanas

- Enseñarle el producto con dos narrativas distintas (captación vs. no-pérdida) y ver cuál le enciende. *(H4, y es gratis)*
- Contrastar el modelo estándar/premium con su objeción original de rigidez. *(H5)*

### Sin destinatario aún

- **Adjuntar la fuente citable** de las ~3.582 clínicas de Madrid y de las ~23.000 de España (INE, Consejo General de Dentistas, colegios profesionales). *(La cifra ya está en §2.2; lo que falta es poder citarla en el pitch sin que dependa de nuestra palabra.)*
- **Confirmar con Infomed** si Gesden ONE expone API o webhooks. Algunas fuentes de terceros lo afirman; no hay documentación pública. *(Cambia la arquitectura entera — ver §3.)*
- **Asesoría jurídica** sobre el DPA de Meta para datos de categoría especial, antes de tratar cualquier dato de salud por WhatsApp. Es el punto que el informe deja explícitamente sin resolver.
- **Reglamento europeo de IA — obligación de transparencia, en vigor desde el 2 de agosto de 2026.**
  Quien habla con un sistema de IA **tiene derecho a saberlo**. Nuestro primer mensaje dice hoy *«soy
  asesor de la clínica»*, y **probablemente no basta**: identifica al emisor, no a la naturaleza del
  interlocutor. Hay que preguntar por escrito **qué formulación cumple y dónde tiene que aparecer**
  — solo en el primer mensaje de cada conversación, o también al reanudar después de días.
  *(Es la pregunta con más superficie de producto de las tres legales: afecta al **primer mensaje de
  cada conversación**, o sea al texto de las plantillas que abren cadencia
  ([`PLANTILLAS-WHATSAPP.md`](PLANTILLAS-WHATSAPP.md)) y al tono de todo el agente. Y toca H9: si la
  declaración obligatoria enfría la conversación, eso se suma al efecto del mensaje neutro que esa
  hipótesis ya mide.)*
- **Convocatoria vigente de Kit Digital** en acelerapyme.gob.es: importes reales y requisitos para darse de alta como agente digitalizador.
- ¿El comprador de una clínica de 2-3 sillones tiene el mismo dolor que una red de 10? ¿Paga lo mismo?
- ¿Cuál es el precio de referencia de los softwares de pago único con los que competimos y qué incluyen?
- **Zolutium: cuál es su licencia recurrente.** Lo único que sabemos es el coste de puesta en marcha
  (~1.200 USD a un consultor); la mensualidad del software no la conocemos, y sin ella no se puede
  comparar con H10. *(De la observación del 5 ago 2026 — ver §2.1.)*
- **Zolutium: ¿su agente traspasa a una persona en algún momento?** Por dentro no se vio nada, pero
  no se leyó su documentación ni se preguntó. Es la diferencia que más pesaría si se confirma, así
  que **es la que menos se puede dar por supuesta** — ver §3.

---

## 6 · Cómo se mantiene este documento

Después de cada conversación con una clínica, cinco minutos:

1. Añadir lo que dijeron a **Evidencia de campo** (§2.1), con nombre y fecha. Solo lo que dijeron.
2. Actualizar el estado de las **hipótesis** que toquen. Una hipótesis refutada se marca y se mueve a la tabla de refutadas con el motivo — **nunca se borra**.
3. Añadir las **preguntas nuevas** que hayan surgido.
4. Si algo cambia un **fundamento**, anotarlo como giro con su fecha y su razón.

Cuando llegue una **investigación externa**, se guarda como archivo propio con su fecha (`INVESTIGACION-MERCADO-AAAA-MM.md`), **no se edita nunca**, y de ahí se vuelca: los datos con fuente a §2.2, las conclusiones a §3 marcadas como interpretación, las hipótesis nuevas a §4 en abierto. Sus recomendaciones **no se implementan** por estar escritas: necesitan una decisión explícita en `DECISIONES.md`.

Cuando una hipótesis validada cambie el producto, la decisión va a `DECISIONES.md` citando la entrada de este documento que la justifica. `DECISIONES.md` guarda qué se decidió; `MERCADO.md` guarda por qué tenía sentido.
