# Fyllio: Investigación estratégica — CRM de "no-pérdida" para clínicas dentales en España

> **Investigación externa de julio 2026. Contiene datos verificados, afirmaciones comerciales
> de terceros y recomendaciones no aprobadas. Nada de aquí se implementa sin decisión
> explícita en [`DECISIONES.md`](DECISIONES.md).**
>
> **Esto es una foto fechada, no un documento vivo.** No se edita: cuando haya investigación
> nueva se añade otro archivo con su fecha y este se queda como está. Lo que de aquí pasa a
> ser conocimiento nuestro —con su fuente y su fecha— vive en [`MERCADO.md`](MERCADO.md),
> separando evidencia de interpretación.

## TL;DR
- **El hueco funcional existe y sigue mayoritariamente abierto**: Gesden trata los presupuestos como estados pasivos (presentado/aceptado/en curso) dentro de un módulo CRM básico, no como un pipeline proactivo con panel diario de acción, y su comunicación nativa es SMS/email/WhatsApp de recordatorio, no seguimiento comercial sugerido por IA. Ningún producto español reúne simultáneamente los 5 rasgos de Fyllio (capa sobre PMS + ciclo lead→cobro + presupuestos enfriados + cobros pendientes + panel diario con WhatsApp por IA). El rival estructural más peligroso es **Engrana** (misma tesis "capa que convive con el software del negocio, no sustituto", precio plano 89 €/mes sin permanencia, ya integrado con Gesden, con "Contrato Art. 28 RGPD firmable" y "BSP europeo"), pero su foco es no-shows/recall/reseñas, no el pipeline de presupuestos.
- **La integración con Gesden es viable pero delicada**: Gesden **no tiene API REST pública oficial**; G5 guarda datos en SQL Server local y ONE es cloud. La vía real es un agente local que lee la BD bajo contrato de encargado de tratamiento (art. 28 RGPD) y NDA — funciona pero es frágil ante cambios de versión y jurídicamente sensible sin permiso del fabricante. Para leads/pacientes nuevos el patrón estándar es que la herramienta sea fuente de verdad del lead y el PMS la del paciente, con sincronización controlada.
- **WhatsApp automatizado es legal con condiciones estrictas**: hay que usar WhatsApp Business API vía proveedor con servidores UE, DPA firmado (art. 28) y consentimiento; los recordatorios de cita se amparan en ejecución de contrato, pero el marketing exige opt-in explícito. Un mensaje que nombra un tratamiento dental concreto es dato de salud (art. 9 RGPD) y debe minimizarse. **La propia Política de mensajes de WhatsApp Business prohíbe enviar/solicitar información de salud cuando la regulación aplicable lo restringe** — un riesgo de cumplimiento que Fyllio debe diseñar desde el minuto uno.

## Key Findings

1. **Gesden domina con 14.000 clínicas** ("El Software de Gestión líder en España con 14.000 clínicas", según la propia Infomed, del Grupo Henry Schein) y es un PMS clínico completo, pero su capa comercial es débil: presupuestos con seguimiento de estado (no pipeline proactivo), recalls y automatización por SMS/email, y un "módulo CRM" que gestiona presupuestos de forma pasiva. No tiene panel de "qué hacer hoy" ni IA que recomiende el siguiente paso por caso.

2. **Gesden no tiene API pública**. G5 = SQL Server local; ONE = cloud. Los integradores actuales (EBROTECH, ImaCash, middlewares de voz IA) leen la BD SQL Server con un agente Windows local. Otros PMS SÍ tienen API documentada: **Dentalink** (API REST de pago, docs públicas en healthatom.com), **XDental Cloud**. Clinic Cloud integra vía sincronización (p.ej. Doctoralia). Los cloud son integrables; los de escritorio no.

3. **El problema de doble entrada se resuelve con la herramienta como fuente de verdad del lead y el PMS como fuente de verdad del paciente**, con sincronización uni o bidireccional. Doctoralia↔Clinic Cloud es bidireccional por agendas; muchos chatbots operan sin integración (recogen datos y el equipo los pasa al PMS a mano) o con conector a medida.

