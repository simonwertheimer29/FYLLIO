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
- **Fecha:** 2026-07-23 · ✅ aprobada (2026-07-23, Simon: las tres juntas, tras verificar el preview de los 4 arreglos y antes de P3)

## 19. Acciones que confirman éxito sin comprobar la respuesta
- **Zona:** `IntervencionSidePanel.tsx` (`handleLlamar` — registra llamada y toast de éxito
  sin `res.ok`); `ActuarHoyView.tsx` (`handleChangePresupuestoEstado` — catch silencioso
  «el polling lo recupera»)
- **Principio:** §5 feedback (misma clase que el «Pausar» no-op arreglado el 2026-07-23)
- **Problema:** si el servidor falla, la coordinadora ve éxito y la acción no quedó
  registrada — un error disfrazado de éxito en pequeño.
- **Mejora:** `res.ok` + toast de error en ambos (patrón ya usado en el resto del panel).
- **Impacto:** medio-bajo (pérdida esporádica de registro/estado sin aviso).
- **Fecha:** 2026-07-23 · ✅ aprobada (2026-07-23, Simon: las tres juntas, tras verificar el preview de los 4 arreglos y antes de P3)

## 20. Portal público — la aceptación puede no llegar al kanban
- **Zona:** `app/api/portal/[token]/responder/route.ts` (el token KV se marca respondido
  ANTES de escribir el presupuesto; si esa escritura falla, ahora se loguea pero el
  presupuesto no cambia y el paciente cree que aceptó)
- **Principio:** mandamiento §1 (persistir antes de confirmar) — pre-existente, hoy solo
  observable
- **Mejora:** escribir el presupuesto primero y marcar el token después (o reintento).
- **Impacto:** medio (raro pero caro: una aceptación real invisible para la clínica).
- **Fecha:** 2026-07-23 · ✅ aprobada (2026-07-23, Simon: las tres juntas, tras verificar el preview de los 4 arreglos y antes de P3)
