# Diario de decisiones — fyllio-mvp

Registro breve y cronológico de **bugs importantes arreglados, decisiones de arquitectura
y hallazgos de auditoría cerrados**. Cada entrada: fecha · qué pasó · qué se hizo · por qué,
en 2-4 líneas. Se añade al final, en el mismo cambio que cierra el asunto.

Esto es el **historial**. Las reglas generales destiladas de estos errores viven en el skill
[`.claude/skills/fyllio-lecciones-ingenieria`](.claude/skills/fyllio-lecciones-ingenieria/SKILL.md):
aquí se cuenta qué pasó; allí, la ley para que no se repita.

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