4. **WhatsApp**: legal con WhatsApp Business API + proveedor UE + DPA + consentimiento. Recordatorios de cita = base legal de ejecución de contrato; marketing = opt-in explícito. Meta, como empresa estadounidense, obliga a analizar transferencias internacionales (SCC). La Política de WhatsApp Business restringe expresamente los datos de salud. La AEPD ha sancionado a clínicas dentales por otras causas (grabación en gabinete 1.200 €, brecha de seguridad, denegación de acceso 5.000 €) pero no hay una sanción-tipo pública específica por WhatsApp automatizado dental; el riesgo es real por analogía.

5. **Competencia**: se divide en (1) chatbots/recepcionistas (Clinicbot, Cliniflux, Automatika, automatizator.es, Aimoova, Javadex), (2) PMS completos con módulo de presupuestos (Klinikare, Clinicbox, Dendoo, Nubimed, Docfav, Akeito; Dentiqa y Odontix en LATAM), y (3) capas CRM de seguimiento comercial (Engrana, Kandent Tools, Growlityc). Nadie combina exactamente el modelo Fyllio.

6. **Entrada al mercado**: Expodental (IFEMA, 11-13 marzo 2026) es el evento clave; COEM y colegios profesionales dan acceso al canal; Kit Digital financia software (bonos según tamaño) y Fyllio podría ser agente digitalizador. Precios de mercado de herramientas complementarias: ~29-129 €/mes (Kandent), 89 €/mes (Engrana), 55 €/mes (Clinicbot).

## Details

### 1. Qué ofrece Gesden, módulo a módulo, y qué hueco deja

Gesden, de Infomed (Grupo Henry Schein), lleva más de 25 años en el mercado y declara 14.000 clínicas en España. Existe en dos versiones:
- **Gesden G5**: escritorio, Windows, datos en servidor local (SQL Server). Interfaz densa y veterana; funciona sin internet. Modelo de licencia + mantenimiento anual opcional.
- **Gesden ONE**: cloud, navegador, datos en servidores de Infomed; interfaz más moderna, actualizaciones y backups automáticos. Modelo de suscripción.

**Módulos**: agenda multigabinete/multicentro con call center; ficha de paciente e historia clínica; odontograma detallado por pieza; presupuestos con circuito completo (presentado→aceptado→en curso→finalizado); circuito de cobros (facturas, anticipos, anulaciones), liquidación de mutuas; facturación con VeriFactu certificado; imagen radiológica (PACS, Image ONE); laboratorio (Novalab); comunicaciones (SMS y Emailing); Cita Online; Automatización (envíos programados por email/SMS: recalls, recordatorios, felicitaciones); Cuadro de Mandos (KPIs); Agenda Mobile; Clinipad (firma digital en tablet); Check In/Check Out; dentIA (IA de diagnóstico por imagen); ONE PAY (pago). El **Pack Premium** agrupa WhatsApp/SMS/emailing, ONPAY, dentIA, ImageOne, cuadro de mandos, control horario y KPIs.

**Seguimiento comercial — el punto clave**: Gesden tiene un "módulo CRM" que, según su propia comunicación y análisis de terceros, permite "seguimiento exhaustivo de los presupuestos entregados". Es decir: se puede VER el estado de cada presupuesto (presentado/aceptado/en curso/finalizado) y filtrar los pendientes. Pero esto es un **estado pasivo en una lista**, no un pipeline proactivo. No hay:
- Panel diario de acción ("hoy contacta a estos 5 presupuestos que se enfrían").
- IA que recomiende el mensaje o el siguiente paso por caso.
- Seguimiento nativo por WhatsApp conversacional (la automatización nativa es SMS/email; WhatsApp llega vía Pack Premium y de forma limitada, más como recordatorio que como seguimiento comercial).

