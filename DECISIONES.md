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
