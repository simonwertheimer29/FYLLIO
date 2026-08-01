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