**Quejas/opiniones reales**: interfaz anticuada (sobre todo G5), curva de aprendizaje pronunciada, costes adicionales por módulos, tiempos de respuesta de soporte lentos según algunos usuarios, precio opaco (requiere contacto comercial). Análisis independientes señalan que Gesden "tiene limitaciones" en integración con marketing digital, seguimiento de leads y automatización de email, que hay que resolver con herramientas externas. **Este es exactamente el hueco de Fyllio**. (Nota: buena parte de las "opiniones" disponibles online provienen de competidores como Akeito o de agencias, no de foros independientes; conviene tratarlas como afirmaciones interesadas.)

### 2. Integración técnica con Gesden y otros PMS

**Confirmado**: Gesden no tiene API REST pública oficial. Un integrador (EBROTECH) lo dice literalmente: *"Gesden no tiene API REST pública oficial. (…) Lo que sí hay (…) es acceso directo a la base de datos SQL Server local de la clínica"*, leída con un agente Windows instalado en el servidor de la clínica "bajo NDA y bajo contrato de encargado de tratamiento Art. 28 RGPD". ImaCash documenta el mismo patrón: pide IP del servidor, nombre de BD, instancia y credenciales de SQL Server. Gesden ONE, al ser cloud, se puede integrar más fácilmente (algunas fuentes de terceros afirman que expone API/webhooks), pero no hay documentación pública oficial que lo confirme.

**Riesgos legales de leer la BD sin permiso del fabricante**: (a) la licencia de uso de Gesden puede prohibir el acceso directo a la BD; hacerlo sin autorización expone a incumplimiento contractual; (b) RGPD: la clínica es responsable del tratamiento y Fyllio sería encargado (art. 28), obligando a DPA, medidas de seguridad y registro de actividades; (c) fragilidad técnica: cualquier actualización de Gesden puede cambiar el esquema de la BD y romper el conector. Es una integración "de facto" tolerada, no bendecida por el fabricante.

**Otros PMS**:
- **Dentalink** (Healthatom): API REST pública documentada (api.dentalink.healthatom.com), con lectura y escritura, tokens por usuario admin; **de pago**. Es la más abierta.
- **XDental Cloud**: API pública documentada.
- **Clinic Cloud**: cloud; integra con Doctoralia por sincronización de agendas; conector propio.
- **Odontonet, Nubimed, Docfav, VeiviClinic, Klinikare, Clinicbox, Dendoo**: cloud; integrabilidad variable, la mayoría sin API pública ampliamente documentada (verificar caso a caso).
- **Gesden G5**: sin API; lectura de BD SQL Server con agente local.

**Vía habitual de integración para un producto complementario**: para cloud con API (Dentalink, XDental), consumir la API REST; para Gesden y escritorios, agente local que lee la BD + escribe de vuelta lo imprescindible. Plataformas low-code (Make, n8n) se usan como puente; middlewares de terceros (p.ej. el de voz IA de Sergio de la Rosa) ya hacen esto con Gesden/Doctoralia/Clinic Cloud/VeiviClinic.

### 3. El problema de la doble entrada de datos

El patrón dominante en el sector es: **la herramienta complementaria es fuente de verdad para leads/oportunidades y el PMS es fuente de verdad para pacientes/historia clínica**. Variantes observadas:
- **Sin integración (manual)**: el chatbot/CRM recoge datos por WhatsApp, el equipo confirma la cita en el PMS a mano (modelo por defecto de Cliniflux en su plan básico). Barato pero con doble entrada.
- **Sincronización unidireccional**: la herramienta empuja la cita/paciente al PMS.
- **Bidireccional**: caso Doctoralia↔Clinic Cloud (integración por agendas; primero viaja Clinic Cloud→Doctoralia y luego en ambos sentidos), evitando duplicidades pero exigiendo "limpiar" agendas para no duplicar.

Problemas conocidos: conflictos de agenda (dos canales reservando el mismo hueco — se resuelve con buffers), duplicación de fichas (mismo paciente creado dos veces), y el reto de mapear identidades (teléfono/DNI como clave). Para Fyllio, la recomendación de patrón es: crear el lead en Fyllio, y al convertirse en paciente, hacer un match por teléfono/DNI contra el PMS y crear/actualizar la ficha una sola vez, con Fyllio como capa de seguimiento y el PMS como registro clínico.

