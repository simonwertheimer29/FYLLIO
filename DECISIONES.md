# Diario de decisiones — fyllio-mvp

Registro breve y cronológico de **bugs importantes arreglados, decisiones de arquitectura
y hallazgos de auditoría cerrados**. Cada entrada: fecha · qué pasó · qué se hizo · por qué,
en 2-4 líneas. Se añade al final, en el mismo cambio que cierra el asunto.

Esto es el **historial**. Las reglas generales destiladas de estos errores viven en el skill
[`.claude/skills/fyllio-lecciones-ingenieria`](.claude/skills/fyllio-lecciones-ingenieria/SKILL.md):
aquí se cuenta qué pasó; allí, la ley para que no se repita.

Y el **porqué** —lo que sabemos del mercado y que justifica que una decisión tuviera
sentido— vive en [`MERCADO.md`](MERCADO.md). Cuando una decisión de producto nazca de algo
que nos dijo una clínica, la entrada de aquí cita la de allí.

---

## 2026-07-06 — Auditoría técnica pre-pilotos (AUDITORIA_FABLE.md)
Revisión del código real del repo completo antes de los pilotos. Tres riesgos mayores: aislamiento
multi-cliente roto, pérdida silenciosa de mensajes y estados, y superficie abierta sin autenticación
(`/api/db/*`, contraseñas en claro). Decisión: NO migrar a Supabase aún; blindar Airtable en dos
sprints (A fiabilidad+seguridad, B aislamiento) porque migrar bloqueaba los pilotos meses.

## 2026-07-06 — Decisión de arquitectura: bases físicas separadas por cliente
Dos clientes legalmente separados compartían una sola base de Airtable, aislados solo por filtros
de software con agujeros demostrados. Se separó en base RB + base INDEP + base central de identidad
(`Usuarios`). Por qué: un fallo de filtro dentro de una base mezcla clínicas del mismo cliente
(malo, recuperable); con los dos clientes en la misma base mezcla dos empresas (catástrofe legal).

## 2026-07-06 — Sprint A: el webhook de WhatsApp perdía mensajes
Respondía 200 a Meta y guardaba "en segundo plano" (promise sin `await`); en Vercel ese trabajo no
está garantizado → mensajes de pacientes desaparecían sin rastro y Meta no reintenta. Ahora se
persiste síncronamente ANTES del 200 y la IA se difiere con `after()` (`6040f46`).

## 2026-07-06 — Sprint A: el "modo demo" ocultaba errores de escritura
Ante fallo de Airtable, las escrituras devolvían `{ok:true}` con datos demo: arrastrar un presupuesto
a "Perdido" decía "hecho" sin haberse guardado. Ahora un fallo devuelve 500 real (`7399c55`); el
cliente comprueba `res.ok` desde el Sprint UI (`4fbde27`). Un error visible se arregla en un día;
uno disfrazado de éxito corrompe datos durante semanas.

## 2026-07-06 — Sprint A: idempotencia en el envío y recepción de WhatsApp
Se enviaba a Meta antes de registrar en Airtable (reintento de coordinadora = paciente recibe el
mensaje dos veces) y el dedup de entrantes era "consultar y luego crear" (race con las reentregas
de Meta). Dedup atómico de entrantes + garantía de no doble envío (`1a66837`).

## 2026-07-06 — Sprint A: cron diario con `sleep(5000)` y sin `maxDuration`
El cron podía superar el timeout y cortarse a mitad (citas sin recordatorio) y, al reejecutarse,
duplicar mensajes. Se puso `maxDuration`, presupuesto de tiempo wall-clock y envíos idempotentes
(`d1b78d7`). La causa real (un `sleep(5000)` por llamada) solo apareció leyendo el código del cron —
no era "Airtable lento", como se asumía.

## 2026-07-06 — Sprint A: cierre de superficie abierta y secretos débiles
`/api/db/*` (14 rutas sin login que leían y borraban pacientes) → 404 en producción (`f8c83de`);
webhook legacy de Twilio con firma verificada fail-closed (`e79356a`) y después 404 en prod
(`a4aea01`); eliminado el fallback público `"dev-secret-change-me-in-prod"` y el secreto interno
del bundle del navegador (`b18501f`); logins legacy con contraseña en claro deshabilitados (410) y
credenciales demo fuera (`bcea8b4`). Sin esto, RGPD infirmable.

## 2026-07-06 — Sprint B: el bug de aislamiento `clinica: null`
`emitLegacyCookies()` emitía siempre `clinica: null`, y Presupuestos/no-shows/llamadas interpretaban
"sin clínica" como "sin filtro = ver todas": una coordinadora podía ver presupuestos de todas las
clínicas. Arreglo de raíz: la sesión lleva `cliente` (`f2de2ef`), las ~30 rutas de Presupuestos
pasan por `withPresupuestosAuth` con verificación de pertenencia, y se cerraron los IDOR por
`?presupuestoId=` (`8538026`) y las fugas de lectura del Copilot (`3bed51e`).

## 2026-07-06 — Sprint B: `base()` fail-closed y contexto explícito sin sesión
El acceso a Airtable pasó por un seam consciente del cliente: sin contexto de cliente, `base()`
lanza error en vez de caer a una base por defecto (`82e7117`). Los caminos sin sesión (webhooks,
crons) no heredan ningún default: se enrutan a un `PILOT_CLIENTE` explícito (`ac59f4e`). El
fail-closed rompió rutas vivas que dependían del default sin saberlo y hubo que restaurarlas
(`4748021`) — ese ruido es el objetivo: mejor romper en QA que filtrar datos en producción.

## 2026-07-06 — Sprint B: QA adversarial de aislamiento
El sprint no se cerró con "los filtros están puestos": se ejecutaron 5 escenarios intentando
activamente ver datos del otro cliente y de otras clínicas, con datos seed reconocibles porque un
preview vacío da falsos aprobados (SPRINT-B-QA.md, `9589caa`). Lección previa: `canAccessClinica()`
llevaba meses escrito con CERO usos — un filtro que nadie intenta saltarse es decorativo.

## 2026-07-06 — Sprint B: No-Shows y demo quedan fail-closed (alcance diferido)
Las ~18 rutas de No-Shows y la superficie demo (`/api/db|dashboard`) no se migraron al seam
multi-base: quedan deshabilitadas-seguras en vez de abiertas-inseguras. Reactivarlas exige
migrarlas al patrón `withAuth`/`runWithCliente`, no quitar el candado.

