# Mejoras pendientes de producto

Propuestas detectadas con la lente de auditoría del skill
[`fyllio-esencia-producto`](.claude/skills/fyllio-esencia-producto/SKILL.md). **Ninguna se
ejecuta sin el visto bueno del fundador** — este archivo existe para que no se pierdan.

Formato por entrada: **zona · principio incumplido · mejora propuesta · impacto · fecha.**
Principios: §1 misión (convertir/perder menos/orden) · §2 facilidad · §3 anticipación ·
§4 tecnología con propósito · §5 feedback · §6 coherencia.

Estado: 🔵 propuesta (sin decidir) · ✅ aprobada · 🟢 hecha · ⚪ descartada.

---

## 1. Actuar hoy — la "cola priorizada por IA" ni prioriza ni se ordena
- **Zona:** `app/(authed)/actuar-hoy/ActuarHoyView.tsx:227,354`
- **Principio:** §1 misión + §3 anticipación
- **Problema:** la prioridad de los leads es un heurístico fijo en cliente (no IA), y la
  lista **no se ordena por ese score** — se renderiza como `[...citados, ...sinContactar,
  ...seguimiento]` aunque cada card muestre un pill ALTO/MEDIO/BAJO. La mitad de Presupuestos
  de la misma pantalla sí ordena por `scoreFinal`.
- **Mejora:** ordenar la cola de leads por la prioridad real (y hacer honesta la etiqueta: si
  es heurístico, no venderlo como IA; si se quiere IA, calcularla de verdad).
- **Impacto:** **alto** en conversión/pérdida — la coordinadora ataca en el orden equivocado
  y los casos calientes quedan abajo.
- **Fecha:** 2026-07-15 · 🟢 hecha (tanda pre-demo, rama `pre-demo-actuar-hoy`, pendiente de
  merge a main) — la cola de leads se ordena por prioridad (ALTO→MEDIO→BAJO); desempate por
  hora de cita / antigüedad.

## 2. Actuar hoy — enviar WhatsApp / Llamar desde la card no confirma nada
- **Zona:** `app/(authed)/actuar-hoy/ActuarHoyView.tsx:451`
- **Principio:** §5 feedback + §6 coherencia
- **Problema:** las acciones de la card de leads no emiten toast ni cambian de estado. La
  MISMA acción tiene tres feedbacks distintos en la app: toast en el panel lateral
  (`LeadAccionPanel.tsx:296`), card atenuada en Presupuestos (`IntervencionView.tsx:245`) y
  **nada** aquí.
- **Mejora:** unificar el feedback (toast "Enviado" / card atenuada) en las acciones de la
  card, con la misma convención que el resto.
- **Impacto:** **medio-alto** en facilidad/pérdida — sin confirmación hay dudas de si se
  envió → reenvíos o casos que se dan por hechos sin estarlo.
- **Fecha:** 2026-07-15 · 🟢 hecha y REDISEÑADA (tanda pre-demo, rama `pre-demo-actuar-hoy`).
  El primer intento (fade solo en navegador) tenía un fallo de criterio: no persistía y
  llamaba "completado" a algo que no lo está. Rediseño aprobado por el fundador → estado real
  **"esperando respuesta"** (enviar NO completa; deja la pelota en el paciente):
  · **derivado de datos** (Acciones_Lead saliente vs entrante en leads; Ultima_accion vs
    Fecha_ultima_respuesta en presupuestos), no del navegador → persiste al recargar;
  · **reactivación**: por respuesta (webhook entrante) o por tiempo (**48 h leads / 72 h
    presupuestos**), recalculada al cargar;
  · **orden**: pendientes arriba, esperando abajo, prioridad conservada dentro de cada bloque;
  · **copy**: "Esperando respuesta · hace X"; KPI "atendidos" (no "completadas"); pendientes
    excluye esperando (sin doble conteo);
  · **presupuestos**: mismo criterio + se cierra el hueco de visibilidad (Fase_seguimiento=
    "Esperando respuesta" al enviar + filtro de cola lo incluye).
  · **pills/sub-filtros** (2ª iteración, tras detectar en preview que "Sin contactar" incluía
    un lead que ya esperaba respuesta y que un "Nuevo ya llamado" desaparecía de todos los
    buckets): los pills de Leads pasan a una partición **mutuamente excluyente** con el mismo
    estado derivado — **Todos · Citados hoy · Sin contactar · Esperando respuesta** — donde
    cada lead cuenta en un solo pill, `Todos = suma`, y cuadran con el KPI del header
    (pendientes = Citados+SinContactar; atendidos = Esperando). En Presupuestos (filtros por
    intención, solapados por diseño) se aplica el mismo criterio: "Actuar ahora" **excluye** los
    que esperan respuesta y se añade la pestaña "Esperando respuesta".
  Verificado en navegador: enviar → recargar → sigue esperando (bug original resuelto); los
  números de los pills cuadran entre sí y con el header, y un envío mueve el lead de
  "Sin contactar" a "Esperando respuesta" sin doblarlo ni perderlo.
  **Bug pre-existente arreglado de paso**: `logAccionLead` escribía un link `Usuario` con id de
  la base central (inválido en la base de negocio) → el create fallaba silenciado y NO se
  registraba la acción (rompía el KPI de tiempo medio y este estado). Quitado el link.

## 3. Actuar hoy — la "acción sugerida" está vacía en el caso más común
- **Zona:** `app/(authed)/actuar-hoy/ActuarHoyView.tsx:544`
- **Principio:** §3 anticipación
- **Problema:** `accionSugerida` solo se rellena tras una clasificación IA de una respuesta
  entrante. Un lead recién captado no trae sugerencia → el "sistema piensa" aparece vacío
  justo donde más se necesita.
- **Mejora:** dar siempre una siguiente acción por defecto según estado (p. ej. lead Nuevo →
  "Llamar ahora"), aunque no haya clasificación IA.