### 4. WhatsApp automatizado en sanidad: qué permite y qué prohíbe la regulación

**Es legal automatizar WhatsApp con pacientes dentales en España, con condiciones**:
- **WhatsApp normal vs Business API**: la app normal vive en un móvil, no escala ni se integra, y su uso comercial masivo no está autorizado. La **WhatsApp Business API (Cloud API)** es la vía profesional: multiagente, plantillas aprobadas, integración y trazabilidad. Para una clínica que envía a decenas de pacientes/día, la API es obligatoria de facto.
- **DPA y servidores UE**: el RGPD (art. 28) exige DPA con cualquier encargado. Meta es estadounidense, así que hay que analizar transferencias internacionales (SCC). La práctica de los proveedores que venden a clínicas es contratar la API a través de un BSP/proveedor con infraestructura en la UE y firmar DPA con la clínica. **Punto crítico no resuelto públicamente**: no está claro que Meta ofrezca un DPA específico válido para datos de salud de categoría especial; de hecho, la Política de mensajes de WhatsApp Business dice literalmente: *"No utilices WhatsApp para ofrecer telemedicina ni para enviar o solicitar información sobre salud si las regulaciones aplicables prohíben la distribución de este tipo de datos en sistemas que no cumplen con requisitos más estrictos"*. Esto traslada el riesgo a la clínica/proveedor.
- **Qué se puede enviar**: recordatorios de cita (fecha/hora/profesional), confirmaciones, mensajes logísticos — amparados en ejecución de contrato. **Qué minimizar/evitar**: nombrar el tratamiento concreto y el importe en el propio mensaje, porque un tratamiento dental identificable asociado a un teléfono es dato de salud (art. 9 RGPD). Recomendación práctica del sector: mensajes neutros ("tienes un presupuesto pendiente, entra a tu portal") en vez de "tu presupuesto de implante de 1.640 €".
- **¿Es dato de salud un mensaje que menciona tratamiento + precio?** Sí: la mención de un tratamiento dental concreto vinculado a un individuo cae en el art. 9. El precio por sí solo no, pero combinado con el tratamiento sí revela información de salud.
- **Consentimiento**: explícito para el canal WhatsApp (recogido en el alta o formulario web), informando en la política de privacidad; opt-in adicional para comunicaciones comerciales/marketing.
- **LOPDGDD y Ley 41/2002**: la Ley 41/2002 (autonomía del paciente) rige la historia clínica y su confidencialidad; la LOPDGDD complementa el RGPD. Cumpliendo RGPD/LOPDGDD se cubre el grueso; la 41/2002 obliga a custodia y confidencialidad de la historia.
- **Sanciones AEPD**: no hay una resolución-tipo pública específica por WhatsApp automatizado en clínica dental, pero sí sanciones relacionadas con datos de salud/clínicas dentales (grabación en gabinete, brecha no notificada, denegación de acceso). INCIBE y la AEPD recomiendan minimizar el uso de WhatsApp para datos personales/confidenciales.
- **Alternativas más seguras**: portales de paciente propios (enlace neutro por WhatsApp que lleva a un entorno cifrado UE), SMS con enlace, apps propias. Varios proveedores (Cliniflux, SAPIENSDATAAI) venden "infraestructura EU-hosted, GDPR compliant" como argumento.

### 5. La competencia, funcionalidad por funcionalidad

**Categoría 1 — Chatbots/recepcionistas (NO hacen seguimiento comercial de presupuestos)**:
- **Clinicbot**: recepcionista de VOZ IA 24/7, agenda citas, plan gratuito + plan de pago 55 €/mes. Capa telefónica.
- **Cliniflux**: capa WhatsApp sobre PMS, chatbot, reactivación; integración por API en plan superior. Sin pipeline de presupuestos.
- **Automatika**: IA de recepción, recordatorios, recaptación; se integra "como capa invisible" vía API. Foco no-shows.
- **automatizator.es**: agencia; capa WhatsApp+CRM sobre Gesden/Klinikare/Dentalink; setup ~1.800-9.000 €, cuota ~290-1.500 €/mes. Menciona "seguimiento de presupuestos" como flujo añadido posterior.
- **Aimoova**: agencia/consultoría IA (Barcelona), automatizaciones a medida; afirma integración "nativa vía API oficial" con Gesden (afirmación comercial dudosa dado que Gesden no tiene API pública).
- **Javadex**: consultoría; asistente de voz IA; desde ~5.000 € + 120-350 €/mes.
- **ClinxBot/ChatbotDental/SAPIENSDATAAI/Aurora Inbox**: variantes de chatbot de citas/recordatorios.