## 2026-07-07 — Sprint UI: tokens, azul único y errores honestos
Sistema de tokens claro/oscuro con un solo acento (#3D6FB2), lucide en vez de emojis, y barrido de
feedback honesto: `res.ok` en los fetch para que un fallo de red nunca se pinte como éxito ni como
"todo vacío" (`4fbde27`, `be7a66d`). Mergeado a main.

## 2026-07-12/14 — Login email+PIN y el matiz del fail-closed
Nuevo flujo email+PIN con rate-limiting persistente en KV, fail-closed (`d6e0584`). En la práctica,
KV inaccesible bloqueaba el login entero: se decidió degradar el rate limiter a memoria con log en
vez de denegar (`ba9daea`, + timeout de KV en `99efdc1`). Matiz de la regla: fail-closed aplica a
decisiones de acceso a datos; una defensa auxiliar caída no debe tumbar la puerta principal.

## 2026-07-13 — Tenant DEMO aislado
Las cuentas de demostración se aislaron como cliente propio: `Cliente=DEMO` enruta a la base antigua
(que ya no tiene datos reales), con el mismo seam fail-closed del Sprint B y seed idempotente
(`9516f4d`). Así la demo comercial vive con las mismas reglas de aislamiento que un cliente real.

## 2026-07-15 — Bug: un link de Airtable cruzando bases rompía el registro de acciones
Tras separar bases (Sprint B), `logAccionLead` seguía escribiendo el link `Usuario` con un record id
de la base central; un linked record no puede apuntar a otra base → el `create` fallaba SIEMPRE y el
catch fire-and-forget lo silenciaba (`acciones.ts:53-61`): sin registro de acciones y KPI de tiempo
de respuesta roto desde la separación. Lección doble: al mover tablas entre bases se verifica cada
linked field que las relacionaba, y un fallo sistemático jamás puede ser silencioso.

## 2026-07-15 — Base DEMO: reset total resembrable, no seed acumulativo
El "re-seed limpio" del 13/7 solo limpiaba 4 tablas: la base DEMO conservaba ~4.600 registros viejos
en 30 tablas — incluidos nombres de clientes reales en la tabla `Usuarios` legacy y 5 reglas de
automatización vivas procesando los leads seed. Nuevo `npm run demo:reset` (`demo-reset.ts`): wipe de
las 39 tablas + seed único de 245 registros coherentes con fechas relativas al ejecutar (la demo no
envejece), guardas fail-closed (aborta si el base id coincide con RB/INDEP/CENTRAL) y reglas siempre
en `Modo_Test` con paciente inexistente → nunca envían. Se corre antes de cada presentación.

## 2026-07-21 — FASE 2 gate final: QA adversarial Sprint B contra Postgres+RLS
Re-corridos los 5 escenarios de SPRINT-B-QA.md a nivel de MOTOR como el rol real `fyllio_app`
(NOBYPASSRLS), atacando el aislamiento con datos `[QA_SB]` en RB+INDEP+DEMO. Cliente↔cliente VERDE:
122/122 (motor) + 14/14 (clínica app-level sobre PG) + smoke 10/10. Dos harnesses reproducibles
(`scripts/qa-rls-sprint-b.mjs`, `scripts/qa-clinica-pg.ts`, `2035bf2`). Detalle y findings en
MIGRACION-POSTGRES-PLAN.md §10. Producción sigue en Airtable; el flag vive solo en env local.

## 2026-07-21 — El guard de service-role llevaba rojo desde gate 3/8 (red de §5 inservible)
`npm run guard:rls` fallaba porque `scripts/db-seed-demo.mjs` usa `SUPABASE_DB_URL_ADMIN` (legítimo:
bypassa RLS para sembrar DEMO) sin estar en el `ALLOWLIST_ADMIN`. Un guard siempre-rojo no puede cazar
una violación real de service-role (§9): la defensa del mandamiento §5 estaba de adorno. Añadido al
allowlist. Lo cazó el propio gate final al correr toda la suite, no un run aislado del guard.

## 2026-07-21 — CORTE FASE A/B/C: identidad sobre Postgres, login verde (3 flujos × 3 clientes)
Simon aprobó ejecutar el corte (riesgo bajo: todo ficticio/placeholder, sin clientes reales aún).
Retirado /login/clasico (100% email-first; los 8 usuarios tienen email). Identidad volteada a PG:
flag `usaPostgresIdentidad()` GLOBAL (el login es cross-cliente, no atado a currentCliente);
`auth/users-pg.ts` (reads sin contexto sobre `usuarios` using-true; clinicas/junction en
runWithClienteDb). Seed `db-seed-identidad.mjs` copió central→PG reconciliando ids (DEMO junction
→ ids de negocio ya en PG por nombre; RB/INDEP → id central). Login sobre PG VERDE (43/0,
`qa-login-pg.ts`): findUsersByEmail cross-cliente, PIN bcrypt contra hash migrado, clínicas del
coord resueltas por id→nombre, aislamiento RB/INDEP/DEMO disjunto. Pendiente antes del flip (FASE
D, requiere OK de Simon): backfill de ids reales en alertas/pagos + QA adversarial con identidad.

## 2026-07-21 — Split-brain de Citas del gate 5: los métodos tipados del scheduler seguían en Airtable
El gate 5 volteó los `*Raw` de Citas a PG pero dejó los 10 métodos TIPADOS de reserva
(createAppointment, cancel/complete/confirm/updateAppointment, markNoShow, getAppointmentByRecordId,
findNext, listAppointmentsByDay/Week) en Airtable → misma tabla, dos backends según el método. Con el
flag "agenda" en DEMO, una cita creada/mutada por el tipado era invisible para las listas *Raw (PG).
Cerrado: los 10 delegan a PG preservando fireCitaEvento y el filtro de clínica. Golden 12/0 (8 citas
byte-idénticas AT/PG) + transiciones verificando lectura tipada y *Raw en el mismo backend. waitlist
también volteada (SQL por intención por la ambigüedad {Clínica} nombre/id). Con esto TODO DEMO corre
sobre Postgres+RLS. Detalle en §10 del plan.

## 2026-07-21 — 9 mini-dominios volteados a Postgres con un evaluador de fórmulas compartido
El `filterByFormula` de Airtable que componen los callers se resolvía con un evaluador dentro de
`presupuestos/pg.ts`. Extraído byte-idéntico a `app/lib/db/airtable-formula.ts` (re-verificado
Presupuestos 22/22 sin regresión ANTES de propagar) y reusado en 9 mini-dominios (notificaciones,
cola-envios, push, informes, vapi, alertas, configuraciones, plantillas-mensaje, mensajes) — una
pieza robusta en vez de N traducciones SQL a mano. Todos vacíos en DEMO → validados por escritura
ejercitada. Los 7 mecánicos por subagentes en paralelo, mensajeria a mano (solo el LOG; idempotencia
KV/WABA intactos). Suite integrada verde (motor 122/0). Notas de paridad y flag en §10 del plan.

## 2026-07-21 — Hueco del gate 8: el chequeo IDOR de presupuestos leía Airtable congelado
`verificarPresupuestoPermitido`/`mapaPresupuestoClinica` (`clinica-scope.ts`) resolvían el presupuesto
por `base(TABLES.presupuestos).find()` = Airtable SIEMPRE, aunque el dominio estuviera volteado a PG.
Efecto en DEMO (2 cuentas de coordinación): un presupuesto creado en PG tras el volteo → Airtable no lo
tiene → 404 en acceso legítimo, en 7 rutas; y permisos leídos de un Airtable congelado podían autorizar
por una clínica vieja (mandamiento §4/§8: mismo backend que se sirve). Fix: los 2 lookups pasan por los
repos que delegan por `usaPostgres`. Verificado con prueba discriminante (presupuesto PG-only) en
`qa-clinica-pg.ts`. Lo cazó el QA adversarial del gate final, no la demo.

## 2026-07-23 — Bug estructural #1: «Aceptó y pagó» solo escribía Estado
El cierre bueno dejaba `fecha_aceptado` NULL (KPIs de cobros ciegos con datos reales), la fase
colgada en "Esperando respuesta" aunque el último mensaje fuera del paciente, y el "y pagó" era
nominal (ningún pago). Ahora el PATCH del kanban y el portal escriben el cierre completo
(Estado + Fecha_Aceptado + Fase "Cerrado"), "Mensaje recibido" resetea la fase igual que el
webhook, y el cierre abre un modal de pago señal/parcial/total (campo vacío a propósito:
prefijarlo al total inflaba la facturación) que crea el pago real vía `crearPago` + resync del
paciente. De paso: "Pausar" mandaba una clave que la ruta ignoraba — era un no-op con toast de
éxito. Escrituras ejercitadas contra PG DEMO: `scripts/qa-cierre-presupuesto.ts` (VERDE, sin residuos).

## 2026-07-23 — Bug estructural #2: tres definiciones de "leads en el pipeline"
La cabecera de Leads contaba TODO (No Interesado incluido), Red excluía solo No Interesado
(contaba Convertidos), y el tablero mostraba otra cosa — tres números distintos para el mismo
concepto. Decisión: pipeline = accionables (Nuevo+Contactado+Citado+Citados Hoy); Convertido
salió ganado y No Interesado perdido. UNA función (`lib/leads/pipeline.ts`) para todos los
conteos, y la cabecera desglosa ("N activos · M no interesados") para cuadrar con las tarjetas
visibles. Regla general: un número de cabecera debe corresponder a una suma visible en pantalla.

## 2026-07-23 — Bug estructural #3/#4: cuatro cifras para "facturado", campos manuales que divergían
Convivían 4 fuentes de dinero (presupuestos ACEPTADO 26.200 · pacientes.pagado 24.239 ·
presupuesto_total de los "Sí" 34.200 · pagos 24.329) y `pacientes.aceptado` era un select manual
(divergía del presupuesto real en 44/46 pacientes de DEMO). Decisión de vocabulario: **Aceptado**
(= Σ presupuestos ACEPTADO) · **Cobrado** (= Σ pagos reales) · **Pendiente** (= la resta), una
fuente por concepto. Nuevo `lib/finanzas-paciente.ts` deriva los cuatro valores por paciente;
lista de pacientes, Red, fichas y KPIs beben de ahí; el select manual desapareció y el rótulo
"facturado" se renombró a "Cobrado" donde la cifra son pagos. Los campos cache del paciente se
siguen escribiendo (compatibilidad) pero ya no son fuente de pantalla. QA: `qa-finanzas-paciente.ts`
(Σ cruzadas exactas contra pagos y presupuestos, 7/7 VERDE).

## 2026-07-23 — estadoConversacion: una sola clasificación de "quién tiene la pelota"
Había TRES criterios para pendiente/esperando (cola de presupuestos: 2 timestamps persistidos;
lista de leads: acciones_lead; paneles/fichas: el hilo) y el mismo caso se contradecía entre
pantallas. Ahora UNA función (`lib/presupuestos/estado-conversacion.ts`) deriva del último
mensaje del hilo (+ acciones salientes registradas para llamadas/chats sin texto):
pendiente_responder / en_espera_paciente / reactivable, con umbral centralizado 48h leads /
72h presupuestos. Prerequisito pagado antes: TODA escritura de mensaje deja fila en
mensajes_whatsapp (registro manual awaited con teléfono real, IntervencionView dejaba de
perder el texto del saliente, IA panels→enviar-manual, secuencias y cobros persisten, chats
sin texto registran acción). Consumidores volteados: cola intervención (server+cards, card
reactivable con contexto XYZ), Actuar hoy leads, LeadAccionPanel (mismos inputs que la
lista), situación del panel de presupuesto y ficha 360. Fase_seguimiento ya NO decide UI
(solo filtro server de inclusión). QA de convergencia: `qa-estado-conversacion.ts` — los 3
casos que divergían clasifican igual en cola y ficha (11/11, sin residuos). Pila Twilio
automática sigue fuera del hilo → MEJORAS nº 24.

## 2026-07-23 — Mejoras 18-20: la familia del feedback deshonesto, cerrada
Aprobadas por Simon tras verificar el preview de los 4 arreglos estructurales. (18) «Rechazó»
desde el panel de acción ahora abre MotivoPerdidaModal como kanban y drawer — el discriminador
es PERDIDO sin motivo, y el panel se cierra al confirmar, no al pulsar. (19) `handleLlamar` y el
cambio de estado de Actuar hoy comprueban `res.ok` — un fallo ya no se pinta como éxito (misma
clase que el «Pausar» no-op). (20) El portal público escribe el presupuesto ANTES de marcar el
token como respondido: si el update falla, 500 honesto y el paciente puede reintentar — antes el
paciente veía "gracias" y la aceptación podía no llegar nunca al kanban (mandamiento §1).

## 2026-07-22 — Seed rico de DEMO sobre Postgres (nunca Airtable), demo:reset volteado
Rehecho el seed de DEMO desde cero directo a Supabase (producción ya en Postgres). Script
`scripts/db-seed-demo-rico.mjs`: SOLO-pg (importa solo pg+dotenv, cero Airtable → imposible
escribir en el Airtable congelado como rollback), corre como fyllio_app + SET LOCAL DEMO (RLS
hace imposible tocar RB/INDEP), NO toca identidad ni catálogo. ~500 filas pensadas por
recorridos (embudo/Actuar hoy en 3 prioridades + esperando, kanban de presupuestos en los 6
estados + estancados >7d + perdidos con motivo, WhatsApp bidireccional con intención IA,
citas hoy/mañana/pasadas, automatizaciones con historial, cobros). Fechas relativas a hoy,
teléfonos +34, cero placeholders. KPIs cuadran (facturado 22.400€, pendiente 9.961€,
conversión 24%). TRIPLE candado de no-envío verificado (modo_test+paciente inexistente 5/5,
eventos procesado 15/15, modo_whatsapp=manual 4/4). `npm run demo:reset` apunta al script
nuevo; el viejo demo-reset.ts (Airtable) queda deshabilitado con candado (PERMITIR_SEED_AIRTABLE=1
para forzar). Idempotente y re-anclado a hoy en cada corrida.

## 2026-07-23 — QA del fix de estados: el negocio manda y el seed no se puede descorrelacionar
El QA de Simon sobre estadoConversacion destapó tres huecos: leads cerrados (No Interesado)
aparecían en "Esperando respuesta" (la cola solo excluía convertidos → ahora `esLeadActivo`),
leads sin conversación caían en textos de seguimiento (nueva rama `sin_conversacion` → "primer
contacto"), y el seed de DEMO fabricaba las contradicciones: acciones sin hilo, intención sin
mensaje, cards ("9 días sin contacto") contradiciendo hilos que terminaban hoy. El seed se
reescribió para que cada caso nazca de UN guion del que derivan hilo Y campos de card, con
invariante dura al final (Nuevo = sin conversación; todo lo demás con hilo; fecha_ultima_respuesta
== último entrante) — resembrar re-ancla fechas sin poder descorrelacionarse.

## 2026-07-23 — La card de presupuesto dependía de la IA para decir "respondió"
La rama «Respondió: …» del panel solo se activaba con `Ultima_respuesta_paciente` persistido
(lo escribe la clasificación IA); un mensaje que llegaba al hilo sin pasar por la IA dejaba la
card en el fallback viejo de "N días sin contacto" contradiciendo a su propia conversación
(caso Sergio Ramos). Ahora `pendiente_responder` del hilo manda: con texto lo cita, sin texto
dice "Te respondió hace X" — la card nunca puede contradecir al hilo que tiene debajo.

## 2026-07-23 — Bifurcación por cita: capa de contexto, no estado nuevo
Un lead Citado salía como "a reactivar/esperando" porque la conversación decidía sola. Decisión:
la cita NO entra en estadoConversacion (una función = una pregunta: quién tiene la pelota);
es contexto de negocio con precedencia cerrado > cita > conversación. Con cita futura la card
dice "Tiene cita el X — confirma su asistencia" con recordatorio precargado en el composer
(solo si está vacío), sale del bucket "Esperando respuesta" de Actuar hoy, y la respuesta
pendiente del paciente sigue ganando: a un mensaje se contesta siempre.

## 2026-07-23 — P3: la cola de presupuestos se unifica al modelo de Leads
La sección "Atendidos hoy" era una segunda representación del viejo criterio de espera
("acción registrada hoy" ≈ esperando) y las 8 pills por intención IA fragmentaban la cola.
Ahora: dos pestañas que PARTICIONAN la cola por estadoConversacion (Actuar ahora = pendiente
+ reactivable · Esperando = en_espera), cabecera y card compartidas con Leads (ActuarHoyHeader,
AccionCard), orden por prioridad. Se eliminaron del payload `secciones` (ningún cliente las
leía), `completadasHoy` y `casosCompletados`; la mejora nº 23 queda resuelta de rebote.

## 2026-07-23 — Caché del mensaje sugerido: escritura esperada + invalidación por hilo
El GET de la cola generaba mensajes IA y persistía la caché con fire-and-forget y el error
tragado: en serverless la promesa puede morir tras responder → los mismos 5 casos se
regenerarían en cada refresh de 15 s (~1.200 llamadas/hora) sin señal — el mismo patrón del
webhook del Sprint A. Ahora la escritura se espera y se loguea, y todo entrante del paciente
invalida Mensaje_sugerido en recibirMensaje (cuello de botella de webhook/clasificar/manual):
la sugerencia de la card nunca puede referirse a una conversación que ya cambió.

## 2026-07-23 — Las cards de Actuar hoy informan; la acción vive en el panel
Se quitaron los botones Llamar/WhatsApp de las cards de leads y presupuestos. Razón de
producto: la acción debe pasar por LEER la conversación — un botón en la card invita a
ejecutar sin criterio. La card da contexto, recomendación y prioridad, y toda ella abre el
panel, donde el flujo es completo (hilo visible, mensaje precargado, registro, feedback).
La auditoría del patrón confirmó el riesgo: el botón de leads abría wa.me SIN texto,
mostraba "Enviado" y no dejaba nada en el hilo (solo la acción registrada); el de
presupuestos sí pasaba por el hilo, pero saltándose la lectura igual.

## 2026-07-23 — Bloque 3: la tabla de Pacientes es una ventana, no una base de datos
Cada dato de la tabla tiene UN registro origen: contacto/notas/doctor se editan inline
escribiendo en el paciente (PATCH ahora con WHITELIST — antes aceptaba cualquier campo,
incluidas las cachés de dinero); cobros y estados van por los modales de su flujo origen
(PagoModal de la ficha, extraído a archivo propio; modales del kanban vía la ruta kanban,
que ahora RECHAZA Perdido sin motivo). Derivados (dinero, aceptado, tratamientos, próxima
cita de la agenda) no se editan jamás. El teléfono se propaga a los presupuestos abiertos
con cascada visible en el toast (deuda D1); Financiado salió de la tabla (nº 27) y el
resto de duplicados quedó inventariado en la nº 28.

## 2026-07-23 — Bloque 2: dashboard de manager derivado de las mismas funciones que las colas
/red pasa de KPIs sueltos + CommandCenter viejo a las 4 preguntas del manager: riesgo de hoy
(reactivables por conversacionDePresupuesto, vencidos por calcularCobrosPorPaciente, leads sin
contacto por estadoConversacion — extraídas a lib y compartidas con sus colas, cero cálculo
paralelo), negocio con deltas mensuales, comparativa de clínicas y € aceptado 6 meses. Decisiones:
fecha de pérdida derivada del historial (registrarAccion ahora escribe en PG; los perdidos
antiguos sin historial se cuentan aparte, honesto) y seed con histórico de 6 meses cubierto por
la invariante. El QA de paridad cazó un fallo real de tenant: listClinicas sin cliente devolvía
las clínicas de TODOS los clientes (15 vs 4) — corregido en el dashboard, anotado el patrón (nº 30).
La cola de cobros dejó de preferir las cachés del paciente al derivar (nº 28 avanzada de rebote).

## 2026-07-24 — Cobros asciende a módulo propio; la fila del Registro es el paciente
Cobros deja la sub-pestaña de Pacientes y pasa al nav tras Presupuestos: cola "Actuar"
(vencidos · por vencer · estancados, cards que informan y panel que actúa, con el
recordatorio de cobranza precargado) + "Registro" (vida financiera completa) + KPIs del
dashboard. Decisión de modelado: los pagos ligan a PACIENTE, no a presupuesto
(`pagos_paciente` sin `presupuesto_id`), así que la fila del Registro es el paciente con
sus aceptados agregados — un "cobrado por presupuesto" habría sido un reparto inventado.
El recordatorio ahora se PERSISTE en el hilo antes de confirmar (el endpoint viejo tragaba
el fallo y confirmaba igual) y converge con estadoConversacion por construcción. QA:
paridad exacta SQL independiente = /api/cobros = dashboard Red (8.790/960/15.020 €, 17
filas); RLS adversarial 401/403/scope OK; mejoras 28 (lectores de cachés a cero) y 30
(listClinicas con cliente, 3 rutas) cerradas de rebote.

## 2026-07-24 — {{pendiente}}: un recordatorio de cobro nunca reclama el total firmado
La plantilla de liquidación decía "tienes pendiente 2.400€" a una paciente que debía 960 €
(el {{importe}} era el total aceptado). Nueva variable {{pendiente}} derivada de
finanzasDePaciente — la misma lib que la ficha y /cobros, sin cálculo propio — y las
plantillas que RECLAMAN (liquidación, primer pago) la usan; la señal mantiene {{importe}}
porque confirma el presupuesto antes de ningún pago. Regla: la cifra que se le pide a un
paciente sale siempre de la derivación compartida del dinero.

## 2026-07-24 — Seed de volumen (nº 31): la demo cuenta 6 meses de red y revienta si descorrelaciona
demo:reset pasa de ~245 filas a ~3.900: 6 meses de leads/presupuestos/pagos con forma mensual
real (dip de junio incluido), agenda laborable casi llena y los tres buckets de Cobros
poblados. Decisiones: capa de volumen DETERMINISTA (LCG, cero Math.random) y ANCLADA al mes
de calendario — resembrar el día 1 no puede vaciar la serie —, integrada en las mismas
estructuras del seed narrativo para que el backfill financiero y las invariantes la cubran;
invariantes nuevas fail-closed (buckets ≥5/≥4/≥3, ningún mes muerto). El primer wipe con
historial_acciones poblado destapó un bug latente de orden FK en la lista WIPE (borraba
presupuestos antes que su historial). Primer test de rendimiento real: dashboard ~2,6 s y
cobros ~3,3 s en local contra Supabase (RTT 182 ms/query) con CPU despreciable — el coste es
round-trips, no filas (nº 35); en Vercel misma región queda en decenas de ms.

## 2026-07-25 — Censo de Seguimiento: la cola de "Actuar hoy" escondía 6 de 31 leads activos
El paso 0 del rediseño (censo caso a caso, replicando la lógica vieja literal) demostró que
el filtro de "accionables" de ActuarHoyView dejaba invisibles 6 leads activos — 3 de ellos
con el paciente ESPERANDO RESPUESTA. Ramas culpables: `esAccionable` solo admitía un
"Contactado" si `l.createdAt <= hace48h` (un contactado reciente cuyo paciente responde no
entra por ninguna rama), y un "Citado" con cita futura no caía en ningún filtro (ni citado
hoy, ni esperando —descartado por cita futura—, ni Nuevo/Contactado-viejo). Decisión:
cohortes derivadas TOTALES sobre estadoConversacion + precedencia de cita (lib
`seguimiento/cohortes`), con invariante permanente `npm run qa:cohortes` que revienta si un
activo queda sin cohorte. Regla: una cola de trabajo se define por PARTICIÓN del universo
activo, nunca por una lista de condiciones de entrada.

## 2026-07-26 — Seguimiento: el orden de Nuevos premia el flujo correcto, no el rescate
Los frescos (<48 h) van arriba con el más reciente primero: un lead recién llegado es la
máxima probabilidad de cierre y atenderlo YA es como se evita que se enfríe; los desatendidos
(≥48 h, chip ámbar) quedan como grupo debajo, el más antiguo primero. Y en Rezagados murió la
fórmula días×interés: el multiplicador comprimía dimensiones distintas en una banda ilegible
(6 días sin interés ≈ 2,6 días con interés ×2) — mandan los días parados, el interés desempata.

## 2026-07-26 — Tanda de coherencia: mueren tres scores paralelos y el último wa.me suelto
El diagnóstico destapó que el badge ALTO/MEDIO/BAJO de los leads medía la frescura del
último toque NUESTRO (castigando justo los casos donde el paciente espera) y no participaba
en ningún orden; y que en Presupuestos convivían TRES scores para el mismo concepto
(scoreFinal de las cards, computeUrgencyScore del kanban y la "probabilidad 71%", basada en
pools de ≥3 cerrados similares — ruido estadístico al volumen de una clínica). Los tres
fuera: un solo criterio conceptual, "quién lleva más esperando, a igualdad el que más vale",
compartido por cohortes y columnas, con ambos datos visibles en la card. Regla: un indicador
que no ordena y no se puede leer desde la card no es información, es ruido con autoridad.
Cerrado también el censo wa.me (era la tercera vez que reaparecía en otra zona): todo envío
pasa por el servicio central y el cliente solo abre la URL que devuelve el servidor DESPUÉS
de persistir el hilo; el "Enviar uno a uno" confirmaba con toast antes de guardar. Dos bugs
latentes destapados: la ficha reventaba (React #130) con cualquier tipo de historial fuera
del union, y FiltersBar mantenía un segundo juego de pills de fecha con otro vocabulario.
Nota de QA: `set_config('app.cliente', x, false)` en un script de diagnóstico deja el ajuste
pegado al backend del POOLER y hace fallar db:smoke-rls en ejecuciones posteriores — en
scripts, siempre is_local=true.

## 2026-07-27 — Dos fichas del mismo objeto: el kanban abría la vieja
El clic en card del kanban de Presupuestos abría `PatientDrawer`; Seguimiento, Leads y la Vista
Máxima abrían `AccionPanel`. No era un enlace mal puesto: eran dos modelos mentales — el drawer no
enseñaba el hilo y pedía a la coordinadora que escribiera a mano una nota de lo ocurrido. Se unifica
en `AccionPanel`, enriqueciendo por `?id=` en la ruta de intervención (sin eso el panel caía al
fallback de "N días" y perdía la clasificación del motor). Se rescató lo único que no existía en el
panel —el timeline de contactos y acciones— como sección plegable. Fuera `PatientDrawer` (598
líneas) y `presupuestos/DoctorView` (sin importadores).

## 2026-07-27 — El motivo de descarte de un lead se inventaba solo
Arrastrar a "No Interesado" escribía `Rechazo_Producto` sin preguntar (y el `LeadAccionPanel` tenía
el mismo default esperando a que alguien lo usara), mientras el gemelo de Presupuestos sí abría su
modal: el dato inventado llegaba a los KPIs de pérdida indistinguible de uno declarado. Ahora se
pregunta. Censo: cero contaminados —las bases piloto no tienen leads todavía— pero el seed de DEMO
escribe motivos en texto libre fuera del single-select real de dos opciones, así que la agrupación
"No asistió / Rechazo" y el copy del panel mienten en la demo (MEJORAS 41; 42 amplía el vocabulario,
43 cierra la puerta del Copilot).

## 2026-07-27 — Kanban: el canon es lo mejor de cada tablero, no Leads por defecto
Igualar los dos tableros a Leads habría borrado dos cosas mejores de Presupuestos: iluminar la
columna destino al arrastrar y preguntar el motivo al cerrar en perdido. Se invirtió la dirección en
ambas. Y se retiró el sortable de Leads: reordenar dentro de la columna no persiste y al recargar
vuelve a su sitio, contradiciendo al criterio de orden declarado — mover de columna es la acción
real, reordenar era una acción sin efecto. Los dos tableros ganan un pie honesto por columna ("Ver N
anteriores") porque el rango recortaba en silencio en las columnas activas.

## 2026-07-27 — Una sola sesión: muere la cookie legacy de presupuestos
Deuda documentada desde el Sprint 7 ("hasta Sprint 8 que las unifica") que mordió dos veces: dos
cookies con dos secretos y dos caducidades (24 h la buena, 7 d la legacy) hacían que una sesión
válida recibiera 401 de media aplicación. `withPresupuestosAuth` lee ahora `fyllio_session` y deriva
la misma forma que el login firmaba; las 5 rutas que verificaban la cookie a mano pasan por
`getSession`. Queda viva la de no-shows (zona congelada); con ella morirá PRESUPUESTOS_JWT_SECRET.
Detalle revelador: el casteo a ciegas de la cookie escondía que el tipo no admitía el cliente DEMO.

## 2026-07-27 — Cuatro copias financieras del paciente, fuera
`presupuesto_total/pagado/pendiente/aceptado` eran caché de lo que ya viven presupuestos y pagos, y
sostenían una maquinaria entera: sincronizar en cada pago, registrar inconsistencias cuando la
sincronización fallaba y un endpoint admin para reconciliarlas. Con las columnas fuera (migración
008) muere todo eso: no se puede desincronizar lo que no se duplica. QA antes/después idéntico cifra
a cifra y alta/baja de pago verificada en vivo. De paso se descubrió que la invariante del seed
comparaba la caché contra su propio derivado —una tautología—; ahora comprueba algo que sí puede
fallar: ningún paciente con más cobrado que firmado.

## 2026-07-27 — El seed inventaba motivos de descarte que el esquema no admite
`Motivo_No_Interes` es un single-select de dos opciones en las bases reales, pero el seed escribía
texto libre: los 158 leads descartados de DEMO quedaban fuera del enum, la columna los agrupaba
todos en "Rechazo" y el panel afirmaba "rechazó la propuesta" de cualquiera — en la pantalla que se
enseña en demos. El matiz se conserva donde corresponde (el hilo de WhatsApp) y la columna guarda un
valor válido. Lección: un seed que no respeta el esquema real no es "datos de prueba", es una demo
que miente.

## 2026-07-27 — El vocabulario de descarte de un lead pasa de dos valores a seis, cerrados
Con dos opciones ("no le interesa" / "no asistió") los KPIs de pérdida no decían nada accionable.
Ahora son seis, sin "otro (texto libre)" a propósito: el texto libre es exactamente lo que rompió el
dato en el episodio del seed. La partición que manda no es el motivo sino su consecuencia —¿queda
algo que intentar?—, así que la columna de descartados se reparte en "se puede retomar" (no asistió ·
no contesta · horarios) y "decisión tomada" (precio · otra clínica · ya no lo necesita).

## 2026-07-27 — La rama Airtable ya no tiene consumidor real; se para de alimentarla
Al ir a añadir opciones al single-select de motivos apareció que la API de meta de Airtable no lo
permite: la vía documentada es escribir con `typecast:true`, o sea crear un registro temporal en una
base de producción para bootstrapear una opción. Eso disparó el censo: última escritura en cualquier
base de Airtable el 2026-07-15, bases piloto vacías de Leads/Citas/Staff/Tratamientos/Mensajes, y la
verdad de negocio en Postgres desde el corte. Decisión: los cambios de esquema van solo a Postgres y
la retirada de la rama queda planificada (MEJORAS 44). El censo destapó además un estado mixto vivo:
el alcance de clínicas y la lista de doctores se leen de Airtable mientras los datos vienen de
Postgres — y Staff está VACÍA en las dos bases piloto (MEJORAS 45).

## 2026-07-27 — Airtable fuera: un solo backend, sin dispatcher
Cada dominio estaba escrito dos veces (17 archivos `*-pg`, 199 bifurcaciones `usaPostgres`) más un
intérprete del dialecto de filtros de Airtable y "shims" que fingían sus records. Nada de eso tenía
consumidor: última escritura en cualquier base el 2026-07-15 y bases piloto vacías. Se retiró la
rama entera, el gate, el paquete npm, los 32 scripts de esquema y la isla de prototipo que el proxy
ya devolvía 404 en producción desde el Sprint A (~15.000 líneas). Las variables salieron de Vercel.
Sobrevive `db/airtable-formula` como deuda acotada y documentada: interpreta el dialecto sobre filas
de Postgres porque ~10 repos aún reciben `filterByFormula` de sus callers.

## 2026-07-27 — No-shows se congela en vez de fingir que funciona
La zona vivía sobre Airtable y llevaba parada desde el Sprint B, con sus rutas respondiendo 401
contra tablas vacías: una pantalla que aparentaba funcionar. Al retirar Airtable se congeló
explícitamente — página que dice que está en reconstrucción, fuera del nav — en lugar de dejar un
404 o un módulo roto. El motor predictivo y sus tablas de analítica NO se tocan y se siguen
alimentando desde la agenda: lo congelado es la interfaz vieja, no el diferenciador.

## 2026-07-27 — /red: la conversión medía dos cohortes distintas y tres gramáticas de delta
Pasada visual, parte 1. El numerador contaba aceptados por fecha de aceptación y el
denominador presentados por fecha de alta: dos conjuntos distintos bajo una etiqueta ("de los
presentados, aceptados") que prometía el ratio de cohorte que la fórmula no calculaba —
capaz de pasar del 100% con retardos reales. Ahora la conversión es de cohorte (mismos
presupuestos arriba y abajo), enseña siempre su denominador y la parte sin decidir, y
**calla el delta mientras >20% de la cohorte siga abierta**: los 28 de 48 presupuestos en el
aire de julio pintaban un desplome del 67% al 29% frente a meses resueltos al 100%. El resto
se compara contra el MISMO TRAMO del mes (días 1..hoy), salvo la fecha de cita, que es
prospectiva. Diagnóstico: el mes incompleto era marginal (jun 1–27 = 14 vs 15 del mes
entero); mandaba la maduración, y el escalón ×3 del mes en curso lo fabrica el seed
(MEJORAS 46). Murieron las tres gramáticas de delta —Δ% relativo, "pts" absolutos y Δ% otra
vez— por una sola: «48 (eran 14)», «12.430 € (eran 7.950 €)», «33% (era 100%)». Un 100%
salido de 2 presupuestos ya no pinta señal ni encabeza el ranking de caídas. De paso, nueve
erratas: `s()` pluralizaba sustantivos y se usaba en verbos ("8 pacientes **superóaron** su
plazo y **sigues** sin pagar" — le decía a la manager que era ella quien no pagaba), un
titular decía "del mes" sobre un dato semanal, "En seguimiento ahora" contaba solo
"Contactado" (cuarto número para el pipeline que unificó la decisión del 23/7), dos cards
gemelas comparaban una el recuento y otra el importe sin que se notara, el pie prometía un
orden que cambiaba al reordenar, y "7 perdidos, eran 5" se pintaba en verde.

## 2026-07-27 — /red: cuatro filas a ancho completo y una destacada que se gana el sitio por urgencia
Pasada visual, parte 2. El dashboard vivía en dos columnas 60/40 con las cinco secciones
apiladas dentro, así que la franja de riesgo era una rejilla 2×2 estrecha con huecos y la
gráfica de 6 meses cabía en 208 px. Ahora son cuatro filas a ancho completo (riesgo ·
funcionando · negocio+clínicas · progreso), el mismo orden que en móvil. Las señales pasan a
cards horizontales y bajas —número · titular · contexto en un renglón— repartidas con
`flex-1` para que nunca quede un hueco de rejilla. **La destacada la elige el servidor por
urgencia de ACCIÓN, no por importe**: cierres esperándonos > leads sin primer contacto >
reactivables > cobros vencidos, ordenados por cuánto se estropea el caso esperando un día
más. Por eso arriba manda una card de 5.900 € y no la de 12.725 €, y el Σ€ del titular va
aparte. Viveza: un pulso ÚNICO al montar en la destacada (halo del color de categoría que se
apaga) y un destello solo cuando un valor cambia entre dos cargas — nada late en bucle, y las
dos animaciones están en el bloque de prefers-reduced-motion. Se reutilizan los primitivos:
Card (con un `style` opcional nuevo para el tinte y el borde semántico), Skeleton con la
forma real de las cuatro filas, y ColaTabs en vez de las pills a medida de la gráfica. La
tabla de clínicas se apila en móvil: cinco columnas en 390 px recortaban la última sin aviso.

## 2026-07-27 — /red sigue al selector global, y el mes en curso se pinta punteado
Cierre de la pasada visual de /red. (49) El selector de clínica de la cabecera filtra todo el
producto pero /red lo ignoraba: usaba siempre el scope de sesión, así que el manager cambiaba
de clínica y la pantalla no se movía — mientras su propia comparativa usaba ese selector para
empujar a /kpis. Decisión de Simon: /red sigue al selector. Con una clínica elegida el
titular es su nombre, "Tus clínicas" se retira (compararía una fila consigo misma), "El
negocio" ocupa la fila y el clic en una clínica FILTRA en vez de navegar. El `?clinica=` llega
del cliente, así que se verifica fail-closed contra lo que ese usuario puede ver — 403, nunca
"sin filtro", que fue exactamente el bug de aislamiento del Sprint B. Probado intentando
saltárselo (§5): id inventado, clínica de otro cliente legal y clínica hermana desde una
sesión de coordinación → 403 los tres (`scripts/qa-red-scope.mjs`, 7/7). Efecto lateral
bueno: al recargar por cambio de clínica el destello por fin tiene cuándo dispararse. (48) El
mes en curso de la gráfica se pinta punteado y atenuado, con "en curso" en el eje, en vez de
excluirlo: se ve la tendencia sin que un mes a medias parezca una caída — la misma doctrina
que los deltas. Detalle que costó una iteración: con el relleno sobre la serie completa y el
trazo solo sobre los meses cerrados, las dos curvas `monotone` se interpolan sobre conjuntos
de puntos DISTINTOS y se separan visiblemente; cada área lleva ahora el mismo juego de puntos
que su trazo, y una serie invisible alimenta el tooltip para que el mes de unión no salga
duplicado.

## 2026-07-27 — /red segunda pasada de layout, y el embudo se queda sin la etapa "citados"
Tres filas en vez de cuatro: riesgo (60%) y logros (40%) COMPARTEN la primera, cada uno como
bloque con el tinte de su categoría; negocio + clínicas la segunda; evolución y embudo la
tercera. El fallo que se corrige: solo la card destacada llevaba color y las secundarias eran
blancas, así que no se leían como parte de su categoría — ahora todas llevan borde semántico
izquierdo y el número en el color del tono, sobre superficie limpia encima del tinte del
bloque. El embudo cuenta la promesa del producto, pero le falta una etapa y NO se inventó:
"citados" no es derivable. De 268 leads de DEMO solo 7 tienen `fecha_cita` y `asistido` está
sin escribir en los 268; de los 79 que llegaron a ser paciente, CERO tienen cita registrada
—la cita solo se graba al arrastrar a "Citado" en el tablero—, así que meter esa etapa haría
que el embudo SUBIERA de 7 a 35, imposible en una cohorte anidada (MEJORAS 50). Quedan cuatro
etapas realmente anidadas sobre la misma cohorte de leads: captados 268 → llegaron a la
clínica 79 → recibieron presupuesto 35 → aceptaron 7. Detalle de honestidad visual: la barra
empezó siendo una caja que contenía su texto, lo que obligaba a un ancho mínimo que igualaba
visualmente 35 y 7 —la barra desmentía a su número—; ahora es un relleno de fondo sobre una
pista a ancho completo, proporcional de verdad, con el texto siempre legible encima.

## 2026-07-27 — Cobros: una gramática compartida, la cola cabe en pantalla y el toggle deja el negro
Pasada visual de /cobros. Contenido: `fmtEUR` escribía `toLocaleString` sin `useGrouping` y
es-ES omite el separador en cuatro cifras — "1050 €" y "12.725 €" en la misma pantalla, en
cards, pestañas, tabla y copy de estado; ahora hay UN formateador para todo el producto. Y
`/api/cobros` comparaba el mes en curso contra el mes anterior COMPLETO mientras /red ya
comparaba el mismo tramo: la misma cifra con dos reglas según la pantalla (el día 3 de un mes
/cobros habría dicho "−90%"). Se extrajo `Cifra`+`Comparativa` de RedView a
`components/shared/Cifra` para que la gramática de comparación sea una sola en todo Fyllio.
Layout: las tres KpiCard de 36px se funden en una franja compacta —se repetían idénticas en
las dos vistas y en móvil empujaban el primer cobro 480px hacia abajo—, y la cola estrena la
densidad "compacta" de AccionCard (identidad · estado · importe en horizontal, opt-in: las
otras colas no cambian), con lo que los 8 vencidos caben en una pantalla donde antes cabían 3.
`emphasis` iba a las OCHO cards del bucket: ahora solo a la primera, porque cuando todas
gritan ninguna destaca. El importe deja de ir a 24px junto a un nombre de 14px: el número no
puede pesar más que la persona a la que hay que llamar. El Registro pliega los ya cobrados
(40 de 68 filas) bajo "Ver N ya cobrados", salvo si se filtra por "pagado" explícitamente.
`SegmentedToggle` pintaba la pastilla activa en `--color-foreground` (negro sólido, un color
de marca que Fyllio no tiene) en el control más visible de tres pantallas: era el primitivo,
no una variante suelta, así que Cobros, Seguimiento y Presupuestos pasan al acento a la vez.

## 2026-07-27 — La comparación es el CAMBIO, no el mes anterior
La gramática «48 · eran 14» obligaba a restar mentalmente y dejaba dos cifras grandes
compitiendo por métrica. Pasa a la magnitud del cambio en las unidades del valor: «+34 vs mes
pasado», «+10.424 € vs mes pasado», «−29 pts» (un porcentaje cambia en PUNTOS, nunca en % de
un %). Fuera las flechas: el signo ya dice la dirección y el icono al lado eran dos símbolos
peleándose — la lección estaba escrita desde hacía días en la columna de evolución de /red y
no se había aplicado al resto. El color queda solo para "bueno/malo para ESTA métrica". El
mes anterior a cero deja de ser caso especial: con delta absoluto no hay división imposible.
La tabla de clínicas pierde el subtexto del € aceptado (la columna Evolución, pegada, ya es
su cambio: eran tres cifras de una métrica en la misma fila); esa columna se queda en % a
propósito, porque es lo único comparable entre clínicas de tamaños distintos y es el criterio
del orden.

## 2026-07-27 — MEJORAS 50: la cita del lead se DERIVA, no se duplica
De 79 leads convertidos en DEMO, cero tenían `fecha_cita`… y los 79 tenían citas reales en la
agenda a través de su paciente. El dato existía; faltaba el enlace. Copiar la fecha al lead
habría creado una segunda verdad que se desincroniza en cuanto alguien mueve la cita, así que
`lib/leads/cita` resuelve en un solo sitio: la del propio lead si alguien la agendó desde
Fyllio, y si no la primera cita de su paciente **dentro de 90 días** desde la captación. La
ventana no es de gusto: de los 77 leads con cita posterior, 73 la tienen en 30 días, los 77 en
60, y el máximo real es 57. Fuera de la ventana no se atribuye y se declara en el propio
embudo ("2 sin fecha atribuible"). Un convertido cuenta como citado aunque su cita caiga
fuera — llegar a paciente implica haber pisado la clínica — y eso es lo que mantiene la
invariante de que el embudo nunca sube. Con eso entra la etapa que faltaba: 268 captados → 86
con cita → 79 llegaron → 35 con presupuesto → 7 aceptaron, y el agujero grande del negocio
queda a la vista (se pierde el 68% antes de pisar la clínica). Se cerraron las dos puertas que
dejaban un lead "Citado" sin cuándo: el PATCH de leads lo rechaza con 400, y el copiloto
pierde "Citado" de su enum **y** lo bloquea en el ejecutor (el enum es una sugerencia al
modelo, la barrera va en el servidor). El kanban ya no permite arrastrar a Citado sin pasar
por Agendar desde ninguna columna: antes solo lo exigía viniendo de "Contactado".
`scripts/qa-leads-cita.mjs` prueba las dos puertas y la invariante del embudo, y restaura el
seed al terminar.

## 2026-07-27 — Leads: una sola urgencia en el tablero, y "Citados Hoy" se queda en rojo
Pasada visual del kanban. **Decisión de producto declarada:** la columna "Citados Hoy" sigue
en rojo, no por accidente de paleta sino porque es lo más importante del tablero y tiene que
tirar del ojo (Simon, 2026-07-27). Dos condiciones que la hacen legítima: va con el token del
sistema (`--color-danger-soft`), nunca con Tailwind crudo + `dark:` a mano; y dentro de la
columna se distingue el caso en el que el rojo SÍ significa problema — cita cuya hora ya pasó
sin cerrar, con borde izquierdo y "Su hora ya pasó · sin cerrar". De ahí sale la regla del
resto del tablero: el color marca URGENCIA, no identidad de columna, y en este tablero solo
hay una — los otros cuatro badges pasan a neutro (antes eran gris · ámbar · azul · rosa ·
gris sin criterio; "Contactado" no es un aviso). El verde de marca de WhatsApp sale de las
cards: se repetía 27 veces en una pantalla, era el color dominante y arrastraba el ojo a la
acción menos importante; los dos botones bajan a neutro de bajo contraste y el acento queda
para lo que decide algo ("Marcar asistido"). Los tres micro-elementos sueltos del pie
(icono "Llamado" · bocadillo con un número · "hace 0d") se funden en UNA línea que dice algo
cierto: "Te respondió hace 10 h" (acento, es lo que toca responder), "Sin respuesta hace 4
días · 2 enviados", "Sin contactar · hace 13 días". El bocadillo con un número no decía si
eran entrantes, salientes ni si tocaba responder — y "sin respuesta hace X" NO se puede medir
desde la captación, así que /leads carga el estado de conversación del MISMO motor que /red y
/seguimiento y mide desde el último saliente real. La etiqueta "Necesita atención" usa el
umbral del motor (`esNuevoUrgente`, 48 h), que sube de SeguimientoView a `lib/seguimiento/
cohortes` para que no haya dos copias.

## 2026-07-27 — El "hoy" salía de UTC y no del calendario de la clínica
Cazado a las 21:32 revisando las fechas humanas de /leads: `new
Date().toISOString().slice(0,10)` devuelve el día EN UTC. Una cita del 29 se anunciaba como
"mañana" y un lead citado para hoy se caía de la columna "Citados Hoy". Vive ahora como
`hoyISO()` en `lib/time`; el resto queda anotado como MEJORAS 52.
**Corrección del día siguiente (2026-07-29), medida en vez de supuesta:** la ventana de fallo
que escribí aquí ("a partir de las 22:00 en Madrid") estaba al revés. Para Madrid, UTC va
por DETRÁS: el día se desincroniza entre las **00:00 y las 02:00** de Madrid (00:00-01:00 en
invierno), y ahí el producto sigue creyendo que es ayer. Lo que vi a las 21:32 fue el error
espejo, propio de una máquina al oeste de Greenwich (UTC−4), donde UTC va por delante desde
las 20:00 locales — o sea, durante las demos. Los dos son reales y los dos los arregla la
misma pieza, pero la afirmación era imprecisa y el detalle importa para saber a quién
afecta: a la clínica en la madrugada, y a las demos por la tarde.

## 2026-07-29 — MEJORAS 52: el día de la clínica, y el censo completo (no eran ocho)
El censo del patrón dio **56 ocurrencias**, no las ocho que se vieron en /leads. Clasificadas:
**decidían lógica (19)** — cohortes de /seguimiento (×2), `LeadAccionPanel` (×3), alertas del
cron, `listAccionesHoyPg`, `kpi-hoy`, próxima cita de un paciente, `TODAY()` del intérprete de
fórmulas, semana de /red, series de KPIs de leads (×2), rangos de KPIs de cobros (×2), mes y
tramo de /api/cobros, mes MTD de automatizaciones, fecha del presupuesto en la conversión y
fecha de un pago (×2, ESCRIBEN un dato). **Decidían solo UI (5)** — defaults de fecha en dos
modales, nombre del CSV, hora de la próxima cita, cadencia de auto-refresh. **Inocuas (32)** —
los `d10()` que convierten un `date` de Postgres, cuatro copias de `shiftDay` (aritmética de
calendario en UTC puro, correcta), los seeds (anclan a las 09:00, así que ningún huso realista
les cambia el día) y logs de scripts de sanity.
Lo importante del arreglo: `hoyISO()` NO puede usar la hora local del proceso, porque en
Vercel el proceso es UTC. La zona es la **de la clínica** (`TZ_CLINICA = "Europe/Madrid"`),
declarada explícitamente y nunca heredada del runtime; cuando haya clínicas en otro huso
saldrá de su ficha. `lib/time` gana `hoyISO`, `mesISO`, `horaClinica`, `sumaDias` e
`inicioDelDiaUTC` — este último es el que arregla las consultas por timestamp: el día empieza
a las 00:00 de Madrid, que en julio son las 22:00 UTC del día anterior, y filtrar por
`T00:00:00Z` se comía las dos primeras horas de trabajo. De paso, las cuatro copias de
`shiftDay` pasan a ser una. En /api/kpis/cobros había un `const ZONE = "Europe/Madrid"` sin
usar con un export falso para callar al linter: alguien vio el problema, lo anotó y siguió
usando el TZ del runtime.
Test permanente `npm run qa:fechas`: puro, sin BD ni servidor, porque el bug vive en una
ventana de dos horas al día y "probarlo a mano" es tirar una moneda. Afirma que el día de la
clínica no depende de la zona del proceso (verde con TZ=UTC, Madrid, New_York y Tokyo), que
la fórmula vieja SÍ falla y exactamente dónde, y la consecuencia de negocio: un lead citado
hoy sigue en su cohorte y en su columna las 24 horas del día (con la fórmula vieja se caía 2).

## 2026-07-29 — Principio: no hay dos tipos de paciente
Decisión de producto de Simon, anotada antes de tocar código. **Hay pacientes, y algunos
tienen un lead de origen.** El lead es PROCEDENCIA, no una clase distinta. Al marcar
asistido, el lead deja de serlo y nace un paciente con historial en la clínica; a partir de
ahí es un paciente más, buscable como cualquier otro. Un paciente con historial puede
recibir presupuestos nuevos **sin pasar por el pipeline de leads** — hoy ese caso
sencillamente no existe en Fyllio, y es la mitad del negocio de una clínica real: medido en
DEMO, el **52% de los pacientes (87 de 166) no tiene ningún lead**.
Consecuencias que gobiernan lo que se construya a partir de aquí: (1) el buscador de un
presupuesto nuevo busca sobre PACIENTES, no sobre leads ni sobre texto libre; (2) un
presupuesto creado sobre un paciente con historial es indistinguible aguas abajo —
seguimiento, cobros y ficha lo tratan igual, sin ramas por origen; (3) el paciente registra
si nació de captación o ya existía, y esa marca existe SOLO para que las métricas no los
mezclen (la conversión de leads se calcula únicamente sobre los de captación); (4) el modal
de presupuesto NUNCA crea el paciente: sería un segundo camino al mismo resultado, sin
asistencia registrada ni trazabilidad de origen.

## 2026-07-29 — El presupuesto se crea sobre un paciente buscado, no sobre un nombre tecleado
Ejecución de la spec del principio anterior. Tres hallazgos que la cambiaron:
**(1)** El modal no buscaba sobre leads, como se sospechaba: no buscaba sobre NADA. El nombre
era un `<input type="text">` y lo único que consultaba era un aviso de presupuestos
duplicados, no de personas. **(2)** El POST no escribía `Paciente` —ni doctor, ni tipos, ni
clínica, ni teléfono—: el presupuesto nacía huérfano y la tarjeta se llamaba literalmente
"Paciente" al recargar. Por eso alguien colaba esos campos en las notas con pipes; el apaño
delataba el bug. Verificado en vivo antes y después contra DEMO. **(3)** Huérfanos existentes:
CERO, en las tres bases. El bug nunca llegó a morder porque nadie había usado el alta manual,
así que no hay nada que migrar ni que adivinar.
Decisiones de diseño: el buscador es UNA función (`lib/pacientes/busqueda`) — es la frontera
con el PMS. El origen del paciente NO se calcula ahí: el picker no lo enseña y hacerlo costaba
una carga entera de leads por tecla (2,3 s por pulsación); vive aparte, para quien mide. El
enlace al lead va a `/leads?lead=<id>`, que abre su ficha: mandar al tablero a buscarlo entre
27 cards no es ayudar. Y el modal no crea pacientes ni preguntando: solo señala qué falta.
Del modal salen Nº de historia, teléfono, especialidad, tipo de paciente, tipo de visita y
origen. Los tres primeros salen del paciente o del doctor. **La especialidad no existía en el
modelo**: `staff` tiene `rol` (Dentista/Higienista) y un campo `tratamientos` vacío, y el
endpoint leía un campo de una tabla inexistente devolviendo "General" para todos — no había
nada que derivar, solo un desplegable decorativo. Los tratamientos pasan de texto libre a
selector del catálogo real (12, con categoría, cubre el 100% de los usados hoy).

## 2026-07-29 — Supuesto validado: el paciente migrado necesita un identificador estable
Validado por Simon. La búsqueda de pacientes vive tras una sola función; hoy consulta
Postgres y mañana podría consultar el PMS del cliente sin rehacer UI ni flujo. Pero para
CREAR sobre un paciente hace falta colgarle el presupuesto de un id: si el PMS no expone un
identificador estable, leer de él solo sirve para consultar y **migrar pasa a ser la única
vía**. Esa es exactamente la frontera y el único punto que queda pendiente de decidir.

## 2026-07-29 — Tipo de paciente: catálogo configurable, no enum
El tipo (Privado / aseguradora) pasa a ser propiedad de LA PERSONA y su catálogo vive en
`configuraciones_clinica`, el mismo sitio que los métodos de pago. **Dos categorías, y la
categoría ES la marca de aseguradora**: `Tipos_Paciente` (los que no lo son) y
`Tipos_Paciente_Aseguradora` (las mutuas). Se descartó meter un flag dentro del valor porque
es exactamente el pecado que acabábamos de quitar de `presupuestos.notas` — metadatos colados
en un campo de texto. La categoría es el vocabulario propio de la tabla y no cuesta esquema
nuevo; en Ajustes son dos pestañas del editor genérico que ya existía.
El enum `TipoPaciente = "Adeslas" | "Privado"` desaparece, y con él los cuatro puntos donde
estaba clavada una aseguradora concreta: el array literal que definía qué se mide en los
KPIs, las dos cards y las cuatro barras (con hex a mano) de la vista de Tarifas, la
heurística del importador CSV y el portal del paciente.
**El bug que la spec pedía evitar, evitado:** el portal enseñaba el desglose de cobertura si
`tipoPaciente === "Adeslas"`, así que un paciente de Sanitas habría dejado de verlo sin que
nadie se enterara. Ahora la pregunta es "¿tiene aseguradora?", resuelta en `generar-portal`
—donde sí hay contexto de cliente— y viajando en el payload, porque el portal es público y no
puede consultar el catálogo. El QA lo cubre, y **declara que la prueba de punta a punta se
omite sin Vercel KV** en vez de darla por verde: un test que pasa porque `undefined === false`
es peor que no tenerlo.
`presupuestos.tipo_paciente` se conserva (lo consumen KPIs históricos) pero deja de ser
fuente: HEREDA del paciente al crear. Sin backfill en datos reales — los 123 presupuestos
decían "Nuevo", que no es un tipo de paciente, y derivarlo sería inventar; el "Nuevo" se
limpia en la migración. En DEMO **sí** se reparten tipos, porque sin ellos la pestaña Tarifas
enseña cuatro cards a cero y la línea de mezcla de /red no enseña ninguna mezcla: ahí el dato
es inventado por diseño y el script lo dice.
La mezcla entra en /red como UNA línea ("De qué depende la facturación": % privado vs
aseguradora con su € aceptado, y cuántos pacientes sin tipo quedan). El detalle y la evolución
se quedan en Tarifas. La medida es sobre los pacientes CON TIPO y los que no lo tienen se
declaran: el campo es nuevo y se rellena con el uso.
Cazado de paso: importar la librería del catálogo desde el modal de CSV arrastraba
`db/context` (y `async_hooks`) al bundle del navegador. La parte pura vive ahora en
`tipos-paciente-puro.ts`. Regla: si algo lo necesita el navegador, no puede compartir archivo
con un repo.

## 2026-07-29 — Pacientes: la tasa deja de diluirse y el euro se escribe una sola vez
Pasada visual de /pacientes + ficha. **La cifra que estaba mal:** decía "41% del total" y
"16% del total" con los 166 pacientes en el denominador, incluidos 46 a los que nunca se les
presentó un presupuesto. La aceptación real era **57% y 23%**. Ahora se mide sobre los 120 que
sí recibieron uno, con los 25 que aún no han decidido declarados y una línea al pie que dice
sobre cuántos se está midiendo — misma regla que la conversión de /red.
**El euro tenía SEIS implementaciones** y tres formatos convivían en la misma pantalla
(«€2100», «118.297 €», «€1977»). Todas caen: tabla, ficha, KPIs de cobros y de no-shows, la
cola de intervención, el kanban, los informes, el importador y **el portal del paciente** —
que enseñaba "€2100" a quien recibe el presupuesto. Una sola función, `eur`.
La columna "Aceptado" tenía cuatro valores bajo una cabecera binaria: pasa a "Presupuesto"
con Aceptado · Perdido · Abierto · Sin presupuesto, y quien no tiene presupuesto pierde el
pill (un borde vacío repetido 46 veces es ruido). De paso se cazó que la columna de dinero y
la de estado quedaban ambas llamadas "Presupuesto": la de dinero es "Firmado", que es lo que
mide (Σ de los aceptados).
Se cierran las tres puertas por las que nacía un paciente sin presupuesto: el checkbox
desmarcable del modal de asistencia, `crearPresupuesto` opcional en la API de conversión —que
la propia cabecera documentaba como "flujo Sprint 8 original, sin body"— y `POST
/api/pacientes`, que **no lo llamaba nadie en la UI** y se retira. **El cuarto camino se
conserva y es válido:** el scheduler, donde un paciente nace de una cita de agenda y no tiene
por qué traer presupuesto todavía.
Horas del seed: se generaban con `setHours` del reloj de la máquina que siembra, así que desde
UTC−4 la clínica demo citaba entre las 15:00 y las 20:30 de Madrid. Ahora se generan en zona
de clínica y caen entre las **09:00 y las 16:30**. Cazado al hacerlo: `setHours` desbordaba
solo (hora 25 → día siguiente) y la primera versión del helper no, así que el seed reventó a
mitad — con rollback, porque es transaccional. Se normaliza en minutos totales.
En la ficha, "Qué hacer ahora" deja de gritar cuando no hay nada que hacer (superficie neutra
y titular pequeño; con acción, todo su peso), "Tratamiento y presupuesto" abre por defecto —es
la razón de ser de la ficha, y con los cuatro plegables cerrados la mitad inferior quedaba en
blanco—, "Económico y pagos" abre solo si hay pendiente, el chip de intención IA se queda
pegado al mensaje que lo originó (salía dos veces) y el ancho sube de 1.030 a 1.280 px.

## 2026-07-29 — Pacientes al centro, y "Máxima" pasa a ser "Tabla"
Reordenación de módulos. **Pacientes va delante de Seguimiento en el nav**: es la base de
datos de personas de la clínica, y lo demás son vistas sobre ella.
**"Máxima" se reconvierte, no se borra.** La auditoría previa lo dejó claro: no es una vista
de pacientes, es una vista de PRESUPUESTOS —su unidad es el presupuesto— con pills de estado
de seguimiento (Intervención · Acepta sin pagar · Sin contactar · En seguimiento · Cerrados),
última y próxima acción, filtros de doctor y tratamiento, orden por columna y la ÚNICA
exportación CSV del producto. Borrarla habría perdido las tres últimas cosas. Y no duplicaba
nada de Pacientes: donde coinciden los nombres de columna (doctor, tratamiento), la unidad de
la fila es distinta. Así que se queda como la segunda vista del toggle y solo cambia el
nombre: **"Tablero" · "Tabla"**. "Máxima" no significaba nada para una coordinadora y "Panel"
tampoco decía que fuese un kanban. El id interno `maxima` se conserva para no romper los
enlaces `?vista=maxima` que ya existen.
La fila de Pacientes **se despliega** con un resumen accionable corto: sus presupuestos con
estado e importe, cobrado y pendiente, y tres botones —nuevo presupuesto, registrar cobro
(los modales que ya existen, cero nuevos) y "Ver ficha completa". Es deliberadamente corto: si
creciera hasta duplicar la ficha, sobraría una de las dos. El fallo de carga del detalle se
declara y ofrece reintentar, no se pinta como "este paciente no tiene nada".

## 2026-07-29 — Producción llevaba semanas sirviendo datos inventados (o nada)
Simon confirmó que `AIRTABLE_API_KEY` y `AIRTABLE_BASE_ID` **no existen en Vercel** desde que
se retiró Airtable. Trece archivos decidían su comportamiento con esas variables, así que la
condición se cumplía SIEMPRE en producción y esas rutas **no llegaban nunca a su código real**
— que hoy lee de Postgres y funciona perfectamente.
Lo que estuvo pasando, por gravedad: **seis escrituras confirmaban éxito sin escribir nada**
(guardar la configuración de automatizaciones, marcar una secuencia como enviada/descartada,
guardar objetivos del mes, guardar la configuración de WhatsApp Business, y un importador de
CSV que respondía "importados N" con cero escritos) — mandamiento §1 al revés. **El motor de
automatizaciones estaba muerto**: su cron abortaba con 500 en cada ejecución. **La cola de
intervención salía vacía** ("no hay nada que hacer" con 28 casos reales). Y **/presupuestos
devolvía 500**, que la pantalla pintaba como "0 presupuestos abiertos · 0 €" — el síntoma que
Simon reportó.
Se eliminaron TODAS las puertas, no se re-condicionaron a otra variable: si una ruta no puede
servir datos reales, error honesto. De paso cayeron los últimos fallbacks a datos demo en los
catch —presupuestos inventados en los KPIs, contactos inventados en el historial de una
conversación, doctores inventados que acaban impresos en el portal del paciente, y estadísticas
de tono inventadas— incluido el de desarrollo: un pipeline falso en local es exactamente cómo
se aprende a no fiarse de la pantalla, y es lo que retrasó este diagnóstico.

## 2026-07-29 — El entorno se declara y se comprueba al arrancar
Respuesta al "¿cómo se detecta esto automáticamente?" tras semanas de producción degradada en
silencio. Cuatro piezas, y ninguna es una revisión manual:
**`lib/entorno`** declara qué necesita Fyllio y qué se rompe sin cada cosa, en lenguaje de
producto ("el login: nadie puede entrar"), con dos niveles: crítica (no se arranca) y
funcional (se arranca, pero una capacidad no existe y hay que saberlo — nunca se descubre por
una pantalla vacía). **`instrumentation.ts`** lo comprueba en el arranque del servidor: en
producción aborta, en desarrollo grita. Fallar al arrancar es barato; degradar en silencio no.
**`/api/salud`** responde desde FUERA si un entorno sirve datos reales — el contrato más una
lectura de verdad, porque un entorno puede tener todas las variables y no llegar a los datos.
**`npm run qa:sin-fallbacks`** guarda el PATRÓN: falla si una ruta de API importa datos demo,
si alguien decide comportamiento con una variable fuera del contrato, o si aparece un `?? []`
nuevo sobre una respuesta de fetch. Los 15 `?? []` anteriores entran como deuda declarada con
regla de trinquete: la lista solo puede encoger. Un guardián que bloquea por deuda vieja es un
guardián que nadie ejecuta.
**La herramienta se delató a sí misma en la primera ejecución:** el contrato marcaba
`DATA_BACKEND_PG_CLIENTES` y `DATA_BACKEND_PG_DOMINIOS` como críticas y la app funcionaba
perfectamente sin ellas — eran interruptores muertos de la migración a Postgres. Y `CRON_SECRET`
pasó a exigirse solo en producción: un contrato que grita en falso en el portátil de todos los
días acaba ignorado, y entonces no avisa cuando importa.

## 2026-07-29 — El guardián entra en el build (no hay CI aparte)
No hay GitHub Actions: el deploy va por Vercel, que ejecuta `npm run build`. Así que la puerta
real es el propio build, vía `prebuild` — npm lo ejecuta siempre antes, sin poder saltárselo y
sin depender de que nadie se acuerde. Verificado en los dos sentidos: con el repo limpio el
build sigue; introduciendo a propósito una variable fuera del contrato, el build se detiene con
el motivo escrito. Impacto confirmado a cero: las bases piloto están vacías y sin usuarios, así
que las semanas de producción degradada no perdieron datos de nadie.

## 2026-07-29 — La herramienta de verificación también tiene que fallar diciendo por qué
`verificar-produccion` dio 401 en sus ocho comprobaciones contra un despliegue sano. No era la
app: era **Deployment Protection de Vercel**, que mientras el proyecto no tenga dominio propio
cubre TODOS los `.vercel.app` — incluido el alias de producción sin hash, así que quitar el hash
de la URL no cambiaba nada. Contesta de tres formas, y la traicionera es la tercera: con
`Content-Type: application/json` devuelve un JSON PROPIO, `{error:{message:"Protected
deployment"},protection:{vercel_auth_enabled:true}}`, que parece la app respondiendo 401 y cuyo
`error` es un objeto — concatenarlo imprimía `[object Object]`, que es lo que hacía imposible el
diagnóstico. El script ahora hace una **sonda previa**: si contesta el borde, si la URL no es
Fyllio o si no hay JSON, aborta con exit 2 y una línea que dice qué hacer, en vez de repetir
ocho veces el mismo error sin nombre. Misma lección que el contrato de entorno, aplicada un
nivel más arriba: **una herramienta que informa mal convierte un problema de dos minutos en una
tarde**, y ocho fallos idénticos son un fallo de la herramienta, no ocho hallazgos.
El camino soportado para atravesar la protección desde un script es el secreto de *Protection
Bypass for Automation* (`x-vercel-protection-bypass`), ya cableado como `FYLLIO_BYPASS`; la
solución de fondo es dar al proyecto un dominio propio.

## 2026-07-29 — `fyllio.vercel.app` NO es nuestro
Es el proyecto de otra persona: responde 200 y sirve un create-react-app con `<title>React
App</title>`. Aparece en cualquier búsqueda de "la URL de Fyllio" y **da 200 a todo**, así que
usarla como referencia de "producción funciona" es un falso verde perfecto. Nuestro alias es
`fyllio-simon-wertheimers-projects.vercel.app` (proyecto `fyllio`, `prj_awFaf3Nk…`). El
verificador lo detecta y aborta: si `/api/salud` devuelve HTML en vez de JSON, quien contesta no
es Fyllio.

## 2026-07-29 — El portal del paciente: nadie había aceptado nunca un presupuesto
Al ir a CORRER el QA de MEJORAS 57 aparecieron dos cosas peores que la que se iba a
comprobar. **Una:** `generar-portal` tenía un "demo fallback" para roles sin restricción
de clínica — si no podía leer el presupuesto, fabricaba un "Paciente Demo" con una
ortodoncia de 4.200 € en una "Clínica Demo", lo guardaba en KV y devolvía un enlace **que
funcionaba**. Un admin podía mandarle a un paciente real un presupuesto que nadie
presupuestó. La barrida de datos demo de ese mismo día (MEJORAS 59) no la cazó porque esa
puerta no la gobernaba una variable de entorno, sino `recs.length === 0`.
**Dos, y es la grave:** aceptar desde el portal era un **no-op silencioso, para todos**.
`responder` envolvía todo en `runWithCliente(PILOT_CLIENTE)` = RB; RB está vacío y los
presupuestos vivos son de otros clientes, así que RLS filtraba la fila, el `update … where
id = ?` afectaba a **cero filas sin lanzar nada**, y la ruta seguía adelante: marcaba el
token como respondido y devolvía `{ok:true}`. El paciente leía "gracias por aceptar" y la
clínica no se enteraba nunca. El orden de escritura que arregló MEJORAS 20 era correcto —
lo que faltaba era **comprobar que la escritura escribió**, y **saber en qué base escribir**.
De aquí salen dos piezas. `lib/db/escritura` (`actualizarUna`) afirma que un update por id
tocó una fila y lanza `EscrituraSinEfecto` si no; aplicada a las 18 escrituras por id que
confirman algo a alguien, con cuatro exclusiones comentadas en su línea donde cero filas es
legítimo. Y `PortalData.cliente`: el cliente se guarda al generar el token y se lee al
responder (era el paso ya escrito en `multi-cliente-pendiente.ts`), fail-closed si falta.
Cazado de paso leyendo el resto: el GET del portal **no fijaba contexto de cliente**, así
que sus dos efectos —el aviso al equipo y el registro de "portal visto"— morían en `base()`
sin contexto y se los comía un `.catch(() => {})`: no se registró **ni una** apertura desde
que existe. Su TTL podía salir 0 en el último segundo de vida, que para KV significa "sin
expiración". Y aceptar escribía la firma en `Notas`, un campo de texto único: **borraba lo
que la coordinadora hubiera escrito del caso**. La firma pasa al historial, con
`registrarAccion({obligatorio:true})` — porque por defecto se traga su propio fallo y un
`await` daba una falsa sensación de garantía.
El "desglose de cobertura" decía "Sanitas cubre: **Consultar**" y "Tu parte: **2.400 €**",
el total entero, a un paciente con mutua. No es un desglose incompleto: es una cifra falsa
en el momento de hablar de dinero, y no hay nada que desglosar porque el modelo no guarda
cuánto cubre cada mutua. Se nombra la aseguradora y se remite a la clínica.
**Lo que NO se pudo cerrar:** el store de KV al que apuntan las variables no existe
(`ENOTFOUND`, también fuera del sandbox), así que el QA de punta a punta sigue sin correrse.
El script nuevo (`npm run qa:portal`, los seis puntos, incluido leer la fila del kanban tras
aceptar) **aborta con exit 2 y el motivo escrito** en vez de omitir en silencio. KV entra en
el contrato de `lib/entorno`: no estaba declarado, y por eso su desaparición no avisó.

## 2026-07-29 — Presupuestos: la cabecera contaba la pantalla, y el euro seguía roto
Pasada visual de /presupuestos. **La barra de cabecera propia era el único módulo con una**
y un tercer patrón: por eso el título quedaba pegado al borde mientras Pacientes y Cobros
respiran. Ahora la anatomía del resto (título y subtítulo dentro del cuerpo, conmutador al
extremo derecho alineado con el título) y las tres acciones a la altura de la fila de
filtros, presentes también en la Tabla — antes esa fila solo existía en el Tablero.
**Las cifras dejan de contar la pantalla:** "En juego ahora" (sigue al tablero y lo dice en
su detalle), "Firmado este mes" con `Comparativa` en euros, y "Se cierran" = aceptados sobre
**decididos** del mes, cohorte anidada por construcción, con los que siguen abiertos
declarados al pie y el delta en pts. Sin decididos dice "—", nunca 0%.
**El euro tenía CINCO implementaciones más en esta zona** después de que la pasada de
/pacientes matara seis: la card escribía `€2.400`, la cabecera del panel `2.400€` y el
subtotal de la columna `2.400 €` — con `eur` importado **en el mismo archivo**. Tres
formatos visibles en tres clics sobre el mismo importe. `eur` se parte a `lib/dinero`
(módulo puro) porque una ruta de servidor lo necesitaba y `Cifra.tsx` es `"use client"`;
Cifra lo reexporta, así que ningún componente cambia de import. Misma regla que
`tipos-paciente-puro`, en el sentido contrario.
**Dos bugs de "dice que sí y no lo hace":** cambiar el DOCTOR de un presupuesto no guardaba
nada (el modal lo mandaba desde siempre, la ruta nunca lo mapeó a un campo), y un fallo del
buscador de pacientes se leía como "no está ni como paciente ni como lead citado" y mandaba
a la coordinadora a darlo de alta por Leads — el §10 en su forma más caras: no vacía una
lista, **dicta la acción contraria**.
**El guardián de `?? []` medía mal su propia deuda.** Solo reconocía
`const d = await res.json()`; la forma `.then((d) => setX(d.cosas ?? []))` no la veía, y se
llevaba siete casos fuera del recuento. Al ampliar la heurística aparecieron cuatro más: la
deuda real no era 15 ni 22, era **26**. Ocho migradas aquí, 18 declaradas (tres de ellas en
un componente sin consumidor). Y se excluye el cuerpo de PETICIÓN (`req.json()`), donde
`?? []` sí es un default legítimo — un guardián con falsos positivos se acaba desactivando.
**El arcoíris que StatePill vino a matar seguía vivo aquí**: `ESTADO_VISUAL_CONFIG` tenía
nueve colores en hex —violeta y púrpura incluidos, retirados del producto— más un tinte de
fila por estado. La cabecera de `StatePill` dice literalmente que existe para "reemplazar la
dispersión morado/celeste/amarillo/rosa/naranja", y este archivo era el último sitio donde
sobrevivían los cinco. Con él, el contador de columna (donde `orange` era un sexto color sin
token) y los dos `cfg.hex` del modal de mover, ilegibles en oscuro.
**El panel de la campana estaba entero fuera del sprint visual** —`bg-white` fijo, nueve
slate sin variante oscura, violeta en tres sitios, `✕` en vez de lucide— y sus dos
mutaciones no comprobaban `res.ok` mientras la UI bajaba el contador: la campana se ponía a
cero sin que el servidor lo supiera, y al recargar volvían.
Y tres promesas que no se cumplían: el banner rojo "N casos requieren intervención" hacía
exactamente lo mismo que el pill de dos líneas más abajo; "Próx. acción: Intervención
urgente" era una etiqueta de estado disfrazada de acción (ahora "Llamar hoy"); y el botón
verde "WhatsApp" de la card no envía WhatsApp — abre la ficha, así que se llama "Escribir" y
baja a neutro de bajo contraste como en Leads, donde el verde repetido 25 veces era el color
dominante de la pantalla.
**Lo que queda medido y sin decidir (MEJORAS 71):** el rango temporal aplica al Tablero y no
a la Tabla, y su selector desaparece al cambiar de vista. El Tablero pinta 45 · 49 · 86 · 123
según el rango; la Tabla siempre 123. La contradicción que Simon vio ("29 abiertos" vs "124
presupuestos") no eran dos medidas del mismo conjunto sino dos universos distintos sin
etiqueta que lo dijera — eso ya está cerrado; lo que falta es decidir si el rango gobierna
las dos vistas.

## 2026-07-29 — El portal del paciente funciona, y comprobarlo destapó un bug más
MEJORAS 57 cerrada: 19 comprobaciones verdes de `npm run qa:portal` contra el build de
producción y un KV nuevo. Es la primera vez que la cadena generar → leer → aceptar se
ejecuta entera, y la primera vez que alguien acepta un presupuesto desde el portal y la
clínica se entera.
**Las variables de KV llevan prefijo obligatorio en Vercel** (`FYLLIO_KV_REST_API_URL` /
`FYLLIO_KV_REST_API_TOKEN`) y el singleton `kv` de `@vercel/kv` lee los nombres SIN prefijo
directamente de `process.env`. Diez archivos importaban ese singleton: diez archivos habrían
dejado de encontrar sus credenciales sin que nadie tocara una línea — la forma exacta de la
avería de Airtable (§11). El cliente se construye ahora en `lib/kv`, el único sitio que
conoce esos nombres, y los diez importan de ahí. **Sin fallback a los nombres viejos**: un
`X || Y` es un camino que funciona en un entorno y no en el otro, que es justo lo que hace
que un entorno degrade en silencio. `lib/kv` también centraliza la única pregunta sobre su
entorno (`kvConfigurado()`, que usa el rate limiter del login para degradarse a memoria).
**La ejecución pagó por sí misma:** la comprobación espejo —poner "Privado" en la persona y
esperar que el bloque de cobertura desaparezca— salió ROJA. El portal resolvía la aseguradora
desde `presupuestos.tipo_paciente`, la instantánea que se hereda al crear, en vez de desde el
paciente. Corregir la mutua de alguien no cambiaba lo que veía en su enlace, y el enlace se
genera DESPUÉS de cualquier corrección. Contradecía la decisión del mismo día ("el tipo es
propiedad de LA PERSONA; la columna del presupuesto se conserva para KPIs históricos pero
deja de ser fuente"). Ahora manda el paciente, y "sin tipo" es una respuesta —no hay
mutua— no un hueco que se rellene con el valor viejo; la copia solo sirve para los
presupuestos huérfanos anteriores al alta por buscador.
Nota de método: el QA no se pudo correr contra el dev server porque `next dev` bloquea
`.next/dev/lock` y ya había uno vivo. Se corrió contra `next start` en otro puerto, que es
modo PRODUCCIÓN — y ahí el contrato de entorno hizo su trabajo dos veces: exigió
`CRON_SECRET` (declarado solo-en-producción, se pasó uno de un solo uso) y listó las
capacidades desactivadas, donde KV dejó de aparecer en cuanto los nombres cuadraron.

## 2026-07-29 — El rango gobierna las dos vistas de Presupuestos
MEJORAS 71, decisión de Simon: "un filtro que aplica a una vista y no a su gemela es una
trampa". El selector sube a la fila de la cabecera —junto al conmutador— para que no
desaparezca al cambiar de lente, y la Tabla filtra con las MISMAS funciones puras del tablero
(`fechaDeRango` + `dentroDeRango`): cero criterio nuevo. Sus pills y su recuento se derivan
del conjunto en rango, porque un pill que cuenta filas que la tabla no pinta es exactamente
el mismo error un nivel más abajo; lo que el rango esconde se dice ("N fuera del periodo") y
el vacío distingue "el periodo no tiene nada" de "ajusta los filtros".
**Lo interesante es lo que no bastaba.** Pasarle el rango a la vista dejó la Tabla enseñando
los 123 en cualquier periodo: `/api/presupuestos/maxima` **no mandaba las fechas de cierre**,
así que `fechaDeRango` devolvía null para todo ACEPTADO/PERDIDO y la regla honesta de "sin
fecha conocida el caso se MUESTRA" los mostraba todos. El filtro estaba puesto; el dato con
el que filtrar no viajaba. Lo cazó una comprobación que compara las dos vistas rango a rango
en vez de mirar solo la que se había tocado — con el filtro recién puesto, la Tabla seguía
dando 123 · 123 · 123 · 123 y el fallo era invisible desde la pantalla. La ruta añade
`fechaAceptado` y deriva `fechaPerdida` del historial con las mismas piezas que el kanban.
Ahora cuadran: 45·45, 49·49, 86·86, 123·123.

## 2026-07-29 — El seed apilaba los casos vivos porque presentar y conversar eran la misma fecha
MEJORAS 46. La serie de presentados daba 15 → 48 (+220 %) y cualquier comparativa se leía
absurda aunque la fórmula fuese correcta. La causa no era el volumen: `fecha` (cuándo se
presentó) y el ancla de la CONVERSACIÓN eran **la misma variable**, así que mantener los hilos
vivos obligaba a que los 28 casos abiertos naciesen todos en las últimas dos semanas.
Se separan, porque son dos hechos distintos. Un presupuesto presentado hace seis semanas cuya
conversación está viva hoy no es un artificio del seed: es **el caso que el producto existe
para rescatar**, y era justo el que no había. Reparto ponderado por mes (40/30/20/10 — la
cartera abierta pesa hacia lo reciente porque lo antiguo ya está decidido), determinista, y
aplicado **también a los cerrados**: su fecha de cierre no se toca, pero presentarse en junio y
aceptarse en julio es lo normal, y dejarlos anclados al mes en curso era la otra mitad del
escalón. Resultado: 9 · 16 · 13 · 28 · 24 · 28, salto ×1.2. Efecto secundario bueno: los días
parados pasan de 2-11 a 2-49, así que el criterio único de orden por fin tiene señal.
Dos garantías duras en el seed (presentación nunca posterior al primer mensaje ni al cierre) y
una **invariante nueva**: revienta si los presentados del mes en curso superan ×2 los del mismo
TRAMO del mes anterior — contra el mes entero sería la trampa de comparar cinco días con
treinta. El re-anclaje cubre el borde: correr `demo:reset` el día 1 no tiene días donde
repartir, así que la cuota se arrastra al mes anterior en vez de apilar catorce casos en una
fecha (el mismo defecto en un solo día).
**Y la sonda de `qa:portal` destapó una regresión vieja de camino:** `demo:reset` borra
`configuraciones_clinica` en el wipe y **nunca sembró el catálogo de tipos de paciente**. El
que había venía de fuera del seed, así que cada reseed lo dejaba vacío — sin catálogo, la
pestaña Tarifas enseña cards a cero, /red no enseña mezcla y el portal no puede mostrar
cobertura. Un QA que aborta con "el catálogo no tiene mutua y no-mutua" en vez de dar por bueno
un catálogo vacío es la diferencia entre enterarse hoy y enterarse en una demo.
**Lo que el seed realista deja a la vista (MEJORAS 75, sin decidir):** con el rango por defecto
de dos semanas, el tablero enseña **14 de 28** abiertos. Los que esconde son los más parados,
que es lo que el criterio de orden considera más urgente. Antes no se notaba porque todos los
abiertos caían dentro de la ventana.

## 2026-07-29 — El rango acota el archivo, no el trabajo vivo
MEJORAS 75, decisión de Simon. **Un caso ABIERTO es trabajo pendiente independientemente de
cuándo se presentó, y esconderlo contradice de frente el criterio único de orden**, que dice
que los más parados son los más urgentes: con el rango por defecto de dos semanas el tablero
enseñaba 14 de 28 abiertos, y los 14 que escondía eran justo los que su propio orden pone
arriba. Para un caso CERRADO la pregunta "¿de qué periodo?" sí es la correcta — es para lo que
el control nació, sustituyendo el corte fijo de 14 días de las columnas cerradas.
La regla vive en UNA función pura, `seVeConRango` (`lib/presupuestos/pipeline`), que consumen
los tres sitios que antes repetían la misma línea copiada: el tablero, la Tabla y el recuento
de la cabecera. Un criterio compartido en tres copias es tres criterios esperando a divergir.
**La asimetría se declara en la UI**, y eso no es decoración: un control que filtra media
pantalla y no la otra, sin decirlo, se lee como un fallo. Bajo el propio selector: "Acota
aceptados y perdidos. Lo abierto se ve siempre". Con ella, "En juego ahora" deja de decir "en el
periodo" —ya no depende de él— y la Tabla dice QUÉ esconde ("N cerrados fuera del periodo"),
igual que las columnas del kanban dicen lo que recortan. Verificado: 28/28 abiertos visibles en
los cuatro rangos, y las dos vistas siguen cuadrando.
**El gemelo en Leads queda anotado (nº 76), no tocado.** Está atenuado por diseño —filtra por
última ACTIVIDAD, no por fecha de alta, así que un lead con conversación reciente no
desaparece— pero de 31 leads activos el defecto enseña 26, y los 5 que esconde son los que
llevan más tiempo sin actividad. Mismo razonamiento por otra puerta; la decisión se tomó para
Presupuestos y ahí se queda hasta que Simon diga.

## 2026-07-29 — La regla del rango, una sola vez para los dos tableros
MEJORAS 76, aprobada con la misma regla que la 75: en Leads el rango acota lo cerrado
(Convertido, No Interesado) y nunca esconde un lead activo. Antes filtraba también los vivos
por su última actividad, así que de 31 leads activos el defecto de dos semanas enseñaba 26 — y
los 5 que escondía eran los que llevaban más tiempo sin actividad, o sea los que hay que
rescatar. Mismo razonamiento que en Presupuestos por otra puerta.
Lo que importa del cierre no es el arreglo, es dónde quedó la regla. **No se copió**: se extrajo
a `casoVisibleConRango`, en `components/shared/RangoTemporal`, junto a `dentroDeRango` — el
hogar del vocabulario de rango. Cada dominio aporta solo sus dos hechos (¿cerrado? ¿fecha del
hito?) y su envoltorio legible: `seVeConRango` para presupuestos, `seVeLeadConRango` para leads.
Dos envoltorios, una regla. Es la lección de esta semana aplicada antes de pagarla: el mismo
criterio en tres copias fue lo que dejó la Tabla enseñando 123 filas cuando el Tablero enseñaba
45, y el euro en siete implementaciones. De paso `fechaDeRangoLead` sale del componente a
`lib/leads/pipeline`, donde ya vivían `esLeadActivo` y el recuento: el hito de un lead es lógica
de dominio, no de vista.
Y el copy que declara la asimetría es **literalmente el mismo** en las dos pantallas, una
constante compartida (`NOTA_RANGO_SOLO_CERRADOS`) y no dos frases parecidas: dos textos que
dicen lo mismo con palabras distintas son dos textos que divergen. Verificado: 31/31 activos y
28/28 abiertos visibles en los cuatro rangos.

## 2026-07-30 — /kpis bloque 1: la tasa de aceptación, una sola vez
Cuatro pantallas calculaban "tasa de aceptación" y ninguna igual. `/kpis` hacía
`aceptados / total` con **todos** los presupuestos en el denominador, incluidos los que aún no
han decidido: enseñaba 55% donde la tasa sobre los 95 decididos era 72%. Diecisiete puntos, y
repetidos en `porDoctor` (cada doctor entre 13 y 20 puntos peor de lo que es — Iván Castaño
63%→83%, Lucía Ferrer 55%→71%), en `porTratamiento`, en la Comparativa de clínicas, en el
informe que se narra con IA y en el PDF/PPT que se le entrega al cliente. El ranking de
doctores no cambiaba de orden, lo comprobé; los números sí, todos.
Es el mismo defecto que la pasada de /pacientes cerró un día antes, y para entonces la cabecera
de /presupuestos ya lo calculaba bien: **dos pantallas del mismo producto daban dos tasas del
mismo hecho.** Por eso la regla no vive en ninguna de las dos, sino en `lib/presupuestos/tasa`
(módulo puro, sin imports de cliente, para que también lo usen las rutas de servidor). Un
`TasaCierre` lleva el % **y su denominador**: `decididos`, `abiertos`, y `pct: null` cuando nadie
ha decidido —no un 0% que se lee como "los rechazaron a todos"—. Lo consumen la ruta de KPIs
(sus siete cortes), el informe IA, el PDF, el PPT y la cabecera. Y `notaTasa` es la coletilla
compartida que lo declara, con un argumento `cohorte` porque la única diferencia legítima que
queda entre pantallas es **de qué conjunto** habla el denominador: la cabecera mide lo que se
CERRÓ este mes (14 de 21 → 67%) y /kpis lo decidido de lo PRESENTADO este mes (6 de 7 → 86%).
Las dos son ciertas; lo que no valía es que ninguna dijera cuál.
Anotar el tipo como objeto y no como número fue deliberado: el compilador señaló los 25 sitios
que leían la tasa, incluido un `d.tasa + "%"` en la exportación CSV que habría escrito
`[object Object]%`. Un `number` los habría dejado pasar en silencio.

## 2026-07-30 — Lo que enseña arreglar un cero: el cero tapaba el hueco
Cuatro de los seis puntos del bloque eran ceros en pantalla, y en tres de ellos el cero no era
un error de cálculo sino **un dato que nadie escribe**:
- "1ª Visita: 0 · Con historial: 0" con 123 presupuestos: el código comparaba con
  `"Primera Visita"` y la base guarda `"Primera visita"`. Arreglado el literal, sale 123 y 0 —
  porque nadie escribe nunca el otro valor. El cero tapaba que el corte no existe (MEJORAS 77).
- "Cobrado 0 €" con 15 convertidos y pagos reales: el filtro "vino de un lead" leía
  `pacientes.lead_origen_id`, que la conversión **nunca escribe**. 0 de 166 pacientes lo tenían.
  El vínculo sí existe, por el otro lado (`leads.paciente_id`, 79 filas). La lectura ahora acepta
  los dos; que el vínculo esté guardado dos veces queda anotado (MEJORAS 79).
- "0 Asistió" seguido de "15 Convertido": un embudo que cae a cero y resucita. `leads.asistido`
  está en false en los 268 leads. La asistencia real estaba en la agenda, y la pieza que la
  atribuye —`citaDelLead`, con su ventana de 90 días— ya existía para el embudo de /red: se
  **reutiliza, no se copia**. Y las etapas se construyen anidadas (convertir implica haber
  pisado la clínica), así que el embudo no puede volver a subir.
Regla que queda: **un KPI a cero se investiga como un fallo de datos, no se acepta como un dato.**

## 2026-07-30 — El catch mudo de Informes: lo que sí rompía y lo que no
`InformesView` cargaba el histórico con `.catch(() => {})` y `?? []`. Lo dije más grande de lo
que era y lo corrijo: **el informe narrado por la IA NO salía de ahí** —lo calcula el servidor
con sus propios datos—, así que ningún informe guardado llevaba ceros inventados. Comprobado en
los tres tenants: 0 informes mensuales guardados, en DEMO, RB e INDEP.
Lo que sí envenenaba es la **previsión a 3 meses**: sin histórico, `avgTotal` cae a 0, el
fallback también, y salían tres tarjetas a €0 con cara de pronóstico — y esa gráfica **se captura
y se incrusta en el PDF que se entrega**. Ahora el fallo se ve (error honesto + reintentar donde
iba la previsión) y **bloquea la exportación**, porque un documento con un pronóstico de cero es
peor que no tener documento. Los seis `fetch` de la pantalla pasan por `cargarJSON`, y el
autoguardado dejó de ser fire-and-forget mudo: si el informe se genera pero no se guarda, se dice.

## 2026-07-30 — /kpis bloque 2: cuatro navegaciones y un bug escondido en la copia
La pantalla tenía cuatro navegaciones a la vez: los módulos en una barra propia pegada al borde
(con `SubTabButton`, quinto patrón de pestañas del producto), los filtros de clínica/doctor/mes
SOLO dentro de Presupuestos, siete pestañas internas con subrayado, y unas pills de periodo que
existían en Leads y Cobros pero no en Presupuestos ni en No-shows. Cambiar de módulo cambiaba la
forma de los controles.
Ahora: la anatomía del resto del producto (título y subtítulo en el cuerpo), `SegmentedToggle`
para los módulos —el mismo de Cobros y Seguimiento—, `ColaTabs` para el periodo y para las siete
pestañas internas, y **cero primitivos nuevos**. La clínica sale del selector global de la
cabecera de la app: KpiView tenía además el suyo, un segundo desplegable de clínicas en una
pantalla que ya tenía uno arriba.
**Y extraer el control no fue limpieza: fue el arreglo.** De las tres implementaciones del
periodo, la de Cobros calculaba los límites en días DE LA CLÍNICA (`inicioDelDiaUTC`, MEJORAS 52)
y la de Leads con `setHours(0,0,0,0)` — días del PROCESO. En Vercel el proceso corre en UTC, así
que en Leads "hoy" empezaba a las 02:00 de Madrid. El mismo bug que Cobros ya había pagado,
vivo en la pestaña de al lado porque la función estaba copiada. Se queda la buena, en
`lib/periodo`, y de paso el periodo previo deja de ser "los N días de antes" para los periodos de
calendario: es el MISMO TRAMO del mes anterior, que es lo que significa "vs mes anterior" y lo
que evita comparar medio mes contra uno entero (el día 3, todo caía un 90%). Esa regla vivía
como función local en `dashboard-red`; ahora la comparten las cuatro pestañas, y también la
comparación interna de /kpis, que la tenía pendiente.
Donde un módulo no puede honrar un filtro se DECLARA en vez de esconderlo: el filtro de doctor
sigue visible y deshabilitado en Cobros y No-shows con su motivo, y No-shows avisa de que sus
números no obedecen al selector porque el motor está congelado. Un control que desaparece al
cambiar de pestaña se lee como un fallo.

## 2026-07-30 — 23 segundos que no eran de la ruta
Al capturar el checkpoint, la pestaña de Leads salía con esqueletos y "Sin datos en el periodo"
con 58 leads en la base. `/api/leads/kpis` tardaba **23 s**. Antes de reportarlo como una
emergencia lo medí: el round-trip a Supabase desde mi portátil es de **~200 ms**, un
`runWithClienteDb` son cuatro viajes (BEGIN + set_config + query + COMMIT) ≈ 1 s medido, y la
ruta abre unas veinte. Los 23 s son mi enlace multiplicado por el número de transacciones. **En
Vercel, con la base en la misma región, el viaje es de ~1-5 ms.** No era una emergencia de
producción; la lección es no reportarla como tal sin medir.
Lo estructural sí queda anotado (MEJORAS 80): `getFacturadoEnPeriodo` se llama seis veces por
carga —periodo, previo y una por clínica— y cada una abre sus propias transacciones. Se quitaron
dos duplicados obvios (el sparkline releía TODOS los leads; el sanity check del ranking volvía a
pedir el facturado ya calculado).
**Lo que sí se arregló porque es del usuario:** mientras la ruta tardaba, la pantalla no decía
"cargando" — decía "Sin datos en el periodo" y los otros seis bloques devolvían `null`, o sea
página en blanco. Es el pecado del `?? []` por la puerta del estado de carga. Ahora todo enseña
esqueleto mientras no haya respuesta, y la página mantiene su forma.

## 2026-07-30 — /kpis bloque 3: el color que significa se queda; el que finge, fuera
La corrección de Simon ordenó el bloque: en KPIs el color aporta más que en ninguna otra
pantalla, así que no se trataba de despintar sino de que cada color signifique algo. **Se
queda y se refuerza**: las series de gráficas (ofrecidos/aceptados), la señal bueno/malo en los
deltas, las categorías dentro de un gráfico y las barras comparativas. **Se retira lo que finge
información**: el degradado por celda cuando los valores no varían, los badges de color sin
umbral declarado y los cinco pastel de especialidad.
La regla que queda: **si el color cambia, algo tiene que haber cambiado de verdad, y el usuario
debe poder saber qué.**

**La flecha sigue al significado, no al signo.** `KpiCard` pintaba `deltaPct` con `↑/↓` y color
atado al signo aritmético. En no-shows alguien había invertido el signo del delta para engañar
al color, y el resultado era «↑ 31%» en verde sobre una tasa que había BAJADO de 7,7% a 5,4%:
el color acertaba y la flecha mentía. Ahora `KpiCard` recibe el valor PREVIO y pinta
`Comparativa` — la misma pieza que `Cifra`, sin flechas (el signo ya dice la dirección) y con
`subirEsMalo` para las métricas donde bajar es mejorar. Las rutas mandan el previo en vez de un
delta ya masticado: la comparación es gramática de presentación, no dato.
`TrendBadge` de KpiView tenía las tres prohibiciones a la vez —flecha, «↑ 14% (19%)» (un % de un
%) y color por signo—; ahora es un envoltorio de `Comparativa`. Y el tiempo medio de respuesta
de Leads se compara en MINUTOS con `subirEsMalo`, no en un porcentaje de un porcentaje.

**Los umbrales se declaran o no se pintan.** «36% en verde al lado de 27% en ámbar» sin criterio
visible era una opinión disfrazada de dato. Ahora hay dos constantes con su frase en pantalla:
"Verde a partir del 30% · ámbar del 15% al 30% · rojo por debajo del 15%" en las tasas de Leads,
y "Verde por debajo del 10% · ámbar del 10% al 20% · rojo por encima del 20%" en no-shows.

**Las barras de no-shows escalaban contra la peor clínica de la lista**, así que la primera
siempre llenaba la barra: con 7,0 · 6,5 · 4,9 · 3,2% se pintaban 100 · 93 · 70 · 46% y todas
verdes. La escala ahora es ABSOLUTA y termina en el 20%, el umbral que ya declaramos como tasa
alta: la barra mide cuánto te falta para estar mal, que es la pregunta.

**Una paleta de gráficas, derivada de tokens** (`shared/paleta-grafica`). Había `ORIGEN_COLORS`
con siete hex sueltos —y semánticos: el canal "Instagram" salía rojo y parecía una alerta— más
DOS copias de la escala del acento, una en KPIs de Leads y otra en Cobros, con el mismo
comentario encima. `ESPECIALIDAD_COLOR` (cinco pastel con el alfa concatenado como texto) se
retira: era identidad, no estado, y la especialidad ya se lee al lado en texto.
**42 hex → 0** en la zona visible, ~100 clases de paleta a tokens semánticos, 12 euros a mano a
`eur()`, y el embudo de Leads reconstruido con el patrón de /red (barras proporcionales, la
caída entre etapas en gris porque un embudo siempre baja, y "No Interesado" contado aparte en
vez de colgando de la misma escala).

**Los hex de `InformesView` NO se tocaron, y eso es deliberado**: viven en el bloque oculto que
se captura a PNG sobre fondo blanco forzado para el PDF. Un `var(--color-*)` ahí resolvería al
tema del NAVEGADOR, así que quien tuviera el modo oscuro exportaría un informe con colores de
tema oscuro sobre papel blanco. Queda comentado para que la próxima pasada no los "limpie".

## 2026-07-30 — Dos números imposibles que solo se vieron con la página delante
Al revisar la captura de Leads, dos cosas que ningún test habría cazado:
**«Tiempo medio respuesta: −4.314 min».** Un tiempo negativo. La ruta hacía `(primera acción −
alta del lead)` sin comprobar el orden, y para 30 de los 58 leads del mes la acción está
fechada ANTES del alta (deuda del seed, MEJORAS 82). Ahora esos casos se descartan y el tooltip
lo dice: "30 descartados: su primer contacto es anterior al alta del lead". La media pasa a 27 h,
que es un número posible.
**Cuatro filas llamadas «Doctor».** El fallback rápido del ranking devolvía `nombre: "Doctor"`
para todos, así que cuatro doctores distintos aparecían con el mismo nombre y se leían como
cuatro anónimos. Los nombres son una consulta barata y el fallback no está dentro de la carrera
de 3,5 s: ahora se resuelven, y lo que no se resuelve dice "Doctor sin identificar".
La lección: **la pasada visual encuentra bugs de datos que la pasada de datos no encontró**,
porque un número imposible solo canta cuando está escrito en su sitio.

## 2026-07-31 — Un widget tumbaba el producto entero: no había NI UNA frontera de error
Revisión externa navegando producción: Automatizaciones → Operativo dejaba la pantalla en blanco
con "Application error". Causa exacta, `AutomatizacionesView.tsx:191→201`:
`EVENTO_CONFIG[sec.tipoEvento].color` con `tipo_evento="seguimiento"` (12 filas en DEMO), un valor
que el union no tiene y que escribía **nuestro propio seed**. Pero el bug de fondo era otro: cero
`error.tsx` y cero `componentDidCatch` en toda la app, así que React desmontaba el árbol y la única
salida era recargar escribiendo la URL. Ahora hay frontera **por sección** (13) + una de grupo + una
global, todas sobre `SeccionRota` — honesta, con reintentar y con salida, y logueando `digest`.
Verificado forzando un throw real en /alertas: se ve la frontera, el menú sigue montado y se sale
con un clic.
El censo del patrón dio cuatro zonas más con la misma forma, y **la más reveladora no rompía**:
`TIPO_LABEL[l.tipo]` en /llamadas con `tipo_llamada="recordatorio"` — la "columna Tipo vacía en
todas las filas" del informe **es exactamente el mismo bug**, y la única diferencia es que se
escribe `DICT[x]` en vez de `DICT[x].campo`. Un `??` a mano no valía como arreglo: en el MISMO
archivo del crash, 194 líneas más abajo, `ESTADO_CONFIG` ya llevaba el suyo. Nace `lib/diccionario`
(`deDiccionario`), que devuelve fallback **y avisa una vez por clave** con tabla, columna y valores
conocidos: un fallback mudo esconde el desajuste igual que un catch mudo (§9).

## 2026-07-31 — El dinero de /red se movía entre dos F5: la ventana rodante pasa a día de clínica
Lo más grave del informe externo (30.205 € → 30.515 € en dos cargas seguidas). **Primero se
descartó lo obvio**: 8 corridas seguidas del dashboard, byte-idénticas — no era orden de consulta.
Era el tiempo. `reactivable` eran 48 h/72 h EXACTAS contra `Date.now()`: una ventana rodante que se
cruza al segundo. Medido: el titular subía de 38.215 € a **39.965 € en dos minutos** y un **62 % en
24 h** sin que nadie tocara nada; y como el seed ancla los mensajes al mismo instante de generación,
había dos cruces a **1,2 segundos** de distancia que sumaban exactamente **310 €** — el salto que se
reportó. El cálculo era correcto; lo insostenible es que la cifra que se vende como "tu dinero hoy"
cambie entre dos recargas.
El umbral pasa a **días de calendario de la clínica** (2 leads / 3 presupuestos): la cifra cambia
una vez, a las 00:00 de Madrid, nunca en mitad de una demo. Verificado: constante las 24 h del día
(39.965 €) y solo salta al día siguiente. `haceMs` sigue siendo el tiempo real, porque es lo que las
cards escriben ("sin respuesta hace 4 días") y ahí sí se quiere precisión.
**`UMBRAL_REACTIVACION_MS` se borró en vez de renombrarse**: los dos eran `number`, así que un
caller sin migrar habría compilado y significado 172 millones de días. El compilador cazó los 6.
Y aun así el peligro apareció donde el tipo no llega: `NUEVO_URGENTE_MS` (que habría pasado a valer
"2 milisegundos") y tres restas en milisegundos dentro de `qa-estado-conversacion`. Por eso ambos
cambiaron de NOMBRE y de TIPO de parámetro, no solo de valor.
De paso, **`{ahora}` era un parámetro muerto** en `calcularDashboardRed` —nadie lo pasaba y la
franja de riesgo llamaba a `Date.now()` por dentro—, igual que `ahoraMs` en
`calcularCobrosPorPaciente`. Ahora se enhebran de verdad y `qa-dashboard-red` fija UN instante para
el dashboard y para su contraste SQL: antes cada lado leía su propio reloj y un cruce entre ambas
lecturas podía hacer fallar la paridad sin que nada estuviera roto. `qa:fechas` gana 8
comprobaciones que afirman que el estado no cambia en 24 h y que la fórmula vieja SÍ cambiaba
(verde con TZ=UTC · Madrid · New_York · Tokyo).
**Cazado de rebote:** `qa-dashboard-red` daba ROJO en un producto sano los días 29, 30 y 31 —
`setMonth(-1)` sobre un 31 de julio pide "31 de junio", JavaScript lo rueda al 1 de julio, y el
"mes previo" era el mes actual comparándose consigo mismo.

## 2026-07-31 — Un estado persistido que cambia lo que se ve tiene que declararse EN PANTALLA
Decisión de producto de Simon, y regla general. La revisión externa reportó "una tarjeta entera que
desaparece" en /red: era la tabla "Tus clínicas", que el producto **retira a propósito** cuando hay
una clínica seleccionada (decisión del 27/7). El filtro vive en el selector de la cabecera y
**persiste en localStorage**, así que se llega a la pantalla con él puesto sin haberlo tocado en
esta sesión: los euros son otros y falta una sección, y nada lo dice. La única señal era un enlace
de 12 px dentro del subtítulo, que el revisor no vio.
La regla: **el control cuenta lo que hiciste hace tres días; la página tiene que contar lo que estás
viendo AHORA**, y la salida va al lado de la declaración, no de vuelta en el control. /red estrena
`AvisoFiltroClinica` — banda en acento bajo la cabecera, con el nombre de la clínica, **qué deja de
verse por tener el filtro puesto** (sin eso, la ausencia se sigue leyendo como avería) y "Ver toda
la red". Verificado en navegador reproduciendo el recorrido del informe: elegir clínica → recargar →
el aviso está. Las demás pantallas que siguen al selector quedan anotadas (MEJORAS 86).

## 2026-08-01 — La última familia de MEJORAS 52: el día que se ESCRIBE
Las piezas de julio arreglaron el día que el producto CALCULA; el que ESCRIBE seguía yendo por
libre. `toLocaleString("es-ES", …)` sin `timeZone` pinta en la zona del NAVEGADOR (o en la de
Vercel, UTC, si es una ruta de servidor). Las doce llamadas de /llamadas están registradas a las
07:00Z = **09:00 de Madrid**, hora de clínica perfecta; la revisión externa las vio **todas a las
02:00** porque su navegador iba en horario central de EE. UU. El dato era correcto: la misma
pantalla enseñaba una hora distinta a cada persona, y en el portátil de las demos (UTC−4/−5)
pasaba igual. Reproducido antes de tocar nada — Madrid 09:00 · UTC 07:00 · New_York 03:00 ·
**Chicago 02:00** — y verificado después en navegador con `timezoneId: America/Chicago`.
`lib/time` gana `fechaClinica` y `fechaHoraClinica`, y son **dos y no una a propósito**: un
INSTANTE se convierte a la zona de la clínica; un DÍA DE CALENDARIO (`date`, "2026-07-29") no,
porque no tiene hora que convertir y pasarlo por un huso es justo cómo se pierde un día. El código
resolvía lo segundo con `new Date(dia + "T12:00:00")`, un truco correcto pero mudo que el siguiente
en pasar "limpia" y rompe: ahora la función lo reconoce y lo absorbe. 16 sitios migrados, incluidos
cuatro de SERVIDOR (el copiloto, los dos PDF de informes) que renderizaban en UTC. `qa:fechas` sube
a **52 comprobaciones**, verdes en UTC · Madrid · New_York · Tokyo.

## 2026-08-01 — /llamadas: la integración no existía y nadie se enteraba
`VAPI_API_KEY` no estaba en ninguna parte —ni en el entorno ni en el contrato de `lib/entorno`— así
que cualquier llamada moría en "VAPI_API_KEY no configurada", mientras la pantalla se veía como un
módulo en marcha y ofrecía a un admin un botón "Reintentar llamada" que siempre fallaba. Es el
MISMO agujero que dejó el portal del paciente sin avisar (§11): una capacidad que desaparece y no
grita. **Decisión de Simon: opción B** — se declara y se dice, no se congela. Vapi entra en el
contrato como capacidad *funcional*, `llamadasOperativas()` lo resuelve en servidor, y la pantalla
lleva un aviso con la distinción que importa: **pendiente de activar ≠ averiado** ("falta activar el
servicio de voz, es un paso de configuración... mientras tanto esta pantalla es el registro"). El
botón se deshabilita **y dice por qué** en vez de esconderse: esconderlo deja buscándolo a quien lo
conoce. Misma doctrina que el Motor con WhatsApp.
Y el resto de la pantalla: era **la ÚNICA sin contenedor de página** (devolvía un `space-y-5
max-w-6xl` suelto, sin fondo ni padding ni scroll propio) — de ahí el título pegado al borde y el
"Coste mes cortado", que no era el texto sino la rejilla desbordando. La columna Paciente era doce
veces "Ver ficha" seguidas porque el contrato no llevaba el nombre: ahora `pacienteNombre` viaja
desde la consulta y la PERSONA va primero, con "Ver ficha" como acción. El coste **sale de la fila
de KPIs**: es lo que nos cuesta a nosotros el servicio, en dólares, y al lado de tres cifras de
pacientes invitaba a leerlo como facturación de la clínica; sigue en USD porque convertir con un
cambio a mano sería inventar un número (§4), pero con un formateador y no un `$${n}` suelto. Sus
KPIs pasan al día de la clínica (`setHours(0,0,0,0)` era el día del proceso) y el tope de 200 del
coste mensual se declara cuando se alcanza.

## 2026-08-01 — El aviso de filtro, en las ocho pantallas que faltaban
MEJORAS 86, aprobada con la regla del 31/7: un estado persistido que cambia lo que se ve se declara
en pantalla. `AvisoFiltroClinica` estaba solo en /red; ahora lo llevan también Pacientes,
Seguimiento, Leads, Cobros, KPIs, Alertas y Presupuestos — las ocho que siguen al selector.
Verificado en navegador recorriendo las ocho con una clínica elegida y recargando.

## 2026-08-01 — Cobros: el plazo vence a medianoche de la clínica, no según el huso del proceso
Medido antes de decidir, porque la pregunta era si la cifra se movía entre recargas como la de /red:
**no se movía** (`fecha_aceptado` es `date`, y el bucket salió constante en 24 h de muestreo). Pero
al medirlo apareció otra cosa: los cruces caían a las **07:00 de Madrid**, no a medianoche, porque
`new Date(fecha_aceptado)` da la medianoche LOCAL DEL RUNTIME — desde Vercel habría cruzado a las
02:00. La definición no cambia (90 días siguen siendo 90 días); cambia cuándo se cruza, que ahora es
la medianoche de la clínica como todo lo demás.

## 2026-07-31 — El seed no puede escribir valores que el producto no conoce (invariante D)
Cuarta vez que el mismo error iba a costar caro: jul-27 los motivos de descarte en texto libre
(MEJORAS 41), jul-30 `"Primera Visita"` vs `"Primera visita"` (MEJORAS 77), y hoy dos —
`tipo_evento="seguimiento"`, que **reventaba una sección entera**, y `tipo_llamada="recordatorio"`,
que dejaba una columna vacía en las 12 filas. Las tres se cazaron mirando una pantalla, nunca un
test. `demo:reset` gana la invariante **D**: 11 columnas de vocabulario cerrado comprobadas contra
la unión declarada; si aparece un valor desconocido, revienta con tabla · columna · valor · nº de
filas · valores admitidos, y hace rollback. El vocabulario se declara **a mano en el seed**, copia
deliberada de los tipos de `app/lib`: cambiar un union sin pensar en el seed tiene que romper en el
próximo reseed, no en una demo. Probado en los dos sentidos — con el valor malo, rojo y exit 1; sin
él, verde. Un seed que no respeta el esquema real no son "datos de prueba": es una demo que miente,
y a veces una demo que se cae.

## 2026-08-01 — MEJORAS 88: `enTramo` compara tramos, no construye series
Cazado al cambiar de mes, con la reunión de RB a dos días. La serie de 6 meses de /red usaba
`enTramo`, que recorta cada mes al día de hoy: el **día 1** marcaba **0 €** en cuatro de los cinco
meses cerrados, con 31.584 · 15.786 · 44.062 · 37.881 € reales en la base, y solo era correcta a
final de mes. Contradecía de frente su propia decisión del 2026-07-27 —el mes en curso se pinta
punteado *en vez de excluirlo*, "para ver la tendencia sin que un mes a medias parezca una caída"—
porque si los cerrados también se recortan no hay tendencia que ver. **Pre-existente**, verificado
con `git stash`; ninguna pasada visual lo había pisado porque vive en una ventana de dos días al mes.
El arreglo no es elegir una ventana: los contadores la **reciben** (`creados`, `presentados`,
`aceptados`, `cobradoEn`), y la serie usa `enSerie` — mes cerrado entero, mes en curso hasta hoy.
`enTramo` se queda donde nació, en los deltas mes-contra-mes.
**Al arreglarlo apareció el error espejo**, en la misma función y en la dirección contraria:
`cobradoEn` usaba el mes ENTERO para el delta, así que hoy /red diría «−28.261 € vs mes pasado» y
/cobros «+0 €» **por la misma cifra** — y el comentario de `/api/cobros` llevaba desde el 27/7
afirmando que lo hacía "igual que el dashboard de Red", que era falso: /red nunca lo hizo para
cobros. La misma cifra con dos reglas según la pantalla, que es exactamente lo que aquella decisión
vino a matar.
**QA:** `qa-dashboard-red` vuelve a VERDE y gana una sección que **simula el reloj los días 1, 2 y
15** y exige que los meses cerrados den lo mismo en los tres, más el contraste medido de que la
fórmula vieja daba 0 € — un bug de dos días al mes no se prueba a mano, igual que el de los husos.
De paso, su propio SQL de "mes previo" pasa al mismo tramo: comparaba contra el mes entero y le
estaba dando por bueno al dashboard justo el error que se iba a arreglar.
Regla destilada: **§16 del skill de lecciones** — una función correcta puede estar mal usada fuera
de su dominio; al reutilizar una utilidad hay que preguntarse si su definición significa lo mismo
ahí, y cuando la ambigüedad es real, que reciba el criterio en vez de suponerlo.

## 2026-08-01 — /alertas: de "un botón de avisar" a supervisión
Pasada de la pantalla, con tres decisiones de producto de Simon.

**Lo estructural: /alertas calculaba los cobros por su cuenta.** `calcular.ts` reimplementaba a
mano la regla de vencimiento (plazo por clínica, `venceMs = aceptadoMs + plazo*DAY_MS`,
`tieneLiquidacion`, >2.000 €, >30 días) en vez de usar `calcularCobrosPorPaciente`, la función que
/red y /cobros comparten. Los conjuntos COINCIDÍAN (8 y 8 vencidos, 5 y 5 estancados, medido) —
pero por suerte: ese mismo día el plazo de cobros pasó a días de clínica y esta copia se quedó en
milisegundos rodantes, así que las dos pantallas ya cruzaban el umbral en instantes distintos. Al
unificar entra gratis lo que la pantalla necesitaba: **el dinero**, porque `calcularAlertas` ya
cargaba pacientes, presupuestos, pagos y opciones. 12.725 € en vencidos — el mismo euro que /red.
Los tres triggers se derivan de los CAMPOS y no del bucket `urgencia`, y es deliberado: `urgencia`
es un único valor con precedencia porque la cola pinta un paciente en una fila, mientras que aquí
son hechos independientes (un paciente puede estar vencido Y ser un estancado alto); y "por vencer"
en la cola son 7 días mientras esta alerta dice 3 y se queda en 3. Lo que se comparte es el reloj y
la derivación, no el umbral de cada pantalla. `cobros.ts` expone `tieneLiquidacion` para eso.

**El orden medía lo que no importa.** El color de urgencia salía del RECUENTO (>5 rojo, 3-5 ámbar),
así que seis leads sin gestionar salían en rojo y dos liquidaciones vencidas de 12.725 € salían en
gris. Ahora la unidad de la pantalla es la ALERTA y no la clínica —agrupar por clínica era lo que
impedía ordenar por daño—, manda el dinero cuando lo hay, y los tipos sin importe **no se inventan
uno**: van después, ordenados por urgencia de acción como en /red.

**Posponer, y solo posponer** (decisión de Simon). Una alerta no es una tarea que el manager
completa: es un hecho del negocio que sigue siendo cierto hasta que alguien lo resuelve en su
clínica. Si se pudiera descartar, se descartaría lo incómodo y la pantalla dejaría de servir para
supervisar. Se oculta hasta mañana guardando quién y cuándo; al día siguiente vuelve **si sigue
existiendo**, y si no existe no vuelve, que era el objetivo. `oculta_hasta` es una FECHA y no un
timestamp: "hasta mañana" es una frase de calendario, y un instante rodante traería de vuelta el
problema de MEJORAS 88. Contador discreto de pospuestas para que no sean un cajón invisible.

**¿Sirvió el aviso?** Era barato y entró. `alertas_enviadas` guardaba QUE se envió, no CONTRA QUÉ:
ahora se guarda la foto (`n_al_enviar`, `importe_al_enviar`) y la card dice "Avisada el 31 jul a
Marta de 3. Hoy quedan 2: el aviso movió 1". El nombre del destinatario se GUARDA en vez de
resolverse del id al leer — si esa coordinadora cambia de clínica, el histórico debe seguir diciendo
a quién se avisó. Las alertas anteriores no tienen foto y lo dicen en vez de inventarla.

**Rendimiento: 13,7 s → 2,6 s en local.** `lastAlertForPg` lee la tabla ENTERA y filtra en memoria,
y la ruta la llamaba en un bucle por (clínica × tipo) EN SERIE: ocho lecturas completas para pintar
ocho líneas, 7,2 s de los 13,7 medidos. Ahora es una pasada. **No afirmo que esto explique los ~7 s
que vio la revisión en producción** —allí el RTT es de 1-5 ms y aquí de 200— pero la forma era mala
en cualquier caso. Lo que sí arregla la espera es el skeleton, que sustituye al "Cargando alertas…"
en texto plano.

**Y lo pequeño:** la errata "liquidaciónes" (el plural de "liquidación" pierde la tilde; el código
concatenaba "es" — misma clase que el "superóaron" de /red); los cooldowns se calculan para los
OCHO tipos y no para cinco (los tres de cobros nunca se veían "Avisada" y el servidor respondía 429
a quien pulsaba: la UI ofrecía una acción que iba a fallar); la ventana del cooldown la declara el
servidor en vez de reconstruirla el cliente restando un `2*60*60*1000` a mano; `cargarJSON` en vez
de `?? []` (deuda declarada 16 → 15); una sola lista `TIPOS_ALERTA` en vez de tres escritas a mano,
que es lo que dejaba fuera a los tipos de cobros; y fuera `toAlerta`, el mapper de la era Airtable
con cero consumidores.

## 2026-08-01 — La misma pregunta, respuesta OPUESTA según qué es la pantalla
Decisión de producto de Simon, y el contraste es la lección. En **/alertas NO hay descartar**: es
una pantalla de SUPERVISIÓN, una alerta es un hecho del negocio que sigue siendo cierto hasta que
alguien lo resuelve en su clínica, y si se puede tapar lo incómodo la pantalla deja de servir para
lo único que hace. En **/seguimiento SÍ hay "visto hoy"**: es la COLA DE TRABAJO de la
coordinadora, que necesita poder decir "este lo he mirado y hoy no toca nada" sin que reaparezca en
cada refresco — sin eso la barra de "% del plan de hoy" no puede llegar nunca al 100 % y deja de
significar algo. Dos pantallas, la misma pregunta, y la respuesta depende de PARA QUÉ existe cada
una. Copiar la respuesta de una a la otra habría roto la que se copiara.
**Qué es y qué no:** se marca desde la card, dura hasta el final del día (`dia` es una FECHA y no
un timestamp — lección de MEJORAS 88: "hasta el final del día" es calendario, y un instante rodante
haría que la cola cambiara sola a media mañana), y mañana vuelve si el caso sigue abierto. **No
cambia el estado del caso**: el lead sigue Nuevo y el presupuesto sigue abierto. Solo declara que
hoy ya se decidió sobre él.
**El desglose no es decoración:** la cabecera distingue "atendido porque actuaste" de "visto sin
acción". Si el segundo grupo crece mucho no es que se trabaje más — es que la cola trae ruido, y
eso hay que poder verlo. El estado vive en un hook compartido por las dos pestañas
(`useVistosHoy`), porque leads y presupuestos son la misma cola vista por dos lentes y dos copias
del mismo estado acaban divergiendo. Marcado optimista con vuelta atrás y aviso si el servidor
falla: es la acción más frecuente de la pantalla, pero un fallo no puede quedarse pintado como
éxito.

## 2026-08-01 — /seguimiento: dos de las cuatro cifras del informe no eran contradictorias
Cierre de la pasada visual. **Antes de arreglar, medir**: el informe externo hablaba de "cuatro
cifras distintas en la misma pantalla", y tres reconcilian por construcción — `13 pendientes + 15
atendidos = 28` y los chips `3 + 21 + 4 = 28` particionan el mismo conjunto. La que no encajaba era
el botón: contaba solo la cohorte visible y además filtraba por "tiene teléfono Y mensaje
preparado", sin que nada lo dijera — el mismo patrón de MEJORAS 71 (dos universos, ninguna
etiqueta). Y el fondo era peor que el número: **solo 15 de 28 tienen mensaje sugerido** y la ruta
genera 5 por carga (`slice(0, 5)`), así que **el número del botón subía cada vez que recargabas**.
Ahora dice "15 de 21" y explica los 6 que faltan.
**Y el defecto de pestaña tampoco era lo que parecía.** El informe decía que abre en el grupo
equivocado; en realidad `cohorteAuto` abre en "En conversación" PRECISAMENTE cuando hay alguien
esperando respuesta, que es lo más urgente. El fallo era que esa cohorte mezcla dos cosas opuestas
—6 que te deben respuesta a ti y 15 donde la pelota es del paciente— y el chip solo decía 21: la
pestaña donde hay que trabajar era la única que no decía cuánto trabajo tiene. Ahora dice "6 te
esperan de 21", con `estadoConversacion`, cero criterio nuevo.
**Lo que NO se tocó, por no reproducirse:** el informe decía que el fondo no bloquea el scroll con
el drawer abierto. `panel-accion-ui` sí pone `body.overflow = "hidden"` y lo medí en el navegador
con el panel abierto: el fondo no se mueve. Un hallazgo sin evidencia no se arregla.
**Y la asimetría entre las dos pestañas era menor de lo reportado**: `AccionCard` ya es compartida
desde la unificación P3 (2026-07-23) y Leads tenía una acción MÁS que Presupuestos, no menos. La
asimetría real eran los filtros de doctor y tratamiento, que ahora tiene también Leads — con sus
opciones derivadas de los leads ACTIVOS y no del catálogo, porque un filtro que ofrece valores sin
resultados es ruido con aspecto de función.

## 2026-08-01 — Bloque 5: el censo de cifras da CERO errores de cálculo
Cierre de la sesión. Se midió contra SQL cada cifra que aparece en más de una pantalla, con julio
como mes de referencia (hoy es día 1 y el mes en curso está a cero, así que no informa). Resultado:

**Cubo A — errores de cálculo: ninguno.** Y de las cuatro contradicciones del informe externo,
**tres ya estaban resueltas**: "28 abiertos vs 44" murió con MEJORAS 71 (29 jul) y hoy Tablero,
Tabla, cola y SQL dicen 28 los cuatro; "15 pendientes · 13 atendidos vs los chips" reconciliaba por
construcción y el mentiroso era el botón, cerrado esta misma sesión; y "67% vs 86%" es una
divergencia legítima que ya se declaraba en las dos pantallas desde el 30 de julio. Leads activos
(31), pendiente (46.665 €) y vencido (12.725 €) coinciden en las tres pantallas donde salen.

**Cubo B — definiciones distintas legítimas: tres**, y solo una estaba sin declarar.
· *Aceptados 16 (/red) vs 8 (/kpis)* — fecha de aceptación contra cohorte de presentación. /kpis lo
  declaraba con un tooltip que hasta nombra la otra pantalla; **/red no**, y decía "Aceptados este
  mes", que se lee justo como la definición que NO estaba usando. Arreglado: ahora dice "N
  presupuestos firmados este mes, se presentaran cuando se presentaran".
· *Tasa 80% vs 67%* — ya declarada en las dos vía `notaTasa` con su argumento de cohorte.
· *Citados 3 (/red) vs 7 (/kpis)* — encontrada en el barrido, no venía en el informe. /kpis declara
  ahora "de los N leads del periodo".

**Y una que no se etiqueta: se elimina.** "Con cita este mes" sale de /red. Era la única cifra
prospectiva de una fila que mide lo que ya pasó, y respondía a "¿cuántas citas hay en el calendario
de julio?" — una pregunta de agenda, no de negocio, en el panel que existe para decir dónde se
pierde dinero. **Una cifra que no cambia ninguna decisión es ruido, y declararla no la habría hecho
útil.** La de /kpis se queda porque allí es una etapa del embudo y se mide contra su propia cohorte.

**Lo que el censo deja registrado, y vale más que los tres arreglos:**
1. **El patrón funciona.** "Cada cifra con su cohorte a la vista" (`notaTasa`, la conversión de
   cohorte de /red, la tasa de /pacientes) ya estaba montado y aplicado en 12 sitios. Lo que faltaba
   no era la pieza: eran tres etiquetas que se quedaron fuera. Un número que enseña su denominador
   no puede mentir, y por eso la reconciliación fue de copy y no de cálculo.
2. **Las revisiones externas señalan bien los SÍNTOMAS y mal las CAUSAS.** Las cuatro
   contradicciones del informe eran observaciones honestas de la pantalla, y las cuatro tenían una
   causa distinta de la que el informe suponía —tres ya estaban arregladas y la cuarta era un botón,
   no una cifra. Lo mismo pasó con el crash ("un estado nuevo" era nuestro seed), con las 02:00 (el
   dato era correcto, fallaba el render) y con "la tarjeta que desaparece" (era el producto
   obedeciendo a un filtro). **El valor de la revisión externa es dónde mirar, no qué arreglar**: se
   agradece el dedo y se mide la causa antes de tocar.

## 2026-08-03 — Auditoría de WhatsApp: la fase 3 del plan estaba mal dimensionada
Antes de arrancar la fase 0 de [`PLAN-AGENTE.md`](PLAN-AGENTE.md) se censó todo el código que toca
WhatsApp. Resultado: **el modo B (WABA) no está por construir, está construido y desconectado.**
`ServicioMensajeriaWABA` en `lib/presupuestos/mensajeria.ts` hace POST real a Graph API v21.0 con
idempotencia (KV), rate-limit y telemetría; el webhook de `api/webhooks/whatsapp` valida HMAC con
`timingSafeEqual`, deduplica por `WABA_message_id`, persiste **antes** del 200 y difiere la IA con
`after()`; y la UI de intervención ya ramifica `wabaActivo ? enviar-waba : enviar-manual`. El punto
de extensión (`getServicioMensajeria(modo)` + `modo_whatsapp` en Postgres) **ya está abierto**.

**Lo que sí falta, y el plan no lo decía:** el envío por **plantilla**. `enviarPlantilla` está
implementado y tiene **cero call sites** — `getServicioMensajeriaWABA` no lo llama nadie. Sin
plantilla no se inicia conversación fuera de la ventana de 24 h, que es literalmente todo lo que
hace un recordatorio o un seguimiento: **todo lo construido asume la ventana ya abierta**. La fase 3
no es "construir el envío y la recepción"; es *conectar credenciales* (casi gratis) **más construir
la capa de plantillas** (catálogo WABA, mapeo a las plantillas de Fyllio, nombres aprobados), que es
la parte cara y la que el plan no mencionaba.

**Restos y una avería encontrados de paso, ninguno tocado (van a MEJORAS):**
- `lib/whatsapp/outbound.ts` (184 líneas, plantillas Meta con botones) tiene **cero importadores** y
  es el único consumidor de `META_WHATSAPP_TOKEN`/`META_PHONE_NUMBER_ID` — **un segundo juego de env
  vars para lo mismo que `WABA_*`**. MEJORAS #5B lo cita como "la pieza que existe para el bulk
  real": apunta a código muerto. `lib/whatsapp/llm.ts` (168 líneas), también sin importadores.
- **`/api/whatsapp/send` no existe** y sigue siendo llamado desde `NoShowRiskPanel.tsx:157` y
  `OperationsPanel.tsx:222` → **404 en runtime**.
- `lib/whatsapp/send.ts` (Twilio, vivo en 4 crons y en no-shows) es `Promise<void>`: **loguea el
  fallo y sigue**. Un envío fallido es indistinguible de uno correcto para quien llama — el mismo
  patrón que el Sprint A mató en las escrituras, sobreviviendo en los envíos.
- `normalizarTelefono` quita el `+` pero **no añade prefijo de país**: un `"667188097"` saldría a
  Meta tal cual. Hay que auditar los teléfonos reales antes de enviar nada.
- `checkRateLimit` es **fail-open**: si la query a Postgres falla, deja pasar. Con cuota real cuesta
  dinero.

**Lo que queda registrado como lección:** el plan se escribió sin censar el código, y estimó de más
lo construido y de menos lo que faltaba **a la vez**. Un plan de fases que toca una zona vieja se
escribe *después* del censo de esa zona, no antes.

## 2026-08-03 — El teléfono se normaliza al guardar, no al enviar
Salió de la auditoría de WhatsApp: `normalizarTelefono` (waba-credentials) quita el "+" y los
separadores pero **no añade prefijo de país**, así que un `"667188097"` guardado sin prefijo se
mandaría a Meta tal cual. El fallo no aparecía hasta el **primer envío a un paciente real**, que es
el peor momento para descubrir que la carga de datos del cliente venía sin prefijos.

Se crea `lib/telefono` como única verdad del formato y se aplica en la **frontera de escritura**
—crear/actualizar paciente y lead, y el importador `upsertPacienteImportPorTelefono`— en vez de en
el envío. Por qué ahí: no hay hoy ninguna ruta de importación de pacientes, así que ponerlo "en la
importación" sería ponerlo en un sitio que no existe; en la frontera de escritura cubre cualquier
importador que se escriba después sin que nadie tenga que acordarse.

**Lo que NO hace, a propósito:** adivinar el país. Ante 10+ dígitos sin "+" devuelve `dudoso` y
**conserva el original**. El normalizador viejo de Gesden (`columnMap.normalizePhone`, sin
consumidores) le pegaba un "+" y lo daba por bueno — eso convierte un dato malo en un dato malo con
pinta de bueno. Se unifica delegando en el compartido, para no dejar dos convenciones del mismo
formato (el error que sigue vivo con `META_WHATSAPP_TOKEN` frente a `WABA_ACCESS_TOKEN`).

**El emparejamiento del importador busca las dos formas** (normalizada y original): si solo buscara
la normalizada, una segunda importación sobre pacientes ya guardados sin prefijo no encontraría a
nadie y crearía un duplicado por cada uno — el importador dejaría de ser idempotente justo al
arreglarle el formato (§2).

Y `npm run qa:telefonos` censa **lo ya guardado**, que el cambio de frontera no arregla: cuántos
saldrían mal, cuántos son fijos (WhatsApp no entrega ahí) y cuántos son dudosos de mirar a mano.
Con sonda previa y salidas distintas para "no pude comprobar" (2) y "comprobé y está mal" (1), §9.
Es requisito de entrada a la fase 3. Verificado 12/12 sobre el normalizador; el censo necesita el
entorno real (en local falta `SUPABASE_DB_URL_APP`, y la sonda lo dice en vez de dar un falso ok).

**Y una corrección de documentación que valía tanto como el código:** MEJORAS #5B describía
`lib/whatsapp/outbound.ts` como "la pieza que existe para el bulk real". Es código muerto con cero
importadores, y el único consumidor de `META_WHATSAPP_TOKEN`/`META_PHONE_NUMBER_ID` — un segundo
juego de variables para lo mismo que las `WABA_*` del producto vivo. Quien retomara esa mejora habría
configurado variables que no alimentan nada y construido sobre un archivo que nadie ejecuta. La
entrada queda corregida: la pieza real es `enviarPlantilla`, y de sus dos dependencias declaradas
solo una era cierta. Retirar `outbound.ts` sigue pendiente y es §11 (censar quién DECIDE con esas
variables antes de quitarlas), en pasada aparte.

## 2026-08-05 — Un inventario de "ya está hecho" escrito de memoria envejece hacia el optimismo
Segunda pasada sobre la sección 05 de `arquitectura-app-automatizacion.html`, la que dice qué está
construido y qué falta. En dos censos ha dado **cuatro afirmaciones falsas**, y las cuatro en la
misma dirección: **daban por hecho lo que no lo estaba**, o por hacer lo que ya estaba.

Lo corregido, todo verificado contra el código:

1. **«Los tres modos A/B/C — el motor de reglas ya los tiene declarados».** No existen. Lo único que
   hay es `modo_whatsapp: manual | waba` (el **transporte**, no la autonomía) y `modo_test: boolean`.
2. **«El clasificador ya detecta acepta / pide cita / pregunta precio».** «Pide cita» **no está en el
   enum**, y `clasificarRespuesta` **solo corre para presupuestos**: el webhook guarda los mensajes
   de leads y explícitamente no los clasifica. Cubre **3 de los 6** disparadores universales —
   quedan fuera queja, pide persona y tono negativo.
3. **«Los tableros y tablas — existen los tres, solo hay que unificarlos bajo un conmutador».** Hay
   **dos tableros** (leads y presupuestos, con **dos implementaciones distintas** — leads monta su
   propio dnd-kit, presupuestos usa `KanbanBoard`) y **dos tablas** (presupuestos y cobros). Faltan
   el tablero de cobros y la tabla de leads, y fundir dos kanban no es «un conmutador».
4. **«El envío y la recepción reales — hay que construirlo».** Al revés: estaban construidos. Lo que
   falta es el catálogo de plantillas (corregido el 3 ago).

**La regla que queda:** un documento que enumera «ya está hecho» **no se escribe de memoria y se
recensa antes de planificar contra él**. El sesgo no es aleatorio — es sistemáticamente optimista,
porque uno recuerda haber diseñado la pieza y no recuerda si llegó a cablearla. Quien planifica
contra ese inventario presupuesta de menos, y aquí llegó a mandar a configurar variables de entorno
que no alimentan nada (MEJORAS 5B).

**Y el alcance de la fase 1, cerrado con el censo delante:** fuera el estado «trabajando» (ningún
dato puede producirlo en modo A: es una promesa falsa en pantalla, como los scores del predictor);
el quiebre corta con **tres** disparadores **y lo declara en pantalla**, porque una coordinadora que
cree que el sistema caza quejas deja de leer los mensajes que el sistema no marcó; y cobros recibe
distintivo pero no entra en la cola. De los seis estados, cuatro se derivan y **lo único que se
persiste es la decisión humana**, en una tabla append-only y no en una columna de estado — una
columna tendría que sincronizarse con seis señales que cambian solas.

## 2026-08-05 — Fase 1 del agente: el estado de automatización se DERIVA, y el log solo guarda decisiones
Tercera coordenada de cada caso (quién lo lleva) y cohorte de quiebre en Seguimiento, con el alcance
cerrado tras censar el código en vez de escribirlo de memoria.

**La decisión que ordena todo: no hay columna `estado_automatizacion`.** De los seis estados, cuatro
se derivan de datos que ya existen (`esperando` ← estadoConversacion · `agotado` ← reactivable +
`contact_count`/`whatsapp_enviados` · `manual` y `cerrado` ← configuración y estado del caso) y el
quiebre deriva su condición de `intencion_detectada`, ya persistida. Una columna tendría que
sincronizarse con seis señales que **cambian solas** —llega un mensaje y el estado de conversación
cambia sin que nadie escriba nada—, y se quedaría mintiendo hasta que algo la reescribiera. Lo único
que ningún dato existente puede producir es la **decisión humana**, y eso va a
`eventos_automatizacion`, append-only (`grant select, insert`, sin update ni delete: un log que se
puede reescribir es una columna con más pasos). Campos nuevos en total: **una tabla y una columna de
configuración** (`toques_antes_de_agotar`, que es una decisión comercial y no deriva de nada).

**La cohorte de quiebre entra como PRECEDENCIA, no como caso del switch.** La invariante de partición
se sostiene sobre un `switch` exhaustivo de `EstadoConversacion`, y el quiebre no es uno de sus
valores: es ortogonal (un caso quebrado es *además* `pendiente_responder`). Entra como guarda por
encima, igual que «citados». El switch queda intacto — `qa:cohortes` sigue en verde sin tocarlo — y
`qa:automatizacion` prueba las 24 combinaciones (conversación × estado) para que ninguna caiga fuera.

**Tres recortes, los tres por lo mismo — no prometer lo que ningún dato produce:**
1. Fuera el estado «trabajando»: significaba «tiene el siguiente toque programado» y en modo A no hay
   nada que programe. Es la tercera vez que se retira una promesa así (scores del predictor,
   «precisión 0 %»).
2. El quiebre corta con **3 de los 6** disparadores y **lo declara en pantalla**. Si la coordinadora
   cree que el sistema caza quejas, deja de leer los mensajes que el sistema no marcó — peor que no
   avisar. El bloque desaparece en el mismo cambio que los haga detectables (fase 2).
3. **El quiebre por intención es solo de presupuestos**: `clasificarRespuesta` no corre para leads (el
   webhook los guarda sin clasificar). Declarado en el plan y en pantalla para que nadie lo pruebe en
   un lead dentro de tres semanas y concluya que está roto.

**La coincidencia guarda la MEDIDA, no la categoría.** Distancia de edición normalizada [0,1] sobre
texto sin acentos, sin dobles espacios y con comillas unificadas — así un acento o un espacio no
cuentan como edición. `tal_cual`/`editado`/`reescrito` se derivan al leer con un umbral que hay que
calibrar: si se guardara la categoría y el umbral resultara malo, el histórico estaría perdido. Y se
mide en el **servidor**, leyendo `mensaje_sugerido` de la base y no del cuerpo de la petición: si el
cliente dijera «esto me propusiste», la métrica mediría al cliente, y es la métrica que decide cuándo
se sube de modo A a modo B.

Verificado: `qa:automatizacion` 41 comprobaciones en verde (censo de 29 presupuestos reales: 26
esperando, 3 quebrado), `qa:cohortes` intacto, tsc y build limpios, y capturas en claro, oscuro y
móvil.

## 2026-08-05 — Una migración de esquema no toca credenciales
`db:migrate` ejecutaba, tras aplicar cada migración, un `alter role fyllio_app with password` desde
`FYLLIO_APP_DB_PASSWORD`. Son dos secretos distintos que nadie compara: el de quien corre la
migración y el que lleva embebido el `SUPABASE_DB_URL_APP` de Vercel. **El día que divergieran,
añadir una columna dejaba a producción sin acceso a su base**, y el síntoma habría salido en la app,
lejos del comando que lo causó.

Ya dio el aviso el mismo día: tras aplicar la 014 el pooler de Supabase rechazó credenciales unos
segundos, porque `alter role` invalida su caché **aunque la contraseña sea la misma**. Esa vez lo
era; se comprobó comparando hashes, no confiando.

Separado en `npm run db:password`, que además **comprueba antes de rotar** que lo que va a fijar es
lo que la app ya usa, y si no coinciden aborta explicando el orden correcto (Vercel → local →
rotar). Rotar es ahora una decisión explícita, no el efecto secundario de añadir una columna.

**Y una trampa vecina, anotada donde se va a leer:** `app/lib/db/types.ts` decía «GENERADO — NO
editar a mano», pero desde la migración 011 hay tablas añadidas a mano que el generador no conoce
(`alertas_pospuestas`, `seguimiento_vistos`, `eventos_automatizacion`). Regenerar se las llevaría en
silencio. La cabecera ahora lo dice.

## 2026-08-05 — La coincidencia agente-humano tiene pantalla, y vive en Automatizaciones
La métrica que decide cuándo el agente puede enviar solo ya se registraba pero no se leía en ningún
sitio: un dato que se acumula bien y no informa a nadie.

**Dónde vive: `/automatizaciones` → «¿Escribe bien?», no `/kpis`.** KPIs mide el NEGOCIO de la
clínica (dinero, aceptación, no-shows) y esto mide la HERRAMIENTA; mezclarlas diluiría la pantalla
con la que la gerencia decide sobre su clínica. Y la decisión que este número dispara —subir la
autonomía— se toma en Automatizaciones. La pestaña se llama «¿Escribe bien?» y no «Coincidencia»:
la coordinadora no tiene por qué saber qué es una tasa de coincidencia.

**El corte principal es POR INTENCIÓN**, porque es lo que alimenta la matriz de la fase 4: una media
del 54 % esconde un 80 % en «acepta sin condiciones» y un 10 % en «pide oferta/descuento», que son
decisiones opuestas. Para eso la intención viaja **con el evento** (migración 015) en vez de
resolverse al agregar: el clasificador la reescribe en la siguiente respuesta del paciente, así que
un join daría la intención de HOY y el histórico entero cambiaría de significado retroactivamente.
Mismo criterio que el nombre de la coordinadora en `alertas_enviadas`.

**El denominador se ve entero**, incluidos los envíos que NO cuentan: los mensajes escritos de cero
salen en su propia línea («otros 412 salieron sin que el asistente hubiera preparado nada») en vez
de desaparecer del cálculo sin decirlo.

**Y el vacío es honesto:** con cero envíos medidos la pantalla dice «todavía no hay ningún envío
medido — no es un 0 %», porque «el agente no acierta nunca» y «no se ha medido nada» son la misma
cifra con significados opuestos. Es la misma regla que mató el «precisión del predictor 0 %».

## 2026-08-05 — El clasificador de leads existía: no faltaba construirlo, faltaba engancharlo
Tercera corrección del mismo tipo en tres días, y la tercera en la dirección cara. El plan decía que
la clasificación de respuestas de leads estaba por construir. **Existe desde el Sprint 10**:
`/api/leads/intervencion/clasificar`, con su propio enum de seis categorías (`Interesado` · `Pide más
info` · `Pregunta precio` · `Pide cita` · `No interesado` · `Sin clasificar`), distinto del de
presupuestos a propósito, persistiendo intención + acción + mensaje sugerido, con log, y con
`LeadAccionPanel` actuando ya sobre el resultado. En DEMO hay 268 leads clasificados.

**Lo que falta es el disparador:** solo corre cuando la coordinadora pulsa el botón de IA. El webhook
guarda el mensaje del lead y hace `return` sin clasificar. Engancharlo al `after()` que ya existe
para presupuestos es **medio día**, no una fase.

**Y el riesgo real, que sí es nuevo:** encenderlo convierte una clasificación *bajo demanda y con una
persona mirando el resultado* en una *automática, por cada mensaje entrante, sin supervisión*, que
reescribe el campo del que cuelgan las recomendaciones del panel. Un cambio de prompt que degrade la
clasificación empeoraría cientos de leads **en silencio**: no da error, solo recomienda peor. Es la
avería que solo detecta un conjunto de evaluación, y por eso la fase 2 va después de los evals de la
fase 1 — no por orden estético.

**Lo que hay que aprender de la tercera vez.** El patrón no es «el plan estaba mal»: es que
**censar el código cuesta minutos y estimar de memoria cuesta fases**. Las tres correcciones
(WhatsApp el 3 ago, §05 el 5 ago, esta) las destapó leer el código, no usar el producto. Antes de
escribir «hay que construir X», se busca X.

## 2026-08-05 — La prueba del termómetro reprobó mi propia expectativa, y eso era el hallazgo
Se montó el conjunto de evaluación del agente (`evals/`, `npm run qa:evals`) y, antes de puntuar
nada, la prueba que exige el plan: degradar el prompt a propósito y comprobar que el número baja.

**La primera degradación fue «quitar la categoría de dinero del prompt». El número SUBIÓ, de 63 % a
88 %.** Investigado en vez de ajustado: al quitar la categoría, los mensajes de dinero no caen en un
limbo — caen en OTRA categoría que también quiebra («¿me haríais descuento?» → «Tiene duda sobre
tratamiento»), y «Sin clasificar» quiebra por ambigüedad.

**No era un fallo del eval: es una propiedad del sistema, y buena.** El producto escala ante lo que
no entiende, que es literalmente la regla «ante la duda, humano». La decisión de quiebre es ROBUSTA a
que el clasificador se confunda de categoría. Lo que estaba mal era mi expectativa.

**Lo que sí queda demostrado, y es una limitación real del conjunto:** un eval que mide SOLO la
decisión de quiebre **no puede ver** una degradación de categoría. Para eso haría falta anotar
también la categoría correcta, y hoy solo está anotada la decisión — a propósito, porque «¿esto lo
podía contestar el sistema solo?» es la pregunta que una persona responde con seguridad y «¿qué
intención es esta?» es taxonomía. Queda escrito en el script para cuando exista esa anotación.

Rediseñadas las degradaciones para que ataquen lo que este conjunto SÍ mide —la decisión— con dos
extremos: un clasificador **complaciente** (nunca quiebra) y uno **alarmista** (siempre quiebra).
Los dos puntúan peor que el real (44 % y 56 % frente a 63 %), así que el eval discrimina en las dos
direcciones y no premia a un clasificador que conteste siempre lo mismo.

**Y el número que importa: el clasificador real saca 63 % (10 de 16) contra la anotación de Simon.**
Sobre casos sintéticos, con 16 puntuables y sin la segunda tanda todavía, así que no es una
conclusión — pero tampoco es un número que se pueda mirar hacia otro lado.

## 2026-08-06 — El eval encontró un bug en la fase 1, escrito dos días antes
Segunda tanda del test-retest (1B) y primera medición real del clasificador. Tres resultados.

**1 · El techo del eval es 100 %.** Simon anotó los mismos 20 casos con un día de intervalo y en
orden permutado: **cero contradicciones** (ninguna A↔B). Dos casos quedaron «no lo tengo claro» las
dos veces (ambigüedad real, fuera del conjunto puntuable) y dos dudas se resolvieron. El criterio es
estable, así que el techo no limita al clasificador y cualquier fallo es del clasificador, no del
anotador. El acuerdo entre Simon y la anotación sellada de Claude fue del **82 %** (17 comparables,
3 discrepancias) — sirvió para lo que sirve: encontrar casos mal escritos.

**2 · El clasificador saca 56 %, exactamente lo mismo que uno que quiebre SIEMPRE.** La prueba del
termómetro lo deja sin margen de interpretación: `complaciente` (nunca quiebra) 44 %, `alarmista`
(siempre quiebra) **56 %**, real **56 %**. En este conjunto, el clasificador de producción es
**indistinguible de escalarlo todo**.

**3 · La causa es un bug MÍO en la fase 1.** Cinco de los ocho fallos son el mismo: «vale», «Ok»,
«Sí, confirmo la cita.», «¿a qué hora abrís los sábados?» → el clasificador devuelve `Sin clasificar`
y `INTENCION_A_DISPARADOR` lo mapea a **ambigüedad → quiebra**. O sea: **cualquier mensaje trivial
acaba en la cola de «Necesita persona»**, que es justo lo que vacía de valor esa cohorte — si la
mitad de la cola son «Ok», la coordinadora deja de mirarla.

Y no es una decisión de diseño discutible: **contradice el propio documento de arquitectura**, que
dice «Ambigüedad — **Dos intentos** sin entender qué quiere y para». Implementé UNO. El eval encontró
en su primera ejecución un defecto en código escrito dos días antes, del tipo que ninguna pasada
visual habría visto porque no rompe nada: solo llena la cola de ruido.

Anotado como pendiente de arreglo con decisión de producto: qué cuenta exactamente como «dos
intentos» (dos entrantes consecutivos sin clasificar, ¿en la misma conversación?, ¿reseteados por
una respuesta nuestra?).

**Y el arnés también tenía lo suyo:** la primera medición pasaba al clasificador la frase pelada, sin
importe ni tratamiento, cuando en producción recibe los dos. Un test que no reproduce las condiciones
de producción no dice nada sobre producción. Corregido antes de dar el número (y bajó de 61 % a
56 %: el contexto no le ayudaba, le daba más motivos para clasificar como algo del presupuesto).

## 2026-08-06 — El clasificador no está ciego de contexto: su taxonomía no cubre los mensajes normales
Hipótesis de Simon: los cinco fallos de «Sin clasificar» («vale», «Ok», «Sí, confirmo la cita»,
«¿a qué hora abrís los sábados?») son porque el clasificador lee el mensaje sin ver a qué responde.
Es una hipótesis mejor que mi parche del contador de dos intentos, así que se midió antes de tocar.

**Qué recibe hoy, verificado en el código:** nombre, tratamiento, importe, estado del presupuesto,
clínica y el mensaje entrante. **Ni el hilo ni el último mensaje que enviamos nosotros.** Y todo lo
necesario para pasárselo ya existe: `getHistorialConversacion({presupuestoId})` lleva tiempo en el
repo y la usan tres rutas; los tres sitios donde se clasifica tienen el `presupuestoId` a mano.

**Pero medido, no cambia nada: 61 % sin contexto, 61 % con el último mensaje nuestro.** Solo dos
casos cambian de decisión, uno a mejor y otro a peor.

**La causa real es otra, y más profunda que las dos hipótesis.** El enum del clasificador
—`Acepta sin condiciones` · `Acepta pero pregunta pago` · `Tiene duda sobre tratamiento` · `Pide
oferta/descuento` · `Quiere pensarlo` · `Rechaza` · `Sin clasificar`— **no tiene ninguna categoría
para un mensaje que simplemente no va de la decisión del presupuesto**. Un «Ok» no tiene dónde caer.
Así que `Sin clasificar` hace hoy DOS trabajos incompatibles:

  · «esto no va del presupuesto» → inofensivo, no debería quebrar
  · «no entiendo qué quiere» → ambigüedad real, sí debería quebrar

y `INTENCION_A_DISPARADOR` los manda a los dos a quebrar.

**La prueba más limpia de esto es el caso que EMPEORÓ con contexto:** «Sí, confirmo la cita» pasó de
`Acepta sin condiciones` (no quebraba, por accidente) a `Sin clasificar` (quiebra). Con más contexto
el modelo acertó más —vio que el mensaje no iba del presupuesto— **y la taxonomía lo castigó por
acertar**.

Orden correcto de arreglo, que ninguna de las dos hipótesis iniciales daba: **partir «Sin
clasificar» en dos categorías** (una neutra que no quiebra y una de confusión real que sí); el
contador de dos intentos aplica solo a la segunda —y ahí sí es lo que dice el documento de
arquitectura—; y el contexto de conversación queda como mejora medida a 0 sobre este conjunto, así
que no es prioridad aunque sea barata.

**Y una lección de método:** las tres hipótesis eran razonables y dos de las tres eran mías. La que
lo resolvió no salió de razonar mejor, salió de **medir el cambio antes de hacerlo** — 20 minutos de
sonda contra medio día de implementar un parche que no habría movido el número.

## 2026-08-06 — El significado de una intención vivía en cinco copias, y una era el dinero de /red
Antes de rediseñar la clasificación, se retiraron los cinco literales sueltos que traducían
«intención → qué significa»: un `Set` en `dashboard-red`, dos `Array.includes` en las rutas de
intervención y máxima, y tres `===` en dos paneles. **Añadir una categoría al enum no rompía nada:
simplemente dejaba de aplicar en cada uno de esos sitios, en silencio.**

**El número, medido en DEMO antes de tocar nada** — titular «próximos a cierre sin acción» de `/red`:

| | |
|---|---|
| Hoy | 3 casos · **5.900 €** |
| Si una categoría nueva absorbiera «Acepta sin condiciones» | 1 caso · **1.200 €** — **−80 %** |
| Si absorbiera «Acepta pero pregunta pago» | 2 casos · 4.700 € — −20 % |

**El dinero en pantalla caía un 80 % sin excepción, sin log y sin un solo test en rojo.** Misma
familia que la ventana rodante de julio: una cifra que se mueve sola y se lleva por delante la
confianza en todas las demás.

Ahora el significado vive en `presupuestos/intenciones` y `leads/intenciones`, con **dos garantías
que se necesitan las dos**:

1. **`Record<Intencion, …>` exhaustivo** — añadir un valor al enum **rompe la compilación** y obliga
   a decidir qué significa. Verificado: al añadir «Acuse de recibo» al enum, `tsc` falla en los tres
   diccionarios. No es un comentario pidiendo que alguien se acuerde.
2. **Lectura por `deDiccionario`** — el valor viene de la BASE, así que el tipo no garantiza nada
   (§12); un valor desconocido devuelve el fallback **y avisa una vez** en vez de degradar mudo.

`qa-dashboard-red` en verde: el refactor no mueve ni un euro.

**Y un error propio que conviene no repetir:** para «demostrar» que antes NO habría roto, hice
`git stash push -q <rutas> 2>/dev/null` con ficheros sin trackear. El push **falló en silencio** —lo
tragó mi propio `2>/dev/null`— y el `git stash pop` siguiente sacó **un stash antiguo de otra rama**,
metiendo conflictos en `DECISIONES.md` y en un skill. Nada se perdió (todo estaba commiteado y los
dos stashes viejos siguen intactos), pero la lección es la de siempre y esta vez me la apliqué a mí:
**redirigir stderr a /dev/null convierte un fallo en un silencio**, y `git stash pop` sin argumento
saca lo que haya arriba, no lo que tú creas que pusiste.

## 2026-08-06 — La decisión se pide, no se deriva de la categoría: 56 % → 94 %
Rediseño del clasificador. Antes: la IA clasificaba en siete casillas y una tabla traducía casilla →
quiebra. Un mensaje que no encajaba en ninguna caía en «Sin clasificar», que estaba mapeado a
quebrar, y la cola se llenaba de «ok» y «confirmo la cita». Medido: **56 %, exactamente lo mismo que
un clasificador que quebrara SIEMPRE**.

Ahora se le pide **la decisión directamente**, con las seis reglas explícitas, y la categoría
**después** y sin que condicione nada. **94 % (17 de 18)**, contra un techo del 100 % y una clase
mayoritaria del 56 %.

| | |
|---|---|
| Antes | 56 % (10/18) |
| **Después** | **94 % (17/18)** |
| Termómetro: complaciente / alarmista | 83 % / 56 % — sigue discriminando |

**El único fallo que queda es el caso #1**, uno de los tres en los que Simon y Claude ya discrepaban
al anotar: «me cuadra todo, ¿el importe es con IVA o sin?». El clasificador para; Simon dice que no
hace falta. **No es un fallo de clasificación: es una decisión de producto sin tomar** — ¿informar
del IVA de un presupuesto ya emitido es «comprometer dinero»? Queda anotada, no promediada.

**Cuatro decisiones de diseño que sostienen el cambio:**

1. **El enum crece con `Acuse de recibo`, `Logística` y `Otra`**, y `Sin clasificar` deja de ser el
   cajón de sastre para significar solo «no lo entiendo». Los `Record` exhaustivos de
   `presupuestos/intenciones` **rompieron la compilación en los tres diccionarios** hasta decidir qué
   significaba cada una: la garantía del refactor de esta mañana funcionó a la primera ocasión.
2. **La decisión se PERSISTE** (`requiere_persona`, `motivo_quiebre`). No contradice la fase 1: allí
   se dijo que no se persiste lo DERIVABLE, y esto no lo es — es la salida de un modelo sobre un
   texto concreto, y recalcularla exigiría volver a llamarlo. Las filas anteriores siguen derivándose
   de la categoría, por una rama de compatibilidad que se retira cuando no quede ninguna.
3. **El mensaje sugerido queda VACÍO cuando el caso quiebra**, y lo impone el código además del
   prompt: un borrador esperando para una pregunta de dinero es una invitación a mandarlo. El panel
   lo explica («esto necesita tu criterio — no he preparado ningún borrador a propósito»), porque un
   hueco en blanco sin más se lee como una avería.
4. **Las categorías propuestas no entran solas al catálogo.** Van a `intencion_propuesta` y se
   acumulan con recuento en `sugerencias_categoria`; pasar al enum exige una migración que **rompe la
   compilación** hasta que alguien decida qué significa la nueva. La barrera es estructural, no de
   disciplina: sin ella, en un mes hay doscientas etiquetas y ninguna sirve para contar nada.

`/red`, cohortes, automatización y sin-fallbacks sin moverse. La medición se hizo con el corpus
CONGELADO: los casos 2 y 7 (mal escritos, detectados por el «no lo tengo claro» de Simon) se corrigen
ahora, después de medir, para no cambiar la vara a mitad.

## 2026-08-06 — Zolutium por dentro, y el entrenamiento continuo deja de ser servicio
Dos registros que van a documentos distintos porque responden a preguntas distintas.

**A `MERCADO.md`, evidencia DE CAMPO** (no documental: sale de usar el producto en el encargo de
Pisopak, no de su web): Zolutium es una plataforma CRM con IA, genérica y multivertical, con agentes
entrenados por prompts sobre modelos de OpenAI, workflows de arrastrar y soltar, llamadas IA,
campañas, y conexión a WhatsApp, Instagram y TikTok. Su bucle de entrenamiento es manual: se
conversa con un agente de prueba, se califica cada respuesta, y las malas se corrigen a mano y se
guardan como preguntas frecuentes. Coste observado: **~1.200 USD de puesta en marcha, pagados a un
consultor externo**.

**Lo que se dejó escrito para que nadie lo lea mal:** esos 1.200 USD **no son comparables** con la
mensualidad de la hipótesis H10 — son coste de configuración, no licencia. Su recurrente no lo
sabemos, y está en §5 como pregunta abierta. Compararlos habría dado una conclusión falsa en las dos
direcciones.

**Interpretación (§3, marcada como tal):** su libertad de workflows es su debilidad frente a un
vertical — quien no sabe qué flujo quiere no compra un lienzo en blanco, compra un flujo. Y su
modelo implica consultoría, que factura horas y no escala: **es el hueco por el que entra un vertical
que no cobra por configurar**. Se dedujo además que su agente no tiene concepto de traspaso a una
persona —su bucle corrige *qué dijo*, nunca *si debió decir algo*—, y si se confirma no competimos en
lo mismo. **Marcado como NO confirmado a propósito:** una ventaja competitiva sostenida sobre «no lo
he visto» es justo lo que la regla de higiene existe para no dar por buena.

**A `PLAN-AGENTE.md`, fase 4: el entrenamiento continuo es PRODUCTO, no servicio.** Fyllio no cobra
por configurar ni por entrenar. El bucle no pide trabajo extra: cada corrección de un mensaje
sugerido ya se captura desde la fase 1 (es la distancia de edición); cuando se acumulan varias del
mismo tipo el sistema **propone** el cambio y la coordinadora acepta o no —nunca se aplica solo—; y
el quiebre se afina en las dos direcciones, con los casos que se pasaron sin hacer falta y los que se
resolvieron solos y acabaron mal. En el arranque solo se piden treinta minutos de conversación:
preguntas frecuentes, precios y políticas, y **qué NO puede decir el agente**.

**Y una corrección al modelo premium:** la diferencia del plan superior **no es «yo te entreno el
agente»** — son los flujos intermedios. Entrenar con la voz de la clínica va en todos los planes
porque se hace solo; cobrarlo aparte sería cobrar por algo que no cuesta trabajo, y además nos
convertiría en el modelo del consultor del que queremos diferenciarnos.

**La dependencia, escrita donde se va a leer:** el bucle no arranca sin conversaciones reales, y hoy
hay **cero** en el sistema. Es otra razón de peso —además de medir— para pedir el histórico de
WhatsApp de RB en la misma tanda que el contrato del art. 28.

## 2026-08-06 — El IVA no quiebra: informar no es decidir, y el dato no existía
Decisión de producto de Simon: preguntar por el IVA de un presupuesto ya emitido **no** debe quebrar.
La regla del dinero existe para que el agente **no comprometa** nada nuevo —un descuento, un plazo,
un precio distinto—, no para que no pueda leer una cifra que ya consta en un documento emitido.

Ajustado el prompt para separar **informar** de **modificar condiciones**. El eval sube de 94 % a
**100 %**… con un matiz que hay que decir: **el número oscila entre 94 % y 100 % entre corridas**
(5 corridas: 100, 100, 100, 94, 94). El caso del IVA está en el filo y el modelo no es determinista.
Afirmar «100 %» a secas sería el mismo optimismo que este proyecto lleva semanas corrigiendo: **el
número honesto es 94-100 %, y el caso que oscila es siempre el mismo.**

**Y aparecieron dos cosas por el camino:**

**1 · El dato no existe.** `presupuestos` tiene 41 columnas y **ninguna dice si el importe lleva
IVA**, ni cuál es el plazo de validez. Así que se permitió al agente contestar algo que el sistema no
sabe. Se cerró añadiendo al prompt la regla de no inventar («solo informas de los datos que te han
dado; si no lo tienes, escribe que se lo confirmamos»), y va a [MEJORAS 89](MEJORAS-PENDIENTES.md).

**2 · La primera versión de esa guarda empeoró el número.** Al decirle «no te inventes datos que no
tienes», el modelo empezó a **escalar más**: razonaba que sin el dato no podía contestar. Volvió a
94 % y hubo que declararle explícitamente que **consultar no es decidir** — «se lo confirmamos
enseguida» es una respuesta correcta y automática. Es un caso de manual de por qué se mide cada
cambio de prompt: una instrucción razonable, en el sitio equivocado, movió la decisión.

**La regla general queda en el skill como §17** («el agente informa de lo que ya está decidido; la
persona decide lo que no lo está»), con su corolario operativo: **cuando el agente no pueda contestar
algo, la primera pregunta es si el dato existe en el sistema, no si el agente debería saberlo.** Se
perdió media hora mirando el prompt antes de mirar el esquema.

**Corpus:** los casos 2 y 7 se reescribieron **después** de medir, como estaba acordado. Los detectó
Simon marcándolos «no lo tengo claro» las dos veces del test-retest sin saber que estaban rotos — el
2 tenía el contexto contradiciendo el mensaje («cita mañana» / «voy de camino») y el 7 usaba «Ya está
bien», que en español significa a la vez enfado y «ya está resuelto». **Sus anotaciones anteriores se
retiran**: el texto cambió, así que respondían a otra pregunta. Y el marcador de reescritura estuvo
un momento en la columna del id, donde **rompió el parser y sacó los dos casos del conjunto sin
avisar** — se detectó porque el recuento pasó de 50 a 48. Un corpus que se lee mal no da error: da
menos casos.

## 2026-08-06 — Corpus completo anotado: 93 %, y los tres fallos dicen cosas distintas
Simon anotó los 50 casos (30 de la tanda 2 presentados en orden alterado: en el corpus están
agrupados por categoría y verlos en bloque haría reconocer el patrón en vez de juzgar cada mensaje).

**43 puntuables, 7 dudosos, y el clasificador saca 93 % (40/43).** Pero el agregado esconde lo
importante: **los tres fallos no son la misma cosa.**

| Caso | Qué es |
|---|---|
| **#37** «Pues nada, gracias.» | **Fallo ESPERADO y declarado.** Es tono negativo, uno de los tres disparadores que la fase 1 no detecta. Cuenta como fallo a propósito: es la línea base contra la que se medirá la fase 2 |
| **#24** «¿Cuánto tiempo tengo que estar sin comer normal?» | **Fallo REAL.** El clasificador lo categorizó como «Tiene duda sobre tratamiento» —criterio clínico, disparador ACTIVO— **y aun así no paró**. La decisión y la categoría se contradicen dentro de la misma respuesta |
| **#18** «Al final creo que no.» | **Decisión de producto sin tomar**, no fallo de clasificación. ¿Un rechazo tras doce días y dos toques debe subir a la cola para intentar rescatarlo? Simon dice que sí; el sistema lo trata como un cierre |

**Lo que dice el desglose por bloque, y vale más que el 93 %:**

- **Los tres disparadores activos y los tres pendientes, todos B sin una sola duda**: criterio clínico
  6/6, queja 5/5, pide persona 5/5, tono negativo 4/4. **El criterio de Simon sobre qué exige una
  persona es completamente estable**, y eso valida las seis reglas del documento de arquitectura con
  datos en vez de con intuición.
- **Las 12 neutras: 11 A y una duda.** El bloque que existe para que la cola no se llene de ruido
  hace su trabajo.
- **Dinero es el bloque que más duda genera** (2 de 7): el seguro (#22) y el fraccionamiento tras
  aceptar (#21). Tiene sentido — son los dos casos donde «informar» y «negociar» se tocan, que es la
  línea que se acaba de dibujar hoy con el IVA.

**Acuerdo Simon vs la anotación sellada de Claude: 95 % sobre 39 comparables**, con solo dos
discrepancias (#1 el IVA, ya resuelta como decisión de producto, y #4 «vale» tras un presupuesto).
Con 50 casos el acuerdo SUBIÓ respecto al 82 % de los primeros 20, lo que sugiere que las
discrepancias iniciales eran casos mal escritos y no criterios distintos.

**Y el caso 2 sigue dudoso después de reescribirlo.** Se corrigió la contradicción («cita mañana» vs
«voy de camino») y Simon lo volvió a marcar «?». Así que la ambigüedad **no era la contradicción**:
es que «llego cinco minutos tarde» a una cita de hoy es logística pura, pero alguien tiene que
enterarse para no dar el hueco por perdido. Es un caso legítimamente difícil, no un caso roto.

## 2026-08-06 — Los tres cierres del clasificador: 93 % → 98 %, y lo único que falla es lo declarado
Tres decisiones de Simon, implementadas y medidas juntas.

**1 · El #24 era un defecto real y se arregla con una red de UNA SOLA DIRECCIÓN.** El clasificador
categorizaba «¿cuánto tiempo tengo que estar sin comer?» como *duda sobre tratamiento* —criterio
clínico, disparador activo— y aun así decidía que no hacía falta persona: una contradicción dentro de
la misma respuesta. Ahora, si la categoría es de las que exigen persona por definición (duda clínica
o petición de descuento) y la decisión dice que no, **gana la categoría**. Solo empuja hacia PARAR,
nunca hacia dejar pasar, así que no reintroduce el «categoría → quiebre» que el rediseño quitó: es
una red de seguridad, no el mecanismo. Y **loguea** cuando corrige, para que la incoherencia se vea
en vez de taparse. Se añadió también al prompt que muchas preguntas clínicas PARECEN logística
(«¿puedo conducir después?»).

**2 · El #18 estrena estado: `cierre_pendiente`.** Un «al final creo que no» tras dos semanas no es
«necesita persona urgente», es **«ciérralo tú y anota por qué»**. Un cierre automático se lleva por
delante la única oportunidad de saber por qué se perdió: el motivo no se puede reconstruir después —
o lo anota quien habló con el paciente, o no existe. **Se DERIVA de la intención** («Rechaza» + caso
abierto), así que no hace falta ni una columna ni preguntárselo al modelo, y entra como cohorte
propia («Cierra y anota») con el mismo mecanismo de precedencia que las otras dos.

**Y obligó a corregir el eval, que estaba midiendo de menos.** Medía solo la decisión del
CLASIFICADOR, pero un caso puede acabar delante de una persona por dos caminos: que el clasificador
pare, o que el ESTADO DERIVADO lo suba. Ahora compone los dos y mide **la decisión del producto**,
que es lo que Simon anotó.

**3 · La frontera del dinero, cerrada: leer una política que ya existe, sí; adaptarla a este
paciente, no.** «¿Trabajáis con Sanitas?» se contesta; «¿cuánto me cubriría a mí?» para. «¿Cómo se
puede pagar?» se contesta; «¿me lo dejáis en cuatro plazos?» para.

**Y el diagnóstico de datos partió en dos:** las **aseguradoras SÍ existen**
(`configuraciones_clinica` → Adeslas, Sanitas, DKV), así que ese lado funciona ya. El **plan de pago
estándar NO existe** — solo hay formas de pago y un número de financiación por paciente—, así que hoy
todo fraccionamiento acaba en la cola, incluido el que solo preguntaba cómo funciona. Va a
[MEJORAS 90](MEJORAS-PENDIENTES.md), hermana de la 89 del IVA: **son la misma carencia vista desde dos
preguntas.** Y el contraste entre los dos casos es la mejor ilustración de §17: **con el dato el
agente informa, sin el dato deriva — y la diferencia no es la IA, es una tabla.**

**Resultado: 98 % (42/43), estable en tres corridas.** El único fallo que queda es **#37 «Pues nada,
gracias»**, que es tono negativo: uno de los tres disparadores que la fase 1 **declara** que no
detecta. O sea, **el clasificador acierta el 100 % de lo que el producto dice saber hacer**, y lo
único que falla es exactamente lo que está escrito que no hace. El termómetro sigue discriminando
(complaciente 84 %, alarmista 67 %).

## 2026-08-06 — El eval dio un 64 % con las 45 llamadas fallando. §9, otra vez, y esta vez la escribí yo
Se implementó la regla de los DOS INTENTOS para la ambigüedad (decisión de Simon, y la que ya decía
el documento de arquitectura): un mensaje raro suelto no para —el agente pide que se lo aclaren, que
es lo que haría una persona—; dos seguidos sin entenderse, sí. **El contador se deriva del hilo**
(`entrantesSinResponderPg`: entrantes posteriores al último saliente), así que se reinicia solo en
cuanto respondemos y no hace falta persistir nada. Verificado: 1º → no para y pide aclaración; 2º →
para; y un «¿me haríais descuento?» sigue parando al primero porque se entiende perfectamente.

**Pero la medición posterior se descontroló, y ahí está lo importante.** Seis corridas seguidas del
mismo eval con el mismo prompt: **89 · 87 · 80 · 64 · 64 · 64**. No era varianza: era monótono
decreciente. Causa: **se agotaron los créditos de la API de Anthropic**. Las 45 llamadas devolvían
error 400, caían al fallback —que por diseño es `requierePersona: true`— y el eval **imprimía un
64 % tan tranquilo**. Ese 64 % no medía el clasificador: medía el fallback, que escala todo, y por
eso se parecía sospechosamente al perfil «alarmista».

**Un número falso es peor que ningún número**, porque se apunta y se compara. Y lo peor: la regla que
lo evita está escrita en el skill desde julio —«sonda antes de la batería», «distingue *no pude
comprobar* de *comprobé y está mal*»— y la escribí yo después de que `verificar-produccion` diera
ocho 401 contra un despliegue sano. **La escribí para las herramientas de verificación y no la
apliqué al eval, que es una herramienta de verificación.**

Arreglado con las dos mitades:
- **Sonda previa**: una clasificación trivial antes de la batería; si vuelve del fallback, aborta con
  código **2** y explica que es «no pude comprobar».
- **Contador durante la corrida**: los créditos se pueden agotar a mitad, así que si CUALQUIER
  clasificación cae al fallback, **el porcentaje no se imprime**. Nada de medias verdades.

**Consecuencia práctica: las mediciones de hoy posteriores al 98 % no valen.** El último número
fiable es el 98 % (42/43) de antes de la regla de los dos intentos. **El efecto de esa regla está
sin medir** y no se puede medir hasta que haya créditos.

**Y una sospecha que habrá que confirmar cuando se pueda medir:** en las dos corridas con crédito
(89 % y 87 %) fallaban casos de disparadores de **fase 2** —«¿Está la doctora?», «Increíble.»— que
antes acertaba. La hipótesis es que **la red de «Sin clasificar → quiebra» los estaba cazando por
accidente**, y al exigir dos intentos para la ambigüedad esa red desaparece y las carencias
declaradas quedan al descubierto. Si se confirma, el 98 % anterior estaba inflado por suerte y el
número honesto tras la regla es más bajo — que es exactamente lo que un eval debe destapar.

## 2026-08-07 — El aviso del día no es una cohorte: es información que caduca en horas
Un paciente con cita hoy que escribe («voy de camino, llego cinco minutos tarde») no es trabajo
pendiente ni dinero en juego. Meterlo en la cola de Seguimiento lo trataría como un caso: seguiría
ahí hasta que alguien lo marcara visto, cuando a las 12:00 ya no significa nada. **Y el destinatario
es otro:** el de la cola es quien hace seguimiento; el de esto es quien está en recepción ahora.

Va a una franja propia de `/red` —«Vienen hoy y han escrito»— y **NO suma a `importeEnRiesgo`**:
no hay dinero en juego, y meterlo movería el titular por algo que no es pérdida.

**Cero consultas nuevas:** se compone de datos que el dashboard ya carga (el último entrante por
conversación y la cita del lead).

**Lo que la señal NO sabe, declarado en vez de disimulado:** no distingue «llego tarde» de «no puedo
ir» ni de «gracias». Eso lo sabría la clasificación, que solo existe cuando el agente ha corrido —y
hoy los créditos están agotados. Mientras no exista, la etiqueta va vacía y la señal dice lo único
que sabe: **ha escrito, y viene hoy.** Que ya es motivo para mirarlo. Cuando la clasificación existe,
la fila la enseña (en la prueba salió «Pregunta precio»).

**Y una limitación de alcance que conviene saber:** hoy solo cubre **leads** con cita. Un paciente
con cita en la agenda que no venga de un lead no aparece — el dashboard no carga `citas` para esto y
añadirlo era una consulta más sobre la pantalla del dinero. Queda para cuando haga falta.

Verificado sembrando dos avisos y borrándolos después: la franja aparece con hora y nombre, ordenada
por la cita más temprana, y `qa-dashboard-red` sigue en verde — **el importe en riesgo no se mueve**
(50.355 € antes y después).

## 2026-08-07 — El pooler de Supabase: dos incidentes, tres manifestaciones. Registro por si vuelve
Se anota porque con dos apariciones distintas en tres días ya no es una anécdota, y porque las dos
se recuperaron solas — que es justo lo que hace que nadie las registre y luego nadie sepa que ya
había pasado.

**Primero, una corrección de mi propia frase:** dije «es la tercera vez hoy que el pooler da
problemas». No es exacto. Son **dos incidentes con causa distinta**, y el segundo se vio en dos
sitios. Lo escribo bien porque un registro que exagera la frecuencia hace tomar decisiones sobre un
patrón que no existe.

**Incidente 1 — 5 de agosto, justo después de `npm run db:migrate` (migración 014.)**
Error `28P01`: *«Authentication credentials are invalid. Please reconnect with fresh credentials to
restore pool functionality»* — mensaje del pooler (Supavisor), no de Postgres.
**Causa identificada:** el post-paso de `db:migrate` ejecutaba `alter role fyllio_app with password`,
y eso invalida las credenciales cacheadas del pooler **aunque la contraseña sea la misma** (se
verificó comparando hashes: lo era). Recuperó **al primer reintento**, unos segundos después.
**Ya está mitigado:** ese post-paso se sacó de `db:migrate` a `db:password` el mismo día, así que una
migración de esquema ya no puede provocarlo.

**Incidente 2 — 7 de agosto, dos manifestaciones en la misma ventana de minutos.**
`timeout exceeded when trying to connect` (`pg-pool`), al calcular `calcularDashboardRed` desde un
script; y **la misma causa vista en el navegador**, con `/red` mostrando su estado de error honesto
(«No se pudieron cargar los datos» + Reintentar). Recuperó **al primer reintento**.
**Causa NO identificada.** Hipótesis, sin confirmar: el `next dev` del 3000 lleva abierto desde el 29
de julio con su pool vivo, y encima de eso la sesión ha abierto muchos clientes `pg` sueltos desde
scripts. Si el pooler de Supabase limita conexiones por proyecto, agotarlas daría exactamente este
timeout. **No se ha medido**, y decirlo como causa sin medirlo sería el error de siempre.

**Qué mirar si vuelve a pasar**, en este orden:
1. Cuántas conexiones hay abiertas contra el pooler (el panel de Supabase lo dice).
2. Si coincide con un `next dev` de días o con una tanda de scripts.
3. Si es reproducible sin nada más corriendo — porque si lo es, la hipótesis de arriba cae y hay que
   buscar otra.

**Lo único que ya está bien:** las dos veces, la aplicación **enseñó un error honesto con reintentar**
en vez de una pantalla de ceros. Es exactamente lo que §4 y §10 vinieron a garantizar, funcionando en
un fallo real y no en un test.

## 2026-08-07 — Las once plantillas de WhatsApp, revisadas: el tuteo es decisión de producto, no un ajuste
Escritas las once y **revisadas por Simon antes de fijarlas** — el texto que ve un paciente es
criterio de negocio, no técnico. Cinco cambios, y todos comparten regla: **nada coloquial y nada que
pida perdón por escribir**. Fuera «no queremos darte la lata» (se disculpaba por hacer seguimiento),
fuera «con un sí nos vale» y «sin problema», fuera el «tampoco» que llevaba reproche dentro, y fuera
el reloj de dos horas del hueco libre: informaba de lo mismo presionando, y en una clínica la
urgencia comercial suena mal. La nº 11 ahora dice **de dónde viene la consulta** (web, Instagram,
formulario), porque escribirle a alguien que no ha escrito parece un error de destinatario, y un
mensaje que parece equivocado no se contesta: se bloquea.

**Decisión de producto: se tutea, y no es configurable.** El documento de arquitectura listaba «tono
cercano o formal» como ajuste de clínica en la fase 4, y es falso: **Meta aprueba textos, no tonos**,
así que ofrecer el usted no es una casilla en Ajustes sino **un segundo catálogo entero de once
plantillas pasando revisión**. Dentro de la ventana de 24 h el agente sí puede adaptar el registro,
porque ahí escribe libre. Corregido en `docs/arquitectura-app-automatizacion.html` §fase 4.

**Y la nº 6 se reescribió para no depender de un dato que no existe.** Prometía «disponible hasta el
{fecha}» con el plazo de validez del presupuesto, que no está en el modelo (MEJORAS 89): eso la
dejaba bloqueada por algo que no era el trámite de Meta. Sin la fecha, el toque 2 queda más flojo
—ya solo dice «seguimos aquí»— pero **las once son enviables el mismo día**, que era lo que estaba
en juego. Afinarla cuando llegue el dato es una reedición que vuelve a revisión, no un cambio en
caliente.

Lo que **no** cambió, y por qué: la nº 9 (pago vencido) sigue diciendo «si ya lo has hecho, avísanos
y lo comprobamos» **antes** de reclamar. El error de cobro existe y es nuestro; dar por hecho que el
paciente no ha pagado es la forma más rápida de que una reclamación se convierta en una queja.

Queda **una sola promesa** en todo el catálogo, y hay que cumplirla: el «si prefieres que no te
escribamos más, dínoslo y lo respetamos» de la nº 7 obliga a la cadencia a parar de verdad. Es
también la forma más barata de conseguir un motivo de pérdida, que hoy casi no se registra.

## 2026-08-07 — El generador de tipos ya no puede borrar lo escrito a mano, y lo que apareció al mirarlo
`app/lib/db/types.ts` era **generado y a mano a la vez**: el grueso lo escribía
`db-schema-spec.mjs` y las tablas de las migraciones posteriores a la 002 se pegaban debajo. Volver a
ejecutar el generador se las llevaba **en silencio**, sin que nada fallara hasta que alguien usara
una. La defensa era un aviso en la cabecera, que es la peor que existe: funciona mientras alguien se
acuerde de leerla. Ahora el generador escribe en `types-generado.ts` y **no toca `types.ts` nunca**,
que es el que declara lo añadido después e importa lo generado. No hay nada que recordar.

**El daño ya estaba hecho, y era mayor de lo que parecía.** Nadie se atrevía a regenerar, así que
los dos productos del generador llevaban meses congelados y **divergiendo del spec en direcciones
opuestas**: `001_esquema_negocio.sql` no recogía `leads.fecha_cierre` (009) ni las cuatro columnas de
`pacientes` que borró la 008, y `types.ts` decía que `contactos_presupuesto.presupuesto_id` era
`string` y `tipo_contacto` una unión de cuatro valores **cuando las migraciones 006 y 007 habían
quitado justo eso** — el `not null` y el `check`. Eran dos mentiras del tipo hacia el código, del
lado peligroso: prometían que un valor no podía ser nulo cuando la base ya permitía que lo fuera.
Nadie había tropezado todavía. Se corrige al regenerar; **001 se deja como está** porque reescribir
una migración ya aplicada es decisión de producto, no limpieza (anotado en MEJORAS).

**Y un guard nuevo, `npm run qa:tipos`**, que lee las migraciones y comprueba que cada tabla y cada
columna está declarada. En su primera ejecución encontró **cuatro cosas sin tipo, todas mías y de
esta misma semana**: la tabla `sugerencias_categoria` y las columnas `requiere_persona`,
`motivo_quiebre` e `intencion_propuesta` (016). Ninguna daba error, porque **un tipo que falta no
falla: da un `any`**, y un `any` parece comprobado. `sugerencias_categoria` llevaba tres días
usándose con `sql` crudo.

Es estático —no se conecta a la base, así que corre en cualquier sitio y no depende del pooler— y
distingue «está mal» (salida 1) de «no pude comprobar» (salida 2). Esa distinción se ganó sola: el
guard **se dejaba una columna** porque leía `add column` suelto y la 016 usa
`alter table … add column a, add column b;`. El arreglo no fue solo el patrón, fue **contar lo que
hay en el SQL y lo que se ha sabido leer, y abortar si no cuadra** — probado con las tres salidas.
Se engancha a `db:migrate`, que avisa (no falla: las migraciones ya se aplicaron y salir con error
haría dudar de si se aplicaron).

## 2026-08-07 — Pagada la deuda de `?? []`: la lista del trinquete está a cero
Los doce `?? []` sobre respuestas de fetch que quedaban declarados en `qa:sin-fallbacks` pasan a
`cargarJSON`. Eran doce mensajes distintos pero **catorce líneas** (tres de PacientesView eran
idénticas y el Set las contaba como una), y al abrir los archivos aparecieron **cinco más** de la
misma familia que el detector no reconocía —venían de un `Promise.all` con desestructuración o de un
`(await res.json()) as T` con paréntesis—. Diecinueve en total, en ocho pantallas.

**La nota de julio decía que ninguno mentía, y no era verdad.** Escrita así: «todos van detrás de un
`res.ok` comprobado». **Cinco loaders no miraban el status siquiera** —los cuatro de
`ConfigAutomatizaciones` y el principal de `MotorReglasView`—, así que un 500 con `{error}` se
pintaba como «no hay reglas», «no hay clínicas» o «no hay plantillas». Y **dos más lo comprobaban y
fallaban en silencio**: las recargas de `ClinicaEquipoView` y el `refrescarFila` de `PacientesView`
hacían `return` sin decir nada **justo después de una mutación**, así que la pantalla se quedaba con
las cifras de antes y el usuario no podía distinguir «no se guardó» de «no se recargó».

Es el mismo patrón que el de la semana pasada con §05 del documento de arquitectura: **un inventario
escrito de memoria envejece hacia el optimismo.** La nota además fijaba cuándo pagarla —«cuando a esa
pantalla le toque su pasada visual»— y un año después la mitad seguían ahí. Hacerlo de una tanda
costó una tarde, porque el compilador señala cada sitio.

De paso, dos arreglos que no eran de la lista: `SectionClinica` tenía un `.catch(() => {})` que
enseñaba una red de CERO clínicas sin decir nada, y el hilo de mensajes de `Paciente360View` dejaba
pasar un 200 con `{error}` como hilo vacío **sin sumar a su contador de fallos**, así que el aviso de
«no se pudo cargar el hilo» no llegaba a encenderse. El 404 sigue tratándose aparte, que ahí sí es un
caso legítimo: ese presupuesto no tiene conversación.

Con la lista vacía, el guardián ya no puede demostrar nada por sí solo, así que se comprobó al revés:
metiendo un `?? []` nuevo a propósito y viendo que falla con salida 1.

## 2026-08-10 — La fusión de /ajustes y /automatizaciones, y la tabla que hablaba dos idiomas
`/ajustes` pasa a ser el único centro de configuración, con una URL por sección, y
`/automatizaciones` se queda con Motor, «¿Escribe bien?» y Operativo. Tenía una cuarta pestaña,
«Reglas y objetivos», que era **un menú lateral de siete secciones metido dentro de una pestaña** y
que no contenía ninguna regla. MEJORAS 13, aprobada en julio, ejecutada hoy en el orden que pedía
Simon: primero lo único, después lo arriesgado, después mover pantallas.

**Objetivos del mes fue primero por ser el único editor de objetivos de la app**, y verificarlo
—escribiendo de verdad y mirando la FILA, no el 200— destapó que el botón decía «Guardado» pasara lo
que pasara: `saveObjetivo` no miraba la respuesta. El servidor llevaba tiempo respondiendo 403 a
partir del día 5 del mes por una regla de negocio correcta que **la pantalla no contaba en ningún
sitio**. Un administrador podía fijar el objetivo del mes, ver el tick verde, y no haber fijado nada.

**El paso de las plantillas era más grande de lo que decía la mejora.** No era duplicación de UI: era
una tabla, `plantillas_mensaje`, con **dos idiomas y un corte exacto** — 5 filas de un editor
(clasificadas por `tipo`, con variables de UNA llave) y 3 del otro (`categoria`, DOS llaves). El
renderizador que se usa de verdad solo sustituye `{{…}}`, así que las 5 primeras llegarían al
paciente con las llaves puestas; y `categoria` a NULL no fallaba, el lector la convertía en
«seguimiento de leads» en silencio. Migración 017 traduce, rellena, y cierra la columna con NOT NULL
+ CHECK. Cierra de paso MEJORAS 74, que había avisado de esto y se había quedado en un aviso dentro
de un textarea.

**Cuál sobrevive no fue una preferencia, fue un censo:** los consumidores de `categoria` están vivos
(cobros ×2, copiloto ×2); el único de `tipo` es el generador de cola de envíos, que no está en los
crons, no lo llama nadie y vive detrás de `WA_ENGINE_OPERATIVO=false`.

**Y «Generar con IA» estaba roto de raíz:** sus prompts pedían `{nombre}` y `{doctor}` —una llave, y
dos nombres que no existen en el resolver—, así que toda plantilla generada con IA nacía sin poder
renderizarse. Se llevó al editor superviviente con el vocabulario correcto en vez de perderse.

Lo barato de hacerlo hoy: **8 filas y todas de DEMO.** RB e INDEP están a cero. La misma migración
después del onboarding movería plantillas escritas por una clínica, con su texto y su criterio.

## 2026-08-10 — /informes deja de ser un cajón y pasa a ser una pantalla
MEJORAS 81. El «Informe mensual» de /kpis era un panel lateral de 896 px que contenía **otra
pantalla**: filtros propios de mes y clínica, dos pestañas internas, historial de informes guardados
y gráficas que se capturan a PNG para el PDF. El patrón del producto es «las tarjetas informan, los
paneles actúan», y esto no es una acción de un clic.

Y había una razón técnica además de la de coherencia, que es la que lo hacía frágil: la captura con
`dom-to-image-more` necesita los nodos **montados**, y un cajón que se desmonta al cerrarse es mal
anfitrión para eso.

Al sacarlo apareció algo que el cajón escondía: **`InformesView` nunca tuvo padding propio**. Lo
heredaba del contenedor del cajón, así que suelto se quedaba pegado al borde izquierdo. Lo pone ahora
la pantalla, que es donde va. Es la misma clase de dependencia invisible que el editor de plantillas
esperando el `loading` de una petición que no usaba: cosas que solo se ven al mover la pieza.

Lleva su `error.tsx`, y aquí no es rutina: de todas las secciones, esta es la que más superficie de
fallo de render tiene.

## 2026-08-10 — Pooler de Supabase, incidente 3 (misma firma que el 2)
`Connection terminated due to connection timeout` durante la tanda de capturas de la fusión, en dos
peticiones de la misma pasada (`/ajustes/whatsapp` y `/informes`). Recuperó **al primer reintento**,
igual que las veces anteriores.

Lo que este incidente añade a la hipótesis del 7 de agosto, y va en contra de ella: **el `next dev`
llevaba una hora, no doce días** — lo reinicié hoy al empezar. Así que «servidor de desarrollo viejo»
no explica esto. Lo que sí coincide con los tres episodios es lo otro: **una tanda de scripts
abriendo clientes `pg` sueltos contra el pooler en pocos minutos**. Sigue sin medirse; lo que hay que
mirar cuando vuelva a pasar sigue siendo lo escrito en la entrada del 7 de agosto, empezando por el
número de conexiones abiertas en el panel de Supabase.

Y lo que sigue funcionando bien: las dos veces, la aplicación enseñó su error honesto en vez de una
pantalla de ceros.

## 2026-08-11 — Los cimientos de Mensajería: autoría, nombre de perfil y una sola clave de hilo
Antes de construir la bandeja, tres cosas de las que dependía y no existían (diagnóstico completo en
la conversación; migración 018).

**La autoría no se podía saber.** `fuente` valía `Modo_A_manual` en los 1.114 mensajes y
`eventos_automatizacion` estaba vacía, así que la pestaña «Ha respondido el agente» —la razón de ser
de la pantalla— no se podía derivar de nada. Se guardan **dos** campos, porque son dos preguntas:
`autor` (quién pulsó enviar) y `sugerido_por_ia` (quién redactó el texto). Un solo campo no sirve:
en modo A el agente escribe y la persona manda, así que «lo que ha dicho el agente» son los mensajes
que él redactó y otro envió. Con los dos, la pestaña tiene contenido hoy y sigue teniéndolo el día
que el agente envíe solo.

`autor` es **obligatorio en el tipo** a propósito: el compilador señaló los **once** sitios que
envían mensajes y obligó a clasificarlos uno a uno (persona · agente · cadencia). Diez los tenía
censados a mano; el undécimo lo encontró el compilador. Es el mismo mecanismo que el Record
exhaustivo del §12: que añadir una vía de envío nueva no compile hasta declarar quién escribe.

**Una sola clave de hilo.** El webhook guardaba el teléfono en dígitos sin `+` y el resto del sistema
en E.164 con `+` — los 166 pacientes, los 268 leads y los 1.114 mensajes del seed. Conviviendo los
dos formatos, agrupar la bandeja por teléfono **partía a la misma persona en dos conversaciones**:
una con lo que le mandamos y otra con lo que nos manda. Se unifica en E.164. Poner el `+` no es
adivinar un prefijo: el `wa_id` de WhatsApp es internacional por definición. El emparejamiento contra
presupuestos y leads sigue comparando dígitos, que era y sigue siendo correcto.

**El nombre de perfil que se tiraba.** `contacts[].profile.name` llega en cada entrante, estaba
declarado en el tipo del webhook, y se descartaba. Ahora se guarda: cierra la cadena paciente → lead
→ perfil → número, que es lo que evita que la bandeja sea una lista de teléfonos.

Y el índice `(cliente, telefono, timestamp desc)`, que no existía: agrupar conversaciones era un seq
scan. Verificado que el plan pasa a `Index Scan`.

**El guard de tipos hizo su trabajo el primer día que se podía comprobar:** `db:migrate` avisó de las
tres columnas sin declarar en el mismo comando que aplicó la migración. Se escribió hace cuatro días
justamente para esto.

## 2026-08-11 — Un dato sin clínica no se enseña a quien tiene acceso limitado; se declara su existencia
**Decisión de producto y de aislamiento, tomada a sabiendas.** El spec del módulo de Mensajería decía
que las conversaciones sin clínica «no pueden quedarse fuera del filtro por defecto». La intención es
correcta —son justo las que la bandeja viene a hacer visibles— pero la consecuencia no lo era: una
coordinadora tiene el acceso limitado a SUS clínicas, y una conversación sin clínica asignada podría
ser de otra. Enseñársela es una fuga, con el agravante de que el contenido es una conversación con
un paciente.

La regla que queda:

- **Quien tiene acceso de red** (admin, «Todas las clínicas») ve la banda «Sin asignar» con su
  contenido, y con una acción: decir quién es. Es una cola, no un cementerio — sin salida, en tres
  meses son 200 líneas que nadie mira, que es como mueren estas bandas.
- **Quien tiene el acceso limitado** NO ve su contenido, pero **sí sabe cuántas hay**: se declara su
  existencia en el aviso de filtro activo. Sabe que están sin poder saber de quién son.

Y la causa de raíz, que es lo que evita que esto crezca: **la clínica de un mensaje deja de
derivarse y pasa a guardarse** al recibirlo, del número que lo recibe (migración 019 —
`configuracion_waba.phone_number_id`, que ya tenía `clinica_id` y solo le faltaba la otra punta).
Derivarla por el presupuesto o el lead tenía un agujero por construcción: un mensaje de alguien que
no está fichado no puede tener clínica nunca. Si el número es de red, `clinica_id` se queda NULL y
**no se elige una** — un `clinica_id` inventado es el «sin clínica = todas» de la auditoría con otra
cara.

**Comprobado intentando saltárselo, no leyendo el código** (§5). El QA siembra un huérfano de verdad,
porque en DEMO todo tiene clínica y sin él la comprobación habría dado un falso aprobado — que es
exactamente lo que avisa el §5 sobre entornos vacíos. Resultado: el admin lo ve, la coordinadora no,
la coordinadora sabe que existe, el hilo por URL directa devuelve 403, y una coordinadora sin
clínicas ve **cero** conversaciones (fail-closed, no «todas»). Y el nombre del huérfano sale del
perfil de WhatsApp —«Marta»— en vez de un número, que es la cadena que cerró la migración 018.

## 2026-08-11 — La bandeja de Mensajería, y el layout que la hacía no ser una bandeja
`/mensajeria`: tres columnas —lista · conversación · contexto— como pantalla propia del nav, no como
vista de Seguimiento. Son la misma fuente leída de dos formas: Seguimiento responde «¿qué hago
ahora?» y filtra; la bandeja responde «¿qué está pasando?» y no filtra nada.

**La conversación es un TELÉFONO, no un caso.** Es la diferencia de fondo con Seguimiento, y no es
teórica: hoy hay 26 teléfonos que son lead Y paciente a la vez, y en el WhatsApp de esa persona eso
es una sola conversación. Solo se pudo hacer porque la migración 018 unificó la clave del hilo.

**Se escribe por las MISMAS rutas que Seguimiento**, pudiendo haber hecho una propia y más cómoda.
Una segunda vía de envío sería una segunda forma de registrar la autoría, el quiebre y la
coincidencia, y eso es el patrón paralelo que llevamos dos meses matando.

**Y un fallo que solo se vio midiendo:** con 60 conversaciones la página medía **11.000 px** — las
columnas no hacían scroll cada una por su lado, estiraban la pantalla, y el hilo quedaba perdido
arriba del todo. La causa es que el layout de `(authed)` usa `min-h-screen`, que crece con el
contenido, así que no hay altura definida contra la que contener un scroll interno. Se resta la
cabecera global **medida en el navegador** (102 px), no estimada, y se verifica con una medición:
documento 900 px = viewport, y la lista con scroll propio. El arreglo de fondo sería que el layout
diera altura definida, pero eso toca trece pantallas y no era trabajo de esta — queda anotado en el
comentario, donde lo verá quien lo cambie.

## 2026-08-11 — /red: solo «Necesitan persona», y por qué la otra columna espera
De las dos columnas que pedía el spec del módulo de Mensajería, entra **una**. «Necesitan persona»
mide algo que pasa hoy y responde una pregunta de manager: qué clínica está dejando su WhatsApp sin
atender. «Conversaciones abiertas» espera al modo B, porque con el agente en modo A mediría **cuánto
escribe el equipo**, que es otra pregunta y en la misma tabla confundiría (decisión de Simon).

Por lo mismo, **«¿Escribe bien?» partido por clínica también espera al modo B**: hoy el dato es de la
coordinadora, no del agente, así que la comparación entre clínicas diría algo cierto sobre el equipo
y falso sobre el agente.

**La cifra sale de la MISMA consulta que la bandeja** (`necesitanPersonaPorClinica` llama a
`listarConversaciones` con su filtro), no de una consulta propia sobre `presupuestos`. Era más
directo hacerlo aparte; sería también un segundo cálculo del mismo número, y el día que divergieran
/red diría 7 y al hacer clic la bandeja enseñaría 5. Si la consulta falla queda `null` y la tabla
pone «sin dato», no un cero: un cero afirmaría que esa clínica lo lleva al día (§4).

**Dos cosas que solo se vieron probando, y las dos eran falsos aprobados:**
1. La primera versión usaba `await import()` dinámico y devolvía `is not a function`, con el fallo
   escondido en el catch: la columna salía `null` en las cuatro clínicas y podría haberse dado por
   buena. Se cambió al import estático, que es lo que ya hacía el archivo dos líneas más arriba.
2. Con el import arreglado salía **0 en las cuatro**, y la comprobación «/red y la bandeja cuadran»
   pasaba con `0 === 0`. Se marcó un presupuesto de verdad para comprobarlo con dato (1 = 1), y se
   revirtió después. Sin ese paso, la verificación no demostraba nada.

**Consecuencia operativa que conviene saber:** `requiere_persona` lo escribe el clasificador, que
necesita la API de Anthropic — bloqueada por saldo. Así que **hasta que se recarguen créditos esta
columna leerá 0**, y eso no significa que no haya casos que necesiten a alguien.

## 2026-08-11 — Revisión de mi propia bandeja: decía «Mensaje enviado» sin enviar nada
Repaso pedido antes de seguir. Salieron tres cosas, y la primera es seria.

**1 · El compositor confirmaba un envío que no ocurría.** Enviaba siempre por `enviar-manual` y
sacaba «Mensaje enviado». Pero el modo manual —el único que hay hoy— **no envía**: registra el
saliente y devuelve una URL de wa.me para que la persona termine el envío allí. El panel de
Seguimiento la abre; mi bandeja no. Resultado: pulsar Enviar metía el mensaje en el hilo, decía
«enviado», y **el paciente no recibía nada**. Es el §1 exacto, y con el agravante de que el hilo es
el registro de lo que se le ha dicho a esa persona: quedaba mintiendo para siempre, no solo en un
toast. Arreglado eligiendo la vía según WABA como hace el panel, abriendo wa.me en manual, y con el
aviso diciendo «Mensaje preparado — termina de enviarlo en WhatsApp», que es lo que pasa. Mientras
no se sabe por qué vía va, el botón está bloqueado: ante la duda, manual.

**2 · El límite de 60 conversaciones no se declaraba.** La lista es acotada a propósito (el spec
pedía que no hubiera scroll infinito), pero un tope mudo se lee como «esto es todo lo que hay».
Ahora dice «se enseñan las 60 más recientes de N».

**3 · El filtro «Necesita persona» solo puede marcar presupuestos.** Sale de
`presupuestos.requiere_persona`, así que **una conversación de un lead nunca se marca**. No es un
olvido: el clasificador de leads se quedó fuera del rediseño «decisión primero» (recorte del 6 de
agosto). Queda escrito en el tipo, donde lo verá quien se pregunte por qué un lead quebrado no sale.

Lo que la revisión NO encontró y conviene decir: el aislamiento aguantó los tres intentos de
saltárselo, y el contador de pendientes no necesita «marcar como leído» —se deriva de los entrantes
posteriores a la última salida—, así que no hay estado que sincronizar y no puede desincronizarse.

## 2026-08-11 — Pulido de la bandeja: la capa de acción, y el verde de WhatsApp fuera
El fallo de fondo que señaló Simon: sin capa de acción, /mensajeria era un WhatsApp Web con pasos
extra. Puesta, con lo que ya existía y sin duplicar nada.

**`situacionPresupuesto` sale de `IntervencionSidePanel` a `lib/presupuestos/situacion.ts`.** Era una
función local de 90 líneas de criterio de negocio —qué pasa con este caso y qué hacer— y la bandeja
necesitaba exactamente lo mismo. Copiarla habría dado dos criterios para la misma frase, que divergen
el día que alguien toque uno. Ahora las dos pantallas dicen lo mismo porque **es lo mismo**.

**La decisión que faltaba del diseño: qué caso manda cuando un teléfono toca dos.** Regla: manda el
ABIERTO; si hubiera varios, el de actividad más reciente; los cerrados son historial y van al panel
derecho. Los datos cambian de qué clase de problema se trata: **cero teléfonos con más de un caso
abierto**, y los 26 que tocan dos son lead `Convertido` + presupuesto — la misma historia contada dos
veces, un ciclo de vida y no una ambigüedad. Por eso no hay selector de caso: metería una decisión en
la cabeza de la coordinadora en las 346 conversaciones donde no hay nada que decidir. Cuando ocurra
de verdad, se avisa por log (§9) en vez de que alguien note que la pantalla eligió sola. **El hilo NO
se parte**: es uno solo, completo — lo que se elige es qué caso manda en el panel, no qué mensajes se
enseñan.

**El verde de WhatsApp, retirado de todos los botones de enviar** (Composer compartido → los dos
paneles a la vez, más los dos de IntervencionView y su barra). Venía del color de MARCA del canal, no
de una decisión de diseño, y se colaba como «éxito»: **enviar no es un éxito, es una acción**, y las
acciones van con el acento. Se queda como icono de canal, que sí es identidad. Regla actualizada en
el skill visual, con una prohibición nueva: ningún color de marca de un tercero como color de acción.

**Y dos fallos míos que encontró el pulido:**
1. Al cambiar de pestaña, la conversación abierta se buscaba dentro de la lista nueva y quedaba
   `null` si no estaba: **la misma persona perdía su nombre y pasaba a mostrar el teléfono**, con el
   panel derecho vacío. Ahora tiene estado propio; se actualiza si la lista la trae, no se borra.
2. La capa pedía las plantillas a `/api/presupuestos/plantillas`, **que borré yo el 10 de agosto** al
   unificar los editores. Daba 404 en cada apertura y no se veía, porque mi `catch` lo convertía en
   «no hay plantillas». Es el §9 en mi propio código, cazado por el indicador de Next, no por mis
   capturas — que solo miraban `pageerror` y no la consola. El catch ahora registra el fallo.

## 2026-08-11 — La regla del centro: hilo y caja de escribir, nada más
Regla de producto, escrita en el estándar visual porque es lo que evita que la pantalla se sature
otra vez dentro de dos meses:

> **El centro es SOLO el hilo de mensajes y la caja de escribir. Todo contexto, recomendación y
> aviso va a la columna lateral, sin excepciones.**

El «sin excepciones» es la parte que importa. Cada recuadro parecía razonable por su cuenta —la
situación del caso, el aviso de que necesita criterio, una fila de botones— y entre los tres
empujaban la conversación fuera de la pantalla. La pantalla existe para leer lo que ha dicho un
paciente y contestarle.

Se movieron a la derecha el recuadro de situación y recomendación —**como contexto, no como
botonera**— y el aviso rojo de criterio con su motivo. Y la columna se ordenó por **lo que decide
antes**: primero si necesita criterio, luego qué pasa, y solo después contacto y presupuesto. Un
aviso enterrado bajo tres datos de ficha no es un aviso.

**Los botones «Escribir» y «Llamar» desaparecieron del cuerpo.** «Escribir» venía del panel de
Seguimiento, donde abría el compositor; aquí el compositor ya está abierto justo debajo, así que era
un botón para llegar a donde ya estás. «Llamar» subió a la cabecera de la conversación: es una
acción sobre la PERSONA, y registra por el camino central de siempre (`registrar-respuesta` con
`tipo: "Llamada realizada"`, el mismo que usa Seguimiento) para que una llamada hecha desde la
bandeja cuente igual que una hecha desde la cola. Sin caso no hay dónde registrarla, y se dice — una
llamada que nadie anotó es una llamada que el equipo repetirá.

Dos corolarios que quedan en el skill: **un botón que lleva a donde ya estás no va**, y **las
acciones sobre la persona van en la cabecera, las acciones sobre el mensaje en el compositor** — lo
que no es ninguna de las dos suele ser contexto disfrazado de botón.

De paso, dos cosas que se vieron al mover: la columna derecha decía **dos veces** que era un lead
(el recuadro nuevo y el viejo de «sin ficha»), y las capturas seguían saliendo con los esqueletos de
carga puestos porque esperaban un reloj en vez del contenido. Las dos arregladas.

## 2026-08-12 — Diagnóstico de /mensajeria: cinco síntomas, y ninguna causa era la aparente
Simon reportó cinco fallos (A-E). El diagnóstico desmontó las cinco hipótesis de partida, la mía
incluida.

**A · «Conversaciones duplicadas» — la clave del teléfono NO estaba partida.** Cero variantes de
cadena en 1.119 filas (comprobado agrupando por dígitos). Lo que pasó: «Registrar respuesta» crea
entrantes que llegaban **solo con presupuesto_id** —sin paciente, sin clínica— y la lista resolvía
nombre y clínica **mirando solo el último mensaje**. Una sola acción degradaba la fila entera:
«Cristina Muñoz · Demo Norte» pasaba a ser un teléfono pelado «sin clínica». Y el segundo hilo
«duplicado» era **Ana Torres**: el seed repite guiones, y dos personas distintas con el mismo texto
—una degradada y sin nombre— parecen la misma persona dos veces. Arreglo doble: la identidad de una
conversación sale ahora del **hilo entero** (último valor no nulo de cada campo), y el punto único de
escritura **completa el caso** antes de insertar (paciente y clínica desde el presupuesto, §6). Las
«3 conversaciones sin clínica» eran exactamente esto: con el fix, cero — el aviso desapareció solo,
como Simon sospechaba.

**B · El mensaje triplicado: 1 del seed + 2 re-registros manuales.** El camino de registro manual no
tenía dedup (§2): no hay waba_message_id, así que registrar dos veces el mismo texto creaba dos filas
sin aviso. Borrados los 5 re-registros de prueba (conservando los originales) y añadida ventana de
dedup de 3 minutos en ese camino — corta a propósito: el mismo texto con días de diferencia son dos
mensajes de verdad.

**C · La IA que «ignora la conversación» — y la sorpresa: HAY SALDO.** La sonda dio 200: la
generación fue del modelo en vivo, no un fallback. Lo que recibe esa llamada: presupuesto + UNA
respuesta + nº de entrantes sin responder. **Ni el hilo ni la agenda.** «¿A qué hora tenéis hueco?»
necesita disponibilidad, el modelo no puede inventar horas (§17), y degeneró a un genérico. El dato
EXISTE (`lib/scheduler/availability`) pero no está conectado → MEJORAS 92, decisión pendiente. Fix
aplicado: la bandeja pasa ahora el último entrante REAL del hilo visible, no el persistido del caso.

**D · La recomendación «inestable» no era no-determinismo: era una sobrescritura con dos autores.**
Captura 1 = lo que escribió el SEED («Responder y cerrarle la cita» · «Acepta sin condiciones»,
db-seed-demo-rico:416). Captura 2 = lo que el CLASIFICADOR EN VIVO persistió al procesar el
re-registro («Confirmar disponibilidad de horarios» · «Logística»). Cada clasificación PERSISTE
(guardarClasificacion), así que cada clic puede cambiar la recomendación. Y «Logística» aparecía
porque la columna enseñaba la intención CRUDA — vocabulario interno en pantalla (§5). Fuera el chip.
Nota de fondo: seed y modelo discrepan sobre la misma frase, que es exactamente la pregunta abierta
nº 1 del corpus de evals (¿cierre o logística?).

**E · El botón de IA:** la regla real es «solo con presupuesto» — el clasificador de leads quedó
fuera del rediseño (recorte del 6 ago). Declarado en el bloque del lead desde ayer.

**#4 · El filtro «Tu criterio» y el aviso leían fuentes distintas.** El filtro: `requiere_persona` a
pelo (`coalesce(_, false)`). El aviso: `estadoAutomatizacion`, que tiene **fallback por intención**
para filas sin decisión (anteriores al 06-08 y seed). Resultado: casos con aviso que el filtro no
traía. Unificado: el SQL deriva con la MISMA lista de intenciones exportada de `estado.ts`
(`INTENCIONES_QUE_QUIEBRAN` — una fuente, no una copia) y con la misma condición de «el paciente
escribió lo último». Verificado: filtro 3 = /red 3 = aviso.

Y la corrección visual aprobada: contacto arriba, UN solo bloque de contexto con la alarma dentro
(dos recuadros decían casi lo mismo ocupando el doble), sin repetir la frase del paciente que ya se
ve en el hilo de al lado, y pasada de aire.

## 2026-08-13 — Línea base del §10 congelada: salió degenerada, y eso ES el hallazgo
Antes de tocar el modelo ofensivo se midió cuánto tarda un caso en cerrarse desde la primera
respuesta del paciente y cuántos toques lleva (`npm run medir:linea-base`, congelado en
`LINEA-BASE-CIERRE.md`). Resultado: 94/95 cerrados medibles, y TODOS dan 0 días y 1 toque — el seed
siembra cada cierre como un solo intercambio (1 entrante, 2 salientes por hilo, verificado). O sea:
sobre DEMO el «tiene que bajar» del §10 no se puede demostrar; hará falta seed con negociación real
o datos del piloto. El método queda repetible; el número, congelado como forma del seed, no como
rendimiento.

## 2026-08-13 — Fase A, pasos 1-2: objetivos como configuración y contexto por conversación
Migración 020 (objetivos en `configuracion_automatizaciones`, el log aprende `aplazado` y
`tipo_caso='conversacion'`), defaults aprobados en `lib/automatizacion/objetivos.ts` y
`contextoDeConversacion()` (teléfono → identidad + objetivos abiertos, derivado y sin persistir).
El QA censal (346 hilos) destapó un matiz: «identificar» pasó a exigir que NO exista ninguna fila
—un lead «No interesado» no abre cita, pero sabemos su nombre, y preguntárselo sería absurdo; 167
hilos salían mal clasificados por eso. `npm run qa:contexto` contrasta contra SQL independiente.

## 2026-08-13 — Decisión de producto: objetivo múltiple, con tope de dos
Cuando la precedencia apunta a un objetivo distinto del que trae el mensaje del paciente, el caso
persigue AMBOS: el orden de la conversación lo marca el paciente, el cierre exige cubrir los dos.
Tope: máximo 2 objetivos simultáneos; la precedencia decide cuáles entran. «Caso listo» deja de ser
global y se evalúa POR OBJETIVO — puede quedar uno cerrado y otro abierto, y la ficha de la fase B
lo refleja así, no como un sí/no único.

## 2026-08-13 — Los aplazamientos llevan clave cerrada con naturaleza, y el parser falla a la cara
Migración 021: `clave_aplazado` obligatoria en aplazado/aplazado_resuelto (8 claves salidas del
corpus de evals + `agenda_disponibilidad` del plan §11). La naturaleza (decision | dato_ausente) se
DERIVA del enum en `aplazamientos.ts` — no son el mismo problema: una se corrige configurando el
alcance, la otra conectando una fuente. Pendiente ⇔ existe aplazado posterior al último resuelto de
su clave (sustituye a la resta: el re-aplazamiento tras resolución sale solo). Y `parseObjetivos`
pasa de fallback-con-aviso a LANZAR: el agente nunca persigue objetivos genéricos creyendo la
clínica que son los suyos. `agenda_disponibilidad` NO se dispara por recoger disponibilidad
declarada (eso es un dato del objetivo §2): solo ante huecos concretos sin agenda conectada — es el
único aplazamiento que la clínica elimina sola conectando una fuente (fase D).

## 2026-08-13 — CORRECCIÓN: el tope de 2 objetivos se elimina (deroga la entrada de hoy)
La entrada «objetivo múltiple, con tope de dos» queda derogada: con tope de 2, el tercer objetivo se
caía EN SILENCIO — un cobro vencido descartado sin traza es exactamente lo que el producto existe
para evitar. Lo que se limita es la CONVERSACIÓN, no el caso: un caso puede tener N objetivos
abiertos y todos se resuelven, uno a uno, en el orden que marque el paciente. ACTIVO hay exactamente
uno por turno (el que trae el mensaje; si no apunta a ninguno, el de mayor precedencia). Al cerrar
el activo, el agente recuerda los demás abiertos — tope de 2 recordatorios POR MENSAJE, por
precedencia; el resto queda abierto sin mencionar (cuatro recordatorios en un mensaje es una
factura, no una conversación). Si el paciente no responde, vuelven por seguimiento. «Caso listo» es
POR OBJETIVO: el caso se entrega al cerrar el activo, con los demás visibles en la ficha B como
«abierto, no trabajado» — la coordinadora no puede cerrar creyendo que está todo resuelto.

## 2026-08-13 — Restricción legal del recordatorio: ni tratamiento ni importe (art. 9 RGPD)
Un recordatorio de cobro o presupuesto NO puede nombrar el tratamiento ni el importe asociados a la
persona: dato de salud, art. 9 RGPD. Mensaje neutro + enlace al portal, el criterio que las
plantillas de Meta ya cumplen (PLANTILLAS-WHATSAPP.md §1). NO depende de la asesoría legal — la
prohibición de base no es opinable; la asesoría afinará la frontera del mensaje neutro y si el
enlace exige identificación. El censo del 13-08 encontró que NO está garantizado en código: el
generador de la cola (`cola-envios/generar`, sustitución `{tratamiento}`/`{importe}` y prompts IA) y
`generarMensajeSugerido` nombran tratamiento e importe. Hoy no hay envío real (motor apagado,
generador fuera de los crons), así que no hay exposición viva — pero la regla entra como GUARDA DURA
en código, no configurable por clínica, antes de enganchar nada al envío (paso 5 / fase 3).

## 2026-08-13 — Un solo agente: el genérico es la configuración por defecto, no otro producto
Decidido en firme el modelo de agente y planes. **Un solo agente**: el genérico no es un producto
aparte sino la configuración por defecto del mismo motor — la arquitectura se diseña para
personalizarse, no hay dos motores que mantener. El genérico es un **producto completo**, no una
demo capada: contesta 24/7, recoge datos y ahorra trabajo real; escala por CAPACIDADES QUE DEPENDEN
DE QUE LA CLÍNICA APORTE ALGO SUYO (sus precios, su agenda), no por interruptores. **Básico** =
genérico sin acceso a la pantalla de configuración (si una clínica se configura mal, el agente
responde mal y la culpa es de Fyllio — ese churn no es asumible). **Premium** = la personalización
la hacemos nosotros en el onboarding (entrevista, prompt a medida, ajuste tras las pruebas): se paga
quién lo hace y la integración, no el permiso. **Precio plano sin coste por mensaje, también en
premium** — cobrar por longitud de prompt penaliza a quien mejor configura, el coste de API es
marginal; el coste real es tiempo de onboarding y va en cuota de alta o en el plan. **La puesta a
prueba fuera de producción (fase E) está en TODOS los planes**: se cobra poder configurar, no poder
comprobar — sin ella el básico nunca gana confianza para subir su automatización, que es lo que el
producto necesita que pase. Y el eval del repo mide EL MOTOR con la configuración por defecto, no
la vara de un agente configurado (anotado en el encabezado del corpus). Los niveles de precio y qué
entra en cada plan: sin decidir (MERCADO.md §4).

## 2026-08-13 — R1 anotada: 82 % de acuerdo, y la frontera A/D queda señalada como decisión abierta
Simon reanotó a ciegas los 45 casos con la pregunta 4-aria. Acuerdo con la sellada: 32/39 (82 %)
sobre respuestas únicas; la vara es la anotación de Simon (los 7 desacuerdos van con su etiqueta).
El desacuerdo no está repartido: (1) la frontera A/D en dudas clínicas —sus dobles y los dos D→A
sugieren «D solo cuando la respuesta clínica condiciona la decisión o la seguridad»; la tanda C1
lleva esa familia y su anotación a ciegas ES la decisión—; (2) rechazo/desgaste → R (18, 16, 49):
quiere persona pronto cuando el caso se muere; (3) el caso del IVA → S implica contestar de ley
general — ojo con la estética (no exenta), la solución limpia sigue siendo MEJORAS 89. Análisis
completo en evals/anotaciones-4aria/ANALISIS-R1.md. Fuera puntuables: 4, 25, 46 (?) y 14, 20, 24
(frontera), señalados como los ⊘.

## 2026-08-14 — C1 anotada: 58 % de acuerdo, y los desacuerdos son seis reglas que el plan no tenía
La tanda conversacional destapó lo que la de mensajes sueltos no podía: con el caso delante, Simon
aplica reglas sistemáticas sin escribir — precio sin presupuesto emitido se contesta (no se aplaza);
aplazar es prometer y la promesa transfiere el caso al asesor (insistencia 1ª → rompe); el pago roto
es de persona y el dato que contradice al sistema se aclara dentro; la urgencia temporal rompe gane
quien gane el tema; D es acompañar sin avanzar, no callar; y la firma en el portal entrega el
objetivo aunque queden flecos. Detalle y casos en evals/anotaciones-4aria/ANALISIS-C1.md. Abiertas:
la contradicción del embarazo (R1#9 A vs C13 D) y la redacción de «¿Listo?» para futuras tandas.
Las seis reglas pasan a ser la especificación del evaluador cuando Simon las confirme.

## 2026-08-14 — El modelo de quiebre se sustituye: nada tapona, tres derivaciones, sin vuelta atrás
Los tres tipos del §1 (aplazable / detiene / rompe) quedan sustituidos. El agente SIEMPRE anota y
sigue — no existe el estado mudo: en espera acompaña, calma y orienta, solo deja de empujar al
cierre. Derivan a persona únicamente: INSISTENCIA (2 toques sobre el mismo tema, no 1; configurable
con tope) → cola normal; URGENCIA MÉDICA → derivación inmediata, cola prioritaria; CASO COMPLETO →
cola normal. La derivación NO se revierte: el caso pasa a ser de la persona aunque el paciente
cambie de tema (dos voces con el mismo paciente, jamás); se acepta que derivar por insistencia
arrastre los demás objetivos abiertos. Regla dura no configurable: ante urgencia médica el agente
NUNCA orienta clínicamente — deriva y dice que alguien contacta ya; lo configurable (fase D) es qué
cuenta como urgencia, si se atienden, y el texto LITERAL (escrito y asumido por la clínica, jamás
generado) si no se atienden. Y entra la primera métrica del §10: tiempo de entrega → primera
respuesta humana, por cola — la única que detecta que el producto empeore la situación.

## 2026-08-14 — Confirmadas las reglas de la C1 (con la contradicción del embarazo resuelta)
De ANALISIS-C1.md, confirmadas por Simon: precio sin presupuesto emitido SE CONTESTA («depende de tu
caso, te hacemos una valoración») — precio_descuento solo aplaza con presupuesto emitido que el
paciente quiere mover · aplazar es prometer y la promesa transfiere (con caso listo o promesa
pendiente, la siguiente pregunta es del asesor) · renegociar un pago es de persona, y un dato que
CONTRADICE al sistema no se confirma en automático — lo aclara la coordinadora (falta de dato ≠
contradicción) · el agente en espera acompaña, no se calla · el portal cierra el objetivo (la firma
formal supersede los campos pendientes) · embarazo: gana la lectura conversacional — acompañar sin
empujar al cierre (resuelve R1#9 vs C13).

## 2026-08-14 — Cuatro disparadores, no tres: petición o queja es disparador propio
Corrección sobre la entrada de hoy: estirar «insistencia» para cubrir la queja al primer toque
enturbiaba el prompt y la anotación. Disparadores definitivos: PETICIÓN O QUEJA (primer toque;
queja ≠ insatisfacción — «me parece caro» se trabaja, «esto es un desastre» deriva; cola prioritaria
solo si hay malestar) · INSISTENCIA (2 toques, configurable) · URGENCIA MÉDICA (inmediata,
prioritaria) · CASO COMPLETO (incluye el rechazo con su motivo). Con esta lectura los 19 casos R de
R1+C1 caben sin reanotar. Migración 022: evento `derivado` + `causa_derivacion` + `malestar` (se
guarda el HECHO; la cola se DERIVA — prioritaria ⇔ urgencia ∨ (petición_queja ∧ malestar), doctrina
de guardar la medida y no la categoría) · `devuelto_al_agente` retirado del vocabulario con la tabla
vacía (la derivación no se revierte; «en manos humanas» = EXISTS desde el último cierre) ·
`duda_clinica` entra al catálogo (9/69 casos; ninguna configuración la elimina — al barrido de la
fase D como límite, no como upgrade). El fleco de la conversación huérfana sin cierre queda para B.

## 2026-08-14 — Evaluador construido y primera pasada cruda: 78 % (49/63), y los fallos son 3 problemas distintos
Paso 3 de la fase A: lib/agente/evaluador.ts (el modelo juzga el texto, el código decide y cuenta;
hilo truncado por presupuesto priorizando entrantes; urgencia con respuesta de código, regla dura) +
harness qa:evals-evaluador contra R1+C1 con mapeo declarado. Primera pasada SIN ajustar: 78 %
global, 0 fallbacks. Los 14 fallos se parten en: (a) ~6 errores genuinos del modelo (pide-persona
sutil, tono pasivo, anotaciones que se le escapan, extracción de no_aplica); (b) ~8 CONFLICTOS
vara-vs-modelo-dictado que no se arreglan con prompt — la vara R1/C1 se anotó ANTES de la corrección
de los 4 disparadores (rechazo→R vs caso_completo; insistencia 1ª→R vs umbral 2; pago roto; urgencia
temporal del Sintrom; el IVA); (c) 2 artefactos del mapeo de ¿Listo? sin objetivo abierto. Coste
MEDIDO: 2.143 tok entrada / 208 salida por turno → $0,0032/turno, ~$0,0095 por conversación de 3
turnos (Haiku 4.5). Nada se ajusta hasta resolver (b) con Simon: ajustar contra una vara en
conflicto consigo misma es optimizar a ciegas con extra pasos.

## 2026-08-14 — Segunda pasada del evaluador: 92 % (58/63) tras remapeo e iteración
Vara remapeada según las 5 decisiones de Simon (rechazo→caso_completo; 1ª insistencia→umbral 2,
comprobado que los casos NO estaban derivados; «no puedo pagar»→caso_completo+plan_pago; IVA→se
aplaza hasta incluye_iva; Sintrom→gana su letra). Migración 023: causa `antecedente_medico` — el
modelo solo detecta la MENCIÓN (nunca valora gravedad), código cuenta la cita próxima (default 7
días de clínica, configurable en fase D); sin cita, se anota duda_clinica con red de seguridad
determinista. Prompt v2 contra el bloque (a): persona concreta, tono seco tras contratiempo,
plan_pago en «no estoy para gastos», reglas de no_aplica, y regla dura clínica explícita (nada de
afirmar dolor/resultado/seguridad aunque sea cierto en general). C1 entera al 24/24. Quedan 5
fallos de decisión: 4 genuinos del modelo (33, 35, 49, y una REGRESIÓN en el 6 que además roza la
regla dura) + el 16, que es la inconsistencia 3-vs-16 de la propia vara (retest pendiente). ¿Listo?
19/21 — la extracción de no_aplica (C2, C7) es el candidato a subir de modelo. Coste medido v2:
2.782/242 tok por turno → $0,004/turno.

## 2026-08-14 — Tercera pasada (Sonnet 5, mismo prompt): 89 % — pierde contra Haiku (92 %) y cuesta 5,5×
Comparación limpia sobre la misma vara: Sonnet arregla 2 de los 3 fallos duros (el 6 y el 33, con
borradores más limpios — el C22 deja de afirmar hechos clínicos) pero NO el 49 (desgaste, falla en
ambos → techo de la tarea, no del modelo), mantiene el 16 (conflicto 3-vs-16 de la vara) y el C2
(no_aplica falla en ambos → problema de prompt/tarea), e introduce SU familia de fallos: sobre-anota
en preguntas simples (5, 43, C5, C20 → S→A). Además 2 timeouts a 20 s (thinking) y $0,0219/turno
(5,5× Haiku; ~$66/mes por 1.000 conversaciones vs $12). Decisión técnica recomendada: producción en
Haiku; la fiabilidad clínica no se le pide al modelo sino a la guarda en código (diagnóstico aparte).

## 2026-08-14 — La guarda de reglas duras (juez de borradores) queda en código, con su propia vara
Opción A implementada: todo borrador del generador pasa por un juez independiente (Haiku, prompt
estrecho de detección, dos preguntas en una llamada: clínica + económica). Si infringe o el juez no
responde → FAIL-CLOSED: plantilla neutra + traza (motivo y frase exacta en `borradorDescartado` —
la tasa de descartes es el termómetro del generador; si sube, el prompt se degradó). Vara propia del
juez (qa:juez): 19 casos con las dos direcciones medidas POR SEPARADO — 0 falsos negativos sobre 9
infractores que no se parecen a C22, y 0 falsos positivos sobre 10 limpios que sí se le parecen
(el error que mata la conversación sin que ninguna métrica lo enseñe). En la vara grande el juez
cazó EN VIVO infracciones que el prompt dejó pasar: financiación inventada (C6) y el «puedes esperar
sin problema» de la regresión del 6. Estado de la vara grande con la guarda puesta: 90-92 % en tres
corridas (varianza ±2 puntos, run a run cambian 1-2 casos frontera); coste con juez incluido:
$0,0048/turno (~$14/mes por 1.000 conversaciones). Producción: Haiku, confirmado.

## 2026-08-14 — Retest 3-vs-16: los dos aplazan, y la regla que sale de ahí
Simon reanotó la pareja (objeción de precio con un tercero de por medio): AMBOS son A. El 16 pasa de
R a A en el harness, marcado como retest y no anotación original. La regla, en firme: UNA OBJECIÓN
DE PRECIO NO DERIVA POR QUIÉN LA TRAE NI POR CÓMO ESTÉ FORMULADA — deriva por insistencia (2 toques)
o por caso completo, como todo lo demás. El desgaste del caso (días transcurridos, toques previos)
es una dimensión DISTINTA y hoy no dispara nada; si algún día debe hacerlo, será una regla explícita
de seguimiento contada del log, no un juicio del modelo sobre el tono. Confirmado en corrida real:
la vara sube el caso previsto (95 % en esa corrida; banda honesta 90-95 %). Nota: bajo esta regla,
el 49 («opiniones de todo» → R por desgaste) merece revisión en un próximo retest.

## 2026-08-14 — Paso 4: la persistencia del turno, con idempotencia estructural
Migración 024: evento `evaluacion` (payload `evaluacion_json` con LOS JUICIOS del modelo: tema,
petición/queja, malestar, urgencia, antecedente, campos recogidos, hiloTruncado, borradorDescartado
y el borrador — aprobado para la vista de supervisión de la fase C) + `mensaje_id` con índice único
parcial: una DOBLE ENTREGA no puede sumar dos aplazados de la misma clave, probado como prueba
nominal en qa:turno (el contador de insistencia decide derivaciones; el dedup deja de vivir solo en
el KV de 24 h). Nada derivable se persiste: listo, cola, en-manos y activo se calculan al leer. La
proyección compat sobre `presupuestos` queda anotada como copia con fecha de muerte (MEJORAS 93: se
retira en fase B). Fallback = sin eventos (no hubo juicio), solo la vía compat. QA completo en verde
al primer intento: roundtrip del payload, doble entrega, contador que sí crece con mensaje nuevo,
compat restaurable, fallback limpio.

## 2026-08-14 — Paso 5: el evaluador entra al webhook, por clínica y apagado por defecto
Migración 025 (`evaluador_activo`, default false, fail-closed en cada eslabón: sin fila o fallo →
flujo viejo byte a byte). Con el interruptor encendido, TODO entrante de la clínica se evalúa —
presupuestos, leads y huérfanos: aquí muere el recorte del 6 de agosto. El registro manda: el
mensaje se persiste síncrono antes del 200 (como siempre) y la evaluación corre en after(); un fallo
pierde un turno de juicio que el siguiente entrante re-deriva del hilo entero. Push SOLO cola
prioritaria (criterio anotado en el PLAN §3: el push es para lo que no puede esperar). Fixture de
huérfanos en el seed (2 hilos) y qa:contexto exige las 4 ramas con datos reales. El clasificador
viejo queda como rama OFF = segunda copia con fecha de muerte (MEJORAS 94).

## 2026-08-14 — El fixture de huérfanos destapó que demo:reset llevaba TRES DÍAS roto
Dos fallos latentes, ninguno del fixture: (1) los mensajes de VOLUMEN nunca pusieron `autor` a sus
salientes — la invariante de autoría (b005c80, 11-08) reventaba el seed entero, y nadie había
corrido demo:reset desde entonces; (2) el reparto ponderado de presentados (40 % al mes en curso,
entero en los días 1..hoy) contradecía matemáticamente su propia invariante del tramo (ratio 40/d:
solo pasaba a final de mes). Arreglos: autoría en el volumen, y el peso del mes en curso escalado
por días transcurridos (ratio 1,33 constante, corras el día que corras). Aviso: el salto quedó en
×2,0 justo en el tope — si vuelve a saltar otro día, lo siguiente es repartir también el volumen.
La lección es la §13 de siempre, esta vez dentro del propio seed.

## 2026-08-17 — Herramienta `demo:entrante`: ver el agente sin pedir un informe
Simular un entrante en la DEMO era imposible (el webhook exige firma de Meta y solo mapea el número
de RB — la DEMO es inalcanzable por diseño). `npm run demo:entrante` hace la MISMA secuencia que el
webhook con el interruptor encendido (registrar mensaje + evaluar) y cuenta el resultado en frases;
interruptores por clínica incluidos. Documentado en `DEMO-ENTRANTE.md`. El criterio: el fundador
comprueba el agente por sí mismo — la herramienta lee el LOG persistido, no variables en memoria.

## 2026-08-17 — Trampa del pooler: `set_config` de sesión + RLS = lecturas vacías en silencio
La primera versión de `demo-entrante` leía el log recién escrito, volvía vacío, y pintaba un «el
evaluador no pudo evaluar» FALSO con la evaluación bien persistida. Causa: `SUPABASE_DB_URL_APP` va
por el pooler en modo transacción (6543); un `set_config('app.cliente',...,false)` de sesión no
sobrevive entre queries y RLS filtra todo sin error. Regla: consulta directa ⇒ su transacción con
`set_config(..., true)`. Dos QA llevan el patrón frágil y pasan por suerte (MEJORAS 95).

## 2026-08-17 — El EXISTS eterno casi enmudece el producto: nace el semáforo de contacto (026)
Carlos salía «este hilo ya es de una persona» tras un reset limpio. El diagnóstico encontró DOS
cosas: el derivado era residuo de una prueba (demo:reset no podía borrar el log — arreglado, wipe
vía admin y aborta sin la URL), y el diseño real: la no-reversión era un EXISTS sin cierre — cada
derivación mataba su hilo para siempre. La regla nueva (dictada): **el agente calla mientras exista
un asunto derivado sin resolver, y «resuelto» es un HECHO DEL SISTEMA** (cita creada, cobro,
presupuesto cerrado — por eso el derivado persiste ahora su objetivo) **o el botón «resuelto»** —
uno solo para todas las causas. Sin hecho observable (queja, insistencia) → solo manual, sin
inventar. Se descartó «vuelve cuando una persona responde» (se metería encima de la coordinadora) y
la caducidad por tiempo (tapa el fallo); la presión es el censo de rojos con edad (`npm run
semaforo`). UN SOLO SEMÁFORO lo miran evaluador, cola de envíos y motor de reglas — hasta la 026,
NINGUNO miraba nada: la cadencia proponía toques con la coordinadora negociando. Recordatorios de
cita exentos (compromiso del paciente, no contacto comercial). Y la espera «sin contacto hasta
[fecha]»: la fija el agente con fecha concreta del paciente (tope 14 días — un paciente que pide
tiempo habla de días) o una persona sin tope; suspende también las cadencias; al vencer solo se
levanta la pausa.

## 2026-08-17 — MEJORAS 95 resuelta el día que mordió
El patrón frágil del pooler (set_config de sesión + RLS) anotado por la mañana falló horas después en
qa:entrante: «el huérfano no existe» con el huérfano en la base, y un toggle que actualizaba cero
filas en silencio. qa:entrante y qa:turno llevan ahora el mismo patrón que qa-contexto y
demo-entrante: cada consulta directa en su transacción con set_config LOCAL. Regla desde hoy:
ningún script habla con la base de la app fuera de una transacción con su contexto dentro.

## 2026-08-17 — El reloj se inyecta y la cadencia sale de la ruta (fase B, paso previo)
`hoy` enhebrado por el semáforo, el orquestador y la generación de cola (§14): sin reloj
inyectable, «pasan 7 días» y «vence la espera» no eran medibles — medio producto sin vara. Y la
cadencia extraída de la ruta con sesión a `lib/presupuestos/generar-cola` (`generarColaDelDia`):
NO es un efecto colateral, es el paso previo del punto 6 de la lista de fase B — la generación no
tenía ningún caller (ni pantalla ni cron; EnviosView quedó en un worktree sin mergear) y dentro
del withAuth era inalcanzable para un cron o un QA. La tesis central del producto sigue sin correr
sola: falta el cron que la llame y la pantalla que despache lo generado.

## 2026-08-17 — La vara de FLUJOS: qa:recorridos, y la primera pasada dio los rojos prometidos
Seis recorridos completos como datos (lead→entrega · presupuesto→acepta · paciente-pide-cita ·
urgencia→vuelta · espera fijada→movida→levantada · varios-asuntos con art. 9), corriendo el bucle
REAL con mini-mundos propios y aserciones de RESULTADO (derivaciones/cola/push/semáforo/campos/
textos prohibidos), nunca de texto. Primera pasada: **1/6 en verde, exactamente lo que el
diagnóstico predijo** — R4 (urgencia) verde; los otros cinco rojos por las causas diagnosticadas
(0 entregas). Regalos de la pasada: R6 cazó la violación art. 9 real (el borrador nombró «600», el
importe del cobro) y R5 demostró que la espera ya «se mueve» (la nueva fecha supersede) — falta la
levantada. La vara vieja sigue como regresión; los fixes de la lista van uno a uno volviendo verde
su recorrido.

## 2026-08-17 — Fase B, puntos 1+2 + art. 9: cuatro recorridos volteados sin romper el embudo
El ciclo de vida del paciente existente: «cita» deja de ser solo de leads — abierta para
cualquier PACIENTE sin cita futura registrada (contexto, con su invariante en qa:contexto), y los
campos que el sistema ya sabe no se piden (nombre_completo de un paciente fichado no cuenta como
faltante). La red del punto 2: juicio `pideAccion` del modelo + condición en código — petición
accionable sin objetivo que la recoja → deriva caso_completo igualmente. Y el ART. 9 como TERCERA
REGLA DURA del juez (adelantado por orden del 17-08: es la única ilegal): tratamiento o cifra que
el último mensaje no pide → descarte; el juez recibe ahora ese último mensaje; su vara sube a
24/24 (FN=0, FP=0) con el caso real de R6 («600 €» en un recordatorio) como infractor I10.
Plantilla neutra reescrita (era solo-para-duda-clínica y usaba el teléfono como nombre).
Resultado medido con LAS DOS varas: recorridos 1/6 → **5/6** (solo R5-espera pendiente, punto 5);
vara vieja **95 % (60/63), banda intacta** — arreglar la entrada del paciente NO rompió la
captación — y ¿Listo? SUBIÓ a 20/21.

## 2026-08-17 — Dos trampas de determinismo cazadas por los recorridos
(1) El evaluador y el juez llamaban al modelo SIN temperatura: juicios muestreados — la extracción
salía distinta entre corridas idénticas. Ahora temperature 0: un juicio no se muestrea. (2) En
greedy, Haiku COPIABA el ejemplo del prompt («"camposRecogidos": {}») — el esquema de respuesta
enseña ahora FORMA con huecos, nunca valores vacíos que calcar. Y la tercera, la peor: el render
enseña objetivos en MAYÚSCULAS («· CITA —»), el modelo devolvía la clave "CITA" y el parser la
DESCARTABA EN SILENCIO por case exacto — camposRecogidos vacío durante días sin un solo aviso
(§12: el fallback mudo). Normalizado + warning. Las tres las destapó la vara de flujos en una
tarde; la de mensajes no podía verlas porque fija sus propias entradas.

## 2026-08-17 — Fase B punto 5: la espera con las cuatro reglas — recorridos 6/6, vara vieja 97 %
Las reglas dictadas, tal cual: (1) responder AL MOTIVO (dar la decisión) → `espera_levantada` — el
modelo juzga «¿resuelve aquello?» con el motivo de la espera delante (el semáforo se lo pasa al
evaluador); (2) fecha nueva → la espera SE MUEVE (espera_fijada nueva con los mismos candados);
(3) otra cosa → la espera aguanta y el agente responde igual; (4) el turno DERIVA → se levanta en
CÓDIGO, explícito en cada retorno de derivación — manda la persona, no una pausa. R5 verde con el
ciclo entero (fijada viernes → movida mañana → levantada al aceptar → entrega, cadencia callada
entre medias): **recorridos 6/6**. Vara vieja **97 % (61/63)**, su mejor registro — solo 35 y 49,
el techo conocido. Nota operativa: correr las dos varas EN PARALELO comparte rate limit y tumba al
evaluador a fallback — el harness de evals se negó a reportar («36/69 en fallback: no fiable»),
que es §9 funcionando; las varas se corren en serie.

## 2026-08-17 — Del barrido de fallos silenciosos: tres arreglos directos (el opt-out era RGPD)
(1) `getOptoutPaciente` era FAIL-OPEN: consulta fallida = «no pidió baja» = se envía. Ahora
bloquea con motivo propio (`optout_no_comprobable`) — enviar a quien pidió baja no es un bug de
calidad, es ilegal; cierra el follow-up nº 10. (2) La traza del juez ya no miente: categoría
ilegible en un veredicto que infringe → `sin_categoria` con warn, nunca archivada como «clinica»
(contaminaba la métrica que detecta un generador degradado). (3) El filter de aplazamientos AVISA
lo que descarta: un aplazamiento tragado era una duda del paciente que no llegaba al asesor.
El clasificador viejo queda FUERA a propósito (fecha de muerte, MEJORAS 94): invertir en él es
tirar trabajo. El corte de raíz del patrón mayúsculas (normalización en el borde) va con
diagnóstico aparte antes de ejecutarse.

## 2026-08-17 — El corte de raíz: la etiqueta del modelo muere en el borde (mandamiento 19)
La instancia no se arregla: se corta la clase. `etiquetas.ts` → `etiquetaDelModelo` canoniza (trim,
minúsculas, sin acentos) contra el vocabulario UNA vez, en el parse (`parsearJuicio`, puro y
exportado); aguas abajo solo circulan uniones canónicas — comparar sin normalizar es imposible por
construcción, y el A-1 del barrido (`juicio.tema`, el bug de «CITA» vivo 90 líneas más arriba del
fix) desaparece en vez de arreglarse. Lo descartado se CUENTA, no solo se avisa (orden del 17-08:
nadie mira consola): viaja en `etiquetasDescartadas` del payload persistido y sale como número en
el harness de evals — hoy: 0 en 69 turnos. `qa:parseo` es la vara determinista del borde (sin
modelo, coste 0): mayúsculas, acentos, claves inventadas, fences. Mandamiento 19 en el skill con su
checklist. Y un fleco medido de camino: el recuerdo genérico del cobro pasó de prompt a CÓDIGO
(oscilaba entre volcarlo con cifra —el juez lo mataba— y omitirlo; como la respuesta de urgencia).
Varas: recorridos 6/6 · vara vieja 95 % en banda · juez 24/24 · qa:parseo 16/16.

## 2026-08-17 — Fase B punto 3: la cuarta regla dura — no prometer sin entregar
El juez recibe «ESTE TURNO ENTREGA: sí/no» (código: deriva ∨ anota; fijar una espera NO es entrega
— nadie llama el jueves) y descarta promesas de TERCEROS sin entrega. La frontera se calibró con
los FP de la primera pasada, por QUIÉN hace la acción: pedir a la persona no es prometer; invitar a
valoración es el trabajo; lo que el agente hace en el chat es suyo; solo infringe el compromiso de
que un tercero inicie acción. La plantilla neutra dejó de prometer («te lo confirma el equipo» era
una promesa) y el recuerdo del cobro en código se añade también sobre descartes. Vara del juez
**31/31** (incluye «voy a coordinar» del recorrido como I12 y la MISMA frase limpia con entrega
como L14) · recorridos 6/6 · evals 94 % en banda · descartes 13 % — tasa vigilada: el generador
aún promete en turnos sigue y el juez lo suprime.

## 2026-08-17 — Fase B, B1: la ficha del caso — una fuente, todo derivado, honesta sin evaluación
`fichaDeCaso(telefono)` en lib + `GET /api/agente/ficha` (aislamiento = el mismo criterio que la
bandeja: sesión manda, fail-closed, hilo sin clínica solo para rol de red). Todo derivado al leer:
espera del semáforo (con la frase que la fijó), intentos contados de mensajes, «qué quiere»
COMPUESTO POR CÓDIGO desde los campos recogidos (nunca un resumen generado), pendientes por la
regla del posterior con la frase del paciente, y el cierre por el PACIENTE derivado de la firma del
portal en el historial (`portal_aceptado/rechazado`) — distinguible de la entrega del agente sin
migración. Caso a: sin evaluación, `evaluado:false` y quéQuiere null — ni blanco ni fingido.
`qa:ficha` DETERMINISTA (fixtures a mano, cero modelo — regla de costes del 17-08): 17/17.
Recorridos ganan la aserción de ficha en los 6 flujos + la MÉTRICA VIGILADA en cada pasada
(descartes del juez: 2/11 turnos, promesa=1 · datos_sensibles=1). B5 queda PREPARADO y PARADO:
encender el evaluador es decisión de producto de Simon, no un refactor — si el clasificador viejo
sigue vivo al llegar a B4, no es deuda, es que la decisión no está tomada.

## 2026-08-17 — Fase B, B2: la ficha en pantalla — un componente, dos sitios, cero resúmenes dobles
`FichaCasoPanel` (el componente ÚNICO, 5 bloques en el orden dictado, tokens y lucide) montado en
DOS sitios: Seguimiento estrena «Casos del agente» — una línea por caso entregado (paciente · qué
quiere · cuánto lleva), los viejos primero, despliegue a la ficha — y en Mensajería la ficha
SUSTITUYE al resumen viejo del clasificador y a las tarjetas de datos (la columna no puede tener
dos resúmenes); Contacto se queda arriba (identidad, no resumen) y «Ver ficha completa» como
salida al detalle. Deep-link `?telefono=` en /mensajeria para el «Ver la conversación» de la
ficha. El harness imprime ahora cada descarte CON flujo, turno y frase — y la primera pasada
detallada destapó que los 2 descartes eran FALSOS POSITIVOS DEL JUEZ (mató el recordatorio
genérico permitido en R6 y una pregunta de recogida en R2): el generador ya obedece; el que roza
es el juez. Pendiente de OK para medir el ajuste (vara del juez). Recorridos 6/6 con aserción de
ficha; iteración entera con QA determinista (regla de costes).

## 2026-08-17 — Fase B, P1: la cola de Seguimiento — CUATRO cohortes que no crecen
Corrección de fondo dictada: las cohortes son las cuatro del §3 (Necesita respuesta · Listos para
cerrar · Pendientes de resolver · Sin actividad) y TODO lo demás es filtro — cada cohorte vieja cae
en una de las cuatro o se vuelve detalle, ninguna sobrevive como categoría. `lib/seguimiento/cola`:
`cohorteDeCaso` PURA (guardas en el orden del §3 + residual + `never` de totalidad) y
`colaDeSeguimiento` fusionando tres orígenes (presupuestos > leads por teléfono, + casos de
conversación del agente) con el clasificador viejo vía su función REAL (no réplica). Decisiones
dictadas dentro: paciente-escribió → Necesita respuesta; nuevos y CITADOS → Sin actividad —
citados CON CONDICIÓN ANOTADA: se quedan hasta que exista la pantalla que recoja
confirmar/recordar; «Casos del agente» desaparece como sección (entregado caso_completo → Listos;
resto de causas → Necesita respuesta). Cabecera de dinero PARADO solo con hechos: € de presupuestos
abiertos, leads CONTADOS (no llevan importe en datos — valorarlos sería inventar), caso más viejo.
`qa:cola` 23/23 determinista (partición, precedencias, censo contra SQL, fixtures del log). La lib
vieja sigue intacta para LeadsView/Intervención//red hasta P4. UNA interpretación mía señalada: el
dictado «en conversación → Necesita respuesta» se aplicó por su RAZÓN (paciente esperando = trabajo)
— en_espera_paciente (esperamos nosotros) va a Sin actividad, no a Necesita.

## 2026-08-18 — Las cohortes son TRES, y B6 pasa delante
Corrección dictada sobre P1: **Necesita respuesta · Listos para cerrar · Fuera de plazo.** La regla
de entrada: solo entra lo que exige que una PERSONA haga algo — lo demás es filtro, Mensajería o
consulta (Tablas). «Pendientes de resolver» se elimina (agente trabajando = supervisión, vive en
Mensajería > En curso); «Sin actividad» se convierte en **Fuera de plazo**: con agente y cadencias
nadie se enfría solo, llegar ahí es fallo del equipo. Umbral = compromiso de servicio de la clínica,
por tipo, configurable en la pantalla del agente (fase D); defaults en código: urgencia 30 min ·
respuesta 2 h · cierre 4 h · lead nuevo 1 h — y el reloj SOLO corre en horario de clínica (de
noche, la cohorte se llenaría y dejaría de significar nada). Los defaults primeros que propuse
(1-2 días) medían mal: el estándar es la clínica con recepcionista que contesta el mismo día, y el
número acaba en la venta. Citados: ni cohorte ni filtro — su pendiente es el recordatorio
automático y las dudas entran por la puerta normal; «¿quién viene?» es la agenda (MEJORAS 97).
Agotados y nuevos-sin-conversación → Necesita respuesta con detalle (agotado-como-juicio: MEJORAS
96; formularios → MERCADO). Y el ORDEN cambia: **B6 (cola única de envíos, cron + pantalla) va
antes que el delta de P1 y que la vista** — sin cadencia corriendo, sacar casos de la cola los
deja enfriándose invisibles. B6 es UNA cola para todo tipo de mensaje propuesto (presupuestos,
recordatorios de cita, reactivaciones; no-shows como integración futura, MEJORAS 98).

## 2026-08-18 — B6.2: los tres agujeros del generador de la cola, cerrados antes de enchufar el cron
El diagnóstico de B6 destapó que `generarColaDelDia` (a) filtraba plantillas por un vocabulario
nominal que casi ninguna fila tiene tras la 017 → casi todo caía a redacción con Haiku SIN juez;
(b) sustituía llave SIMPLE `{nombre}` cuando la 017 migró todo a `{{nombre}}` → al paciente le
habría llegado «Hola {Ana}»; y (c) no miraba ni opt-out ni horario (solo semáforo). Cerrado con la
decisión dictada (opción b): la redacción con IA se RETIRA — sin plantilla no se genera y se cuenta
(`sinPlantilla` por tipo, `llavesSinResolver` por plantilla), porque un mensaje que sale sin que
nadie lo mire tiene que ser plantilla revisada — y fuera de la ventana de 24 h Meta solo permite
plantillas aprobadas, así que el texto libre ni era enviable. Correspondencia de tipos declarada
(§16), sustitución de dobles llaves donde NINGUNA llave superviviente pasa como buena, y opt-out
RGPD fail-closed ANTES de que la fila exista (`bloqueadosOptout` contado). `qa:generar-cola`
20/20 determinista (helpers puros + fixtures reales con opt-out). Ninguno de los tres agujeros
mordía aún porque nada llamaba al generador — el orden B6.2→B6.3 existe para eso.

## 2026-08-18 — B6.1: la cola de envíos se hace única (origen + cita_id, 027) y las citas entran
`cola_envios` gana `origen` (seguimiento_presupuesto · recordatorio_cita · reactivacion — el filtro
por tipo de la pantalla; no-shows entrarán como origen nuevo, MEJORAS 98), `cita_id`/`lead_id`, y
el estado `Caducado` (la cola es del día; Cancelado queda para la decisión de persona). Segundo
generador: `lib/envios/recordatorios-cita` — citas de mañana (Pendiente/Confirmada) → fila de la
cola con plantilla de categoría `cita_recordatorio` (nueva en el seed), EXENTO del semáforo
(PLAN §3: la cita es compromiso, no contacto comercial) pero CON opt-out RGPD fail-closed, dedupe
una-cita-un-recordatorio-por-día, y `sustituirLlaves` compartido en lib/plantillas con el contrato
«ninguna llave sobrevive». Sustituye al canal muerto de Twilio del cron daily como camino de los
recordatorios. `qa:generar-cola` ampliado a 27 checks (fila real, dedupe en reejecución, opt-out
con cita). El envío sigue siendo modo A: una persona, uno a uno.

## 2026-08-18 — B6.4: la pantalla de la cola única (/envios) — uno a uno, estados honestos, caducados a la vista
Nueva sección /envios (enlazada desde Seguimiento: lo que va a SALIR frente a lo que toca hacer),
servida por `lib/envios/vista-envios` — todo resuelto en servidor, scope por IDs de clínica
fail-closed (la clínica de cada fila se resuelve por su origen: presupuesto o cita; sin clínica
resoluble, solo admin la ve). Cuatro bloques: por enviar HOY con el texto completo a la vista y
envío UNO A UNO (dictado: la coordinadora firma lo que sale — el PATCH registra con
autor='cadencia' y abre WhatsApp con el texto puesto; sin botón de enviar-todo); citas próximas
48 h con recordatorio enviado y sin respuesta (comparación de teléfonos por dígitos); procesado
hoy con estado HONESTO (nada de entregado/leído sin statuses del webhook); y caducados de 7 días
VISIBLES («se propusieron y nadie los envió» — la medida del equipo). Aviso ámbar de huecos sin
plantilla (opción b). De paso se cerró un IDOR: el PATCH no verificaba nada para filas sin
presupuesto — ahora las filas de cita verifican la clínica de su cita. B6 COMPLETO: generación
saneada (B6.2), cola por tipos (B6.1), día con caducidad en el cron (B6.3), pantalla (B6.4).

## 2026-08-18 — Delta P1: las TRES cohortes en la lib, y la cabecera deja de inventar un plan
`cohorteDeCaso` pasa a devolver una de TRES (Necesita respuesta · Listos para cerrar · Fuera de
plazo) **o null** — null = no exige persona: aplazados sin entrega (Mensajería > En curso), citados
(Envíos/agenda — cayó la condición anotada del 17-08), esperando al paciente y rezagados (Tablas/
cadencia), y presupuesto sin hilo (su primer toque es de la cola de Envíos; el LEAD sin hilo sí
entra: no hay cadencia de leads). Agotado sube a Necesita respuesta (toca llamar). FUERA DE PLAZO
es escalada, no estado: umbral por obligación en minutos LABORABLES (urgencia 30 · respuesta 120 ·
cierre 240 · lead nuevo 60 — dictados; llamada 240 default nuestro), reloj puro inyectable
(`tiempo-laborable.ts`, no corre de noche ni en finde) y el detalle se conserva al escalar. La
cabecera de Seguimiento (`CabeceraCola` + /api/seguimiento/resumen) sustituye al «13% del plan de
hoy» — métrica inventada, nadie fijó un plan — por hechos: dinero parado EN LA COLA, desglose por
cohorte, leads contados y el caso más viejo. En el seed: 33 casos en cola (todos fuera de plazo —
el seed simula un equipo que no atiende) y 18 presupuestos abiertos legítimamente fuera. `qa:cola`
reescrito: 29 checks (reloj laborable en días de riesgo, partición, escalada con reloj fijado,
fixtures del log — el aplazado sin entrega ahora SALE de la cola y se afirma).

## 2026-08-18 — P2: Seguimiento ES la cola de tres cohortes (y murió la pantalla de pestañas)
/seguimiento reescrito: las cohortes son la división principal (plegadas, la primera con contenido
abierta, las demás con su número), card compacta recuperada (tags · importe · teléfono · edad
laborable) como gatillo, y despliegue EN EL SITIO con la ficha (FichaCasoPanel) + CHAT EMBEBIDO en
escritorio (hilo real + envío por el mismo camino manual de Mensajería: registrar + wa.me) y botón
a la conversación en móvil. Leads/Presupuestos pasó a filtro; «Casos del agente» desapareció como
sección (los entregados SON la cola); las pestañas viejas con sus paneles murieron de esta pantalla
— los cierres de presupuesto siguen en /presupuestos hasta B3+. Nuevas rutas /api/seguimiento/cola
(scope + remapeo negocio→central para que el selector de clínica case) y de paso se arregló un
fallo MÍO de ayer en /api/seguimiento/resumen: scopeaba con IDs CENTRALES contra datos de NEGOCIO
— a una coordinadora le habría dado la cabecera a cero. Pendiente anotado: P4 remapea los
deep-links de /red (?vista=&cohorte= apuntan al vocabulario viejo) e IntervencionView queda sin
caller. El cierre de llamadas desde la ficha: diagnóstico en MEJORAS 102 (registrar existe pero la
cola lo ignora; el diseño «no contesta→espera corta / hablé→flujos existentes» espera OK).

## 2026-08-21 — MEJORAS 102 ejecutada: la llamada se registra Y la cola se entera
Con las dos decisiones dictadas: «no contesta» → contacto registrado (contactos_presupuesto con
ContactCount, o acción de lead) + ESPERA de 1 DÍA LABORABLE con la pieza 026 (viernes → lunes,
`proximoDiaLaborable`) — el caso sale de la cola y vuelve solo; «hablé» → solo registro, LA
CONVERSACIÓN MANDA (el estado se mueve por mensajes o por los cierres de siempre — hablar sin
cerrar no es cerrar, y el caso se queda a la vista a propósito). Pieza nueva en la lib pura: la
espera vigente saca de la cola lo que era iniciativa NUESTRA (agotado, lead nuevo) pero NO tapa lo
que provoca el paciente (escribió, quiebre) ni las entregas del agente. Ruta única POST
/api/seguimiento/llamada con IDOR por tipo (presupuesto→verificador Sprint B; lead→clínica del
lead; huérfano→clínica del hilo, sin clínica solo red). UI: bloque «Registrar llamada» (nota +
dos botones) en el despliegue de la card. qa:cola 40 checks, con el end-to-end del fixture.

## 2026-08-21 — P4: /red habla el vocabulario nuevo y muere el código de las pestañas
Las cards de riesgo de /red se remapearon al modelo de tres colas: «Presupuestos sin seguimiento»
(rezagados) enlaza a /ENVÍOS — la insistencia ya no es trabajo de persona, es la cadencia; «Cierres
esperando tu respuesta» y «Leads sin primer contacto» enlazan a /seguimiento?cohorte=
necesita_respuesta (deep-link con el vocabulario NUEVO, validado en la page). El redirect de
/actuar-hoy descarta los parámetros viejos en vez de traducirlos a medias. Borrados
IntervencionView y SeguimientoHeader (muertos desde P2). QUEDA FUERA a propósito: /leads conserva
sus cohortes de pipeline (Citados · Nuevos · …) — es pantalla de CONSULTA, su reorganización es de
la fase F con la tabla de verbos del §8; y las CIFRAS de las cards de /red siguen saliendo de la
lib vieja (cohortes.ts + estado-conversacion), que es coherente mientras el clasificador viejo
viva (94) — remapearlas a colaDeSeguimiento entra cuando B4/B5 decidan qué motor queda.

## 2026-08-21 — B4: muere la proyección compat (MEJORAS 93) — el log ya no tiene copia
`persistirTurno` deja de escribir en columnas de `presupuestos` (requiere_persona, motivo_quiebre,
mensaje_sugerido, urgencia, acción, fase): la condición de la mejora se cumplió — las pantallas de
la fase B leen del log (cola por eventos, ficha por log) y la BANDEJA gana la segunda fuente que le
faltaba: «necesita persona» también por derivado-sin-resolver del log del evaluador, que además
cubre leads y huérfanos (el hueco que la doc del tipo declaraba). El FALLBACK del evaluador ya no
proyecta un quiebre falso «para que lo lea alguien»: en el modelo de tres cohortes, un entrante sin
responder ES Necesita respuesta por construcción — visible sin flag, y el error queda logueado
(§9). Las columnas quedan como salida EXCLUSIVA del clasificador viejo (MEJORAS 94, fecha de
muerte B5): un solo escritor por columna, cero copias. qa:turno reescrito: afirma que un turno que
deriva NO toca el presupuesto y que la derivación vive en el log. Con esto, B4 cerrado — la fase B
completa salvo B5, que es decisión de producto de Simon (encender el evaluador por clínica).

## 2026-08-21 — B3: el borrador de entrada — la presentación de quien retoma, medida
`lib/agente/borrador-entrada`: partir de la FICHA (una sola verdad), redactar la presentación de la
coordinadora al retomar un caso del agente — preséntate, usa lo YA recogido (regla dura: repreguntar
es decir que nadie leyó), avanza lo pendiente — y pasar por EL MISMO JUEZ que los borradores del
agente (turnoEntrega=true: las promesas de la persona son suyas; con el último mensaje real para el
art. 9). SIN evaluación no hay botón (confirmado) — el flag `evaluado` viaja en la cola y la lib lo
re-verifica fail-closed. Si el juez descarta, NO sale plantilla: sale el motivo con su frase (una
plantilla neutra como presentación sería peor que nada). La EDICIÓN SE MIDE: el chat conserva el
original y al enviar registra la distancia (medirYRegistrarEnvio → mensaje_enviado con
distancia_edicion), la misma métrica que la coincidencia agente-humano. Antes, el ajuste del juez
autorizado: los 2 FP de los recorridos (recuerdo genérico del cobro = disponibilidad, no promesa;
pregunta de recogida con acción contingente no promete) + refuerzo del futuro inmediato del propio
agente — vara 33/33, FN 0/13 · FP 0/20, reportados por separado. CON ESTO LA FASE B ESTÁ COMPLETA
salvo B5 (encender el evaluador), que es decisión de producto de Simon.

## 2026-08-21 — El caso ES la conversación: agrupación en la cola, y el evaluador captura de QUÉ presupuesto se habla
Fallo Carlos: dos cards por paciente (una por presupuesto), con la card en 3.400 € y el hilo
hablando del de 300. La cola agrupa ahora por conversación (dígitos): UNA card, cohorte = LA PEOR
de sus miembros (se asume de más), importe del ACTIVO en el título y los demás NOMBRADOS como tag
(«+ otro de 3.400 €») y en la ficha («Se habla del presupuesto de X · También vivo: Y»). El ACTIVO
lo decide LA CONVERSACIÓN con una sola pieza para cola y ficha (`elegirPresupuestoActivo`):
1) el juicio nuevo del evaluador `presupuestoReferido` — el modelo ve los presupuestos con LETRA y
devuelve la del que el último mensaje identifica; el código traduce letra→id (borde canónico),
viaja aditivo en el payload (`presupuestoReferidoId`) y un turno sobre otra cosa NO borra el último
conocido; 2) sin juicio, PROXY DECLARADO (condición dictada: se ve que es proxy — la ficha dice
«elegido por ser el más señalado o reciente; compruébalo en el hilo»): señal del clasificador viejo
> el emitido más reciente. El proxy nace con fecha de muerte: muere solo a medida que el evaluador
evalúe turnos. La cabecera suma TODOS los vivos del caso (importeTotal — misma cifra, menos cards);
los deep-links y acciones usan el id del activo sin tocar rutas; la cola de ENVÍOS sigue por
documento a propósito (la cadencia es del papel; el caso, de la persona). El juicio nuevo es cambio
de prompt del evaluador: su pasada de vara viaja con la próxima autorizada — el modo de fallo es
benigno (ilegible/null → proxy, contable). De paso murió el ÚLTIMO escritor compat superviviente
(la rama de config-ilegible de evaluar-entrante). Y el botón de generar de MENSAJERÍA dejó el
clasificador viejo: usa /api/agente/entrada — una sola pieza con Seguimiento (ficha → juez → sin
repreguntar), para cualquier hilo evaluado, con errores honestos. qa:cola 52 checks.

## 2026-08-21 — Censo de generadores ejecutado: todo texto a paciente pasa por regla dura
Con el OK al censo: BORRADOS los tres huérfanos (`lib/whatsapp/llm.ts` — el bot del scheduler
Twilio; `/api/ai/insights-semana`; `/api/ai/siguiente-accion`) y los dos generadores sin juez que
escribían a pacientes (`/api/presupuestos/ia/mensaje`, `/api/leads/ia/mensaje`): sus paneles
(IntervencionSidePanel, LeadAccionPanel) generan ahora por /api/agente/entrada — la MISMA pieza que
Seguimiento y Mensajería (ficha → juez → sin repreguntar), con errores honestos. Las rutas del
clasificador viejo (`*/intervencion/clasificar`) quedaron sin caller de generación pero NO se tocan:
son territorio 94 y mueren con B5. Plantillas-IA y Copilot se quedan CON CRITERIO escrito
(MEJORAS 103: la revisión humana los salva hoy; si el texto puede salir sin que nadie lo lea,
pasan por el juez). Las llamadas de voz quedan DECLARADAS como censo pendiente (MEJORAS 104). De
propina, el swap destapó MEJORAS 105: el SidePanel lleva desde el 10-08 pidiendo plantillas a una
ruta borrada — 404 mudo. Resultado del censo: HOY ningún texto generado por modelo llega a un
paciente sin pasar por el juez.
