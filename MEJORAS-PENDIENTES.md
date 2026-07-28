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

## 46. El seed de DEMO apila los casos vivos en el mes en curso y revienta todos los deltas
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
- **Fecha:** 2026-07-27 · 🔵 **prioridad subida por Simon: se mira justo después
  de cerrar /red.**

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

## 50. El embudo no puede tener etapa "citados": el dato no existe
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
- **Fecha:** 2026-07-27 · 🔵 **PRIORIDAD SUBIDA por Simon**: sin este dato no hay embudo
  completo NI señal para el motor predictivo de no-shows. Se propone el fix al cerrar la
  pasada visual, antes de volver a tocar producto.

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