**Categoría 2 — PMS completos con módulo de presupuestos (sustituyen al PMS)**:
- **Klinikare**: PMS cloud, presupuestos con seguimiento de estado y firma digital, automatización, financiación en 1 clic; agente digitalizador Kit Digital.
- **Clinicbox**: PMS cloud, app móvil, integración Doctoralia, comunicaciones WhatsApp/SMS/email.
- **Dendoo**: PMS cloud freemium (plan gratis + premium de pago); presupuestos con seguimiento, detección de impagos y recordatorios por SMS/WhatsApp.
- **Nubimed**: PMS cloud multiespecialidad (~49 €/mes); presupuestos con seguimiento.
- **Docfav**: PMS cloud español; presupuestos por fases con "seguimiento hasta la aceptación", recordatorios WhatsApp, Verifactu; desde 33,25 €/mes por profesional (+8,33 €/prof. adicional). Migra desde Gesden/Excel gratis.
- **Akeito**: PMS con IA; incluye "seguimiento de presupuestos" y "detección automática de impagos" que avisa al equipo. Lo más cercano dentro de los PMS a la lógica Fyllio, pero es sustituto, no capa.
- **Dentiqa** (LATAM): PMS todo-en-uno con IA (Claude), pipeline CRM comercial estilo Kanban (contactó→presupuestó→evaluando→aceptó→en tratamiento), chatbot WhatsApp. Concepto más parecido a Fyllio, pero PMS sustituto y no enfocado a España/Gesden. USD 89/149/249 mes.
- **Odontix** (LATAM/México): PMS con IA, seguimiento de presupuestos no aceptados, cuentas por cobrar, agente WhatsApp.

**Categoría 3 — Capas CRM de seguimiento comercial (lo más parecido a Fyllio)**:
- **Engrana** (engrana.es) — **el competidor estructural más peligroso**. Se autodefine como capa sobre el PMS ("no es un sustituto (…) si ya tienes Klinikare, Dentalink o Gesden (…) Engrana se le suma como capa de WhatsApp + IA + recall + reseñas + cobros"); explícitamente una capa que "convive" con el software del negocio. Compatible con Dentalink/Klinikare/Gesden/Odontonet/Clinic Cloud sin migrar. **"Precio plano 89€ al mes" sin permanencia**; operado por AUVE Media Group SL (Terrassa, Barcelona), fundadores Alejandro y Pau; ofrece "Contrato Art. 28 RGPD firmable" y "BSP europeo". **Gap vs Fyllio**: aborda presupuestos de forma conversacional/reactiva, no como pipeline diario priorizado de "presupuestos que se enfrían" + cobros pendientes.
- **Kandent Tools** — herramientas IA de rentabilidad; su discurso es casi idéntico a Fyllio: cita literal (tools.kandent.es) *"El 50% de los presupuestos que se aceptan no se aceptan en la primera visita. Se aceptan después de un seguimiento proactivo. Si no haces seguimiento, pierdes la mitad de los que iban a decir sí."* Precios 29/39/69/129 €/mes. **Gap**: no es capa conectada al PMS en vivo; herramientas sueltas, sin panel operativo de pipeline.
- **Growlityc/Growthlyfy** — CRM dental sobre GoHighLevel, agencia catalana; pipeline de 7 etapas, dashboard ROI. Servicio de agencia, no SaaS con precio público; foco en captación.