- **Impacto:** **medio** en anticipación/conversión — es la promesa central ("te digo qué
  hacer") fallando en el arranque del embudo.
- **Fecha:** 2026-07-15 · 🔵

## 4. Leads — mover a "No Interesado" fija el motivo a escondidas
- **Zona:** `app/(authed)/leads/LeadsView.tsx:199`
- **Principio:** §2 facilidad + §6 coherencia
- **Problema:** arrastrar un lead a "No Interesado" fija `motivoNoInteres="Rechazo_Producto"`
  por defecto sin preguntar. El caso gemelo en Presupuestos (`→ PERDIDO`) sí abre
  `MotivoPerdidaModal` para elegir el motivo. Mismo concepto, comportamientos opuestos.
- **Mejora:** abrir un modal de motivo al mover a "No Interesado", reutilizando el patrón de
  `MotivoPerdidaModal`.
- **Impacto:** **medio** en conversión (a futuro) — sin el motivo real no se aprende por qué
  se pierden leads y no se puede mejorar la captación.
- **Fecha:** 2026-07-15 · 🔵
- **2026-07-27 · 🟢 CERRADA**: MotivoNoInteresModal al arrastrar a "No Interesado" (y fuera
  el mismo default silencioso del panel y del Copilot, nº 43). El vocabulario disponible sigue
  siendo pobre — dos opciones: ver nº 42.

## 5. Presupuestos — el "envío en lote" no es en lote
- **Zona:** `app/components/presupuestos/IntervencionView.tsx:328`
- **Principio:** §2 facilidad + §3 anticipación
- **Problema:** el wizard de "bulk send" obliga a pulsar "Enviar a X" uno por uno y abre una
  pestaña `wa.me` por paciente. Promete lote, entrega N envíos manuales — en el corazón de la
  conversión.
- **Mejora:** envío real en lote a través del servicio central de mensajería
  (`mensajeria.ts`), con confirmación de cuántos salieron.
- **Impacto:** **alto** en orden/esfuerzo — es trabajo repetitivo diario sobre los casos con
  más valor.
- **Estimación de esfuerzo (jul 2026):** el "bulk real" server-side existe como pieza
  (`app/lib/whatsapp/outbound.ts` → Meta WABA), pero está **bloqueado por dos dependencias
  externas**: (1) `META_WHATSAPP_TOKEN`/`META_PHONE_NUMBER_ID` en producción, y (2) una
  **plantilla aprobada por Meta** para el mensaje de intervención (aprobación tarda días y
  obliga a un mensaje FIJO con variables — Meta NO permite enviar en lote el texto IA
  personalizado actual). Conclusión: el bulk real de mensajes IA **no es viable "ahora"**.
  Opciones: **(A) versión mínima honesta** (~2-4 h, sin dependencias): dejar de prometer
  "lote", renombrar a envío uno-a-uno con progreso "X de N" y reutilizar el feedback de #2 —
  demo-safe; **(B) bulk real por plantilla** (~1-2 días de código + espera de aprobación
  Meta + cambiar el mensaje a plantilla fija) — no entra en la ventana de la demo.
- **Fecha:** 2026-07-15 · 🟢 **opción A hecha** (tanda pre-demo, rama `pre-demo-actuar-hoy`):
  el flujo deja de prometer "lote" — botón "Enviar uno a uno (N)", título "Paciente X de N",
  copy honesto ("abrirás WhatsApp para cada paciente, uno a uno") y toast por envío.
  **Opción B (bulk real por plantilla WABA) queda en BACKLOG** para después del piloto; las
  plantillas de Meta se decidirán con el cliente.

## 6. Jerga e IDs crudos en superficies de coordinadora
- **Zona:** `app/(authed)/automatizaciones/MotorReglasView.tsx` (paciente de prueba),
  `app/components/copilot/FyllioCopilot.tsx:917` (trace de tools),
  `app/components/presupuestos/IntervencionView.tsx:525` (QuickResponseModal + atajo)
- **Principio:** §2 facilidad (y estándar visual §5)
- **Problema:** se le pide a un perfil no técnico cosas que no tiene de dónde sacar: un
  *record ID* en una caja de texto ("Paciente de prueba"), nombres de función crudos en el
  historial del Copilot, y atajos tipo `Ctrl+Shift+L` expuestos como pill.
- **Mejora:** sustituir cajas de ID por **buscadores por nombre**, ocultar los traces
  técnicos del Copilot tras lenguaje llano, y quitar los atajos crudos de la vista.
- **Impacto:** **bajo-medio** en facilidad/confianza — no bloquea, pero delata prototipo y
  frena a la coordinadora.
- **Fecha:** 2026-07-15 · 🔵

## 7. Copilot — es reactivo, nunca se anticipa
- **Zona:** `app/components/copilot/FyllioCopilot.tsx:416`
- **Principio:** §3 anticipación
- **Problema:** el FAB solo actúa cuando lo invocan; nunca empuja "estas 3 cosas urgentes
  hoy". El modelo de lujo ("el sistema te dice qué hacer") queda a medias.
- **Mejora:** que el Copilot (o "Actuar hoy") **empuje** proactivamente lo urgente del día
  sin que haya que pedírselo.
- **Impacto:** **medio** en anticipación/pérdida — convierte una herramienta pasiva en un
  asistente que evita olvidos.
- **Fecha:** 2026-07-15 · 🔵

## 8. Patrones paralelos — lo mismo resuelto de varias maneras
- **Zona:** transversal — `mensajeria.ts` vs ~13 `window.open("wa.me/…")`; tres generadores
  de mensaje IA (`IAMensajePanel`, `IAGeneradorDrawer`, editor de `LeadAccionPanel`, con
  etiquetas de tono que ni coinciden); tres fuentes de "siguiente acción"; dos cabeceras
  "Cola de hoy"; dos kanban de @dnd-kit; tres sistemas de notificación (sonner, `DemoToast`,
  banners `setError`).
- **Principio:** §6 coherencia
- **Problema:** cada duplicado reinventa algo ya resuelto en otra parte. Peor: la telemetría
  y la idempotencia de WhatsApp solo existen en el camino central, no en los 13 atajos.
- **Mejora:** unificar cada caso en la implementación buena (mensajería central, un generador
  IA, una fuente de siguiente acción, un header, un kanban, un toast) y retirar los paralelos.
- **Impacto:** **alto** a medio plazo — consistencia, mantenimiento y fiabilidad (envíos sin
  duplicar ni perder telemetría).
- **Fecha:** 2026-07-15 · 🔵

---

Sesión de mantenimiento · zona Automatizaciones · 2026-07-16 (skill
`fyllio-sesion-mantenimiento`). Aprobados y hechos en el momento: UI honesta de reglas WA
sin integrar (`fca5065`) y borrado de código muerto (`fcd27de`). Lo demás, abajo.

## 9. Motor de reglas — dedup faltante en `cita_24h` y `lead_inactivo`
- **Zona:** `app/api/cron/automatizaciones-evaluar/route.ts:165,267` (solo `presupuesto_7d`
  usa `yaDisparadaRecientemente`, `:252`)
- **Severidad:** 🟠 (latente — hoy la vía WA es skeleton; crítico el día que envíe de verdad)
- **Problema:** un reintento del cron re-dispara `cita_24h` el mismo día, y `lead_inactivo`
  re-evalúa a diario el mismo lead sin comprobar si ya disparó (mandamiento §2: idempotencia).
- **Propuesta:** reutilizar `yaDisparadaRecientemente` en ambos triggers.
- **Esfuerzo:** horas.
- **Fecha:** 2026-07-16 · 🔵 **condición acordada: obligatorio junto a la integración WABA
  real (#5 opción B), nunca después.**

## 10. Motor de reglas — salvaguardas que se apagan en silencio
- **Zona:** `app/lib/automatizaciones/engine.ts:452` (cooldown catch→0),
  `app/lib/automatizaciones/repo.ts:63` (`listReglas` catch→`[]` deja el cron sin trabajo
  en silencio)
- **Severidad:** 🟡
- **Problema:** si la query de una salvaguarda falla, la protección se desactiva sin señal
  visible (mandamiento §9: fallos nunca silenciosos).
- **Propuesta:** fallo de salvaguarda → visible en el KPI de errores del Motor.
- **Esfuerzo:** horas.
- **Fecha:** 2026-07-16 · 🔵 acordado: junto a la integración WABA (#5B), con el nº 9.

## 11. Operativo — la "automatización" depende de que alguien abra la pestaña
- **Zona:** `app/components/presupuestos/AutomatizacionesView.tsx:70-82` (POST
  `/api/automatizaciones/procesar` al montar, debounce 60 min en `localStorage`)
- **Severidad:** 🟠
- **Problema:** la generación de secuencias solo corre cuando un humano visita la página;
  el debounce vive en el navegador de cada uno (§3 anticipación).
- **Propuesta:** mover la generación a cron diario y retirar el debounce local.
- **Esfuerzo:** medio día.
- **Fecha:** 2026-07-16 · 🔵 acordado: **solo si el piloto usa la cola de Operativo.**

## 12. Dos motores persiguen el mismo presupuesto estancado
- **Zona:** regla `presupuesto_estancado_7d` del Motor vs cola de secuencias de Operativo
  (`/api/automatizaciones/procesar`)
- **Severidad:** 🟡
- **Problema:** dos sistemas independientes (reglas Airtable+cron vs secuencias LLM
  on-page) actúan sobre el mismo caso → doble mensaje al paciente cuando ambos envíen de
  verdad (§6 coherencia; pariente del nº 8).
- **Propuesta:** unificar en el motor de reglas (la secuencia LLM pasa a ser una acción
  "generar borrador para revisar"). Parte del rediseño del nº 13.
- **Esfuerzo:** días.
- **Fecha:** 2026-07-16 · 🔵 acordado: espera feedback del cliente (con el nº 13).

## 13. Automatizaciones — zona unificada (una vista, config a Ajustes)
- **Zona:** `app/(authed)/automatizaciones/AutomatizacionesTopView.tsx` (3 pestañas =
  3 generaciones apiladas: Motor, Operativo, "Reglas y objetivos")
- **Severidad:** 🟡
- **Problema:** tres pestañas sin relación clara; "Reglas y objetivos" no contiene las
  reglas (es un cajón de config con 7 secciones); solapamientos (nº 12; sección
  Recordatorios vs regla de recordatorio).
- **Propuesta:** una sola vista — header KPI, lista de reglas con interruptor y estado
  honesto, desplegable por regla (qué hace · cómo · qué esperar · KPIs por regla),
  sección "Pendientes de revisar" que absorbe la cola; el resto de config se muda a
  Ajustes. ⚠️ **La sección "Objetivos del mes" es el ÚNICO editor de objetivos mensuales
  de la app (`ConfigAutomatizaciones.tsx:347`): se muda, nunca se borra.**
- **Esfuerzo:** 1-2 días.
- **Fecha:** 2026-07-16 · 🔵 acordado: espera feedback del cliente del piloto.

## 14. Restos de prototipo en superficie de admin
- **Zona:** `ConfigAutomatizaciones.tsx:110` (botón "Cargar demo"), `:177,444` + 
  `AutomatizacionesView.tsx:517` (stubs "Próximamente"), toggles auto del motor no-shows
  inertes (`app/lib/no-shows/acciones.ts:250`, `aplicarAccionesAutomaticasNoShow` sin
  cablear)
- **Severidad:** ⚪
- **Problema:** utilidades de desarrollo y promesas "Próximamente" visibles en producción;
  toggles que no hacen nada.
- **Propuesta:** ocultar "Cargar demo" fuera del tenant DEMO; retirar stubs; decidir
  cablear o quitar los toggles inertes.
- **Esfuerzo:** horas.
- **Fecha:** 2026-07-16 · 🔵

## 15. "Agendar" desde la ficha no preselecciona al paciente
- **Zona:** ficha del paciente (`Paciente360View.tsx`, botón Agendar) → `/no-shows?tab=agenda`
- **Severidad:** 🟡
- **Problema:** el accionable lleva a la agenda, pero la coordinadora tiene que volver a
  buscar al paciente a mano en el modal de nueva cita (paso extra; incumple §2 facilidad).
- **Propuesta:** aceptar `?paciente=<id>` en la agenda y prefijar el modal de nueva cita
  (toca query param + estado del modal; sin cambio de datos). Impacto medio: quita un paso
  del cierre de cita, el momento de mayor valor.
- **Esfuerzo:** horas.
- **Fecha:** 2026-07-22 · 🔵

## 16. La "siguiente acción" vive en varios sitios
- **Zona:** ficha (`derivarSituacion`, cliente) · panel de lead (`situacionLead` — usa los
  MISMOS triggers que la cola de Actuar hoy, a propósito) · cola de Presupuestos
  (`scoreFinal`) · `accion_sugerida` del presupuesto
- **Severidad:** 🟡
- **Problema:** varias fuentes de "qué hacer ahora". Para leads, panel y cola ya comparten
  definición (citado-hoy · nuevo>24h · caliente>12h · espera 48h) pero implementada dos
  veces; la ficha tiene la suya. Cada duplicado puede divergir (incumple §6 coherencia).
- **Propuesta:** extraer UNA función de recomendación compartida (lib común) que consuman
  ficha, panel y colas; las vistas solo pintan. Hacerlo al tocar Actuar hoy (Bloque 2 P3)
  o justo después.
- **Fecha:** 2026-07-22 · 🔵

## 17. Contactos y mensajes: dos verdades del mismo seguimiento
- **Zona:** `contactos_presupuesto` (ContactCount → score/cola/KPIs) vs `mensajes_whatsapp`
  (hilo). El panel ya muestra SOLO el hilo; el contacto se registra automáticamente al
  enviar/llamar desde el cliente (fire-and-forget).
- **Severidad:** 🟡
- **Problema:** el "contacto" se cuenta aparte del mensaje real y por un camino best-effort
  del cliente: si esa segunda llamada falla, ContactCount y el score divergen del hilo.
  Cualquier vía de envío nueva tiene que acordarse de registrar el contacto.
- **Propuesta:** derivar el contacto EN SERVIDOR del propio mensaje saliente (el servicio
  de mensajería registra ambos en la misma operación), y dejar ContactCount como dato
  derivado. Una sola verdad; los KPIs cuentan lo que de verdad se dijo.
- **Esfuerzo:** medio (toca mensajería + repos de contactos).
- **Fecha:** 2026-07-22 · 🔵

## 18. Panel de presupuesto — «Rechazó» no pregunta el motivo de pérdida
- **Zona:** `app/components/presupuestos/IntervencionSidePanel.tsx` (botón Rechazó →
  `onChangeEstado(id, "PERDIDO")` directo)
- **Principio:** §6 coherencia (gemelo del nº 4 de leads)
- **Problema:** desde el kanban, arrastrar a PERDIDO abre `MotivoPerdidaModal`; desde el
  panel de acción, «Rechazó» marca PERDIDO sin preguntar motivo — mismo concepto, dos
  comportamientos. Sin motivo no se aprende por qué se pierden presupuestos.
- **Mejora:** interceptar PERDIDO en los hosts del panel igual que hoy se intercepta
  ACEPTADO con el modal de pago (patrón ya montado en `PresupuestosShell`/`ActuarHoyView`).
- **Impacto:** medio (datos de pérdida incompletos en el flujo más usado).
- **Fecha:** 2026-07-23 · 🟢 hecha (2026-07-23, tras el OK del preview de los 4 arreglos)

## 19. Acciones que confirman éxito sin comprobar la respuesta
- **Zona:** `IntervencionSidePanel.tsx` (`handleLlamar` — registra llamada y toast de éxito
  sin `res.ok`); `ActuarHoyView.tsx` (`handleChangePresupuestoEstado` — catch silencioso
  «el polling lo recupera»)
- **Principio:** §5 feedback (misma clase que el «Pausar» no-op arreglado el 2026-07-23)
- **Problema:** si el servidor falla, la coordinadora ve éxito y la acción no quedó
  registrada — un error disfrazado de éxito en pequeño.
- **Mejora:** `res.ok` + toast de error en ambos (patrón ya usado en el resto del panel).
- **Impacto:** medio-bajo (pérdida esporádica de registro/estado sin aviso).
- **Fecha:** 2026-07-23 · 🟢 hecha (2026-07-23, tras el OK del preview de los 4 arreglos)

## 20. Portal público — la aceptación puede no llegar al kanban
- **Zona:** `app/api/portal/[token]/responder/route.ts` (el token KV se marca respondido
  ANTES de escribir el presupuesto; si esa escritura falla, ahora se loguea pero el
  presupuesto no cambia y el paciente cree que aceptó)
- **Principio:** mandamiento §1 (persistir antes de confirmar) — pre-existente, hoy solo
  observable
- **Mejora:** escribir el presupuesto primero y marcar el token después (o reintento).
- **Impacto:** medio (raro pero caro: una aceptación real invisible para la clínica).
- **Fecha:** 2026-07-23 · 🟢 hecha (2026-07-23, tras el OK del preview de los 4 arreglos)

## 21. Reactivación de perdidos — el reloj de 90 días arranca en la fecha equivocada
- **Zona:** `app/api/automatizaciones/procesar/route.ts:194,249-258` (evento
  `reactivacion_programada`)
- **Principio:** §1 misión / mandamiento §7 (dato equivocado)
- **Problema:** "recordar reactivar en 90 días tras perderse" cuenta los días desde `Fecha`
  (la fecha ORIGINAL del presupuesto), no desde que se marcó perdido. Un presupuesto antiguo
  marcado hoy como reactivable dispara el recordatorio inmediatamente.
- **Mejora:** contar desde la fecha de pérdida (o desde que se marcó el flag).
- **Impacto:** medio — recordatorios de reactivación a destiempo.
- **Fecha:** 2026-07-23 · 🔵

## 22. Regla lead_inactivo mide inactividad con la fecha de alta, no con la actividad
- **Zona:** `app/api/cron/automatizaciones-evaluar/route.ts:265+` (comentario lo admite:
  proxy porque `Leads.Ultima_Accion` es texto, no fecha)
- **Principio:** §3 anticipación / mandamiento §7
- **Problema:** "lead inactivo N días" filtra por `createdAt`, así que un lead con actividad
  reciente pero antiguo cuenta como inactivo, y uno recién creado sin tocar jamás no dispara
  hasta cumplir N días de VIDA, no de silencio.
- **Mejora:** derivar inactividad de la última acción real (`acciones_lead`), que en Postgres
  ya es consultable con fecha.
- **Impacto:** medio (latente — la vía WA es skeleton; importa cuando envíe de verdad, junto
  con el nº 9).
- **Fecha:** 2026-07-23 · 🔵

## 23. Pestaña "Sin respuesta" de la cola no significa "sin respuesta"
- **Zona:** `app/lib/presupuestos/colors.ts:142` (tab `sin_respuesta` = intenciones
  `["Rechaza","Sin clasificar"]`)
- **Principio:** §2 facilidad (nombre engañoso)
- **Problema:** la coordinadora lee "Sin respuesta" y espera "pacientes que no han contestado";
  el filtro en realidad agrupa por intención detectada (rechazos y no clasificados).
- **Mejora:** renombrar la pestaña a lo que es (p. ej. "Rechazos / sin clasificar") o
  cambiar el filtro al significado natural cuando exista el estado de conversación unificado.
- **Impacto:** bajo-medio (confianza en los filtros).
- **Fecha:** 2026-07-23 · 🟢 hecha (P3 unificación: las pills por intención se retiraron;
  las dos pestañas derivan de estadoConversacion — la pestaña engañosa ya no existe)

## 24. Los envíos automáticos (pila Twilio) siguen fuera del hilo de conversación
- **Zona:** `lib/whatsapp/send.ts`/`core.ts` y sus callers — crons daily/reminders/confirm/
  feedback, motor no-shows (`lib/no-shows/acciones.ts:138`), waitlist, `/api/whatsapp/send`;
  además los wa.me de superficies diferidas (no-shows views, demo PatientCard/QuotesPanel/
  RecallPanel) y el link de chat de PacientesView (paciente sin texto ni registro).
- **Principio:** §6 coherencia / mandamiento §9 — es la mitad que queda del nº 8
- **Problema:** todo lo que envía por Twilio/plantilla automática NO deja fila en
  `mensajes_whatsapp`: el hilo que ve la clínica está incompleto para pacientes contactados
  por automatización, y estadoConversacion no puede contarlos. (La pila manual/WABA quedó
  garantizada el 2026-07-23.)
- **Mejora:** enrutar la pila Twilio por el servicio central de mensajería (o que registre
  fila además de enviar) cuando se reactiven no-shows / se integre WABA real (nº 5B/9/10).
- **Impacto:** medio (latente: esa pila hoy no envía en vivo para clientes reales).
- **Fecha:** 2026-07-23 · 🔵


## 25. GET de la cola de intervención tiene efectos secundarios (genera IA y escribe)
- **Zona:** `app/api/presupuestos/intervencion/route.ts` (bloque "Generate missing
  mensajeSugerido": hasta 5 llamadas IA por carga + escritura en background del campo
  `Mensaje_sugerido`)
- **Principio:** mandamiento §2 idempotencia / §9 no silencios — detectado con la lente
  durante la unificación P3
- **Problema:** un GET (que además auto-refresca cada 15 s) dispara generación IA y
  escrituras: coste y latencia invisibles, y si dos pestañas cargan a la vez se duplica
  trabajo. El tope silencioso de 5 por carga tampoco se comunica.
- **Mejora:** mover la generación a una acción explícita o a un job (al crear el caso /
  al entrar en reactivable), y dejar el GET de solo lectura.
- **Impacto:** medio (coste IA + latencia de la cola).
- **Fecha:** 2026-07-23 · 🟢 hecha (opción elegida: caché + invalidación. La escritura de la
  caché se espera y se loguea — mata la regeneración infinita en serverless — y todo mensaje
  entrante del paciente limpia Mensaje_sugerido en recibirMensaje, el cuello de botella por
  el que pasan webhook, clasificar y registro manual)

## 26. La entrada a la cola de intervención sigue dependiendo de urgencia/fase persistidas
- **Zona:** `app/api/presupuestos/intervencion/route.ts` (filterFormula: respuesta ≠ '' OR
  urgencia ≠ NINGUNO OR fase = 'Esperando respuesta')
- **Principio:** §6 coherencia — media verdad que queda del criterio viejo
- **Problema:** un presupuesto ABIERTO sin urgencia asignada, sin fase y sin respuesta
  registrada no entra en la cola aunque su hilo diga pendiente_responder o reactivable:
  invisible para la coordinadora. (Con el seed DEMO no pasa porque todos llevan urgencia.)
- **Mejora:** que entren TODOS los presupuestos abiertos y estadoConversacion decida la
  pestaña; la fórmula quedaría solo como optimización si hiciera falta.
- **Impacto:** medio (casos reales pueden quedar fuera de la cola).
- **Fecha:** 2026-07-23 · 🟢 hecha (la fórmula quedó en Estado≠ACEPTADO/PERDIDO; la pestaña
  la decide estadoConversacion — el estado de negocio sigue mandando en la entrada)

## 27. Financiado — columna huérfana retirada de la tabla; derivarla si el piloto la pide
- **Zona:** `pacientes.financiado` (columna manual que solo escribían seeds viejos)
- **Principio:** una sola verdad — un dato sin flujo que lo escriba es un dato muerto
- **Problema:** ningún flujo de producto escribe `financiado`; en `pagos` ya existe el
  método "Financiación", así que el concepto tiene un origen natural sin columna manual.
- **Mejora:** si el piloto pide ver "financiado", derivarlo como Σ pagos con método
  Financiación (misma mecánica que cobrado); si no, eliminar la columna del esquema.
- **Impacto:** bajo (columna ya fuera de la tabla de Pacientes desde Bloque 3).
- **Fecha:** 2026-07-23 · 🔵

## 28. Columnas duplicadas de pacientes — deuda a deprecar (mapa Bloque 3)
- **Zona:** `presupuestos.paciente_telefono` (D1), `pacientes.tratamientos` (D2),
  `pacientes.fecha_cita` (D3), cachés `pagado/pendiente/aceptado/presupuesto_total` (D5)
- **Principio:** cada dato con UN registro origen; cero sincronización
- **Problema:** D1 es copia viva que consume la cola (hoy puenteada con propagación al
  editar teléfono); D2/D3 ya no se muestran (la tabla pinta derivados de presupuestos y
  agenda) pero las columnas siguen escribiéndose en seeds/flujos; D5 sigue teniendo un
  consumidor vivo: la cola de cobros filtra por el `pendiente` almacenado (`pagos.ts:151`).
- **Mejora:** migrar la cola de cobros al derivado (`finanzas-paciente`), dejar de escribir
  las copias y eliminarlas del esquema en una migración.
- **Impacto:** medio (mientras existan, cualquier flujo nuevo puede volver a leerlas).
- **Fecha:** 2026-07-23 · 🟢 **lectores a cero** (2026-07-24, módulo Cobros): migrados los
  que quedaban — tools de cobros y buscador del Copilot, alertas de cobro (flag `Aceptado`
  + `Presupuesto_Total`), `sumPendientePorIds`/`listResumenFinancieroPorIds` del repo
  (→ /api/leads/kpis), `{{importe}}` de plantillas, payloads de la ficha y filtro
  `?aceptado=`. QA: cero lectores fuera del repo/seeds. **Queda como paso aparte**
  (acordado): dejar de ESCRIBIR las copias (`crearPago`→sync, seeds) y la migración que
  elimina las 4 columnas — pequeña, tras QA verde del piloto.
- **2026-07-27 · 🟢 CERRADA (paso 2)**: migración 008 elimina las 4 columnas; fuera
  syncPacienteCache, la tabla de inconsistencias como mecanismo y /api/admin/reconciliar-pagos.
  QA antes/después idéntico cifra a cifra + alta/baja de pago verificada.

## 29. CommandCenterView huérfano tras el dashboard de Red
- **Zona:** `app/components/presupuestos/CommandCenterView.tsx` (636 líneas)
- **Principio:** código muerto = deuda que alguien volverá a leer
- **Problema:** el dashboard de Red (Bloque 2) retiró su único consumidor; el mini-dashboard
  viejo de presupuestos queda sin montar en ninguna ruta.
- **Mejora:** borrar el componente (y sus helpers exclusivos) tras el preview del dashboard.
- **Impacto:** bajo (limpieza).
- **Fecha:** 2026-07-23 · 🔵
- **2026-07-27 · 🟢 CERRADA**: CommandCenterView cayó con el dashboard de Red; barrido
  posterior de 9 componentes sin importador (~1.900 líneas), incluidos dos de los tres
  generadores de mensaje IA del catálogo de olores.

## 30. listClinicas sin cliente en cola-cobros (mismo patrón que cazó el QA del dashboard)
- **Zona:** `app/api/cola-cobros/route.ts` (listClinicas({ onlyActivas: true }) sin cliente)
- **Principio:** identidad central siempre con cliente explícito
- **Problema:** sin `cliente`, la rama PG lee el directorio global (clínicas de TODOS los
  clientes). Hoy solo se usa como mapa id→nombre (sin fuga visible), pero es exactamente el
  patrón que en el dashboard devolvía 15 clínicas en vez de 4 hasta que el QA de RLS lo cazó.
- **Mejora:** pasar `cliente: currentCliente()` (una línea) y auditar otros callers sin cliente.
- **Impacto:** medio (higiene de tenant; hoy sin fuga demostrada en esta ruta).
- **Fecha:** 2026-07-23 · 🟢 hecha (2026-07-24, módulo Cobros): cliente explícito en el
  nuevo /api/cobros (la ruta cola-cobros se retiró) y en los otros dos callers que cazó la
  auditoría: /api/kpis/cobros y /api/kpis/no-shows. Sin más `listClinicas` sin cliente en
  rutas de negocio.

## 31. Seed realista de volumen (agenda llena 6 meses, cientos de leads)
- **Zona:** `scripts/db-seed-demo-rico.mjs`
- **Principio:** la demo debe parecerse al piloto; y las queries agregadas del dashboard
  necesitan un test de rendimiento con volumen real
- **Problema:** el seed actual es narrativo (decenas de registros); el dashboard de Red y
  las colas nunca se han visto con cientos de leads/presupuestos y una agenda llena.
- **Mejora:** seed de volumen aparte (o flag `--volumen`): ~6 meses de agenda completa,
  cientos de leads/presupuestos/pagos coherentes con las invariantes existentes; medir
  tiempos de /api/red/dashboard y las colas con ese volumen.
- **Impacto:** medio (realismo de demo + test de rendimiento).
- **Fecha:** 2026-07-23 · 🟢 hecha (2026-07-24, aprobada por Simon): capa de VOLUMEN dentro
  de `demo:reset` — +120 pacientes, +230 leads (serie mensual 34/41/37/46/52/58 con estados
  realistas), +76 presupuestos (todos los estados), +46 pagos que pueblan los TRES buckets
  de Cobros (8 vencidos · 6 por vencer · 5 estancados), +2.806 citas (agenda laborable casi
  llena 6 meses con ~9% no-shows) y +886 mensajes de hilo coherentes. Determinista (LCG) y
  anclada al mes de calendario (correr demo:reset el día 1 no rompe la serie). Invariantes
  duras NUEVAS: buckets poblados + serie mensual sin meses muertos (leads/aceptados/cobrado);
  las 6 existentes cubren el volumen por construcción. Paridad SQL=API=dashboard exacta con
  volumen (46.665/12.725/23.561 €). Rendimiento: ver medición en DECISIONES 2026-07-24.

## 32. Plantilla de liquidación — {{importe}} dice el total firmado, no lo pendiente
- **Zona:** `app/lib/plantillas/plantillas.ts` (variables de render) + plantilla canónica
  `recordatorio_liquidacion`
- **Principio:** §2 facilidad / honestidad del dato de cara al paciente
- **Problema:** el recordatorio dice "tienes pendiente la liquidación de {{importe}}€" con
  el TOTAL aceptado (p. ej. 2.400 €) aunque el paciente ya pagara 1.440 € y deba 960 € —
  un mensaje incorrecto en el momento más delicado (reclamar dinero). Detectado en el QA
  del panel "Recordar pago".
- **Mejora:** añadir la variable `{{pendiente}}` (derivada: Σ ACEPTADO − Σ pagos, ya
  disponible) y usarla en la plantilla de liquidación.
- **Impacto:** medio (confianza del paciente; hoy la coordinadora tiene que corregir el
  importe a mano).
- **Fecha:** 2026-07-24 · 🟢 hecha (2026-07-24, aprobada por Simon): variable `{{pendiente}}`
  derivada de `finanzasDePaciente` (la lib compartida — cero cálculo propio; de paso
  `{{importe}}` también sale de ahí); `recordatorio_liquidacion` y `recordatorio_primer_pago`
  reclaman `{{pendiente}}` en canónicas (sprint14b), seed rico y DB DEMO; la señal conserva
  `{{importe}}` (confirma el presupuesto, aún sin pagos — pendiente=importe). Verificado en
  render real: Clara Rey pasa de "liquidación de 2.400€" a "de 960€". Auditadas el resto:
  ninguna otra plantilla reclama con `{{importe}}`. ⚠️ Si RB/INDEP tienen plantillas de
  cobranza propias en sus bases, actualizarlas al configurar el piloto (no se tocan desde aquí).

## 33. La penalización de re-contacto de cobros no ve a pacientes sin lead de origen
- **Zona:** `/api/cobros` (cruce `ultimaCobranzaPorLead`) + `recordar/route.ts` (rama
  `appendNotaPaciente`)
- **Principio:** §3 anticipación — la cola promete "no re-contactar en 3 días" y solo lo
  cumple a medias
- **Problema:** el último contacto de cobranza se deriva de Acciones_Lead; si el paciente
  no tiene `leadOrigenId`, el registro cae a una nota de texto que ningún cruce lee → su
  card nunca se atenúa entre sesiones ni baja en la cola (verificado en QA con Clara Rey).
  Limitación heredada de la sub-pestaña vieja.
- **Mejora:** derivar el último contacto también del hilo (último saliente con contexto de
  cobro) o registrar el contacto de cobranza en un sitio consultable para ambos casos.
- **Impacto:** bajo-medio (riesgo de re-contactar dos veces al mismo paciente).
- **Fecha:** 2026-07-24 · 🔵

## 34. Backend Airtable (solo dev local): /cobros sin nombres de clínica ni scope fino
- **Zona:** `/api/cobros` con `DATA_BACKEND_PG_*` sin configurar (rama Airtable): los
  pacientes llevan ids de clínica de NEGOCIO y `listClinicas` devuelve ids CENTRALES
- **Principio:** §6 coherencia (dos espacios de ids sin remapear)
- **Problema:** con backend Airtable, `clinicaNombre` sale null y el filtro por clínica de
  una coordinadora no casa (heredado de la cola vieja, que tenía exactamente lo mismo). En
  producción los 3 clientes van por PG (ids centrales) y no aplica.
- **Mejora:** si algún tenant volviera a Airtable, remapear con `clinicasNegocioAccesibles`
  como hacen Actuar hoy y el dashboard; mientras tanto, nada.
- **Impacto:** bajo (solo dev local sin flags PG).
- **Fecha:** 2026-07-24 · ⚪ (documentada, sin acción salvo vuelta a Airtable)

## 35. Rutas de negocio: cada llamada a repo paga su propio viaje a la base
- **Zona:** transversal PG — `runWithClienteDb` por llamada (begin + set_config + query +
  commit) y conexión por request; visible en /api/cobros (~3,3 s) y /api/red/dashboard
  (~2,6 s) medidos en local contra Supabase remoto (RTT 182 ms)
- **Principio:** eficiencia — el primer test de rendimiento real (seed de volumen, nº 31)
  mostró que el coste NO es el volumen (agregar ~3.500 filas en memoria es despreciable y
  el tiempo no se movió al pasar el registro de 17 a 68 filas): son los round-trips.
- **Mejora:** agrupar las lecturas de una request en una sola transacción/conexión (o al
  menos paralelizar las que hoy van en serie: staff, última cobranza, etc.).
- **Impacto:** bajo en producción (Vercel misma región, RTT 1-5 ms → decenas de ms), medio
  como higiene: cualquier despliegue con la DB lejos lo notará multiplicado.
- **Fecha:** 2026-07-24 · 🔵

## 36. Cobros · Actuar — vista compacta / toggle de densidad
- **Zona:** `/cobros` pestaña Actuar (cards de bucket)
- **Principio:** §2 facilidad — con volumen real, 8+ cards de altura completa piden scroll;
  una densidad compacta (una línea por cobro) daría el barrido rápido de toda la cola.
- **Mejora:** toggle de densidad (cómodo/compacto) en la cabecera de Actuar, recordado por
  usuario. Candidata a evaluar con el feedback del piloto.
- **Impacto:** medio en facilidad para redes con muchos vencidos.
- **Fecha:** 2026-07-24 · 🔵 (anotada por Simon en el checkpoint de la revisión visual;
  post-piloto)

## 37. Leads · sin fecha de cierre persistida (conversión / no interés)
- **Zona:** tabla `leads` + kanban de Leads
- **Principio:** coherencia/orden — la columna "No Interesado" recorta a 14 días por
  ÚLTIMA ACTIVIDAD (acciones+hilo) porque no existe fecha de cierre; es un proxy razonable
  pero impreciso (un lead cerrado sin mensajes nunca "envejece"), y las métricas de
  conversión por mes tampoco tienen fecha real de conversión.
- **Mejora:** persistir `fecha_cierre` (o una acción de cierre en acciones_lead) al pasar a
  Convertido/No Interesado, y usarla en la ventana del kanban y en KPIs.
- **Impacto:** bajo hoy (el proxy funciona con el DEMO), medio para métricas de piloto.
- **Fecha:** 2026-07-26 · 🔵
- **2026-07-27 · 🟢 CERRADA**: `leads.fecha_cierre` escrita en la transición dentro del repo
  (y borrada al reactivar); el kanban la usa como fecha del hito. Sin backfill en datos reales
  —null ⇒ el caso se muestra—, sembrada solo en DEMO. Solo Postgres (ver nº 44).

## 38. Sesión doble: fyllio_session + cookie legacy de presupuestos
- **Zona:** `app/lib/auth/legacy-presupuestos.ts` + ~30 rutas `/api/presupuestos/*`
- **Principio:** coherencia — dos sistemas de sesión con dos secretos (AUTH_SECRET y
  PRESUPUESTOS_JWT_SECRET); documentado como deuda desde Sprint 7 ("hasta Sprint 8 que las
  unifica") y sigue vivo: hoy volvió a morder (una sesión válida de fyllio_session recibe
  401 de presupuestos si falta la cookie legacy).
- **Mejora:** migrar las rutas legacy a `withAuth` (fyllio_session) y retirar
  emitLegacyCookies; una sola sesión, un solo secreto.
- **Impacto:** medio en fiabilidad (expiraciones desincronizadas = pantallas a medias) y en
  simplicidad de auth.
- **Fecha:** 2026-07-26 · 🔵
- **2026-07-27 · 🟢 CERRADA**: withPresupuestosAuth lee fyllio_session; las 5 rutas que
  verificaban la cookie a mano pasan por getSession; el login deja de emitirla. Queda la de
  no-shows (zona congelada, nº 39); con ella morirá PRESUPUESTOS_JWT_SECRET.

## 39. Zona no-shows sin camino de WhatsApp con registro
- **Zona:** `/no-shows` (HoyView, AgendaView, RiesgoView, AccionesView, AccionSidePanel)
- **Principio:** §5 confianza — al cerrar el censo wa.me (2026-07-26) esta zona se quedó
  solo con Llamar/Copiar: sus recordatorios no tienen ficha ni panel de conversación al que
  enviar, porque sus APIs siguen fail-closed del Sprint B.
- **Mejora:** cuando se reactive No-Shows, dar a sus acciones el mismo camino central
  (persistir en hilo → abrir la URL que devuelve el server), como Cobros y Presupuestos.
- **Impacto:** alto cuando se reactive la zona; nulo mientras siga congelada.
- **Fecha:** 2026-07-26 · 🔵
- **2026-07-27 · 🟠 CONGELADA**: la zona se retiró con Airtable. La página dice
  que está en reconstrucción (lenguaje de coordinadora, primitivos de la app) y
  no está en el nav. El motor predictivo y sus tablas de analítica siguen vivos
  y alimentándose: reactivar = reconstruir la interfaz sobre Postgres.

## 40. `urgencyScore` sigue vivo como dato aunque ya no ordena ninguna vista
- **Zona:** `app/lib/presupuestos/urgency.ts`, payload de `/api/presupuestos/kanban`, orden
  opcional de la Vista Máxima
- **Principio:** coherencia — tras unificar el criterio de orden (2026-07-26) el score dejó
  de gobernar el kanban, pero se sigue calculando en cada request y la Máxima permite
  ordenar por él: un cuarto criterio latente esperando a contradecir a los demás.
- **Mejora:** sustituir esa opción de orden por "días parados" e "importe" (los del criterio
  único) y retirar el campo del payload.
- **Impacto:** bajo hoy, medio como higiene (evita que el score reviva por la puerta de atrás).
- **Fecha:** 2026-07-26 · 🔵
- **2026-07-27 · 🟢 CERRADA**: fuera lib/urgency, el campo del contrato y las 6 rutas que
  lo calculaban; la Máxima ordena por el criterio único; el insight de IA usa días parados.

## 41. El seed de demo escribe motivos de descarte fuera del vocabulario real
- **Zona:** `scripts/db-seed-demo-rico.mjs:215` y `:735`; consumido por
  `LeadsView` (agrupación de "No Interesado") y `LeadAccionPanel.tsx:140`
- **Principio:** §5 confianza — el campo `Motivo_No_Interes` es un single-select de DOS
  opciones en las dos bases reales (`Rechazo_Producto`, `No_Asistio`), pero el seed inventa
  texto libre ("Problema de horarios", "Se fue a otra clínica más barata"): **158 de 158**
  leads descartados de DEMO están fuera del enum. Consecuencia visible: la agrupación
  "No asistió / Rechazo" mete todo en Rechazo, y el panel afirma "rechazó la propuesta" de
  un lead cuyo motivo guardado dice otra cosa. Es la pantalla que se enseña en demos.
- **Mejora:** que el seed use los dos valores reales; si se quiere el matiz rico, primero
  ampliar el vocabulario (nº 42) y después sembrarlo.
- **Impacto:** alto en credibilidad de demo, bajo en producción (las bases piloto están
  vacías de leads).
- **Fecha:** 2026-07-27 · 🔵
- **2026-07-27 · 🟢 CERRADA**: el hilo conserva las narrativas, la columna guarda el valor
  válido; añadida la narrativa "no asistió" (con cita en el pasado) para que ese grupo exista
  en la demo. Reseed: 127 Rechazo_Producto + 31 No_Asistio, cero fuera del enum.

## 42. El motivo de descarte de un lead tiene 2 opciones; el de un presupuesto, 7
- **Zona:** single-select `Motivo_No_Interes` (Airtable, ambas bases), `LeadMotivoNoInteres`
  en `app/lib/leads/leads.ts:32`, `MotivoNoInteresModal`
- **Principio:** misión (§1, perder menos) — al preguntar el motivo (2026-07-27) queda a la
  vista que sólo se puede responder "no le interesa" o "no asistió". El gemelo de
  presupuestos distingue precio, otra clínica, financiación, miedo, sin respuesta… que es
  justo lo que permite actuar sobre la causa.
- **Mejora:** ampliar el single-select y el tipo con el vocabulario de presupuestos, y
  añadir el "otro (especificar)" con texto libre.
- **Impacto:** alto para los KPIs de pérdida de leads (hoy no dicen nada accionable);
  requiere tocar esquema de Airtable, por eso no entró en la tanda de coherencia.
- **Fecha:** 2026-07-27 · 🔵
- **2026-07-27 · 🟢 CERRADA**: seis valores cerrados en `lib/leads/motivos`, sin texto libre;
  la columna se reparte en "se puede retomar" vs "decisión tomada" y el motivo se lee en la
  card. Solo Postgres: las opciones se añadieron al single-select de Airtable antes de parar,
  pero esa rama ya no tiene consumidor (nº 44).

## 43. El Copilot sigue fijando el motivo de descarte por defecto
- **Zona:** `app/lib/copilot/actions-exec.ts:81`
- **Principio:** §5 confianza — al cerrar la escritura silenciosa del kanban y del panel
  (2026-07-27) queda este cuarto camino: si se pide "marca a X como no interesado" sin
  motivo, el Copilot escribe `Rechazo_Producto` por su cuenta.
- **Mejora:** que la acción pida el motivo en la confirmación previa (el Copilot ya tiene
  patrón de preview + Confirmar) en vez de rellenarlo.
- **Impacto:** medio — mismo dato contaminado, por una puerta menos usada.
- **Fecha:** 2026-07-27 · 🔵
- **2026-07-27 · 🟢 CERRADA**: la acción falla pidiendo el motivo y la herramienta instruye
  al modelo a preguntarlo antes de proponer nada.

## 44. Retirar la rama Airtable: dos implementaciones de cada dominio sin consumidor real
- **Zona:** `lib/airtable.ts` (base/TABLES/runWithCliente), las 15 ramas gateadas por
  `usaPostgres`, `lib/db/airtable-formula.ts`, y los módulos sin rama PG (abajo)
- **Principio:** coherencia — cada dominio está escrito DOS veces (17 archivos `*-pg.ts`,
  3.553 líneas, 199 puntos de bifurcación `if (usaPostgres…)`), y la rama PG carga además un
  **intérprete de `filterByFormula` de Airtable** (97 líneas) y "shims" que fingen la forma de
  un record de Airtable — código cuyo único motivo de existir es emular al backend que se
  retiró.
- **Evidencia de que no hay consumidor:** última escritura en cualquier base de Airtable,
  2026-07-15 (tablas de negocio: 2026-07-06). Las dos bases piloto están VACÍAS de Leads,
  Citas, Staff, Tratamientos y Mensajes; solo quedan restos pre-corte. La verdad de negocio
  vive en Postgres desde el corte del 2026-07-21.
- **Coste de mantenerla (medido hoy):** todo cambio de esquema se aplica dos veces y en dos
  lenguajes (migración SQL + esquema Airtable ×2 bases), a mano y sin nada que verifique que
  coinciden — exactamente la clase de desajuste de la nº 41. Y la API de meta de Airtable **no
  permite añadir opciones a un single-select**: la vía documentada es escribir con
  `typecast:true`, o sea crear un registro temporal en una base de producción para bootstrapear
  una opción.
- **Mejora:** retirar la rama. Orden propuesto: (1) extraer el contexto de cliente
  (`runWithCliente`/`currentCliente`) de `lib/airtable.ts` a su propio módulo — todo depende de
  él; (2) escribir contra PG los 6 módulos que hoy NO tienen rama (ver nº 45) y el repo del
  scheduler (staff/tratamientos/sillones, ~2.171 líneas); (3) borrar la rama Airtable de los 15
  dominios gateados, el dispatcher, el intérprete de fórmulas y los shims; (4) sacar
  `AIRTABLE_API_KEY` y los 3 ids de base de Vercel. No-shows queda aparte (nº 39): o migra con
  su reactivación o es el último consumidor.
- **Impacto:** alto en velocidad de cambio (hoy cada esquema cuesta el doble y puede
  desincronizarse) y en superficie de bug; nulo en datos (no hay nada vivo que migrar).
- **Fecha:** 2026-07-27 · 🔵
- **2026-07-27 · 🟢 CERRADA (los cuatro pasos)**:
  - Paso 1 HECHO: el contexto de cliente vive en `lib/cliente-contexto`.
  - Paso 3 al 70%: fuera la isla de prototipo que el proxy ya devolvía 404 en producción
    desde el Sprint A (`/api/db`, `/api/dashboard`, `/api/scheduler`, `/api/dev`,
    `/api/twilio`, `/api/import/gesden`, `/demo`, `/dashboard` y ~40 componentes que solo
    ellas montaban): **15.173 líneas**. Podada la rama Airtable de 25 módulos de dominio y
    del dominio Pacientes.
  - **BLOQUEADO en no-shows**: quedan `airtableRepo` (30 usos), `staffRepo` (8) y sus
    satélites, que solo consumen ya la zona no-shows y los dos crons. Retirar Airtable sin
    resolverla la deja rota; migrarla es un sprint. Decisión pendiente (ver nº 39).
  - Paso 4 (env fuera de Vercel) NO ejecutado a propósito: quitar las variables mientras
    no-shows llama a Airtable rompe esa zona en producción.
  - Paso 2 y 3 COMPLETOS: cero llamadas a Airtable y **cero bifurcaciones
    `usaPostgres`**. Fuera el gate, el paquete npm, los 32 scripts de esquema y
    los módulos ya sin ruta que los montara. `lib/airtable.ts` queda como
    reexport del contexto de cliente (solo sobrevive el nombre del archivo).
  - Paso 4 HECHO: `AIRTABLE_API_KEY` y los 3 ids fuera de Vercel (production,
    preview y development).
  - **Deuda acotada que sobrevive**: `db/airtable-formula` interpreta el dialecto
    de filtros de Airtable sobre filas de Postgres porque ~10 repos aún reciben
    `filterByFormula` de sus callers. No habla con Airtable. Siguiente paso:
    tipar esos filtros y borrarlo.

## 45. Estado mixto: el alcance de clínicas y los doctores se leen de Airtable, los datos de Postgres
- **Zona:** `lib/clinicas-negocio.ts:33`, `lib/scheduler/repo/staffRepo.ts`, y las páginas de
  Leads / Seguimiento / Pacientes (`base(TABLES.staff)` directo)
- **Principio:** §5 confianza / una sola verdad — estos módulos NO pasan por `usaPostgres`:
  leen Airtable siempre, aunque su dominio esté volteado.
- **Problema (verificado hoy):** la tabla **Staff está vacía en las dos bases piloto**, así que
  el selector de doctor de Leads, Seguimiento y Pacientes sale vacío para RB/INDEP mientras
  Postgres SÍ tiene tabla `staff`. Y `clinicasNegocioAccesibles` resuelve el alcance de
  clínicas leyendo Airtable y lo cruza **por nombre** con los datos de Postgres: hoy cuadra de
  milagro (RB 10/10, INDEP 1/1), pero una clínica creada solo en Postgres dejaría sus leads y
  pacientes invisibles, sin error.
- **Mejora:** llevar los dos a Postgres (las tablas `staff` y `clinicas` ya existen) antes de
  que los pilotos empiecen a operar. Es el primer paso natural de la nº 44.
- **Impacto:** alto — es una fuga funcional silenciosa en la superficie principal.
- **Fecha:** 2026-07-27 · 🔵
- **2026-07-27 · 🟢 CERRADA**: los seis módulos leen y escriben Postgres. Aviso: RB/INDEP
  tampoco tienen `staff` en Postgres todavía — esto arregla DÓNDE se lee; los doctores de los
  pilotos hay que darlos de alta antes de que operen.

## 46. ✅ CERRADA — El seed repartía los casos vivos en el mes en curso
- **Zona:** `scripts/db-seed-demo-rico.mjs` (capa de volumen mensual)
- **Principio:** §5 confianza — la demo es la pantalla que se enseña.
- **Problema (medido hoy):** la serie mensual de presupuestos presentados es
  11 · 16 · 13 · 20 · 15 · **48**. Los 33 de más del mes en curso son los casos
  narrativos (kanban, colas, conversaciones) que el seed necesita "vivos", y
  **28 de esos 48 siguen sin decidirse**, 25 presentados en los últimos 7 días.
  Efecto: cualquier comparación mes contra mes sale absurda (+220% en
  presentados) aunque la fórmula sea correcta. Verificado que NO es el mes
  incompleto: días 1–27 de junio = 14 presentados frente a 15 del mes entero.
- **Mejora:** repartir la carga narrativa hacia atrás (que los casos vivos
  nazcan escalonados en las últimas 6-8 semanas) o subir el volumen de los
  meses cerrados para que la forma mensual no tenga un escalón ×3 en el último.
- **Impacto:** alto en credibilidad de demo; nulo en producción.
- **Fecha:** 2026-07-27 · ✅ **CERRADA el 2026-07-29.** La causa era que `fecha` (cuándo se
  presentó) y el ancla de la CONVERSACIÓN eran la misma variable (`altaOff`), así que dejar
  los hilos vivos obligaba a que todo naciera en las últimas dos semanas. Se separan, porque
  son dos hechos distintos: un presupuesto presentado hace seis semanas cuya conversación está
  viva hoy no es un artificio, es **el caso que el producto existe para rescatar** — y era el
  que faltaba. Reparto ponderado por mes (40/30/20/10: la cartera abierta pesa hacia lo
  reciente porque lo antiguo ya está decidido), determinista, y **también en los cerrados** —
  su fecha de cierre no se toca, pero presentarse en junio y aceptarse en julio es lo normal;
  dejarlos anclados era la otra mitad del escalón.
  · **Resultado:** presentados 9 · 16 · 13 · 28 · 24 · 28 → salto **×1.2** (era ×3.2, +220 %).
    "Firmado este mes" 33.181 € vs 22.757 € (+10.424 €) y "Se cierran" 67 % de 21 decididos
    vs 67 % de 15: comparables y creíbles.
  · **Efecto secundario bueno:** los días parados de los abiertos pasan de 2-11 a **2-49**, así
    que el criterio único de orden ("quién lleva más esperando") por fin tiene señal.
  · **Dos garantías duras** en el propio seed: la presentación nunca es posterior al primer
    mensaje del hilo ni a la fecha de cierre (verificado, 0 casos). Y **invariante nueva (C)**:
    el seed REVIENTA si los presentados del mes en curso superan ×2 los del mismo TRAMO del mes
    anterior — comparar contra el mes entero sería la trampa de siempre.
  · **Re-anclaje**: correr `demo:reset` el día 1 o 2 no tiene días donde repartir, así que la
    cuota del mes en curso se arrastra al anterior en vez de apilar catorce casos en la misma
    fecha (el mismo defecto, reproducido en un día). Simulado para los días 1, 2, 5, 15 y 29.
  · **Regresión que destapó la sonda de `qa:portal`:** `demo:reset` borra
    `configuraciones_clinica` en el wipe y **nunca sembró el catálogo de tipos de paciente** —
    el que existía venía de fuera del seed, así que cada reseed lo dejaba vacío. Sin él, la
    pestaña Tarifas enseña cards a cero, /red no enseña mezcla y el portal no puede mostrar
    cobertura. Añadidos el catálogo (1 propio + 3 aseguradoras) y la mezcla en pacientes
    (143/166, con cola sin tipo a propósito).

## 75. ✅ CERRADA — El rango escondía la mitad del trabajo abierto
- **Zona:** `RANGO_DEFAULT = "2s"` (`components/shared/RangoTemporal.tsx`) + `fechaDeRango`
  (`lib/presupuestos/pipeline.ts`), aplicado ahora a las dos vistas (nº 71)
- **Principio:** §1 misión ("no se te pierde nada") — **medido hoy con el seed realista de la
  nº 46: con el rango por defecto el tablero enseña 14 de 28 presupuestos abiertos.** Los que
  esconde son los presentados hace más de dos semanas, o sea **los más parados**, que es
  exactamente lo que el criterio único de orden considera más urgente. Antes no se veía porque
  todos los abiertos nacían dentro de la ventana.
- **Diagnóstico:** el rango nació para acotar el ARCHIVO (sustituyó el corte fijo de 14 días de
  las columnas cerradas) y se aplicó luego a todas. Para un caso cerrado, "de qué periodo" es
  la pregunta correcta; para uno abierto, es trabajo vivo independientemente de cuándo se
  presentó.
- **Recomendación (mía, sin ejecutar):** que el rango gobierne solo los CERRADOS y no esconda
  nunca un abierto. `fechaDeRango` ya distingue los dos casos (fecha de cierre vs de
  presentación), así que la asimetría está medio hecha en el diseño. Alternativa si se quiere
  un solo comportamiento: subir el defecto a "Trimestre", que hoy enseña 28 de 28.
- **Impacto:** alto — es la pantalla de trabajo del día escondiendo la mitad de la cola.
- **Fecha:** 2026-07-29 · ✅ **CERRADA el 2026-07-29.** Decisión de Simon: el rango gobierna
  solo los cerrados y nunca esconde un abierto. La regla vive en UNA función pura,
  `seVeConRango` (`lib/presupuestos/pipeline`), que consumen los tres sitios que antes
  repetían la misma línea: el tablero, la Tabla y el recuento de la cabecera.
  **La asimetría se DECLARA en la UI**, que era la otra mitad del encargo: bajo el propio
  control, "Acota aceptados y perdidos. Lo abierto se ve siempre" — sin decirlo, un control que
  filtra media pantalla y no la otra parece un fallo. Con ella, "En juego ahora" deja de decir
  "en el periodo" (ya no depende de él) y la Tabla dice qué esconde: "N **cerrados** fuera del
  periodo". El vacío también distingue los dos casos.
  Verificado en los cuatro rangos: **28/28 abiertos visibles siempre**, y las dos vistas
  siguen cuadrando (45·45, 49·49, 86·86, 123·123).

## 76. ✅ CERRADA — El gemelo en Leads: el rango escondía los activos más inactivos
- **Zona:** `app/(authed)/leads/LeadsView.tsx` (`enRango`), mismo control `RangoTemporal`
- **Principio:** §1 misión — hermano de la nº 75, y **atenuado a propósito por cómo está
  hecho**: Leads no filtra por fecha de alta sino por la del HITO (cierre para los cerrados,
  **última actividad** para los vivos, alta si no hay nada). Así que un lead con conversación
  reciente no desaparece nunca, venga de cuando venga — eso ya está bien.
- **Lo que sí queda (medido hoy en DEMO):** de **31 leads activos**, el rango por defecto de
  dos semanas enseña **26**. Los 5 que esconde son los que llevan más tiempo sin actividad —
  exactamente los que hay que rescatar. Es el mismo razonamiento de la nº 75 por otra puerta:
  un lead vivo es trabajo pendiente independientemente de cuándo se le tocó por última vez.
- **Mejora:** el gemelo de `seVeConRango` para leads (el rango acota solo Convertido y No
  Interesado), y declarar la asimetría junto al control como en Presupuestos.
- **Impacto:** medio-alto, y bajo en coste: la pieza ya está escrita al lado.
- **Fecha:** 2026-07-29 · ✅ **CERRADA el 2026-07-29**, aprobada por Simon con la misma regla.
  Y no es una copia: la REGLA se extrajo a `casoVisibleConRango` (`components/shared/
  RangoTemporal`, junto a `dentroDeRango`, que es el hogar del vocabulario de rango). Cada
  dominio aporta solo sus DOS hechos —¿está cerrado? ¿cuál es la fecha de su hito?— y su
  envoltorio legible: `seVeConRango` para presupuestos y `seVeLeadConRango` para leads. Dos
  envoltorios, una regla; si mañana cambia el criterio, cambia en un sitio.
  De paso `fechaDeRangoLead` sale de dentro del componente a `lib/leads/pipeline`, donde ya
  vivían `esLeadActivo` y el recuento — el hito de un lead es lógica de dominio, no de vista.
  **La asimetría se declara con el MISMO copy**, y literalmente el mismo: una constante
  compartida (`NOTA_RANGO_SOLO_CERRADOS`, "Acota lo cerrado. Lo que sigue vivo se ve siempre")
  bajo el selector en las dos pantallas. Dos textos que dicen lo mismo con palabras distintas
  son dos textos que divergen.
  Verificado en los cuatro rangos: **31/31 leads activos visibles siempre** (antes 26/31 con el
  defecto), y 28/28 presupuestos abiertos sigue en verde.

## 47. `/presupuestos/login` es una pantalla muerta contra un endpoint 410
- **Zona:** `app/presupuestos/login/page.tsx` → `POST /api/presupuestos/auth/login`
- **Principio:** §5 confianza — el formulario pide email y contraseña y su ruta
  responde 410 "método retirado" desde el Sprint A: el usuario que llegue solo
  puede fracasar. Sobrevivió a la unificación de sesión del 2026-07-27.
- **Mejora:** borrar la página (y con ella el endpoint 410) o redirigir a
  `/login`.
- **Impacto:** bajo; higiene pura (una puerta que no lleva a ningún sitio).
- **Fecha:** 2026-07-27 · 🔵

## 48. La gráfica de Progreso pinta el mes en curso junto a meses completos
- **Zona:** `app/lib/dashboard-red.ts` (serie `progreso`), `RedView` (AreaChart)
- **Principio:** coherencia — tras arreglar los deltas para comparar el mismo
  tramo del mes (2026-07-27), la gráfica sigue mezclando 5 meses cerrados con
  un sexto punto a medias. El último tramo de la curva no es comparable con el
  resto y se lee como una caída (o subida) real.
- **Mejora:** marcar el punto en curso (trazo discontinuo o etiqueta "en curso")
  o proyectar el mes al ritmo del tramo. No decidido: es decisión de producto.
- **Impacto:** medio — es la única pieza de la página que aún compara peras con
  manzanas.
- **Fecha:** 2026-07-27 · 🔵
- **2026-07-27 · 🟢 CERRADA**: decisión de Simon — se pinta, no se excluye. El último
  tramo va punteado y atenuado, el eje lo etiqueta "en curso" y el pie lo explica.
  Dos áreas con el MISMO juego de puntos que su trazo (con el relleno sobre la serie
  completa, las dos curvas `monotone` se calculaban sobre conjuntos distintos y se
  separaban a la vista) más una serie invisible que da un único valor al tooltip.

## 49. /red ignoraba el selector global de clínica
- **Zona:** `app/api/red/dashboard/route.ts`, `app/(authed)/red/RedView.tsx`
- **Principio:** coherencia — el selector de la cabecera filtra todo el producto, pero
  /red siempre usaba el scope de sesión: el manager cambiaba de clínica y la pantalla no
  se inmutaba. Y su propia tabla usaba ese mismo selector para "abrir el detalle" en
  /kpis, así que el control existía para esta pantalla pero no la afectaba.
- **Impacto:** alto — el dashboard del manager no podía responder "¿cómo va ESTA
  clínica?" sin salir a otra pantalla.
- **Fecha:** 2026-07-27 · 🔵
- **2026-07-27 · 🟢 CERRADA**: decisión de Simon — /red sigue al selector. Con una
  clínica elegida se filtra la pantalla entera, el titular pasa a ser su nombre (con
  "Ver toda la red"), "Tus clínicas" se retira (compararía una fila consigo misma) y
  "El negocio" ocupa la fila. Clic en una clínica filtra en vez de saltar a /kpis. El
  `?clinica=` viene del cliente y se verifica FAIL-CLOSED contra lo que ese usuario
  puede ver: 403, nunca "sin filtro". QA adversarial `scripts/qa-red-scope.mjs`
  (7/7 VERDE, incluidos clínica de otro cliente legal y clínica hermana desde
  coordinación).

## 50. ✅ CERRADA — El embudo no podía tener etapa "citados": faltaba el enlace, no el dato
- **Zona:** `leads.fecha_cita` / `leads.asistido`, `scripts/db-seed-demo-rico.mjs`,
  conversión lead→paciente (`markLeadConvertido`)
- **Principio:** §5 confianza — al montar el embudo de /red (2026-07-27) se pidió la
  etapa "citados" y resultó no ser derivable.
- **Evidencia (DEMO, medida hoy):** de 268 leads, solo **7** tienen `fecha_cita` y
  `asistido` está sin escribir en **los 268**. Pero **79** llegaron a ser paciente, y de
  esos 79, **cero** tienen `fecha_cita`. Un lead solo registra su cita si alguien lo
  arrastra a "Citado" en el tablero; cualquier otro camino de conversión la deja vacía.
  Consecuencia: un embudo con esa etapa SUBIRÍA de 7 citados a 35 con presupuesto, que es
  imposible en una cohorte anidada.
- **Mejora:** que la cita quede registrada en el lead venga por donde venga (agendar desde
  el panel, conversión, o derivarla de `citas` por paciente), y que `asistido` se escriba.
  Entonces la etapa entra en el embudo sin inventar nada.
- **Impacto:** alto para el embudo (hoy le falta justo el paso donde una clínica pierde
  más gente: los que piden cita y no aparecen) y medio para los KPIs de leads.
- **Fecha:** 2026-07-27 · ✅ **CERRADA el mismo día**. Resuelta derivando, no duplicando:
  `lib/leads/cita` resuelve la cita del lead (la suya, o la primera de su paciente dentro de
  90 días desde la captación) y declara lo no atribuible. Etapa "Consiguieron cita" en el
  embudo (268 → 86 → 79 → 35 → 7). Cerradas las dos puertas de escritura (PATCH de leads y
  copiloto) y el kanban exige Agendar desde cualquier columna. Sin tocar esquema.
  QA: `scripts/qa-leads-cita.mjs`. Ver DECISIONES.md.

## 51. El embudo solo cubre el 28% de los presupuestos: el resto no viene de un lead
- **Zona:** `lib/dashboard-red.ts` (embudo), modelo lead → paciente
- **Principio:** §5 confianza — de 123 presupuestos en DEMO, solo **35** pertenecen a un
  paciente que vino de un lead. El embudo lo dice en su pie ("no incluye pacientes que
  llegaron sin pasar por un lead"), pero conviene decidir si eso es realidad del negocio
  (pacientes de siempre, derivaciones, puerta fría) o un hueco del seed.
- **Mejora:** confirmar contra un piloto real; si en producción la mayoría de presupuestos
  tampoco nace de un lead, el embudo necesita una segunda entrada además de "lead captado".
- **Impacto:** medio — condiciona si el embudo describe el negocio o solo una esquina.
- **Fecha:** 2026-07-27 · 🔵

## 52. ✅ CERRADA — `toISOString().slice(0,10)` como "hoy": el día salía de UTC
- **Zona:** `SeguimientoView.tsx:367` y `:703`, `LeadAccionPanel.tsx:87`, `:174`, `:393`,
  `MaximaView.tsx:519`, `NewPresupuestoModal.tsx:52`, `PagoModal.tsx:62`
- **Principio:** §5 confianza. **Ventana real, medida (corrige lo que puse el 27):** para
  Madrid, UTC va por DETRÁS, así que el día se desincroniza entre las **00:00 y las 02:00**
  (00:00-01:00 en invierno) y ahí el producto cree que sigue siendo ayer. Lo que se vio a
  las 21:32 fue el error espejo de una máquina en UTC−4 (la de las demos), donde UTC va por
  delante desde las 20:00 locales. Efecto: una cita del 29 anunciada como "mañana" y un lead
  citado para hoy fuera de la columna "Citados Hoy".
- **Mejora:** `hoyISO()` ya existe en `lib/time` y /leads ya lo usa. Sustituir las ocho
  ocurrencias restantes; la de Seguimiento es la más grave porque decide cohortes.
- **Impacto:** alto en una ventana de dos horas al día y cero el resto — que es justo lo que
  lo hacía difícil de reproducir y fácil de dejar pasar.
- **Fecha:** 2026-07-27 · ✅ **CERRADA el 2026-07-29.** No eran ocho ocurrencias sino 56 del
  patrón; censo completo en DECISIONES.md. `lib/time` pasa a ser tz-aware
  (`TZ_CLINICA`, `hoyISO`, `mesISO`, `horaClinica`, `sumaDias`, `inicioDelDiaUTC`) porque en
  Vercel el proceso corre en UTC y la hora local del runtime tampoco servía. Test permanente:
  `npm run qa:fechas` (31 comprobaciones, verdes con TZ=UTC · Madrid · New_York · Tokyo).

## 53. El tablero de Leads no prioriza: 12 cards idénticas en "Nuevo"
- **Zona:** `app/(authed)/leads/LeadsView.tsx`
- **Principio:** §3 anticipación — el kanban ordena por nada. La coordinadora abre "Nuevo"
  con doce cards del mismo peso y decide ella por dónde empezar, mientras /seguimiento ya
  tiene un motor que sabe cuál urge. La pasada visual del 2026-07-27 añadió la etiqueta
  "Necesita atención" (mismo umbral del motor), pero es una señal, no un orden.
- **Mejora:** ordenar cada columna por el criterio del motor de cohortes que ya existe, en
  vez de por fecha de creación. Cero criterio nuevo: reutilizar el de /seguimiento.
- **Impacto:** medio-alto en pérdida evitada, bajo en coste — el motor ya está escrito.
- **Fecha:** 2026-07-27 · 🔵

## 54. Leads en móvil: 12.000 px de scroll y lo urgente en cuarta posición
- **Zona:** `app/(authed)/leads/LeadsView.tsx` (layout del tablero)
- **Principio:** §2 facilidad — en 390 px las cinco columnas se apilan sin selector, así que
  "Citados Hoy" (la única con hora, la que caduca hoy) queda tras unas 28 cards. La
  coordinadora usa el móvil entre paciente y paciente.
- **Mejora:** selector de columna en móvil (pestañas tipo ColaTabs) o abrir directamente por
  la columna con trabajo del día. **Fuera del alcance de la pasada visual del 2026-07-27**:
  toca la estructura del tablero, que Simon dejó explícitamente sin tocar.
- **Impacto:** alto en uso real de móvil.
- **Fecha:** 2026-07-27 · 🔵

## 55. La cabecera de Leads cuenta la pantalla, no el negocio
- **Zona:** `app/(authed)/leads/LeadsView.tsx` (cabecera)
- **Principio:** §1 misión — "27 leads activos · 7 no interesados" es un recuento de lo que
  ya se ve. /red y /cobros abren con cifras de negocio (en riesgo, cobrado, pendiente);
  aquí no hay ninguna: ni cuántos sin contactar, ni tiempo medio de respuesta, ni cuántos
  citados esta semana.
- **Mejora:** franja compacta con 3 cifras, reutilizando `Cifra`/`Comparativa`.
- **Impacto:** medio. **Fuera del alcance de la pasada visual del 2026-07-27** (añade
  estructura nueva, y el encargo excluía tocar la del tablero).
- **Fecha:** 2026-07-27 · 🔵

## 56. "Ver 151 anteriores" en No Interesado no lleva a nada útil
- **Zona:** `app/(authed)/leads/LeadsView.tsx` (pie de columna)
- **Principio:** §2 facilidad — el enlace cambia el rango a "Histórico" y vuelca 151 leads
  descartados en una columna del tablero de trabajo. Nadie revisa 151 descartes; lo que sí
  tiene valor es el subgrupo "Se puede retomar".
- **Mejora:** en No Interesado, que el pie ofrezca solo los reactivables ("Ver 23 que se
  pueden retomar") en vez del volcado completo.
- **Impacto:** bajo-medio.
- **Fecha:** 2026-07-27 · 🔵

## 57. ✅ CERRADA — El portal del paciente, probado de punta a punta (19/19)
- **Zona:** `app/api/presupuestos/[id]/generar-portal/route.ts`, `app/api/portal/[token]/route.ts`,
  `scripts/qa-tipo-paciente.mjs`
- **Principio:** §5 confianza. El portal enseñaba el desglose de cobertura solo si
  `tipoPaciente === "Adeslas"`; ahora usa la marca de aseguradora del catálogo. **La REGLA
  está verificada** (el QA comprueba que `esAseguradora` distingue Privado de las mutuas),
  **pero el FLUJO COMPLETO no**: `generar-portal` escribe en Vercel KV y en local devuelve
  500 ("fetch failed"), así que la cadena generar → leer → pintar no se ha ejecutado nunca
  con el código nuevo.
- **Agravante:** la primera versión de ese QA daba **verde por casualidad** —
  `Boolean(undefined) === false` hacía pasar el caso "Privado"— y roja para las tres mutuas.
  Ahora el script DECLARA que omite la prueba en vez de fingir que pasa, pero eso no la
  sustituye.
- **Mejora:** correr `node scripts/qa-tipo-paciente.mjs` una vez contra un entorno con KV
  (preview de Vercel o KV local) y confirmar que un paciente de Sanitas ve su desglose.
- **Impacto:** alto — es lo que ve el PACIENTE, no la coordinadora, y falla en silencio.
- **Fecha:** 2026-07-29 · 🔵 **PRIORIDAD ALTA por Simon**: no se da por cerrado hasta
  comprobarlo.
- **2026-07-29 · el código está arreglado; la EJECUCIÓN sigue pendiente.** Al leerlo
  aparecieron dos cosas peores que la que se iba a comprobar, ya cerradas:
  (a) `generar-portal` FABRICABA un "Paciente Demo" con 4.200 € y devolvía un enlace
  que funcionaba, si el presupuesto no se podía leer y el usuario era admin — la
  barrida de la nº 59 no la vio porque esa puerta no la gobernaba una variable de
  entorno; (b) aceptar desde el portal era un **no-op silencioso para todos**: se
  resolvía a `PILOT_CLIENTE` (RB), RLS filtraba la fila, el UPDATE afectaba a cero
  filas sin lanzar, y el token quedaba marcado como respondido. El paciente leía
  "gracias por aceptar" y el kanban no se enteraba. El orden de escritura de la
  nº 20 era correcto; faltaba comprobar que la escritura escribió (ahora
  `lib/db/escritura`) y saber en qué base escribir (ahora el cliente viaja en el
  token). QA nuevo `npm run qa:portal` (`scripts/qa-portal-paciente.mjs`) con los
  SEIS puntos, incluido leer la fila del kanban tras aceptar.
  Primer intento BLOQUEADO POR ENTORNO: el store de KV al que apuntaban las variables
  **no existía** (`direct-dassie-46333.upstash.io` → `ENOTFOUND`, comprobado también
  fuera del sandbox). El QA abortó con exit 2 y el motivo escrito, en vez de fingir.
- **2026-07-29 · ✅ CERRADA. CORRIDA Y VERDE: 19 comprobaciones, 0 KO**
  (`QA_BASE_URL=http://localhost:3100 npm run qa:portal`, contra el build de
  producción y el KV nuevo `prompt-chicken-173778`). Los seis puntos afirmados:
  se genera el enlace · el paciente ve SUS datos (nombre, importe y clínica reales,
  y un presupuesto ilegible da 404 en vez de un enlace fabricado) · el desglose
  aparece por la REGLA "tiene aseguradora" y no por el nombre —comprobado con
  **Sanitas**, que activa, y con **Privado**, que no— · nombra la aseguradora
  correcta · los importes salen de `eur()` y el fuente del portal no escribe ni un
  euro a mano · y aceptar PERSISTE: la fila queda ACEPTADO **leída de la base**, con
  fecha de aceptación, sin borrar las notas, con la firma en el historial, un
  segundo envío rechazado con 409, y —forzando el fallo con un token de otro
  cliente— error honesto, presupuesto intacto y enlace todavía reutilizable.
  **Las variables de KV pasan a `FYLLIO_KV_REST_API_URL` / `FYLLIO_KV_REST_API_TOKEN`**
  (Vercel exige prefijo en este proyecto). El singleton de `@vercel/kv` lee los
  nombres sin prefijo, así que el cliente se construye en `lib/kv` — un solo sitio,
  sin ramas "una u otra"— y los diez consumidores importan de ahí.
  **Y la propia ejecución cazó un bug que el código anterior tenía:** el portal
  resolvía la aseguradora desde `presupuestos.tipo_paciente`, la copia congelada al
  crear, en vez de desde el paciente. Corregir la mutua de una persona no cambiaba lo
  que veía en su enlace, y el enlace se genera DESPUÉS de la corrección. Ahora manda
  el paciente (y "sin tipo" es una respuesta, no un hueco que rellenar con el valor
  viejo); la copia solo se usa para presupuestos huérfanos.

## 58. Filtro por tipo de paciente en el kanban: cuando el dato tenga contenido
- **Zona:** `app/api/presupuestos/kanban/route.ts` (`?tipoPaciente=` ya se acepta), UI del kanban
- **Principio:** §2 facilidad — el parámetro existe en la API desde siempre y ninguna pantalla
  lo ofrece. Con el campo recién creado y sin backfill, un filtro por tipo hoy filtraría a
  cero en producción: sería ruido con aspecto de función.
- **Mejora:** añadirlo cuando el piloto tenga tipos rellenados de verdad (se rellenan con el
  uso). Decisión de Simon del 2026-07-29: **no añadirlo ahora**.
- **Impacto:** bajo hoy, medio cuando el dato exista.
- **Fecha:** 2026-07-29 · 🔵

## 59. ✅ CERRADA — Rutas sirviendo datos DEMO en producción por variables de Airtable retiradas
- **Zona:** `automatizaciones/secuencias`, `automatizaciones/configuracion`,
  `automatizaciones/seed-demo`, `automatizaciones/procesar`, `presupuestos/intervencion`,
  `presupuestos/objetivos` (×2) y las que queden con el mismo patrón
- **Principio:** §4 — todas empiezan con
  `if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) return <datos demo>`.
  **Airtable está retirado del producto** (los datos salen de Postgres), así que esa condición
  no significa nada: basta con que un entorno no tenga unas variables muertas para que la
  pantalla sirva datos inventados con cara de reales. En local existen en `.env.local`, por
  eso no se nota; en Vercel no se ha comprobado.
- **Mejora:** retirar la puerta en las nueve, como ya se hizo en `presupuestos/paciente`
  (2026-07-29). Y comprobar si esas variables siguen definidas en Vercel — si no lo están,
  esto está activo en producción.
- **Impacto:** CONFIRMADO EN PRODUCCIÓN. Simon verificó que las dos variables no existen en
  Vercel, así que la condición se cumplía SIEMPRE. No eran nueve rutas sino **quince sitios en
  trece archivos**, incluido el cron de automatizaciones y seis ESCRITURAS que confirmaban
  éxito sin escribir.
- **Fecha:** 2026-07-29 · ✅ **CERRADA el mismo día.** Eliminadas todas las puertas, no
  re-condicionadas. Ver DECISIONES.md para el detalle de qué devolvía cada una.

## 60. `NoShowRiskPanel` llama a una ruta que no existe (404)
- **Zona:** `app/components/dashboard/NoShowRiskPanel.tsx:353` → `/api/dashboard/noshow-risk`
- **Principio:** §9 — la carpeta `app/api/dashboard/` **no existe**. El panel llevaba
  fallando siempre, y no se notaba porque su catch era `{ /* silent */ }` literal. Lo destapó
  el barrido de errores del 2026-07-29.
- **Matiz:** el componente **no está montado en ninguna pantalla** — no tiene ningún consumidor
  (se comprobó por grep). Así que hoy no rompe nada visible: es código muerto que apuntaba a
  una ruta muerta.
- **Mejora:** decidir si el panel entra en el módulo de no-shows (congelado) o se retira. No
  dejarlo a medias: un componente que llama a una ruta inexistente es una trampa para el
  siguiente que lo monte.
- **Impacto:** nulo hoy, alto el día que alguien lo monte creyendo que funciona.
- **Fecha:** 2026-07-29 · ✅ **cerrada el 2026-08-03: se retira.** La auditoría de WhatsApp
  destapó que el panel llamaba además a `/api/whatsapp/send`, y la arqueología dio la respuesta:
  esa ruta y las tres que usaba `OperationsPanel` (`/api/db/appointments`, `/api/db/quotes`,
  `/api/dashboard/*`) **se borraron a propósito** en `a8717a3` («fuera la isla de prototipo
  bloqueada en producción»), junto con las páginas `/demo` y `/dashboard` y ~40 componentes.
  `NoShowRiskPanel` y `OperationsPanel` eran **los dos supervivientes de esa misma limpieza**:
  el censo de huérfanos confirmó que nadie los importaba (solo se citaban entre sí, en
  comentarios). Se borran los dos (1.599 líneas), y con ellos las **3 entradas de deuda `?? []`**
  que el trinquete llevaba declaradas precisamente porque el archivo «hay que BORRAR, no
  migrar»: la deuda baja de **15 a 12**. Queda **cero** rutas inexistentes llamadas desde
  componentes. `InformesView` sigue sin montar, pero eso es MEJORAS 81, no residuo.

## 61. El CSV de la Tabla exporta otra cosa que la que estás viendo (D7)
- **Zona:** `MaximaView.tsx` (`ExportCsvButton`) → `/api/export/presupuestos.csv`
- **Principio:** §5 confianza — filtras "Intervención · 12", exportas y te llevas
  los 123. Ni el pill, ni el doctor, ni el tratamiento, ni la búsqueda viajan al
  endpoint; solo la clínica. El prop `estado` era literalmente
  `pillActiva === "todos" ? null : null` (la misma rama dos veces), retirado el
  2026-07-29 en vez de seguir fingiendo que se mandaba algo.
- **Mejora:** pasar los cuatro filtros activos al endpoint (o exportar en cliente
  la lista ya filtrada, que es lo que la coordinadora cree que está haciendo).
  Es la ÚNICA exportación del producto.
- **Impacto:** medio — quien la usa para un informe se lleva datos que no pidió.
- **Fecha:** 2026-07-29 · 🔵

## 62. Las notas del presupuesto siguen enseñando el apaño de los pipes (D10)
- **Zona:** `app/api/presupuestos/kanban/route.ts:102-128` (parseo de
  `| Doctor: X | Clínica Y | Privado | 1ª Visita |` desde `Notas`, y `notes`
  viajando crudo al cliente), `NewPresupuestoModal.tsx:119`
- **Principio:** §2 facilidad / estándar visual §5 (jerga en superficie de
  coordinadora) — el modal limpia el `[SEED_PRES]` pero NO los pipes: al pulsar
  "Editar", la coordinadora ve metadatos de infraestructura dentro de su caja de
  notas, y si guarda los reescribe. El apaño nació porque el POST no escribía
  esos campos (arreglado el 2026-07-29); el lado de LECTURA sigue vivo.
- **Mejora:** retirar el parseo y limpiar los pipes de `notes` antes de servirlo;
  migración opcional que los borre de las filas que los tengan.
- **Impacto:** bajo-medio (credibilidad; ninguna decisión depende de eso).
- **Fecha:** 2026-07-29 · 🔵

## 63. El sondeo del tablero trae 500 registros cada minuto para contarlos (D12)
- **Zona:** `PresupuestosShell.tsx` (intervalo de 60 s sobre `/api/presupuestos/kanban`)
- **Principio:** eficiencia — el banner "N presupuestos nuevos" necesita UN
  número y se descarga la cola entera. (Los dos bugs de ese sondeo —contar la red
  entera ignorando el filtro de clínica, y el `?? []` con catch mudo que dejaba
  el contador en 0 y luego anunciaba "123 nuevos"— se cerraron el 2026-07-29.)
- **Mejora:** un `HEAD`/endpoint de recuento, o cabecera `X-Total`.
- **Impacto:** bajo (en producción la DB está al lado); higiene.
- **Fecha:** 2026-07-29 · 🔵

## 64. El evento del motor se emite después de la respuesta sin `after()` (D13)
- **Zona:** `app/api/presupuestos/kanban/[id]/route.ts` (`void (async () => …)()`
  justo antes del `return`)
- **Principio:** mandamiento §1 — en Vercel el sandbox se congela tras responder,
  así que ese trabajo no está garantizado. El webhook de WhatsApp usa `after()`
  por esta razón exacta (`webhooks/whatsapp/route.ts:280`).
- **Mejora:** envolverlo en `after()`.
- **Impacto:** latente mientras la vía WhatsApp sea esqueleto; el día que envíe,
  un cambio de estado puede no disparar su regla.
- **Fecha:** 2026-07-29 · 🔵

## 65. Tope silencioso de 500 presupuestos en el tablero (D14)
- **Zona:** `app/api/presupuestos/kanban/route.ts` (`maxRecords: 500`)
- **Principio:** §9 — las columnas y la Tabla SÍ dicen lo que esconden ("Ver más
  (N)", "Ver N anteriores"); este tope no dice nada. Con 123 en DEMO no muerde.
- **Mejora:** o paginar de verdad, o declarar el corte en pantalla cuando se
  alcance ("se muestran los 500 más recientes").
- **Impacto:** bajo hoy, alto para una red con volumen.
- **Fecha:** 2026-07-29 · 🔵

## 66. `Europe/Madrid` escrito a mano en diez archivos (D16)
- **Zona:** `const ZONE = "Europe/Madrid"` en `api/presupuestos/kanban/route.ts`,
  `kanban/[id]/route.ts`, `lib/presupuestos/intervencion.ts`,
  `lib/presupuestos/mensajeria.ts`, `lib/copilot/tools-exec.ts`,
  `lib/no-shows/score.ts`, `lib/demo/seed.ts`,
  `lib/scheduler/waitlist/eligibility.ts`, `api/kpis/no-shows/route.ts`
  *(las dos de `components/` desaparecieron con MEJORAS 60 el 2026-08-03: quedan **ocho**)*
- **Principio:** una sola verdad — `TZ_CLINICA` vive en `lib/time` desde que se
  cerró MEJORAS 52. Hoy todas dicen lo mismo; el día que un cliente esté en otra
  zona, se cambia en un sitio y hay diez que no.
- **Mejora:** importar `TZ_CLINICA` en las diez.
- **Impacto:** bajo hoy, alto el día del segundo huso. Cambio mecánico.
- **Fecha:** 2026-07-29 · 🔵

## 67. Llamar desde la card no deja rastro; el mismo botón en el panel sí (D17)
- **Zona:** `KanbanBoard.tsx` (`<a href="tel:">` puro) vs
  `IntervencionSidePanel.tsx:264` (`handleLlamar` registra con `res.ok` + toast)
- **Principio:** §6 coherencia / §5 feedback — misma acción, dos comportamientos.
  Las llamadas hechas desde el tablero no entran en el hilo ni en el KPI de
  tiempo de respuesta. Si la regla es "las cards informan, los paneles actúan",
  la propuesta es QUITAR los botones de la card, no duplicar el registro. Es
  decisión de producto. (Twin en Leads: allí la card tiene los mismos dos botones.)
- **Impacto:** medio para los KPIs de actividad.
- **Fecha:** 2026-07-29 · 🔵

## 68. El link al paciente va por NOMBRE y resuelve al primero que encuentre (D18)
- **Zona:** `MaximaView.tsx` (celda Paciente) → `/presupuestos/paciente/[nombre]`
  → `page.tsx:32` (`listPacientes({search})`, y si no hay match exacto `pacs[0]`)
- **Principio:** §5 confianza — dos pacientes con el mismo nombre y siempre se
  abre la ficha del primero. El payload de la Tabla no lleva `pacienteId`
  (`types.ts`, `Presupuesto` no lo tiene), así que el arreglo empieza en el
  contrato: añadir el id y enlazar a `/pacientes/[id]` directamente.
- **Impacto:** medio (abrir la ficha equivocada de un paciente es grave, aunque
  sea raro).
- **Fecha:** 2026-07-29 · 🔵

## 69. Higiene de la zona de Presupuestos
- **Zona:** varios
- **Qué:** `velocidad.lenta` se calcula en `KanbanBoard.tsx` y no se pinta nunca ·
  `fechaDesde`/`fechaHasta` que la API acepta y ningún cliente manda
  (`kanban/route.ts:48`) · el overlay de modal escrito de tres formas distintas
  (`bg-slate-900/40` ×3 y `bg-black/30`, ninguna con token) · emoji en el push de
  presupuesto aceptado (`"✅ Presupuesto aceptado"`, `kanban/[id]/route.ts`) ·
  `components/presupuestos/Paciente360View.tsx` (636 líneas) es una ficha
  PARALELA a la buena, viva solo por el fallback de un nombre que no resuelve, y
  con hex a mano y dos de los `?? []` declarados · los indicadores de orden de la
  Tabla son `▲`/`▼` de texto, no lucide · `TimelineAcciones.tsx:101` pinta fechas
  con la zona del navegador.
- **Impacto:** ⚪ higiene. Suelto, no una tanda.
- **Fecha:** 2026-07-29 · 🔵

## 70. Presupuestos en móvil: seis columnas apiladas y la tabla a 950 px
- **Zona:** `KanbanBoard.tsx` (`grid-cols-1 md:grid-cols-2 xl:grid-cols-6`),
  `MaximaView.tsx` (tabla `table-fixed` de ~950 px con scroll horizontal)
- **Principio:** §2 facilidad — gemelo exacto de la nº 54 (Leads) y peor:
  PRESENTADO va primera con hasta 25 cards antes de llegar a lo accionable. La
  coordinadora usa el móvil entre paciente y paciente.
- **Mejora:** selector de columna en móvil (patrón ColaTabs), y abrir por la
  columna con trabajo del día. Fuera del alcance de la pasada visual: toca la
  estructura del tablero.
- **Impacto:** alto en uso real de móvil.
- **Fecha:** 2026-07-29 · 🔵

## 71. ✅ CERRADA — El rango gobierna las DOS vistas y el selector no desaparece
- **Zona:** `PresupuestosShell.tsx` (`RangoTemporal` solo se renderiza en la vista
  Tablero), `MaximaView.tsx` (no filtra por rango en absoluto)
- **Principio:** §6 coherencia — son DOS VISTAS DE LO MISMO y un filtro que
  aplica a una y no a la otra es una trampa.
- **Medido hoy en DEMO (123 presupuestos):** el Tablero pinta 45 · 49 · 86 · 123
  según el rango (2 semanas · mes · trimestre · histórico); la Tabla siempre 123.
  Los ABIERTOS son 28 en los cuatro rangos —todos se presentaron en las últimas
  dos semanas, efecto de la nº 46— así que lo que el rango esconde son los
  CERRADOS. Y el selector no existe en la Tabla, así que no hay forma de saber
  que hay un rango en juego.
- **Diagnóstico de la contradicción original ("29 abiertos" vs "124
  presupuestos"):** no eran dos medidas del mismo conjunto, eran dos universos
  distintos —abiertos-en-el-rango vs todos-los-estados-sin-rango— y ninguna
  etiqueta lo decía. Eso ya está cerrado el 2026-07-29: la cabecera dice "N
  presupuestos abiertos en el periodo" y la Tabla "N presupuestos en total".
- **Recomendación (mía, sin ejecutar):** rango en LAS DOS, con el selector movido
  a la fila de la cabecera para que no desaparezca al cambiar de vista, y
  MaximaView filtrando con las MISMAS `fechaDeRango`/`dentroDeRango` del tablero
  (cero criterio nuevo). Las dos cifras del mes siguen declarando su ventana en
  su etiqueta, que es lo que las hace no contradictorias.
- **Impacto:** medio-alto en confianza en los números de la pantalla.
- **Fecha:** 2026-07-29 · ✅ **CERRADA el 2026-07-29.** Decisión de Simon: rango en las dos
  ("un filtro que aplica a una vista y no a su gemela es una trampa"). El selector sube a la
  fila de la CABECERA, junto al conmutador, así que ya no desaparece al cambiar de lente; la
  Tabla filtra con las MISMAS funciones puras del tablero (`fechaDeRango` + `dentroDeRango`),
  cero criterio nuevo, y sus pills y recuentos se derivan del conjunto en rango — un pill que
  cuenta filas que la tabla no pinta es el mismo error un nivel más abajo. Lo que el rango
  esconde se DICE ("N fuera del periodo"), como en las columnas del kanban, y el vacío
  distingue "el periodo no tiene nada" de "ajusta los filtros".
  **Lo que faltaba y no se veía:** pasarle el rango a la vista no bastaba. `/api/presupuestos/maxima`
  **no mandaba las fechas de cierre**, así que `fechaDeRango` devolvía null para todo
  ACEPTADO/PERDIDO y `dentroDeRango` los mostraba siempre — la Tabla seguía enseñando los 123
  en cualquier periodo. El filtro estaba puesto; el dato con el que filtrar no viajaba. La
  ruta añade `fechaAceptado` y deriva `fechaPerdida` del historial, con las mismas piezas que
  el kanban. Verificado: tablero y tabla cuadran en los cuatro rangos (45·45, 49·49, 86·86,
  123·123).

## 72. `verificar:produccion` deja un presupuesto de prueba en los datos cada vez
- **Zona:** `scripts/verificar-produccion.mjs:239-255`
- **Principio:** §9 — la herramienta AVISA de que lo deja ("bórralo desde la
  tabla") porque la ruta no expone DELETE, pero el aviso se pierde en el log y la
  fila se queda en la pantalla que se enseña en demos. Se borró uno a mano el
  2026-07-29 (1 €, "Revisión general", notas "VERIFICACION DE DESPLIEGUE").
- **Mejora:** que la comprobación de escritura use un PATCH reversible sobre una
  fila existente (escribir y restaurar, como hace `qa-portal-paciente`), o exponer
  el borrado. Una verificación que ensucia los datos se deja de correr.
- **Impacto:** bajo, pero crece: una fila por ejecución.
- **Fecha:** 2026-07-29 · 🔵

## 73. El portal del paciente no tiene teléfono de la clínica
- **Zona:** `generar-portal/route.ts` (`clinicaTelefono: undefined` con el
  comentario "No clinic phone in Airtable yet")
- **Principio:** §1 misión — el paciente recibe un presupuesto de miles de euros
  y no tiene a quién llamar. `clinicas` en Postgres puede tener el teléfono; el
  comentario es de la época de Airtable.
- **Mejora:** poblarlo desde `clinicas` al generar el token y enseñarlo en el
  portal.
- **Impacto:** medio en conversión (una duda sin canal es una duda que no se
  resuelve).
- **Fecha:** 2026-07-29 · 🔵

## 74. Dos sintaxis de placeholder en la misma tabla de plantillas
- **Zona:** `IntervencionSidePanel.tsx` (`replace(/\{importe\}/g, …)`) vs
  `lib/plantillas/plantillas.ts:154` (documenta `{{nombre}}`)
- **Principio:** §6 coherencia — la tabla `plantillas_mensaje` guarda las dos
  familias. Las de presupuestos usan `{importe}` y las de cobranza `{{importe}}`;
  una plantilla escrita con dobles llaves y aplicada desde el panel llega al
  paciente como `{2.400 €}`.
- **Mejora:** un solo renderizador de plantillas para las dos familias.
- **Impacto:** bajo hoy (las familias se separan por `tipo`), medio en cuanto la
  coordinadora escriba sus propias plantillas en Ajustes.
- **Fecha:** 2026-07-29 · 🔵

### CENSO COMPLETO — 2026-08-01 (pedido por Simon antes de la reunión de RB)

**La causa no son dos sintaxis: son DOS EDITORES sobre la MISMA tabla**
(`plantillas_mensaje`), cada uno con su API y su vocabulario. Las sintaxis son
el síntoma.

| | Automatizaciones → Plantillas | Ajustes → Plantillas WhatsApp |
|---|---|---|
| Ruta | `/automatizaciones` → "Reglas y objetivos" → Plantillas | `/ajustes/configuracion` → Plantillas WhatsApp |
| API | `/api/presupuestos/plantillas` | `/api/plantillas` |
| Discriminador en la fila | `categoria = NULL` | `categoria = 'cobranza'` |
| Sintaxis | `{una llave}` | `{{dos llaves}}` |
| Variables | `{nombre}` `{tratamiento}` `{importe}` `{doctor}` `{clinica}` | `{{nombre}}` `{{tratamiento}}` `{{importe}}` `{{nombre_doctor}}` `{{nombre_clinica}}` `{{pendiente}}` `{{dias_vencido}}` |

**No es solo el número de llaves: los NOMBRES también difieren** — `{doctor}` vs
`{{nombre_doctor}}`, `{clinica}` vs `{{nombre_clinica}}`. Son dos diccionarios
de variables distintos, no dos formatos del mismo.

**Las 8 filas que existen hoy, en las tres bases:**

| Cliente | Nombre | tipo | categoria | Sintaxis | Editor |
|---|---|---|---|---|---|
| DEMO | Confirmación de aceptación | Confirmacion | — | `{simples}` | Automatizaciones |
| DEMO | Detalles de pago | Detalles de pago | — | `{simples}` | Automatizaciones |
| DEMO | Financiación | Financiacion | — | `{simples}` | Automatizaciones |
| DEMO | Reactivación | Reactivacion | — | `{simples}` | Automatizaciones |
| DEMO | Seguimiento de presupuesto | Seguimiento | — | `{simples}` | Automatizaciones |
| DEMO | recordatorio_liquidacion | Cobranza | cobranza | `{{dobles}}` | Ajustes |
| DEMO | recordatorio_primer_pago | Cobranza | cobranza | `{{dobles}}` | Ajustes |
| DEMO | recordatorio_senal | Cobranza | cobranza | `{{dobles}}` | Ajustes |

**Tres hechos que importan para la reunión:**
1. **RB e INDEP tienen CERO plantillas.** Las 8 son de DEMO. No hay nada que
   migrar, y todo lo que RB escriba caerá en el editor que abra primero.
2. **Cero filas mezclan las dos sintaxis** hoy. La separación es limpia y el
   reparto es exactamente por editor — lo que confirma que el editor es la causa.
3. `{{pendiente}}` y `{{dias_vencido}}` **solo existen** en la familia de
   Ajustes. `{{pendiente}}` es la variable que se creó el 2026-07-24 para que un
   recordatorio de cobro no reclamara el total firmado: si alguien la escribe en
   el editor de Automatizaciones, no se sustituye y el paciente recibe el texto
   con las llaves puestas.

**Mitigación puesta hoy (no es el arreglo):** el editor de Automatizaciones avisa
de que ahí las variables van con **una sola llave**, y si se detecta `{{…}}` en
el contenido sale una advertencia antes de guardar. Es una tirita hasta la fusión
(MEJORAS 13, aprobada para después del piloto), que es donde esto se cierra de
verdad: un editor, un vocabulario, un renderizador.

## 77. "1ª visita vs con historial" no existe en el dato: el 100% son primeras visitas
- **Zona:** `lib/presupuestos/tipo-visita.ts`, `api/presupuestos/kpis/route.ts`
- **Principio:** §1 misión / §4 no inventar — el KPI enseñaba "0 y 0" por una
  mayúscula (`"Primera Visita"` en el código, `"Primera visita"` en la base). Eso
  ya está arreglado (2026-07-30, bloque 1.3), pero al arreglarlo se ve el fondo:
  **los 123 presupuestos de DEMO tienen el mismo valor**, y ninguno dice "Paciente
  con Historia". Nadie escribe ese valor: Leads solo maneja "Primera visita ·
  Revisión · Urgencia" y la conversión lead→presupuesto copia el del lead tal cual
  (`convertir/route.ts:117`). El KPI ahora dice la verdad —123 y 0— pero sigue sin
  informar de nada.
- **Mejora:** derivarlo de verdad (un presupuesto es "ya era paciente" si su
  paciente tiene una cita o un presupuesto ANTERIOR a este), que es dato que ya
  existe; o retirar el corte y decir por qué. La pestaña "Tipo Paciente" entera
  depende de esto.
- **Impacto:** medio — es una de las siete pestañas de /kpis y hoy no dice nada.
- **Fecha:** 2026-07-30 · 🔵

## 78. ✅ CERRADA — El origen sí se sabía: estaba en el lead, no en el presupuesto
- **Zona:** `lib/leads/captacion.ts` (nuevo), `api/presupuestos/kpis/route.ts`
- **Cerrada:** 2026-07-30. La intuición de Simon era correcta: misma forma que la
  79. `presupuestos.origen_lead` está a null en las 123 filas —solo lo escribe la
  conversión lead→presupuesto—, pero el canal vive en el lead que trajo al
  paciente, por el mismo vínculo `leads.paciente_id` que destapó el "Cobrado 0 €".
  Se deriva con una consulta de dos columnas, sin duplicar nada.
- **El matiz que cambia el arreglo:** cubre 35 de 123 (28%), y no porque falte
  dato — los otros 88 son pacientes que la clínica YA tenía, y no vinieron de
  ninguna captación. Es el mismo 28% anotado en la nº 51 para el embudo. Por eso
  los dos casos se separan con etiquetas distintas: "Paciente ya en la clínica"
  (no aplica) y "Captado, canal sin registrar" (no se sabe). Meterlos en el mismo
  saco "Sin origen" era el bug de fondo.
- **Verificado:** la pestaña pasa de 1 fila a 7 que discriminan de verdad —
  pacientes de siempre cierran al 95%, la captación entre el 17% y el 33%.

## 79. El vínculo lead→paciente está guardado dos veces y solo se llena uno
- **Zona:** `pacientes.lead_origen_id` vs `leads.paciente_id`;
  `lib/pacientes/pg.ts:createPacienteDesdeConversionPg`
- **Principio:** §6 coherencia — la conversión NUNCA escribe `lead_origen_id` (está
  documentado como follow-up en `pacientes.ts:178`), así que estaba a null en los
  166 pacientes de DEMO y en cualquiera creado en producción. Todo lo que filtraba
  "pacientes de origen lead" por ese campo devolvía cero: por eso "Cobrado" salía
  0 € con 15 convertidos y pagos reales. La lectura ya acepta los dos lados
  (2026-07-30, bloque 1.5), pero el campo duplicado sigue ahí.
- **Mejora:** decidir cuál es la casa del vínculo. Recomendación: `leads.paciente_id`
  (es el que se llena y el que ya usa el ranking de doctores) y borrar
  `pacientes.lead_origen_id`, en vez de escribir los dos y dejar que diverjan.
- **Impacto:** medio — mientras existan los dos, cualquier consulta nueva puede
  volver a elegir el vacío.
- **Fecha:** 2026-07-30 · 🔵

## 80. `/api/leads/kpis` abre ~20 transacciones para pintar una pantalla
- **Zona:** `api/leads/kpis/route.ts`, `lib/pagos-pg.ts:getFacturadoEnPeriodoPg`
- **Principio:** §3 facilidad / rendimiento. **Medido el 2026-07-30, y ojo con la
  interpretación:** la ruta tarda **23 s desde local** pero eso es sobre todo la
  latencia de mi portátil con Supabase, no la ruta. Round-trip medido: **~200 ms**.
  Un `runWithClienteDb` son 4 viajes (BEGIN + set_config + query + COMMIT) ≈ 1 s
  medido. La ruta abre unas 20 → los 23 s cuadran. **En Vercel, con la base en la
  misma región, el viaje es de ~1-5 ms y la misma ruta debería ir en ~1 s.**
- **Lo que sí es estructural:** `getFacturadoEnPeriodo` se llama **6 veces** por
  carga (periodo + previo + una POR CLÍNICA en la comparativa) y cada llamada
  abre 2-3 transacciones propias. Reparto medido: comparativa de clínicas 5,9 s ·
  ranking de doctores 3,5 s · los dos facturados 5,7 s · `listLeads` 2,7 s ·
  `primeraAccionLeadTimestamp` 2,0 s **solo para componer un tooltip**.
- **Lo PRIMERO, porque no depende del enlace:** `primeraAccionLeadTimestamp()`
  cuesta **2 s** para componer un tooltip ("Datos disponibles desde …"). Es un
  `min(timestamp)` sobre `acciones_lead`: dos segundos ahí son falta de índice,
  no latencia. O se indexa, o el tooltip se calcula una vez y se cachea, o se
  retira. Es el único punto de la lista cuyo coste seguiría en producción.
- **Mejora:** un `getFacturadoPorClinicaEnPeriodo` que devuelva el mapa de todas
  las clínicas en UNA pasada (los datos ya se leen enteros y luego se filtran),
  y agrupar las lecturas sueltas dentro de una sola transacción. Ya se quitaron
  dos duplicados obvios (el sparkline releía TODOS los leads; el sanity check del
  ranking volvía a pedir el facturado que ya estaba calculado).
- **Impacto:** bajo en producción hoy, alto en cuanto la base no esté al lado —
  y es la diferencia entre "va bien en Vercel" y "no se puede usar desde fuera".
- **Fecha:** 2026-07-30 · 🔵

## 81. `/kpis` "Exportar informe" es una pantalla entera dentro de un cajón
- **Zona:** `(authed)/kpis/KpisView.tsx:ExportDrawer` → `InformesView` (995 líneas)
- **Principio:** §6 coherencia — el patrón del producto es "las tarjetas informan,
  los paneles actúan". Esto es un panel que **contiene otra pantalla**: filtros
  propios de mes y clínica, dos pestañas internas, un historial de informes
  guardados, y gráficas fuera de pantalla que se capturan a PNG para el PDF. Un
  cajón de 896 px que hace scroll sobre 995 líneas no es un panel de acción.
- **Además es frágil:** la captura con `dom-to-image-more` necesita los nodos
  montados, y un cajón que se desmonta al cerrar es mal anfitrión para eso.
- **Mejora (mi recomendación):** pantalla propia, `/informes`. Generar un informe
  con IA tarda segundos, produce un documento y luego se navega el historial: eso
  es una pantalla, no una acción de un clic. La alternativa —un botón que genera y
  descarga sin montar nada— pierde el historial, que es la mitad del valor.
- **Ya hecho de paso (2026-07-30):** el botón pasa a llamarse "Informe mensual" y
  el cajón declara que va por MES de calendario, no por el periodo de la cabecera.
  Antes parecía obedecer a los controles de arriba y no lo hacía.
- **Impacto:** medio · **Esfuerzo:** medio (ruta nueva + entrada de navegación).
- **Fecha:** 2026-07-30 · 🔵 **decisión de producto pendiente**

## 82. El seed pone acciones ANTES de crear el lead: 30 de 58 fuera del tiempo de respuesta
- **Zona:** `scripts/db-seed-demo-rico.mjs` (guion de conversación de los leads)
- **Principio:** §4 — el KPI "tiempo medio de respuesta" salía **−4.314 min**, un
  tiempo negativo. La causa: para 30 de los 58 leads del mes, la primera acción
  saliente tiene un timestamp ANTERIOR al alta del lead. El KPI ya descarta esos
  casos y lo declara en su tooltip (2026-07-30), así que la pantalla no miente —
  pero está midiendo sobre 12 de 58 leads, no sobre 42.
- **Mejora:** que el guion ancle sus mensajes DESPUÉS de `created_at` siempre. En
  producción no puede pasar (la acción se escribe cuando ocurre), así que es
  deuda de la demo, no del producto — pero deja la tasa de contactación de la
  demo en 12/58, que se enseña.
- **Impacto:** bajo en producto, medio en demo (es un KPI de la pantalla).
- **Fecha:** 2026-07-30 · 🔵

## 83. Las plantillas de WhatsApp nombran tratamiento e importe en el mismo mensaje
- **Zona:** `scripts/db-seed-demo-rico.mjs:1164` (plantilla de ejemplo) ·
  `app/(authed)/ajustes/configuracion/ConfiguracionView.tsx:1011` (editor que
  ofrece las variables) · `app/lib/plantillas/plantillas.ts:137,160`
- **Principio:** §1 misión — un riesgo legal que cae sobre la clínica no ayuda a
  convertir ni a perder menos; lo que hace es dar una objeción en la reunión.
- **Problema:** la plantilla que servimos como ejemplo dice *"Confirmamos tu
  presupuesto de {{importe}}€ para {{tratamiento}}"*, y el editor ofrece las dos
  variables juntas a cualquier clínica. Un tratamiento dental concreto vinculado
  a un teléfono **es dato de salud (art. 9 RGPD)**, y la propia Política de
  mensajes de WhatsApp Business restringe enviar información de salud cuando la
  regulación aplicable lo limita (ver `INVESTIGACION-MERCADO-2026-07.md` §4). El
  riesgo es de la clínica, que es la responsable del tratamiento — pero se lo
  damos nosotros hecho y por defecto.
- **Mejora:** plantillas neutras por defecto ("tienes un presupuesto pendiente,
  entra aquí") con enlace a una vista propia donde sí se ve el detalle; dejar
  `{{tratamiento}}` disponible pero **con aviso en el editor** de qué implica
  usarlo. El competidor (Engrana) ya publica su cumplimiento como argumento de
  venta, así que esto no es solo defensa.
- **Impacto:** alto en venta y riesgo · medio en conversión (H9 mide si el
  mensaje neutro convierte igual; si convierte menos, hay que decidir con la
  cifra delante, no por intuición).
- **Esfuerzo:** medio (plantillas por defecto + aviso en el editor + la vista de
  detalle con enlace, que no existe).
- **Fecha:** 2026-07-31 · 🔵 **decisión de producto pendiente**

## 84. El tono "cercano" no existe para la tabla A/B, y se descarta en silencio
- **Zona:** `app/api/presupuestos/tonos-stats/route.ts:96` (`if (!counts[tono]) continue`),
  `KpiView.tsx:990` (`TONO_META`, tres claves)
- **Principio:** §4 no inventar / §5 confianza — la pestaña "Motor IA" de /kpis mide
  tres tonos (directo · empático · urgencia) y **descarta cualquier otro sin
  decirlo**. El seed de DEMO escribía `"cercano"` en 12 de 28 secuencias: casi la
  mitad de los mensajes no aparecían en ninguna fila y la tabla no lo declaraba.
  El seed ya está corregido (2026-07-31), así que hoy no muerde — pero la ruta
  sigue tragándose en silencio cualquier tono que no sea uno de los tres.
- **Mejora:** o el descarte se declara al pie ("N mensajes con otro tono, fuera de
  la comparativa"), o la tabla se deriva de los tonos que existen en los datos.
  Lo segundo es más honesto; lo primero, más barato.
- **Impacto:** bajo hoy (pestaña de /kpis, fuera del guion de demo), medio cuando
  el piloto genere tonos reales.
- **Esfuerzo:** horas.
- **Fecha:** 2026-07-31 · 🔵

## 85. Cobros mide su plazo en milisegundos rodantes, no en días de clínica
- **Zona:** `app/lib/cobros.ts:120-145` (`venceMs = aceptadoMs + plazoDias * DAY_MS`
  comparado contra `today`)
- **Principio:** coherencia — el umbral de reactivación pasó a **días de calendario
  de la clínica** el 2026-07-31 justo porque una ventana rodante hacía que la cifra
  de portada de /red cambiara entre dos recargas. Cobros conserva la aritmética
  vieja: el bucket "vencido" cruza en un instante fijo derivado de
  `fecha_aceptado`, no a las 00:00 de Madrid.
- **Por qué no se tocó en la misma tanda:** hoy no muerde (medido: los vencidos
  no se movieron en 24 h simuladas, porque `fecha_aceptado` es una fecha y el
  cruce cae a medianoche UTC) y cambiar cuándo un cobro pasa a "vencido" es una
  decisión de negocio, no una refactorización.
- **Mejora:** contar el plazo con `diasDeClinicaEntre`, como el resto.
- **Impacto:** bajo · **Esfuerzo:** horas.
- **Fecha:** 2026-07-31 · 🟢 **CERRADA el 2026-08-01.** Medido primero, que era la
  condición: la cifra **no** se mueve entre recargas (`fecha_aceptado` es `date`;
  el bucket salió constante en 24 h de muestreo), así que no era el caso de /red.
  Lo que sí apareció al medir: los cruces caían a las **07:00 de Madrid** —la
  medianoche local del runtime que lee la fila—, y desde Vercel habrían caído a
  las 02:00. Ahora se cuenta con `diasDeClinicaEntre`. La definición de negocio
  no cambia: 90 días siguen siendo 90 días.

## 86. El aviso de "estás viendo una sola clínica" solo existe en /red
- **Zona:** `components/shared/AvisoFiltroClinica.tsx` (nuevo), consumido solo por
  `RedView`. Siguen al mismo selector: `/pacientes`, `/seguimiento`, `/leads`,
  `/cobros`, `/kpis` (×4 pestañas), `/alertas`, `/presupuestos`
- **Principio:** §5 confianza — la regla que se acordó el 2026-07-31 es general:
  *un estado persistido que cambia lo que se ve debe declararse en pantalla*. El
  selector guarda la clínica en `localStorage`, así que en TODAS esas pantallas se
  puede llegar con el filtro puesto sin haberlo tocado en la sesión. Se arregló
  donde mordió (y donde además se retira una sección entera), no en las demás.
- **Mejora:** montar el mismo aviso en las que filtran de verdad, con su propio
  `ocultaAdemas` cuando escondan algo. La pieza ya está escrita.
- **Impacto:** medio · **Esfuerzo:** horas (cada pantalla tiene su cabecera).
- **Fecha:** 2026-07-31 · 🟢 **CERRADA el 2026-08-01**, en la misma tanda de
  /llamadas: las ocho lo llevan (Pacientes, Seguimiento, Leads, Cobros, KPIs,
  Alertas, Presupuestos, y /red que ya lo tenía). Alertas y Leads añaden su
  `ocultaAdemas`. Verificado en navegador recorriendo las ocho con clínica
  elegida y recargando.

## 87. Lo que queda del informe de revisión externa (jul 2026) — flujo, no fallos
- **Zona:** transversal · **Origen:** recorrido completo de producción con
  Claude for Chrome, sección por sección (2026-07-31). Los bloqueantes de ese
  informe se cerraron el mismo día; **esto es lo que se dejó fuera a propósito**,
  y son decisiones de producto, no arreglos.
- **Red:** los KPIs no son clicables — se lee "5.900 € esperando tu respuesta" y
  hay que reconstruir a mano dónde están esos tres pacientes. Cada cifra debería
  ser enlace profundo a su lista ya filtrada. Además, la tabla "Tus clínicas" se
  corta por la derecha sin scroll visible, y las tarjetas pequeñas truncan con "…"
  justo donde está el dato útil.
- **Alertas:** ~7 s de carga con texto plano "Cargando alertas…" en vez de
  skeleton; todas las alertas pesan visualmente igual (ordenar por dinero en
  riesgo, no por clínica); no se puede descartar ni posponer; "Enviar alerta" no
  se convierte en estado ("Enviada hace 2 h"); errata **"liquidaciónes"** con
  tilde en varias líneas.
- **Pacientes:** se pintan los 166 de golpe, sin paginación ni virtualización, y
  al final hay una zona en negro enorme; la columna "Notas" trunca siempre en
  "Paciente recurrent…"; los tres iconos de acciones no tienen tooltip; el
  formato de fecha es inconsistente; no se puede ordenar por cabecera (y
  "pendiente de cobro" es justo lo que querrías ordenar).
- **Ficha de paciente:** no se puede escribir desde ahí (hay botón de WhatsApp
  pero no el compositor que sí existe en el drawer de Seguimiento — dos
  componentes para lo mismo); falta histórico de acciones visible y navegación
  anterior/siguiente.
- **Seguimiento:** cuatro cifras distintas en la misma pantalla ("15 pendientes ·
  13 atendidos" vs chips que suman 28 vs botón "Enviar uno a uno (17)"); abre por
  defecto en "En conversación" en vez del grupo más urgente; Leads y Presupuestos
  son vistas hermanas con capacidades muy distintas; no hay forma de marcar nada
  como atendido desde la lista, así que la barra de progreso nunca se mueve; el
  fondo no bloquea el scroll con el drawer abierto. Propuesta del informe:
  "Hecho / Posponer" por tarjeta y **modo cola** (al cerrar el drawer, saltar al
  siguiente pendiente), que es lo que la convertiría en la herramienta diaria.
- **Impacto:** alto en conjunto (es la diferencia entre diagnosticar y actuar),
  pero **son varias tandas**, no una.
- **Fecha:** 2026-07-31 · 🔵 **sin priorizar — Simon decide el orden**

## 88. 🔴 La gráfica de 6 meses de /red está PLANA el día 1 de cada mes
- **Zona:** `app/lib/dashboard-red.ts` — la serie `progreso` se construye con
  `aceptados(mes)`/`presentados(mes)`/`creados(mes)`, y las tres pasan por
  `enTramo`, que recorta a `día <= díaHoy`.
- **Principio:** §5 confianza — y contradice de frente la decisión del
  2026-07-27: "el mes en curso se pinta punteado **en vez de excluirlo**, se ve
  la tendencia sin que un mes a medias parezca una caída". Si los meses CERRADOS
  también se recortan al día de hoy, no hay tendencia que ver.
- **`enTramo` es correcto donde nació**: comparar "este mes" contra "el mismo
  tramo del anterior" evita comparar cinco días con treinta. Lo que está mal es
  aplicarlo a una serie histórica de meses completos.
- **Medido hoy (1 de agosto), mirando la misma base a distintos días del mes:**

  | Se mira el | mar | abr | may | jun | jul |
  |---|---|---|---|---|---|
  | **1 ago** | 0 € | 0 € | 0 € | 4.800 € | 0 € |
  | 5 ago | 2.334 € | 1.800 € | 10.659 € | 6.210 € | 1.520 € |
  | 15 ago | 20.367 € | 9.713 € | 30.268 € | 8.410 € | 3.020 € |
  | 28 ago | 31.584 € | 15.786 € | 44.062 € | 22.857 € | 37.881 € |

  Solo es correcta a final de mes. El día 1 la gráfica está a cero.
- **Es PRE-EXISTENTE**, verificado con los cambios del día guardados (`git
  stash`): falla igual. No lo destapó ninguna pasada visual porque nunca se
  había mirado /red un día 1 o 2.
- **Lo tiene rojo ahora mismo:** `npx tsx scripts/qa-dashboard-red.ts` (6 fallos,
  cinco de la serie y "perdidos mes previo").
- **Mejora:** que la serie histórica use meses COMPLETOS y solo el mes en curso
  vaya a día de hoy — que además es lo que su propio trazo punteado ya declara.
  `enTramo` se queda para los deltas mes-contra-mes, que es para lo que nació.
- **Impacto:** 🔴 **alto y con fecha**: /red es el acto I del guion de demo y el
  guion dice que no se recorta nunca. La reunión con RB es la semana del 3 de
  agosto — dos días.
- **Esfuerzo:** ~5 líneas (separar `enTramo` de la serie) + volver a poner verde
  el QA de paridad.
- **Fecha:** 2026-08-01 · 🟢 **CERRADA el mismo día**, con prioridad por la reunión.
  `enTramo` deja de ser la única ventana: los contadores la RECIBEN
  (`creados`/`presentados`/`aceptados`/`cobradoEn`), y la serie usa `enSerie` —
  mes cerrado entero, mes en curso hasta hoy, que es lo que su propio trazo
  punteado ya declara.
  **Y apareció el error ESPEJO al arreglarlo:** `cobradoEn` usaba el mes ENTERO
  para el delta mes-contra-mes, así que hoy /red diría «−28.261 € vs mes pasado»
  y /cobros «+0 €» por la MISMA cifra — con un comentario en `/api/cobros`
  afirmando desde el 2026-07-27 que lo hacía "igual que el dashboard de Red",
  que llevaba cinco días siendo falso. Las dos direcciones del mismo fallo, en
  la misma función.
  **QA:** `qa-dashboard-red` en VERDE, con sección nueva que simula el reloj los
  días **1, 2 y 15** y exige que los meses cerrados den lo mismo en los tres,
  más el contraste medido de que la fórmula vieja daba 0 €. De paso, su SQL de
  "mes previo" pasa al mismo tramo: comparaba contra el mes entero y le estaba
  dando por bueno al dashboard justo el error que la decisión del 27/7 mató.
  Regla destilada en el skill de lecciones (§16).