**Conclusión competitiva**: nadie reúne los 5 rasgos de Fyllio a la vez. Engrana cubre el "capa + WhatsApp + cobros" pero no el pipeline de presupuestos con panel diario; Kandent el discurso de presupuestos pero sin conexión al PMS; Dentiqa el producto integral pero como PMS sustituto en LATAM. **El hueco "CRM de no-pérdida como capa sobre Gesden con panel diario de presupuestos + cobros y WhatsApp sugerido por IA" sigue esencialmente sin ocupar en España, pero los bordes se cierran rápido.**

### 6. Cómo entra un producto nuevo en este mercado

**Mercado**: España cuenta con **43.672 dentistas colegiados en 2025** (INE, +1,9% sobre los 42.860 de 2024, según el Consejo General de Dentistas, 27 mayo 2026) y en torno a 23.000 clínicas operativas; el 97% ejerce en el ámbito privado. El sector crece (~5-7% anual en cadenas; gasto privado en máximos). El estudio Key-Stone/Fenin sobre 448 clínicas registra una media de **71,8 visitas semanales por clínica en 2025** (frente a 79,2 en 2019); el informe "Panorama y perspectiva del sector dental en España" (presentado en Expodental 2026) cifra el mercado odontológico español **por encima de 1.200 millones de euros**. Ticket medio por paciente ~150-300 €; implante ~1.640 €; ortodoncia 2.200-6.300 €. Esto sostiene el argumento de ROI de Fyllio: recuperar un solo presupuesto de implante/ortodoncia paga meses de suscripción.

**Canales que funcionan**:
- **Expodental** (IFEMA Madrid, 11-13 marzo 2026, pabellones 4, 6 y 8, horario 10:00-20:00): el evento de referencia; la edición anterior tuvo **374 expositores, más de 24.500 m² netos de exposición y cerca de 30.000 visitantes profesionales** (Gaceta Dental, dic. 2025), cifras que la edición 2026 busca superar. Infomed/Gesden expone con stand de 140 m². Caro pero es donde deciden los gerentes. Se celebra de forma bienal.
- **Colegios profesionales (COEM y otros)**: acceso a colegiados, formación, avales.
- **Distribuidores de material dental y consultoras de gestión dental**: canal de recomendación (el distribuidor "recomienda el software").
- **Venta directa** a redes/DSOs (como RB Dental) y clínicas medianas: ciclo de venta típico de semanas a pocos meses.

**Quién decide**: en clínica pequeña, el dentista propietario; en clínica mediana/red, el gerente o director, con la coordinadora/recepción como usuaria clave e influenciadora (Fyllio le quita trabajo, así que es aliada natural). Para RB Dental (10 clínicas) el comprador es dirección/gerencia.

**Precio aceptado**: herramientas complementarias se mueven en ~29-150 €/mes por clínica (Kandent 29-129 €, Engrana 89 €, Clinicbot 55 €, Docfav 33 €/prof.). Modelos habituales: por clínica, por sillón/gabinete, por usuario o por volumen. Para una capa de valor comercial demostrable, un modelo por clínica + tramo por volumen de presupuestos/mensajes es defendible.

**Kit Digital**: financia software de gestión de clientes y digitalización. Bonos por tamaño (referidos por agentes: 2.000 € autónomos/1-2 trabajadores; 6.000 € para 3-9; 12.000 € para 10-49; algunas fuentes citan hasta 4.000 € en tramos concretos — verificar convocatoria vigente). Infomed, Klinikare y Odontonet ya son agentes digitalizadores. **Fyllio puede y debería darse de alta como agente digitalizador** para que la clínica adopte sin coste inicial, usando la categoría "Gestión de clientes/CRM".

## Recommendations

**Fase 0 (ahora, con RB Dental)**:
1. **Posicionamiento**: no competir con Gesden, sino ser explícitamente "la capa de no-pérdida sobre tu Gesden". Mensaje: "Gesden guarda la historia clínica; Fyllio se asegura de que ningún presupuesto ni cobro se pierda." Diferénciate de chatbots (que solo agendan) con el panel diario de acción + IA de siguiente paso.
2. **Integración**: valida qué versión usa RB Dental (G5 vs ONE). Si es G5, construye el agente local que lee SQL Server, firma DPA (art. 28) y NDA, y limita la escritura de vuelta a lo imprescindible. Documenta el esquema para blindarte ante actualizaciones. Explora en paralelo si ONE ofrece API/webhooks para clínicas que migren.
3. **WhatsApp cumplidor desde el día 1**: contrata la Business API a través de un BSP con hosting UE, firma DPA con cada clínica, recoge consentimiento explícito de canal, y **diseña plantillas neutras** que no revelen tratamiento+precio (enlace a portal propio cifrado). Publica tu compromiso de cumplimiento (servidores UE, DPA, minimización) como los competidores — Engrana ya lo hace con "Contrato Art. 28 RGPD firmable + BSP europeo", así que es tabla mínima.

**Fase 1 (validación, 3-6 meses)**:
4. Mide baseline en RB Dental: tasa de aceptación de presupuestos, presupuestos enfriados recuperados, cobros pendientes cerrados, tiempo de respuesta a leads. Convierte esto en un caso de éxito cuantificado (es tu principal activo de venta).
5. Cierra el gap frente a Engrana construyendo lo que ellos no tienen: **pipeline diario priorizado de presupuestos que se enfrían + cobros pendientes con IA que sugiere el mensaje**. Es tu foso.

**Fase 2 (escala)**:
6. Hazte **agente digitalizador de Kit Digital** (categoría gestión de clientes) para eliminar la fricción de precio.
7. Prepara presencia en **Expodental 2028** (bienal) y, antes, trabaja COEM + consultoras de gestión dental para referidos. Prioriza redes/DSOs de 3-15 clínicas (como RB Dental): mismo ciclo de venta, mayor ARPU.
8. Modelo de precio sugerido: por clínica (rango 89-149 €/mes) + tramo por volumen; ancla el precio al ROI de un presupuesto recuperado.

**Benchmarks que cambian la estrategia**:
- Si Engrana o Kandent lanzan un pipeline de presupuestos conectado a Gesden en vivo → acelera y profundiza el diferenciador de IA/cobros.
- Si Gesden ONE publica API oficial → pivota la integración a API (más estable) y conviértete en partner del ecosistema.
- Si Gesden lanza su propio panel de acción comercial con WhatsApp → reposiciónate hacia redes/DSOs multi-PMS donde Gesden no llega.

## Caveats
- **Datos de mercado divergentes**: el nº de clínicas oscila entre ~7.600 (una fuente de plan de negocio) y ~23.000 (fuente de compraventa); 43.672 dentistas colegiados en 2025 es cifra del INE citada por el Consejo General de Dentistas. La facturación del sector se cita entre ~970 M€ ("servicios odontológicos") y ~12.000 M€ ("gasto privado total"); el informe Key-Stone/Fenin sitúa el mercado odontológico por encima de 1.200 M€. Tratar con cautela según la definición.
- **Cifras de Kit Digital**: los importes de bono varían según convocatoria y fuente; verificar la convocatoria vigente en acelerapyme.gob.es antes de comunicarlos.
- **Afirmaciones comerciales**: muchas "opiniones sobre Gesden" y comparativas provienen de competidores (Akeito, Docfav) o agencias; los porcentajes de mejora (no-shows -40%, aceptación +30%, ROI 200%) son claims de proveedores sin verificación independiente.
- **API de Gesden ONE**: algunas fuentes (Flowmatic) afirman que ONE tiene API; no hay documentación pública oficial que lo confirme. Verificar directamente con Infomed.
- **DPA de Meta para salud**: no se ha podido confirmar que Meta ofrezca un DPA específico válido para datos de categoría especial; la evidencia (su propia Política) sugiere que traslada el riesgo al usuario. Punto a validar con asesoría jurídica antes de tratar cualquier dato de salud por el canal.
- **Precios de competidores**: varios (Clinicbox, Akeito, Dendoo premium, Gesden) no publican precio; las cifras de terceros son estimaciones. B-one.dental NO es software: es un medio de prensa del sector, no un competidor.
