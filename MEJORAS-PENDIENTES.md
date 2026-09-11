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
- **Estimación de esfuerzo (jul 2026):** ~~el "bulk real" server-side existe como pieza
  (`app/lib/whatsapp/outbound.ts` → Meta WABA)~~, pero está **bloqueado por dos dependencias
  externas**: (1) ~~`META_WHATSAPP_TOKEN`/`META_PHONE_NUMBER_ID` en producción~~, y (2) una
  **plantilla aprobada por Meta** para el mensaje de intervención (aprobación tarda días y
  obliga a un mensaje FIJO con variables — Meta NO permite enviar en lote el texto IA
  personalizado actual). Conclusión: el bulk real de mensajes IA **no es viable "ahora"**.
  Opciones: **(A) versión mínima honesta** (~2-4 h, sin dependencias): dejar de prometer
  "lote", renombrar a envío uno-a-uno con progreso "X de N" y reutilizar el feedback de #2 —
  demo-safe; **(B) bulk real por plantilla** (~1-2 días de código + espera de aprobación
  Meta + cambiar el mensaje a plantilla fija) — no entra en la ventana de la demo.

  > ⚠️ **CORRECCIÓN 2026-08-03 — lo tachado arriba era falso, y quien retomara la opción B
  > habría construido sobre nada.** `app/lib/whatsapp/outbound.ts` **no es la pieza del bulk
  > real**: es **código muerto con cero importadores**, resto del prototipo anterior a Fyllio.
  > Y es el **único** consumidor de `META_WHATSAPP_TOKEN`/`META_PHONE_NUMBER_ID`, que son un
  > **segundo juego de variables para lo mismo** que las `WABA_*` que sí usa el producto vivo.
  > O sea: esta entrada mandaba a configurar unas variables que no alimentan nada y a apoyarse
  > en un archivo que nadie ejecuta.
  >
  > **Dónde está de verdad la pieza:** `lib/presupuestos/mensajeria.ts` →
  > `ServicioMensajeriaWABA.enviarPlantilla`, ya implementado, con idempotencia y rate-limit,
  > y hoy con **cero llamadas**. La dependencia (1) por tanto **no existe**: se resuelve con las
  > `WABA_*` que ya lee todo el producto. La dependencia (2) —la plantilla aprobada por Meta—
  > **sigue siendo real y es la única**, y ya no es un problema solo de esta mejora: el catálogo
  > de las 11 plantillas está diseñado en la **fase 3 de [`PLAN-AGENTE.md`](PLAN-AGENTE.md)**,
  > y la de esta entrada es `seguimiento_info_disponible`.
  >
  > **Retirar `outbound.ts` (y `whatsapp/llm.ts`, también muerto: 352 líneas entre los dos) NO
  > es un `git rm`**, es §11: primero hay que censar quién **decide** con
  > `META_WHATSAPP_TOKEN`/`META_PHONE_NUMBER_ID` —el patrón peligroso es `if (!process.env.X)`,
  > que cambia de rama solo cuando la variable desaparece del entorno— y quitar esas ramas
  > **antes** de quitar las variables. Es exactamente el error que costó semanas de degradación
  > silenciosa al retirar Airtable. **Pasada aparte, no en la misma tanda que otro cambio.**
- **Fecha:** 2026-07-15 · 🟢 **opción A hecha** (tanda pre-demo, rama `pre-demo-actuar-hoy`):
  el flujo deja de prometer "lote" — botón "Enviar uno a uno (N)", título "Paciente X de N",
  copy honesto ("abrirás WhatsApp para cada paciente, uno a uno") y toast por envío.
  **Opción B (bulk real por plantilla WABA) queda en BACKLOG** para después del piloto; las
  plantillas de Meta se decidirán con el cliente. · **Descripción corregida el 2026-08-03**
  tras la auditoría de WhatsApp (ver [`DECISIONES.md`](DECISIONES.md)).

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
- **Fecha:** 2026-07-16 · ✅ **HECHA el 2026-08-10.** `/ajustes` es el único centro de
  configuración, con una URL por sección (Objetivos · Automatizaciones · Configuración ·
  WhatsApp · Notificaciones · Clínica y equipo), y `/automatizaciones` se queda con las tres
  cosas que sí son operación: Motor, ¿Escribe bien? y Operativo.
  - **Objetivos del mes** se movió el primero, por ser el único editor que hay. Al verificarlo
    apareció que el botón decía «Guardado» aunque el servidor respondiera 403 — arreglado, y de
    paso la pantalla ahora declara la regla del día 5 en vez de dejar intentar lo imposible.
  - **Los dos editores de plantillas** eran el paso de riesgo y resultó ser mayor de lo escrito
    aquí: no era solo duplicación, era **una tabla con dos idiomas** (`tipo` vs `categoria`, y
    una llave vs dos). Migración 017 + `demo:reset` alineado. Cierra también MEJORAS 74.
  - **«Clínica y equipo»** de Automatizaciones era una copia de solo lectura de
    `/ajustes/clinica-equipo`: borrada, no movida.

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
- **Fecha:** 2026-07-22 · 🔵 **Verificada el 2026-09-06: SIGUE ABIERTA** — `Paciente360View.tsx:684` manda a `/no-shows?tab=agenda` (zona congelada) sin el paciente. Arreglo: reutilizar `AgendarLeadPanel` (G3) desde la ficha del paciente con el paciente preseleccionado. **Fase 2** (2.9: pantalla de demo) · 3-4 h
- **2026-09-09 · 🟢 CERRADA (2.9)**: el panel de agendar (G3) pasa a `AgendarPanel` con un
  `sujeto` —lead o paciente— y «Agendar» en la ficha del paciente lo abre al lado con ese paciente
  ya puesto (doctor de la ficha preseleccionado). Lead: PATCH `/api/leads/[id]` como siempre;
  paciente: POST `/api/agenda/citas` con `pacienteId`, el mismo camino que la rejilla (crea OTRA
  cita; si ya tiene una futura, el subtítulo lo dice y no la mueve). Cero rutas nuevas.

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
- **Fecha:** 2026-07-24 · ⚪ **DESCARTADA el 2026-09-06** (decisión de Simon: la cola por impacto —NBA, MEJORAS 186— sustituye al tablero; mantenerla viva era deuda) · (anotada por Simon en el checkpoint de la revisión visual;
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
- **Fecha:** 2026-07-27 · (ya cerrada el mismo día — ver la línea siguiente; el censo del 06-09 la contó abierta por el emoji de esta línea)
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
- **Fecha:** 2026-07-27 · ✅ **CERRADA el 2026-09-06** — /red murió el 04-09 (redirige a /inicio) e Inicio filtra por el alcance de la sesión
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
- **Fecha:** 2026-07-27 · ⚪ **DESCARTADA el 2026-09-06** (decisión de Simon: la cola por impacto —NBA, MEJORAS 186— sustituye al tablero; mantenerla viva era deuda) ·

## 54. Leads en móvil: 12.000 px de scroll y lo urgente en cuarta posición
- **Zona:** `app/(authed)/leads/LeadsView.tsx` (layout del tablero)
- **Principio:** §2 facilidad — en 390 px las cinco columnas se apilan sin selector, así que
  "Citados Hoy" (la única con hora, la que caduca hoy) queda tras unas 28 cards. La
  coordinadora usa el móvil entre paciente y paciente.
- **Mejora:** selector de columna en móvil (pestañas tipo ColaTabs) o abrir directamente por
  la columna con trabajo del día. **Fuera del alcance de la pasada visual del 2026-07-27**:
  toca la estructura del tablero, que Simon dejó explícitamente sin tocar.
- **Impacto:** alto en uso real de móvil.
- **Fecha:** 2026-07-27 · ⚪ **DESCARTADA el 2026-09-06** (decisión de Simon: la cola por impacto —NBA, MEJORAS 186— sustituye al tablero; mantenerla viva era deuda) ·

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
- **2026-09-09 · 🟢 CERRADA (2.9)**: franja de tres `Cifra` bajo el título —«Sin contactar» (con la
  espera del más antiguo), «Citados esta semana» (lunes a domingo, cuántos hoy) y «Convertidos este
  mes» (de N cerrados con fecha de cierre)— calculadas en cliente sobre los leads ya cargados de la
  clínica elegida, sin búsqueda ni rango. «Sin contactar» usa la MISMA función que la línea de la
  card (`sinContactar`), no una segunda definición. El tiempo de respuesta NO entra: la única medida
  honesta es la de 2.5 (por cola, en Inicio) y duplicarla aquí sería una tercera definición.

## 56. "Ver 151 anteriores" en No Interesado no lleva a nada útil
- **Zona:** `app/(authed)/leads/LeadsView.tsx` (pie de columna)
- **Principio:** §2 facilidad — el enlace cambia el rango a "Histórico" y vuelca 151 leads
  descartados en una columna del tablero de trabajo. Nadie revisa 151 descartes; lo que sí
  tiene valor es el subgrupo "Se puede retomar".
- **Mejora:** en No Interesado, que el pie ofrezca solo los reactivables ("Ver 23 que se
  pueden retomar") en vez del volcado completo.
- **Impacto:** bajo-medio.
- **Fecha:** 2026-07-27 · ⚪ **DESCARTADA el 2026-09-06** (decisión de Simon: la cola por impacto —NBA, MEJORAS 186— sustituye al tablero; mantenerla viva era deuda) ·

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
- **2026-09-09 · 🟢 CERRADA (2.9)**: viaja el RESULTADO, no el criterio: la Tabla manda por POST los
  ids de `filtered` (pill, doctor, tratamiento, búsqueda, rango y orden) y el endpoint devuelve
  exactamente esas filas, en ese orden, con las 12 columnas oficiales y el recuento en el nombre
  (`…_12-filas.csv`). El botón dice cuántas exporta y se apaga con cero. GET sin ids sigue igual.
  `qa:export` 8/8.

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
- **Fecha:** 2026-07-29 · ✅ **CERRADA el 2026-09-06** — resuelta el 31-08 (§20): Maxima enlaza por pacienteId y no queda ningún link por nombre (censo 06-09)

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
- **Fecha:** 2026-07-29 · ⚪ **DESCARTADA el 2026-09-06** (decisión de Simon: la cola por impacto —NBA, MEJORAS 186— sustituye al tablero; mantenerla viva era deuda) ·

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
- **2026-09-09 · 🟢 CERRADA (2.9)**: `telefonoDeClinica(cliente, nombre)` (lib/clinicas-negocio)
  al generar el token; el portal lo enseña como enlace `tel:` (se toca y llama). Hallazgo de paso:
  NINGUNA clínica de ningún cliente tenía teléfono porque `updateClinicaCentralRawPg` y
  `createClinicaCentralRawPg` ignoraban `Telefono` —Ajustes › Clínica y equipo lo mandaba y se
  perdía— y el shim no lo devolvía; arreglado (vacío = null). El seed de DEMO pone un teléfono
  ficticio por sede. `qa:portal` 20/20 con la comprobación nueva («el de la base, o ninguno»).

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
- **Fecha:** 2026-07-30 · ✅ **HECHA el 2026-08-10.** `/informes` es una pantalla, con su
  entrada en la navegación y su `error.tsx` — que aquí no es rutina: es la pantalla que
  monta gráficas y las captura a PNG, o sea la que más superficie de fallo de render tiene.
  El botón de /kpis pasa a ser un enlace. Al sacarlo del cajón apareció que `InformesView`
  **nunca tuvo padding propio**: lo heredaba del cajón, y suelto se quedaba pegado al borde.
  Lo pone ahora la pantalla.

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
- **Fecha:** 2026-07-30 · 🟢 **HECHA el 2026-09-06** (el lead rico nace 1 h antes de su primera acción o mensaje; un «Nuevo» sin hilo, hace 3 h; invariante: cero acciones ni mensajes anteriores al alta) · — tanda «seed honesto», fase 2 (Simon: la demo es hoy el peor argumento de venta) ·

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

## 89. El presupuesto no declara si el importe lleva IVA (ni hasta cuándo vale)
- **Zona:** tabla `presupuestos` — 41 columnas y ninguna de IVA, base imponible ni plazo de validez.
  `importe` es un número suelto.
- **Principio:** §4 honestidad — el agente no puede informar de un dato que el sistema no tiene, y
  la carencia es del PRESUPUESTO, no suya.
- **Problema:** el 6 de agosto de 2026 se decidió que preguntar por el IVA de un presupuesto ya
  emitido **no** debe quebrar (es un dato, no una negociación: la regla del dinero existe para que
  el agente no comprometa nada nuevo, no para que no pueda leer lo que ya consta). Al implementarlo
  apareció que **el dato no existe**. Hoy el agente contesta lo único honesto —«se lo confirmamos
  enseguida»— y la coordinadora tiene que ir a buscarlo. Igual con «¿hasta cuándo me vale este
  presupuesto?».
- **Mejora:** declarar en el presupuesto si el importe **incluye IVA** y su **plazo de validez**.
  Los dos son datos que la clínica ya tiene en la cabeza y que hoy viven fuera del sistema — y los
  dos aparecen literalmente en el catálogo de plantillas de la fase 3 (`seguimiento_sigue_vigente`
  necesita la fecha de vigencia como variable).
- **Impacto:** medio hoy (una consulta más para la coordinadora), **alto** cuando el agente envíe
  solo: es la diferencia entre contestar y derivar en una de las preguntas más frecuentes.

  > **La lectura general, que vale más que esta entrada.** Cada vez que el agente no pueda contestar
  > algo, **la primera pregunta es si el dato existe en el sistema, no si el agente debería saberlo.**
  > Es fácil leer «el agente no sabe contestar al IVA» como un problema del agente y ponerse a tocar
  > el prompt; el agente estaba bien y lo que faltaba era una columna. Antes de mejorar la IA, mirar
  > si el dato está.

- **Fecha:** 2026-08-06 · 🔵

## 90. La clínica no tiene dónde declarar su plan de pago estándar
- **Zona:** no existe. `configuraciones_clinica` tiene `Metodos_Pago` (efectivo, tarjeta…) pero eso
  son FORMAS de pago, no un plan; `pacientes.financiado` es un número por paciente, no una política.
- **Principio:** §17 de las lecciones — el agente informa de lo que ya está decidido; la persona
  decide lo que no lo está. Para informar de una política, la política tiene que existir.
- **Problema:** el 6 de agosto de 2026 se cerró la frontera del dinero — **leer una política que ya
  existe, sí; adaptarla a este paciente, no**. Aplicado al fraccionamiento: si la clínica tiene un
  plan de pago estándar publicado, el agente lo informa; si el paciente pide uno a medida, para.
  **Pero el plan estándar no existe en el sistema**, así que hoy el agente no puede informar de nada
  y todo fraccionamiento acaba en la cola, incluido el que solo preguntaba cómo funciona.
- **Contraste con las aseguradoras, que sí funcionan:** `configuraciones_clinica` →
  `Tipos_Paciente_Aseguradora` ya tiene Adeslas, Sanitas y DKV, así que «¿trabajáis con Sanitas?» se
  contesta solo. Es exactamente el mismo patrón: **con el dato, el agente informa; sin el dato,
  deriva.** La diferencia entre los dos casos no es la IA, es una tabla.
- **Mejora:** una categoría de configuración por clínica con su plan de pago estándar (entrada,
  número de plazos, si hay intereses) y su política de validez de presupuesto. Va con
  [MEJORAS 89](MEJORAS-PENDIENTES.md), que pide lo mismo para el IVA — **son la misma carencia** vista
  desde dos preguntas distintas.
- **Impacto:** medio hoy, **alto** en la fase 3: dos de las once plantillas del catálogo necesitan
  estos datos como variables.
- **Fecha:** 2026-08-06 · ✅ **CERRADA el 2026-09-06** — cubierta por la fase D (conocimiento.politicas, «Vías de pago»): la clínica publica su plan estándar y el agente lo lee; un plan A MEDIDA sigue siendo aplazado (§17)

## 91. `001_esquema_negocio.sql` lleva meses sin regenerarse y ya no dice lo que crea
- **Detectado:** 2026-08-07, al separar el generador de tipos de lo escrito a mano.
- **Qué pasa:** `db-schema-spec.mjs` genera dos cosas desde el mismo spec, `001_esquema_negocio.sql`
  y los tipos. El spec **se ha ido actualizando** al ritmo de las migraciones, pero el 001 en disco
  **no se ha vuelto a escribir**, porque regenerar borraba las tablas añadidas a mano en `types.ts`
  y nadie quería tocarlo. Resultado: el 001 del repo **no coincide con lo que produciría el
  generador hoy**. Le faltan `leads.fecha_cierre` (009) y le sobran las cuatro columnas de
  `pacientes` que borró la 008; además mantiene el `not null` y el `check` que quitaron la 006 y la
  007. La causa de la congelación **ya está arreglada** (el generador ya no toca `types.ts`); lo que
  queda es decidir qué hacer con el archivo.
- **Por qué no lo he hecho:** reescribir una migración **ya aplicada en producción** no es limpieza,
  es una decisión. No afecta a las bases existentes —el runner va por nombre de fichero, la 001 no se
  vuelve a ejecutar—, pero **sí cambia lo que se crea en una base nueva**, que es el camino de
  `demo:reset` y el de cualquier cliente que se dé de alta.
- **Riesgo de dejarlo:** el 001 es lo que alguien lee para saber cómo es el esquema, y hoy miente en
  cuatro sitios. Riesgo de arreglarlo sin mirar: las migraciones 006-016 se aplicarían encima de un
  001 distinto del que vieron cuando se escribieron; son idempotentes (`if not exists`), así que en
  principio no rompen, pero **eso hay que comprobarlo creando una base desde cero**, no suponerlo.
- **Mejora:** regenerar el 001 y **verificar con una base limpia** que las 16 migraciones aplican
  seguidas sin error y dejan el mismo esquema que una base ya migrada. Con eso hecho, el 001 vuelve
  a ser generado de verdad y `qa:tipos` cubre el resto.
- **Impacto:** bajo hoy, **medio al dar de alta el primer cliente nuevo**.
- **Fecha:** 2026-08-07 · 🔵

## 92. El clasificador no puede responder «¿a qué hora tenéis hueco?» — y el dato EXISTE
- **Detectado:** 2026-08-12, diagnóstico C del pulido de /mensajeria. Cristina pregunta a qué hora
  hay hueco el jueves; la generación con IA produce un genérico de reactivación.
- **Qué recibe hoy esa llamada:** el presupuesto (importe, tratamiento, estado), UNA respuesta del
  paciente y el nº de entrantes sin responder. **Ni el hilo, ni la agenda.** El modelo, que no puede
  inventar horas (la lección del IVA, §17), degenera a un mensaje genérico — el seed en cambio
  inventaba «16:30 o 18:00» porque es demo.
- **La lectura del §17:** la primera pregunta es si el dato existe. **Existe**:
  `lib/scheduler/availability.ts` calcula huecos reales por clínica. Lo que no existe es la conexión
  clasificador→agenda.
- **Mejora (decisión de producto pendiente):** o darle disponibilidad al clasificador cuando la
  intención es de cita (con qué límites: ¿ofrece huecos él solo?), o que «pregunta por hueco» quiebre
  con motivo «necesita la agenda» hasta que esa conexión se decida. Hoy hace la tercera cosa, que es
  la peor: contesta genérico como si no pasara nada.
- **Impacto:** alto en cuanto el agente responda solo; hoy medio (el texto se revisa antes de enviar).
- **Fecha:** 2026-08-12 · 🔵

## 93. La proyección compat del evaluador sobre `presupuestos` — COPIA CON FECHA DE MUERTE
- **Qué es:** `persistirTurno()` (fase A, paso 4) escribe en columnas de `presupuestos`
  (`requiere_persona`, `motivo_quiebre`, `mensaje_sugerido`, `urgencia_intervencion`,
  `accion_sugerida`, `fase_seguimiento`) además de en el log `eventos_automatizacion`. Existe SOLO
  porque la bandeja, /red, las cohortes y la cola de intervención leen hoy esas columnas.
- **La condición explícita:** SE RETIRA EN LA FASE B, cuando esas pantallas lean del log. No es una
  segunda fuente: el log manda, y esta copia funciona — que es exactamente el tipo de duplicado que
  sobrevive por inercia. La fase B no está terminada mientras esta proyección exista.
- **Dónde:** `app/lib/agente/persistir-turno.ts` (proyectarCompatPresupuesto / Fallback).
- **Impacto:** ninguno mientras la fase B no llegue; deuda estructural si la sobrevive.
- **Fecha:** 2026-08-14 · ✅ **RESUELTA el 2026-08-21 (B4)** — la proyección murió entera
  (proyectarCompatPresupuesto y el fallback). Las pantallas de la fase B leen del log: la cola de
  Seguimiento deriva cohortes de eventos, la ficha lee el log, y la bandeja marca «necesita
  persona» también por derivado-sin-resolver del log (cubre leads y huérfanos, el hueco
  documentado). El fallback ya no proyecta un quiebre falso: el entrante sin responder es Necesita
  respuesta por construcción. Las columnas de presupuestos quedan como salida EXCLUSIVA del
  clasificador viejo (94, muere con B5). qa:turno afirma la muerte: un turno no toca las columnas.

## 94. El clasificador viejo — SEGUNDA COPIA CON FECHA DE MUERTE
- **Qué es:** con el interruptor `evaluador_activo` apagado (el default), el webhook sigue usando
  `clasificarRespuesta`/`guardarClasificacion` para presupuestos y guardar-sin-evaluar para leads y
  huérfanos. Es la rama OFF del paso 5 — el flujo de producción actual, intacto a propósito.
- **La condición explícita:** SE RETIRA cuando todas las clínicas tengan el evaluador encendido y
  observado. Mantener dos clasificadores «porque funcionan» es el duplicado que sobrevive por
  inercia; la señal de retirada es el interruptor a true en todas las filas de
  `configuracion_automatizaciones` + un período de observación sin sustos.
- **Dónde:** `app/api/webhooks/whatsapp/route.ts` (rama OFF) + `lib/presupuestos/intervencion.ts`.
- **Fecha:** 2026-08-14 · 🔵

## 95. QA sobre el pooler: `set_config` de sesión no es fiable
- **Qué es:** `qa-evaluador-entrante.mts` y `qa-persistir-turno.mts` fijan `app.cliente` con un
  `set_config(..., false)` de sesión sobre `SUPABASE_DB_URL_APP`, que pasa por el pooler de Supabase
  en modo transacción (puerto 6543). Cada query fuera de transacción puede caer en otro backend sin
  el contexto, y RLS devuelve cero filas EN SILENCIO: un QA que a veces lee vacío lo que acaba de
  escribir. Se descubrió construyendo `demo-entrante` (2026-08-17): su primera versión pintaba un
  «no pudo evaluar» falso con la evaluación bien persistida.
- **El arreglo:** el patrón de `qa-contexto-conversacion.mts` y de `demo-entrante.mts` — cada
  consulta directa en su transacción con `set_config(..., true)` (local).
- **Impacto:** hoy los QA pasan por suerte de pinning; el día que fallen, fallarán como flaky
  inexplicable y quemarán una tarde.
- **Fecha:** 2026-08-17 · ✅ **RESUELTA el 2026-08-17** — mordió a las pocas horas, el mismo día (qa:entrante
  falló con «el huérfano no existe» y un toggle de cero filas); los dos QA llevan ya el patrón
  transaccional. Ver DECISIONES 2026-08-17.

## 96. «Agotado» es un contador de toques y debería ser un juicio
- **Qué es:** hoy un caso queda «agotado» cuando la cadencia consume sus toques
  (`toques >= toquesAntesDeAgotar`). Es un contador, no un juicio: un paciente que dice «ahora no
  puedo» no está agotado; uno que lleva tres mensajes sin abrir, sí. El contador trata igual los
  dos.
- **Qué haría falta:** que el estado «agotado» incorpore señales de la conversación (respondió
  alguna vez, qué dijo, entregas/lecturas si existen) — probablemente un juicio del evaluador, no
  una regla.
- **Decisión (Simon, 2026-08-18):** anotado como pregunta abierta. **Fase D o después, no ahora.**
- **Fecha:** 2026-08-18

## 97. La agenda como vista — «¿quién viene esta semana?» no se contesta con la cola
- **Qué es:** al pasar la cola de Seguimiento a tres cohortes (criterio 18-08), los CITADOS salen
  de la cola: ni cohorte ni filtro. Su único pendiente es el recordatorio automático, y una duda
  que surja de él entra por la puerta normal (Necesita respuesta). La pregunta de consulta —
  «¿quién viene esta semana?» — se contesta con una **agenda**, que hoy no existe como vista.
- **Decisión (Simon, 2026-08-18):** feature anotada como **dependiente del nivel de integración de
  cada clínica (nivel 2, lectura)**. No es parte de la fase B.
- **Fecha:** 2026-08-18 · ✅ **CERRADA el 2026-09-06** — /agenda existe desde G2 (28-08): semana, doctor, crear y mover

## 98. No-shows: integración futura a la cola única de envíos (B6)
- **Qué es:** el módulo de no-shows existe pero está desactualizado y no es prioridad. Cuando se
  reactive, sus mensajes NO estrenan pantalla: se enchufan como un TIPO más a la cola única de
  envíos de B6 (seguimiento de presupuestos · recordatorios de cita · reactivaciones · no-shows),
  con su filtro.
- **Decisión (Simon, 2026-08-18):** anotado como integración futura. **No tocar el módulo ahora.**
- **Fecha:** 2026-08-18

## 99. El agente que ELIGE la plantilla — después de B6, con umbral claro
- **Qué es:** idea dictada (18-08): en vez de una regla fija por tipo, el agente podría elegir qué
  plantilla del catálogo encaja con el estado del caso. Diagnóstico: HOY no aporta — el catálogo
  real tiene UNA candidata por hueco (censo 18-08: 'Seguimiento de presupuesto' para toda la
  cadencia, 'Detalles de pago', 'Reactivación', 1 de cita), así que «elegir» sería elegir entre
  una. La regla fija basta y es determinista.
- **El umbral que lo activa:** cuando una clínica tenga >1 plantilla candidata por hueco (variantes
  por tono, tratamiento, momento). Entonces es un juicio barato y seguro: el modelo elige un ID de
  plantilla revisada, no redacta — el riesgo de texto libre no vuelve.
- **Fecha:** 2026-08-18 · decisión: **va después de B6**

## 100. Cadencia de LEADS — no existe, y queda fuera de B6 a propósito
- **Qué es:** la cola de envíos solo genera para presupuestos (seguimiento + reactivación ≥90d de
  PERDIDO). Un lead sin conversación no recibe ningún toque automático: por eso «nuevo sin
  contactar» entra en Necesita respuesta de la cola de Seguimiento (decisión 18-08) — es trabajo de
  persona mientras esta cadencia no exista.
- **Qué haría falta:** generador propio (origen nuevo en `cola_envios`), secuencia por clínica, y
  la decisión de producto de qué se le dice a un lead que nunca escribió (plantilla marketing,
  ventana 24h de Meta no aplica — plantilla siempre).
- **Fecha:** 2026-08-18 · decisión de Simon: **fuera de B6, anotada**

## 101. /envios — reestructura pendiente (dictada, NO construir ahora)
- **Qué es:** la v1 de B6.4 apila cuatro secciones, y solo UNA es trabajo (por enviar); el resto es
  información. Lo dictado (18-08):
  1. **Una fila de cifras arriba** (por enviar · esperando respuesta · caducados · procesados)
     donde cada cifra FILTRA una única lista debajo. Un solo bloque de contenido, estado completo
     sin scroll.
  2. **Modo automático y semiautomático son pantallas distintas**, no la misma con botones
     ocultos: en automático no hay nada que pulsar y los caducados no existen — es un panel de
     vigilancia, no una cola de trabajo.
  3. **«Citas próximas sin respuesta» SALE de Envíos**: llamar es trabajo humano y su sitio es
     Seguimiento > Necesita respuesta (si se queda aquí, la coordinadora tiene su trabajo
     repartido en dos pantallas). Ver el criterio del ciclo del caso en PLAN §8.
- **Fecha:** 2026-08-18 · dictado por Simon; entra con la vista de cohortes o después, no en B6.

## 102. Registrar una llamada y que la COLA se entere — el cierre del caso «toca llamar»
- **Qué es:** la cohorte de agotados dice «toca llamar» pero no hay dónde marcar que se llamó ni
  qué pasó. Y lo que existe es PEOR que nada: registrar el contacto SÍ se puede (presupuestos →
  `/api/presupuestos/contactos`; leads → acciones de lead), pero la cola lo IGNORA — el estado de
  conversación es de MENSAJES (una llamada no es un mensaje) y el clasificador solo cambia por
  eventos del log. Llamas, registras, y el caso sigue en «toca llamar»/Fuera de plazo como si nada.
- **Diseño propuesto (pendiente de OK):** dos resultados desde la ficha, cada uno con su efecto:
  1. **«No contesta»** → registra el contacto + fija una ESPERA corta (hasta mañana) con la pieza
     026 que YA existe (espera fijada por persona): el caso sale de la cola, las cadencias quedan
     suspendidas, y vuelve SOLO al vencer — sin estado nuevo, sin caducidad.
  2. **«Hablé con él/ella»** → registra el contacto con nota; el cierre real es el de siempre (el
     estado del presupuesto si se resolvió, el botón «resuelto» si había asunto derivado, o la
     conversación si sigue viva). No se inventa un «cerrado por llamada».
  Técnica: ruta única POST (telefono + tipo + casoId + resultado + nota) que despacha el registro
  por tipo y emite la espera; funciona también para huérfanos (la espera es por teléfono). UI: dos
  botones en la ficha del despliegue.
- **Fecha:** 2026-08-18 · detectado por Simon mirando la cohorte de agotados
- ✅ **RESUELTA el 2026-08-21** con las dos decisiones dictadas: espera de 1 DÍA LABORABLE en
  «no contesta» (viernes → lunes; `proximoDiaLaborable`), y «la conversación manda» sobre el
  agotado tras hablar (solo registro; el estado se mueve por mensajes o flujos de cierre).
  `lib/seguimiento/registrar-llamada` + POST /api/seguimiento/llamada (IDOR por tipo) + bloque
  «Registrar llamada» en el despliegue. La ESPERA además saca de la cola la iniciativa nuestra
  (agotado, lead nuevo) sin tapar al paciente — 8 checks nuevos en qa:cola (40 en total).

## 103. Generadores de texto con revisión humana — el criterio que los salva (y su límite)
- **Qué es:** tras el censo del 21-08, quedan DOS generadores de texto con modelo fuera del camino
  del agente, y se quedan A PROPÓSITO: el generador de plantillas de Ajustes
  (`/api/presupuestos/plantillas/generar-ia` — escribe borradores de plantilla que una persona
  revisa y guarda ANTES de que existan) y el Copilot (chat interno de coordinación — redacta para
  que una persona copie a mano si quiere).
- **EL CRITERIO (dictado):** la revisión humana los salva HOY porque hay alguien mirando. **Si
  algún día ese texto puede salir hacia un paciente sin que nadie lo lea** (una plantilla que se
  autoaprueba, un copilot con botón de enviar), **pasan por el juez** — sin discusión nueva: es
  este criterio aplicándose.
- **Fecha:** 2026-08-21

## 104. Llamadas de voz (Vapi) — censo de reglas duras PENDIENTE
- **Qué es:** las llamadas IA son OTRO canal generativo con sus propios prompts
  (`lib/llamadas/*`, webhook de Vapi) y hoy están fuera del censo de reglas duras: nada equivalente
  al juez revisa lo que la voz afirma (hechos clínicos, condiciones económicas, art. 9 en voz).
  Las mismas reglas duras deberían aplicar.
- **Decisión (Simon, 2026-08-21):** anotado como censo pendiente — NO tocar ahora, pero declarado.
- **Fecha:** 2026-08-21

## 105. IntervencionSidePanel pide plantillas a una ruta BORRADA el 10-08 (404 silencioso)
- **Qué es:** visto durante el swap del censo: `IntervencionSidePanel` hace
  `fetch("/api/presupuestos/plantillas")` — ruta eliminada el 10 de agosto al unificar los
  editores. El catch lo convierte en «no hay plantillas» (§9/§10: fallo sistemático mudo), así que
  su selector de plantillas y la precarga de «Confirmación de aceptación» llevan muertos desde
  entonces sin que nadie lo viera. Además su `aplicarPlantilla` sustituye llave SIMPLE `{nombre}`
  (el mismo bug de B6.2: con el vocabulario post-017 produciría «{Ana}»).
- **El arreglo:** apuntar a `/api/plantillas` (el editor único) + `sustituirLlaves`. Hoy no muerde
  SOLO porque el fetch muere antes.
- **Fecha:** 2026-08-21 · ✅ **RESUELTA el 2026-08-21** — el panel pide al editor único
  (lead_seguimiento + cobranza) con `cargarJSON` y el fallo SE DICE (toast, no catch mudo);
  `sustituirLlaves` movida a módulo client-safe (`lib/plantillas/llaves`) y usada en la precarga de
  «Confirmación de aceptación» y en `aplicarPlantilla` — una plantilla con huecos no se inserta
  rota: se avisa con sus llaves.

## 106. Tres pares de «dos fuentes del mismo concepto» — limpieza cuando muera el motor viejo (B5)
- **Qué es:** el diagnóstico de fase D (22-08) encontró TRES solapes de la misma familia — dos
  fuentes del mismo concepto, el patrón que llevamos semanas matando:
  1. **Dos lectores de horario laborable:** ~~dos defaults~~ (corregido 22-08: tiempo-laborable
     IMPORTA el `HORARIO_DEFAULT` del motor viejo — es el mismo objeto). El solape real: el motor
     viejo lee su horario de `configuraciones_clinica` (categoría horario_laboral, hoy sin filas)
     y la cola lo lee ahora de la configuración del agente (grupo 4, donde el dato NACE — en
     `clinicas` nunca existió: solo `staff.horario_laboral`, por empleado). Al morir el motor
     viejo, queda una sola fuente: la del agente.
  2. **Dos fuentes de «caso frío»:** `UMBRAL_REACTIVACION_DIAS` hardcoded (lead 2 / presupuesto 3,
     `estado-conversacion.ts`) vs `configuracion_automatizaciones.dias_reactivacion` /
     `dias_inactividad_alerta` (por clínica, solo los lee el motor viejo).
  3. **Dos frenos de mensajes al mismo paciente:** el cooldown del engine viejo (3 msg/24 h) y el
     tope diario de la cadencia (`MAX_ENVIOS_POR_CLINICA_DIA=30`, hardcoded en `generar-cola.ts`).
- **Decisión (Simon, 2026-08-22):** NO arreglar ahora. Cuando el motor viejo de Automatizaciones
  muera con B5, esta es la limpieza: una sola fuente por concepto, leída de la configuración del
  agente (fase D grupo 4/5).
- **Fecha:** 2026-08-22

## 107. El bucle de correcciones del banco de pruebas (fase E+, anotado 22-08)
- **Qué es:** sobre el banco de pruebas de /agente: marcar «esto está mal» en una respuesta,
  acumular las marcas, y proponer ajustes de configuración a partir de ellas. Es lo de más valor
  a largo plazo del banco — y lo dictado es que NO entra en fase E: para septiembre basta con que
  alguien escriba al agente y vea que decide.
- **Regla que ya aplica desde el día 1:** lo sintético y lo real no se mezclan al medir (§7 del
  plan) — todo lo que el banco registre vive en su propia tabla, etiquetado por origen.
- **Fecha:** 2026-08-22

## 108. El agente se presenta con nombre propio — BLOQUEADA por la consulta legal del Reglamento de IA
- **Qué es:** que el agente abra con un nombre («Soy Leo, del equipo de la clínica») en vez de
  hablar sin identidad. Mejoraría la naturalidad de la conversación y de la demo.
- **Decisión (Simon, 2026-08-23):** APARCADA, no implementar — choca con la obligación de
  identificarse como IA del Reglamento europeo de IA, que está en la consulta legal pendiente
  (la misma que cubre la banda del borrador en el composer). Se decide cuando vuelva la consulta;
  cualquier presentación tendrá que convivir con la identificación como sistema automático.
- **Fecha:** 2026-08-23

## 109. Fetch muerto a /api/no-shows/config (404 silencioso en Ajustes)
- **Qué es:** `MotorNoShowsPanel` (Ajustes → Configuración) fetchea `/api/no-shows/config/[clinicaId]`
  y esa ruta NO existe (el módulo no-shows está congelado). 404 en cada carga del panel (§9/§10).
  Visto en el censo de fase F (23-08).
- **El arreglo:** o el panel se retira con el módulo congelado, o declara el estado («módulo no
  activo») sin fetch. No dejar el 404 mudo.
- **Fecha:** 2026-08-23 · ✅ **RESUELTA el 2026-08-23** — el panel declara el módulo congelado
  (sin formulario fingido, sin fetch); vuelve con sus ajustes cuando el módulo se reactive.

## 110. El seed de reglas_automatizacion escribe valores FUERA del enum (reglas decorativas)
- **Qué es:** `db-seed-demo-rico` escribe `trigger_tipo` con valores que no existen en TriggerTipo
  («cita_proxima», «presupuesto_estancado», «lead_inactivo», «paciente_inactivo»), condiciones «{}»
  (no array) y acciones como string plano — el engine nunca las encuentra ni las ejecuta: las 5
  reglas demo son decorativas. Mandamiento 15 (el seed respeta el vocabulario real). Visto en el
  censo de fase F.
- **Decisión pendiente:** si el motor viejo muere en fase F/B5, el arreglo es borrar el seed de
  reglas, no corregirlo.
- **Fecha:** 2026-08-23 · **Fase 2** · 🟢 **HECHA el 2026-09-06** (trigger_tipo del TriggerTipo real, condiciones «[]», acciones JSON de Accion[]; siguen inertes por el triple candado; invariante) · — tanda «seed honesto» (Simon: la demo es hoy el peor argumento de venta)

## 111. El reloj de la cola está anclado a mediodía — la escalada a Fuera de plazo solo cambia una vez al día
- **Qué es:** `colaDeSeguimiento` fija su «ahora» a las `T12:00Z` del día (14:00 Madrid) — el ancla
  del mandamiento 13 (clasificación estable). Pero los umbrales de Fuera de plazo son de MINUTOS
  laborables (30/120/240): con el ahora congelado, una urgencia entregada a las 15:00 no puede
  escalar hasta el mediodía siguiente, y por la mañana los casos de ayer tarde miden de más. El
  ancla de estabilidad y los umbrales finos se contradicen. Lo destapó un flake de `qa:cola`
  el 23-08 («entregado ahora mismo» medía 300 min corriendo el QA por la mañana; el QA ahora
  ancla sus fixtures y es determinista — el fondo queda).
- **El arreglo (a decidir):** o el «ahora» de la cola pasa a ser el instante real (la cohorte puede
  cambiar dentro del día — el mandamiento 13 habla de umbrales de NEGOCIO en días, y estos son
  plazos operativos de minutos), o los umbrales asumen la granularidad del ancla. La primera parece
  la correcta: sin reloj vivo, «30 minutos» no significa 30 minutos.
- **Fecha:** 2026-08-23 · ✅ **RESUELTA el 2026-08-23** (dictado): reloj VIVO para los plazos
  operativos (`ahora = new Date()` salvo inyección); lo diario sigue en días de clínica (§13); el
  QA inyecta su instante fijo (§14) y los fixtures siguen anclados.

## 112. El seed demo escribe motivo_perdida FUERA del enum (texto libre)
- **Qué es:** los perdidos del seed llevan `motivo_perdida` = «Precio», «Cambió de opinión»,
  «Se fue a otra clínica», «Sin respuesta tras 3 contactos» — texto libre, no el enum del modal
  (`precio_alto`, `otra_clinica`…). Mandamiento 15 (el seed respeta el vocabulario real), el mismo
  patrón que la 110. Lo destapó el filtro por motivo de F7: filtrar por el enum daba vacío en la
  demo. Mitigado en la UI: el filtro de /tablas/presupuestos lista el enum ∪ los valores presentes
  (también cubre datos legacy reales), y la celda enseña el texto tal cual.
- **El arreglo:** demo-seed escribe el enum (y la invariante del seed lo comprueba, §15).
- **Fecha:** 2026-08-24 · **Fase 2** · 🟢 **HECHA el 2026-09-06** (MOTIVO_PERD_ENUM: precio_alto · otra_clinica · no_responde · sin_urgencia; la narrativa sigue en el hilo y en motivo_perdida_texto; invariante) · — tanda «seed honesto» (Simon: la demo es hoy el peor argumento de venta)

## 113. Sillones como restricción de agenda — PREGUNTA ABIERTA (validar con RB antes de modelar)
- **Qué es:** decisión de diseño de la agenda (2026-08-27, dictada): los sillones quedan FUERA del
  modelo de disponibilidad. La agenda que manda es la del doctor — el nº de sillones no cambia
  cuándo puede atender un doctor concreto. El único caso donde el sillón restringe de verdad es
  si hay MÁS doctores trabajando a la vez que sillones disponibles: dos doctores libres a la misma
  hora no podrían atender los dos.
- **Qué falta:** validar con RB si ese caso se da en la práctica. Si se da, el sillón entra al
  cálculo como tope de concurrencia por clínica (nº de citas simultáneas ≤ sillones), no como
  asignación por cita. Si no se da, no se modela.
- **Contexto:** el motor de huecos del MVP (`lib/scheduler/availability.ts`, sin callers) colisionaba
  por sillón con un `chairId` sintético (regex de dígitos sobre códigos `CHR_01` de la era Airtable,
  índices 1..N inventados desde una config in-memory) — un argumento más para no reutilizarlo.
  RESUELTO en parte el 28-08: el motor se tiró (G1b) y el nuevo no sabe de sillones; queda la
  validación con RB.
- **Fecha:** 2026-08-27

## 114. Dos fuentes de «doctor» y dos horarios de clínica — unificación pendiente post-agenda
- **Qué es:** (a) `staff` (la agenda, G1) y `doctores_presupuestos` (el filtro ?doctor de
  /tablas y /pipeline, por NOMBRE como string) siguen siendo dos registros sin relación — renombrar
  un doctor rompe el histórico de presupuestos; (b) el horario de APERTURA vive dos veces con el
  mismo tipo TS: `conocimiento.plazos.horario` (agente + reloj de la cola, la fuente viva) y
  `configuraciones_clinica[horario_laboral]` (lo lee el engine de automatizaciones y lo edita
  HorarioLaboralPanel). La 031 NO los unificó a propósito: G1 no debía tocar presupuestos ni el
  motor viejo, que muere en B5.
- **El arreglo:** tras B5, presupuestos resuelve doctor contra `staff` (id, no nombre) y
  `doctores_presupuestos` pasa a vista/compat; el horario viejo muere con el engine y
  HorarioLaboralPanel enlaza al del agente.
- **Fecha:** 2026-08-28

## 115. El desempate de plantillas por «la primera de la lista» CAE ANTES DE B5
- **Qué es:** `app/api/cobros/[pacienteId]/panel/route.ts:58` propone mensaje de cobro con
  `plantillas.find(nombre) ?? plantillas[0]` — si el nombre esperado no existe, coge la primera
  plantilla activa de cobranza al azar. Hay 3 sitios más que casan plantilla por nombre pero SIN
  desempate ciego (actions-exec, no-shows/acciones, copilot/chat: sin match no proponen).
- **La condición, explícita (dictada 31-08):** hoy es tolerable únicamente porque una persona lee
  el texto antes de enviarlo (modo A, envío uno a uno). **Deja de serlo con B5 y el modo B**:
  cuando el agente envíe solo, la primera plantilla al azar es un mensaje equivocado que nadie ve.
- **El arreglo:** sin match exacto → no se propone mensaje (hueco honesto, como la opción (b) de
  la cola de envíos), nunca un desempate. Hacerlo como precondición de B5, no después.
- **Fecha:** 2026-08-31

## 116. Calendario de CLÍNICA para festivos y cierres (nivel 2, «sí pero después»)
- **Qué es:** el mapeo del nivel 2 es un calendario POR DOCTOR. Falta el de clínica: festivos,
  cierres y vacaciones colectivas que bloquean a TODOS los doctores de una clínica a la vez.
- **El arreglo:** extensión natural del modelo 033 — `agendas_externas.staff_id` nullable +
  `clinica_id`, y sus ocupaciones se restan como bloqueo global en el compositor. El conector no
  cambia. Dictado el 31-08: «sí, pero después».
- **Fecha:** 2026-08-31

---

## AUDITORÍA PROFUNDA DEL AGENTE (2026-09-05) — 117 a 155

Salida de la auditoría de solo-lectura del flujo entero (webhook → contexto → evaluador → juez →
veto → persistencia → cola → entrega). Severidad con el vocabulario de la auditoría:
**rompe silencioso · rompe visible · degrada · mejora**. Estado: ✅ = en el encargo de resolución
del 2026-09-05 (se marca 🟢 al cerrarse) · 🔵 = pendiente de decisión o fuera del encargo.

## 117. Webhook — un fallo de persistencia pierde el mensaje para siempre
- **Qué es:** el dedup marca el KV ANTES de guardar (`route.ts:238` → `:257`). Si el insert falla,
  devolvemos 500, Meta reintenta, el reintento cae en «ya visto» y responde 200: nadie lo vuelve a
  intentar. Es S1 con otra forma. Además el KV es get-y-luego-set (race) y sin UNIQUE en base.
- **Severidad:** rompe silencioso · **Propuesta:** UNIQUE (cliente, waba_message_id) + ON CONFLICT;
  el KV se marca DESPUÉS de persistir · **Esfuerzo:** 2 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): UNIQUE (cliente, waba_message_id) + ON CONFLICT en `createMensajeWhatsAppPg`; el KV se marca después de persistir

## 118. Webhook — solo `messages[0]` y solo texto
- **Qué es:** del lote de Meta se procesa el primer mensaje (`route.ts:194`) y solo si es `text`
  (`:195`). Audios, fotos, documentos, ubicaciones y respuestas de botón no se guardan ni dejan rastro.
- **Severidad:** rompe silencioso · **Propuesta:** lote entero + todos los tipos persistidos con
  `tipo`; en el hilo se ven como lo que son; el agente deriva lo que no puede leer sin inventar ·
  **Esfuerzo:** 3 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): lote entero y todos los tipos (034 `tipo`/`media_id`); lo no legible deriva por `no_legible` sin modelo; sticker/system no exigen respuesta

## 119. Un solo borrador — el composer no enseña el del evaluador
- **Qué es:** el borrador que juzga, veta y mide el evaluador solo lo lee el banco. El composer
  genera OTRO por `/api/agente/entrada` (`ComposerConversacion.tsx:132`), que no pasa por el veto
  determinista de agenda. Dos veces se midió un artefacto que no era el producto.
- **Severidad:** rompe visible · **Propuesta:** el composer precarga el del evaluador (al día), el de
  entrada solo en el relevo, veto en los dos, y la coincidencia se mide contra ese texto ·
  **Esfuerzo:** 3 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): `borradorAgenteDe` es la única fuente; composer y chat embebido lo precargan; entrada solo en relevo; veto en los dos; las 4 rutas de envío miden contra él

## 120. La coletilla del pago pendiente se pega en cada turno
- **Qué es:** `evaluador.ts:945-952` la añade sin memoria de turnos previos, y el prompt también.
- **Severidad:** rompe visible (tono) · **Propuesta:** una vez por conversación, contado del hilo ·
  **Esfuerzo:** 1 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): `cobroYaRecordado` contado del hilo + el prompt lo sabe

## 121. Nadie emite `aplazado_resuelto`
- **Qué es:** ni la ruta de decisiones ni ningún botón lo escriben: los pendientes son eternos y el
  agente re-aplaza y deriva por insistencia sobre lo ya contestado a mano.
- **Severidad:** rompe visible · **Propuesta:** botón «Respondido» por pendiente en la ficha ·
  **Esfuerzo:** 2 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): botón «Respondido» por clave en la ficha → `aplazado_resuelto`

## 122. Red de clínicas — el hilo no distingue clínica y la config es la de la ficha
- **Qué es:** hilo por teléfono sin `clinica_id` (`evaluar-entrante.ts:81-87`); objetivos y
  conocimiento salen de `ctx.clinicaId ?? e.clinicaId` (`:62`), la clínica del paciente antes que la
  del número que recibió. En RB, diez clínicas.
- **Severidad:** rompe visible · **Propuesta:** config del NÚMERO (hoy) + hilo filtrado por clínica
  (decisión de producto: ver diagnóstico del 2026-09-05) · **Esfuerzo:** 1 h + 1 día ·
  **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): config del número + hilo único por persona con una sola regla de acceso (`lib/mensajeria/acceso-hilo`), mensajes etiquetados por clínica y contexto de red al evaluador

## 123. El contador de insistencia cuenta toda la vida y todas las ráfagas
- **Qué es:** `evaluar-entrante.ts:125-129` suma todo `aplazado` de la clave sin cortar en el último
  resuelto ni agrupar una ráfaga.
- **Severidad:** degrada · **Propuesta:** vueltas desde el último resuelto, ráfaga = una vuelta ·
  **Esfuerzo:** 1 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): `vueltasPorClave` — desde el último resuelto, ráfaga de 15 min = una vuelta

## 124. Una espera de más de 14 días se pierde sin rastro
- **Qué es:** `evaluador.ts:770-778` la descarta sin anotar ni contar.
- **Severidad:** rompe silencioso · **Propuesta:** pendiente visible «pide no ser contactado hasta X
  (la fija una persona)» · **Esfuerzo:** 1 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): pendiente visible clave `otro` + contado en descartes

## 125. Rojo eterno por queja o insistencia
- **Qué es:** `semaforo.ts:187` solo cierra a mano. Cada paciente que se quejó una vez deja mudo al
  agente con él hasta un clic.
- **Severidad:** degrada (crece con los meses) · **Propuesta:** ver la recomendación del
  2026-09-05 (cierre por hecho + edad) · **Esfuerzo:** 2 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): queja se cierra con dos hechos (respuesta + la persona vuelve a escribir), insistencia con `aplazado_resuelto`, edad visible en la ficha; nada caduca

## 126. El semáforo carga todos los eventos del cliente en cada evaluación
- **Qué es:** `semaforo.ts:100-110` sin WHERE por caso; matching por subcadena de dígitos (`:254`).
- **Severidad:** degrada con volumen · **Propuesta:** filtrar por dígitos del caso en SQL y exigir
  ≥ 9 dígitos para el matching · **Esfuerzo:** 2 h · **Fecha:** 2026-09-05 · 🔵

## 127. La anonimización es un no-op en producción
- **Qué es:** el mapa solo lleva `e.clinica` (`evaluador.ts:483`) y el orquestador no lo pasa. Nombre
  de pila y texto de salud íntegro viajan a Anthropic. Va al resumen para la consulta legal.
- **Severidad:** legal · **Esfuerzo:** decisión · **Fecha:** 2026-09-05 · 🔵 consulta legal

## 128. Los fallos sistemáticos del agente solo llegan a consola
- **Qué es:** config ilegible, contexto roto y API caída → `console.error` y nada más
  (`evaluar-entrante.ts:71`, `route.ts:309`). La bandeja no distingue «sin evaluar».
- **Severidad:** rompe silencioso · **Propuesta:** aviso en la campana (uno por hora y motivo) +
  contador «sin evaluar» por clínica en la bandeja · **Esfuerzo:** 3 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): `avisarFalloAgente` (campana, uno por hora/motivo/clínica) + filtro y banda «Sin evaluar» en la bandeja

## 129. El webhook no declara `maxDuration`
- **Qué es:** evaluador (20 s) + juez (10 s) + semáforo dentro de un `after()` sin tope declarado. Si
  el proyecto no está en Fluid Compute, el default de 10-15 s mata la evaluación en silencio.
- **Severidad:** rompe silencioso · **Propuesta:** `maxDuration = 60` + verificar Fluid en el
  dashboard (el token del CLI local está caducado) · **Esfuerzo:** 10 min · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): `maxDuration = 60` en el webhook. Fluid Compute SIN verificar (token del CLI caducado): comprobar en Vercel → Settings → Functions

## 130. Modo manual — el saliente se inserta antes de que nadie lo envíe
- **Qué es:** `mensajeria.ts:256-274` registra y luego abre wa.me; si no se completa, el hilo dice
  «Clínica:» sobre algo que nunca salió y el evaluador lo lee.
- **Severidad:** rompe silencioso · **Propuesta:** registrar al confirmar («ya lo envié») o marcar
  el saliente como `pendiente_confirmar` · **Esfuerzo:** 3 h · **Fecha:** 2026-09-05 · 🟢 **HECHA el
  2026-09-06** tal como se diseñó: `Modo_A_manual_pendiente` al insertar, `POST /api/mensajeria/confirmar-envio`
  con `actualizarUna` (409 si ya estaba), los cinco lectores lo excluyen (hilo del evaluador, barrido,
  semáforo ×2, `intentos` de la ficha, `ultimo`/`ult_sal`/`pend` de la bandeja), el hilo lo pinta en gris
  a trazos con «Sí, lo envié», y tras abrir wa.me un toast con acción pregunta lo mismo en los tres
  sitios que abren WhatsApp (composer, intervención, lead). La cola de envíos (`Plantilla_automatica`)
  queda fuera a propósito: su `fuente` es la plantilla y confirmar la pisaría. `qa:modo-manual` 11/11 ·
  **Fase 0.5**
  · **Diseño fijado el 2026-09-06 (para ejecutar en frío):** NO se deja de insertar (si la persona
  cierra la pestaña tras abrir wa.me, un mensaje enviado sin registro es perder un dato, §1). Se
  inserta con `fuente = 'Modo_A_manual_pendiente'`; `POST /api/mensajeria/confirmar-envio {mensajeId}`
  lo pasa a `Modo_A_manual` («ya lo envié», con `actualizarUna`); y los lectores que deciden con el
  saliente lo EXCLUYEN mientras esté pendiente — el hilo del evaluador (`evaluar-entrante`), el
  «saliente posterior» del barrido y del semáforo (queja, no_legible), `intentos` de la ficha y
  `sinRespuestaDesde` de la bandeja — enseñándolo en gris como «pendiente de confirmar». Cinco
  lectores: por eso son 3 h y no 30 min.

## 131. La rama WABA no persiste `autor` ni `sugerido_por_ia`
- **Qué es:** `mensajeria.ts:385-396`. En modo B real la tasa de coincidencia y «las lleva el
  agente» nacen muertas. · **Severidad:** degrada · **Esfuerzo:** 15 min · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05)

## 132. Los webhooks de estado de Meta se descartan
- **Qué es:** `route.ts:192`. Sin columna de entrega; un `failed` posterior no lo ve nadie; el
  envío no lee el cuerpo del error (`mensajeria.ts:370`).
- **Severidad:** rompe silencioso · **Propuesta:** procesar `statuses` (sent/delivered/read/failed)
  sobre `waba_message_id` + leer el código de error de Meta · **Esfuerzo:** 1 día ·
  **Fecha:** 2026-09-05 · 🔵

## 133. La ventana de 24 h no se comprueba antes de enviar
- **Qué es:** ni backend ni UI (`ComposerConversacion.tsx:149-172` recibe `ultimoEntrante` y no lo
  usa). Sin plantilla viva, el envío fuera de ventana falla como «No se pudo cargar».
- **Severidad:** rompe visible · **Propuesta:** aviso en el composer + bloqueo hasta que exista
  plantilla · **Esfuerzo:** 2 h · **Fecha:** 2026-09-05 · 🔵 (depende del catálogo de Meta)

## 134. El composer pisa cualquier error de envío con «No se pudo cargar»
- **Qué es:** `ComposerConversacion.tsx:175,190` + `fetch-json.ts:92-95`.
- **Severidad:** rompe visible · **Esfuerzo:** 30 min · **Fecha:** 2026-09-05 · **Fase 0.5** · 🟢 **HECHA el 2026-09-06** — el composer lanza `ErrorDeCarga` con el texto del servidor (y «Sin conexión» si el fetch cae); `mensajeDeError` ya no lo pisa

## 135. Opt-out — una fuente, la mitad de los lectores, y sin detección conversacional
- **Qué es:** `pacientes.optout_automatizaciones` lo respetan cola, recordatorios, engine, no-shows y
  llamadas; NO el webhook, ni el evaluador, ni el composer, ni el envío WABA. Solo lo escribe el STOP
  legacy de Twilio. «No me escribáis más» no existe como juicio.
- **Severidad:** rompe silencioso · **Propuesta:** una lib por teléfono, todos los lectores, juicio
  `pideNoContacto` + evento `opt_out` · **Esfuerzo:** 4 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): `lib/contacto/optout.ts` (paciente + log), juicio `pideNoContacto` + respuesta por código, composer/chat/4 rutas de envío/cola lo leen

## 136. Idioma — sin instrucción; vetos y plantillas solo en español
- **Qué es:** el evaluador no fija idioma; el veto determinista (`juez-borrador.ts:210-218`), la
  coletilla y las preguntas seguras son español puro.
- **Severidad:** degrada · **Propuesta:** instrucción + juicio `idioma` + firmas en en/ca; plantillas
  en otros idiomas, decisión aparte · **Esfuerzo:** 2 h · **Fecha:** 2026-09-05 · 🟢 parcial (2026-09-05): instrucción de idioma, juicio `idioma`, veto en/ca, plantillas neutras y de entrega en ca/en · 🔵 preguntas seguras y coletillas en otros idiomas

## 137. Config — precio y horario absurdos se afirman tal cual
- **Qué es:** precios texto libre sin rango (`conocimiento.ts:15-17`); «25:00» pasa la regex de
  horario (`:354-356`). · **Severidad:** degrada · **Esfuerzo:** 1 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): `motivoPrecioAbsurdo` (1–100.000 €) + `esHoraValida` + topes de longitud, en el mismo parser de guardar y leer

## 138. Inyección — texto del paciente sin delimitar; cero casos en el eval
- **Qué es:** `evaluador.ts:423`, `juez-borrador.ts:141`. · **Severidad:** degrada ·
  **Propuesta:** delimitar con etiquetas + regla en el system + tanda I del eval · **Esfuerzo:** 2 h ·
  **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): `<paciente>…</paciente>` en evaluador, juez y entrada + regla en los tres system + tanda I del eval (4/4)

## 139. Teléfono compartido — mezcla presupuestos de madre e hijo en el mismo prompt
- **Qué es:** paciente por `LIKE %dígitos%` con `limit 1` (`contexto-conversacion.ts:115-124`);
  presupuestos por teléfono O por ese paciente (`:147-155`). Mandamiento 20 con teléfono.
- **Severidad:** rompe visible · **Propuesta:** ver diagnóstico del 2026-09-05 (guarda de
  ambigüedad: no afirmar presupuestos ni pagos cuando el número es de más de una persona) ·
  **Esfuerzo:** 3 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): guarda de ambigüedad en `contextoDeConversacion` (hasta 5 pacientes, `mismaPersona` para paciente+lead), solo `identificar`, ficha lo declara, `qa:contexto` lo censa

## 140. Menores — el agente no lee `edad`, `fecha_nacimiento` ni `tutor_telefono`
- **Severidad:** degrada · **Propuesta:** si el paciente casado es menor, la ficha lo dice y toda
  duda clínica deriva · **Esfuerzo:** 2 h · **Fecha:** 2026-09-05 · 🔵

## 141. Reglas duras de dinero, clínico y art. 9 solo en el juez (modelo)
- **Qué es:** el único veto en código son cinco regex de agenda. Censo de frases-firma en la auditoría
  del 2026-09-05. · **Severidad:** degrada · **Propuesta:** veto determinista condicionado a «no
  consta» (mismo mecanismo que `huecosConstan`) · **Esfuerzo:** una mañana · **Fecha:** 2026-09-05 · 🔵

## 142. Descarte del juez → plantilla que ignora lo preguntado
- **Qué es:** `plantillaNeutraConRecogida` pregunta por el objetivo activo aunque la persona
  preguntara otra cosa (`evaluador.ts:926`). · **Severidad:** rompe visible · **Propuesta:** juez
  que corrige (una llamada más solo en el 10 % de turnos, re-vetada) · **Esfuerzo:** 3 h ·
  **Fecha:** 2026-09-05 · 🔵

## 143. `camposRecogidos` por etapa, no por presupuesto
- **Qué es:** con seis presupuestos vivos, «decision: acepta» no dice cuál; letras sin tope.
- **Severidad:** degrada · **Esfuerzo:** 3 h · **Fecha:** 2026-09-05 · 🔵

## 144. Hilo largo — el juez ve solo los últimos 1.500 caracteres de la persona
- **Qué es:** `evaluador.ts:871-875`; y el recorte tira los salientes viejos antes que los entrantes.
  El falso positivo de «dato no pedido» del 22-08 vuelve con volumen.
- **Severidad:** degrada · **Esfuerzo:** 2 h · **Fecha:** 2026-09-05 · 🔵

## 145. Sin tope de coste ni de mensajes por conversación en producción
- **Qué es:** el banco tiene 100/día; el camino real, nada. · **Severidad:** degrada ·
  **Propuesta:** tope por conversación/día con aviso · **Esfuerzo:** 1 h · **Fecha:** 2026-09-05 ·
  **Fase 0** · 🟢 **HECHA el 2026-09-06** — `topeTurnos24h()` en `evaluar-entrante` (50 por
  conversación en 24 h rodantes, `AGENTE_TOPE_TURNOS_24H`); al superarlo no se llama al modelo, el
  caso queda «Sin evaluar» y suena la campana (`tope_turnos`, uno por hora); el barrido lo reintenta
  sin coste cuando baja.

## 146. Crons sin heartbeat ni registro de última ejecución
- **Severidad:** rompe silencioso (cola de envíos, no-shows, llamadas Vapi) · **Propuesta:** fila
  de última ejecución + `/api/salud` que la lea · **Esfuerzo:** 2 h · **Fecha:** 2026-09-05 · 🔵

## 147. Retención y borrado de mensajes y eventos del agente
- **Qué es:** `evaluacion_json` y `motivo_texto` guardan salud en claro; ningún camino de borrado;
  borrar paciente no los toca (van por teléfono). Va al resumen legal. · **Fecha:** 2026-09-05 ·
  **Fase 0** · 🟢 **HECHA el 2026-09-06 (mecanismo)** — migración 039 `supresiones` + grant delete
  sobre el log; `lib/contacto/supresion` borra por teléfono en una transacción y anota hash, motivo,
  actor y recuentos (nunca contenido); `POST /api/admin/supresion` (admin, confirma si el número es
  compartido) y `DELETE /api/pacientes/[id]` (solo si el número es exclusivo); retención por plazo en
  `/api/cron/retencion` y en el cron diario **solo con `RETENCION_CONVERSACIONES_DIAS`** — sin plazo
  no borra. `qa:supresion`. **Del abogado queda el plazo** (bloqueante de Simon). Sin botón en la ficha
  todavía: el camino es la ruta admin.

## 148. Transparencia de IA — ver 108
- Censo del 2026-09-05: primer mensaje de cada hilo, reanudación por plantilla, relevo persona-agente.
  Va al resumen legal. · 🔵

## 149. Caso 35 del eval a regla de código
- «¿Con quién hablo de esto?» tras un enlace no es pedir persona. · **Esfuerzo:** 30 min ·
  **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): regla en `evaluarTurno` — «¿con quién hablo?» tras un enlace no es pedir persona

## 150. Señales del log que el prompt no ve
- Tiempo desde el último saliente y el entrante previo, hora contra el horario, salientes sin
  respuesta: tres líneas contadas por código. · **Esfuerzo:** 1 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): `senalesDelHilo` → línea SEÑALES DEL HILO en el contexto

## 151. El motivo de descarte del juez está persistido y nadie lo mira
- Panel por clínica y motivo (30 días). · **Esfuerzo:** 2 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-05): `/api/agente/descartes` + `DescartesJuezPanel` en la pestaña Configuración de /agente

## 152. Caso 49 del eval — decisión de producto
- «Hay opiniones de todo» exige una causa «desconfianza» que no existe. Ver propuesta del
  2026-09-05. · 🟢 hecha (2026-09-05): 49 remapeado a A en la vara

## 153. Transcripción de audio — decisión aparte
- Coste por minuto y salud hablada en otro proveedor. Se diagnostica como pieza propia cuando el
  punto 2 esté cerrado. · **Fecha:** 2026-09-05 · 🔵

## 154. Plantillas — sin guarda de categoría y `outbound.ts` muerto con nombres inexistentes
- `nombrePlantilla` es texto libre; `outbound.ts` usa nombres que no están en el catálogo. ·
  **Severidad:** degrada · **Esfuerzo:** 1 h · **Fecha:** 2026-09-05 · 🔵

## 155. Un error transitorio en `evaluadorActivo` manda el mensaje al clasificador viejo
- Dos comportamientos para la misma clínica según un hipo de base. · **Severidad:** degrada ·
  **Propuesta:** con B5 muere el camino viejo; hasta entonces, reintento único · **Esfuerzo:** 30 min ·
  **Fecha:** 2026-09-05 · **Fase 0** · 🟢 **HECHA el 2026-09-06** — `evaluadorActivo` reintenta una
  vez (250 ms) antes de degradar a apagado, con el intento en el log. El camino viejo muere en B5 (94).

## 156. Inicio · «Conversión» de la tabla de clínicas enseña 0 % de una cohorte 100 % abierta
- La primera semana de cada mes (no solo en la demo) todas las sedes salen a «0 %». El bloque
  de negocio ya sabe que la cohorte no es comparable (`abiertos/total > 20 %`, `muestraCorta`);
  la tabla lo ignora y pinta el porcentaje. · **Propuesta:** la celda pasa a «aceptados de
  presentados» con barra de proporción; el % solo cuando la cohorte es comparable; si no,
  «N abiertos · muestra corta». · **Severidad:** engaña · **Esfuerzo:** 1 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-06: tabla → «aceptados de presentados» + barra; % solo con cohorte comparable)

## 157. Inicio · micro-visualización dentro de lo que ya existe (sin gráficos nuevos)
- Hoy no hay un solo elemento donde la forma comunique: todo cifras. · **Propuesta:** «Qué hizo
  Fyllio» → barra de proporción bajo cada cifra (cobros a cero salta a la vista); «Tu equipo» →
  barra apilada de las tres cohortes; «Tus clínicas» → barra fina bajo € aceptado y € vencido
  (ranking legible); «Parado esperándote» → bullet (medida, marca hace 7 d, bandas = rango del
  mes) y sparkline de 7 d en cada línea. Una familia de color; rojo = actuar; sin ejes ni
  leyendas. Modelo visual publicado el 2026-09-05; pendiente de OK. · **Esfuerzo:** 3-4 h ·
  **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-06: barras de proporción, cola apilada, barras en la tabla, bullet A de Few, sparklines)

## 158. Inicio · «Ver el detalle» en dinero parado, equipo y clínicas
- Solo «Qué hizo Fyllio» tiene desplegable. · **Propuesta:** dentro va lo analítico del MISMO
  bloque: dinero → evolución del mes, composición, qué entró/salió en 7 d; equipo → la cola en
  el mes, edad de espera en tramos, por sede; clínicas → aceptado vs mismo tramo del mes previo,
  vencidos por sede, agente por sede. Nada nuevo fuera. · **Depende de:** 159 para las series ·
  **Esfuerzo:** 4-6 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-06: desplegables de dinero, equipo y clínicas con lo analítico del mismo bloque)

## 159. Fotos diarias del Inicio: el seed guarda 2 (hoy, hace 7 d); las series piden ~30
- Sparklines, bullet con bandas y «evolución del mes» necesitan una foto por día. En real las
  escribe el cron; en la demo, `db-seed-inicio-fotos.mts` debe sembrar 30 días (30 pasadas de
  `calcularDashboardRed({ahora})`, ~+1 min de seed). Sin esto, 157/158 enseñan líneas planas. ·
  **Esfuerzo:** 1 h · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-06: seed de fotos a 30 días, en paralelo por día; columna equipo_json (036))

## 160. Demo · el agente nunca «cocina» un cobro (0 de N siempre)
- El seed no genera ninguna entrega `caso_completo` con `objetivo_activo='cobro'`, así que la
  tarjeta de cobros sale a cero mes tras mes. Decidir si es realidad del producto (el agente aún
  no persigue cobros) y entonces la tarjeta lo dice, o si el seed debe sembrar 1-2. ·
  **Severidad:** confunde en demo · **Esfuerzo:** 30 min · **Fecha:** 2026-09-05 · 🟢 hecha (2026-09-06: hueco del seed confirmado — el camino real funciona (evaluación real 06-09); 2 cobros acordados sembrados)

## 161. `d10` en `presupuestos/pg.ts` resta un día a las fechas cuando el proceso no corre en UTC
- pg devuelve las columnas `date` como Date a medianoche LOCAL y `d10` hace `toISOString()` (UTC):
  en Madrid, el 1-sept sale como 31-ago. En Vercel (UTC) no se nota; en local y en cualquier QA
  o seed que calcule sobre el mismo loader, sí (esta sesión: la cohorte de septiembre «perdía»
  sus 3 aceptados). · **Propuesta:** `types.setTypeParser(1082, v => v)` en el cliente pg (date
  como texto) y `d10` sin conversión de huso. · **Severidad:** engaña fuera de Vercel ·
  **Esfuerzo:** 30 min · **Fecha:** 2026-09-05 · 🔵

---

# Plan maestro (6-sep-2026) — entradas 162-205, cada una con su FASE

Nacen del [diagnóstico estratégico](DIAGNOSTICO-ESTRATEGICO-2026-09-06.md) aprobado por Simon; la
fase de cada una y el reparto de las anteriores están en [`PLAN-MAESTRO.md`](PLAN-MAESTRO.md).
Formato compacto: problema · propuesta · severidad · esfuerzo · **fase**.

## 162. Fase 0 · Log drain — los errores de producción viven un día
- Vercel Hobby retiene los logs ~24 h y no ofrece drains; 265 `console.error` que nadie podrá leer
  cuando RB diga «el martes contestó mal». · **Propuesta:** `lib/log` que además de consola envíe
  a un destino externo por HTTP (Axiom o Sentry, capa gratuita), o plan Pro con drain nativo
  (decisión de gasto de Simon). · **Severidad:** ciega · **Esfuerzo:** 1-2 h · **Fase 0** ·
  **Fecha:** 2026-09-06 · 🟢 **HECHA el 2026-09-06** — `lib/log-drain` envuelve `console.error/warn`
  desde `instrumentation.ts`; declarado en `lib/entorno`. **Inerte hasta que Simon cree el destino y
  ponga `LOG_DRAIN_URL` (+ `LOG_DRAIN_TOKEN`) en Vercel** — bloqueante suyo, no de código.
  **Decisión 6-sep (Simon): el drenaje queda anotado para cuando haya clientes reales**, no ahora
  — otro proveedor recibiendo registros con contenido es otra superficie que justificar ante el
  abogado. Lo capturable desde nuestro código va a `incidencias` (207); esto cubre solo lo que
  muere fuera de él.

## 163. Fase 0 · Barrido de reevaluación — el turno perdido no se reintenta
- Modelo caído o timeout de 20 s → turno perdido; el caso queda en «Sin evaluar» hasta que alguien
  mire. · **Propuesta:** ruta protegida que busca entrantes legibles sin evento `evaluacion` con más
  de N minutos y evaluador activo, y los reevalúa (idempotente por `mensaje_id`); la dispara la cola
  (164). · **Severidad:** pierde turno · **Esfuerzo:** 1 día · **Fase 0** · **Fecha:** 2026-09-06 ·
  🟢 **HECHA el 2026-09-06** — `lib/agente/barrido-reevaluacion` (idempotente, excluye lo contestado y
  lo del lote) + `/api/cron/reevaluar` (todos los clientes, CRON_SECRET) + el webhook barre 3 hilos
  por lote + suelo en el cron diario; `qa:barrido` sin modelo. Sin la cola (164) el disparo periódico
  fuera del tráfico sigue siendo el cron diario.

## 164. Fase 0 · Cola de trabajos — `after()` y dos crons diarios no sostienen nada de lo que viene
- Sin reintentos, sin ejecución diferida, sin garantía. · **Propuesta:** QStash (push, reintentos y
  mensajes diferidos, sin worker, funciona en Hobby) o equivalente; primer uso: la evaluación del
  turno y el barrido 163; después cadencias a la hora correcta, retención, recálculo de NBA. Cierra
  146 (heartbeat) de paso. · **Severidad:** bloquea 0.1 y 0.2 · **Esfuerzo:** 1 semana ·
  **Fase 0** · **Fecha:** 2026-09-06 · 🟢 **HECHA el 2026-09-06** (QStash). Qué se mueve a la cola
  HOY: **solo el turno del evaluador** (`evaluar_entrante`, desde el webhook, encolado antes de
  responder a Meta). Qué se queda en `after()` a propósito: el barrido al final de cada lote
  (barato, idempotente, con suelo en el cron), el flujo viejo de clasificación (muere con 165), la
  foto de Inicio y el sync de agendas (tienen su propio estado persistido). Firma de QStash
  verificada en `/api/cola/*` (fail-closed: sin clave rechaza todo); idempotencia en dos capas
  (`deduplicationId` + `turnoYaEvaluado` antes de gastar modelo); 3 reintentos y, agotados, el
  callback deja el turno en `incidencias` (207) con aviso en la campana. `lib/cola/qstash` ·
  `qa:cola-trabajos` (firma, malformado, reentrega, callback). Activa sola en producción (URL de
  Vercel); el disparador cada 10 min de `/api/cron/reevaluar` se crea con `npm run cola:programar`
  (necesita `COLA_URL_BASE`). Queda para otro día: el barrido y la retención como trabajos con hora.

## 165. Fase 0 · UNA sola salida automática hacia el paciente
- Hoy nada sale solo: Twilio apagado, `engine.ts` no envía (skeleton), `cola_envios` se genera por
  cron y se **envía a mano** (11), el motor de reglas no tiene dedup (9/10). · **Propuesta:**
  `cola_envios` → plantillas WABA, con dedup por (persona, plantilla, día), idempotency key,
  semáforo, opt-out y ventana de 24 h (133), estados de entrega de Meta (132); el motor 16b deja de
  «enviar». **Bloqueada por el catálogo de Meta**: se construye hasta donde no dependa de él y
  queda DECLARADA aplazada, no olvidada. · **Severidad:** el producto promete lo que no hace ·
  **Esfuerzo:** 1 semana · **Fase 0** · **Fecha:** 2026-09-06 · 🔵

## 166. Fase 0 · Registro de consentimiento y bloqueo de envío sin él
- Fyllio no guarda ni pide el consentimiento del canal WhatsApp; lo respeta si la clínica lo tiene
  en papel. · **Propuesta:** columna con fecha y origen en pacientes/leads, bloqueo del envío
  proactivo sin ella, visible en la ficha. La forma exacta la fija la consulta legal. ·
  **Severidad:** legal · **Esfuerzo:** medio día · **Fase 0** · **Fecha:** 2026-09-06 · 🟡 **PARCIAL el
  2026-09-06** — migración 039: fecha y origen en pacientes, y las tres columnas en leads (no existía);
  `lib/contacto/consentimiento` (sí/no/desconocido por teléfono, paciente manda, ambigüedad =
  desconocido; `registrarConsentimiento` por id) y la ficha del caso lo lleva. **Pendiente:** el
  bloqueo del envío proactivo está detrás de `CONSENTIMIENTO_WHATSAPP_OBLIGATORIO` y aún no se cablea
  en las cuatro rutas de envío: se hace cuando la consulta legal fije la forma (bloqueante de Simon).

## 167. Fase 0 · Log de cambios de configuración — nadie sabe quién apagó el agente ni cuándo
- `configuracion_automatizaciones` se sobreescribe; `evaluador_activo` es un boolean sin fecha.
  Sin esto no hay auditoría, ni rollback, ni «desde cuándo» para comparar antes/después. ·
  **Propuesta:** tabla `configuracion_historial` (cliente, clínica, campo, antes, después, quién,
  cuándo) escrita por todas las rutas de configuración; el encendido del agente es su primer
  hecho. · **Severidad:** irrecuperable hacia atrás · **Esfuerzo:** 1 día · **Fase 0** ·
  **Fecha:** 2026-09-06 · 🟢 **HECHA el 2026-09-06** — migración 038 `configuracion_historial` +
  `lib/configuracion/historial` (diff por campo, en la MISMA transacción) enganchado a
  `PUT /api/agente/configuracion` (con actor) y a `updateConfigRawPg`. **Hallazgo:** ninguna ruta
  escribe `evaluador_activo` hoy (solo el seed): el encendido quedará registrado cuando exista su
  interruptor en Ajustes.

## 168. Fase 1 · Hash de prompts, conocimiento y objetivos en el payload de cada turno
- El system prompt es una constante en git; el payload lleva `v:1` y `modelo`, ningún hash. Ningún
  juicio del histórico es atribuible a una versión. · **Propuesta:** sha256 de
  `SYSTEM_PROMPT_EVALUADOR`, `SYSTEM_PROMPT_JUEZ`, del conocimiento y de los objetivos renderizados,
  guardados en `evaluacion_json` (aditivo). · **Severidad:** irrecuperable · **Esfuerzo:** 2 h ·
  **Fase 1** · **Fecha:** 2026-09-06 · 🟢 **HECHA el 2026-09-06** — `lib/agente/version.ts`; el
  payload lleva `version.{evaluador,juez,conocimiento,objetivos}` (12 hex de sha256 del texto tal
  cual se mandó, override incluido).

## 169. Fase 1 · Entrada renderizada persistida — reproducir una decisión pasada
- Se guarda el juicio, no lo que el modelo vio (`renderEntrada` se tira). · **Propuesta:** guardar
  la entrada renderizada (comprimida si hace falta) junto al juicio; con 168 permite replay exacto
  en el banco de pruebas. · **Severidad:** irrecuperable · **Esfuerzo:** medio día · **Fase 1** ·
  **Fecha:** 2026-09-06 · 🟢 **HECHA el 2026-09-06** — `entrada` en el payload (texto renderizado
  antes de anonimizar). El replay en el banco queda para 183.

## 170. Fase 1 · El eslabón acción → resultado: `respuesta_a_mensaje_id` en salientes
- El saliente lleva un boolean `sugerido_por_ia`; `mensaje_enviado` lleva la distancia pero ningún
  id. No se puede saber qué borrador respondió a qué evaluación, ni qué resultado siguió a qué
  acción. · **Propuesta:** columna en `mensajes_whatsapp` escrita por las cuatro rutas de envío
  (id del entrante evaluado) + id del saliente en el evento `mensaje_enviado`. · **Severidad:**
  irrecuperable · **Esfuerzo:** 1 día · **Fase 1** · **Fecha:** 2026-09-06 · 🟢 **HECHA el 2026-09-06**
  (primera mitad, la irrecuperable) — migración 037 `mensajes_whatsapp.respuesta_a_mensaje_id`,
  resuelto en `createMensajeWhatsAppPg` al último entrante del hilo (id de Meta o id de fila). La
  segunda mitad (id del saliente en `mensaje_enviado`) es derivable por tiempo y queda 🔵.

## 171. Fase 1 · Señales del hilo persistidas
- `senalesDelHilo` (minutos sin respuesta, salientes sin respuesta, hora, en horario) se calcula y
  se tira cada turno. · **Propuesta:** viajar en el payload; de ahí sale 180 sin consulta nueva. ·
  **Severidad:** dato perdido · **Esfuerzo:** 1 h · **Fase 1** · **Fecha:** 2026-09-06 · 🟢 **HECHA el
  2026-09-06** — `senales` viaja en el payload de cada turno.

## 172. Fase 1 · `metricas_diarias` con definición versionada y backfill
- La única serie es dinero parado (035) con dos días. La tasa cambió de definición el 4-sep sin
  versión. · **Propuesta:** tabla (cliente, clínica, día, métrica, valor, n, `definicion_v`)
  alimentada por la cola; backfill desde datos crudos con timestamp (tiempo de respuesta,
  aceptación, pérdida, lead→cita). Necesita 37 (fecha de cierre de leads). · **Severidad:** sin
  esto no hay comparación contra uno mismo · **Esfuerzo:** 2-3 días · **Fase 1** ·
  **Fecha:** 2026-09-06 · 🟢 **HECHA el 2026-09-06** — migración 041 `metricas_diarias` (única por
  cliente, clínica o red, día y métrica; `definicion_v`; `n` junto al valor), `lib/metricas/diarias`
  con 18 métricas v1 definidas en la cabecera del archivo, `calcularDia`/`guardarDia` (upsert),
  `calcularDiaCliente` (red + cada clínica activa), `backfill` por rango (31 días por llamada),
  `serie()` para 181/158/203, `/api/cron/metricas` (`?dia=`, `?desde=&hasta=`, `?cliente=`) y suelo
  diario en el cron (ayer, todos los clientes). `qa:metricas` 20/20 con un día de 2020 contado a mano.
  **Lo que no está y por qué:** `leads_citados` (nadie registra el cambio de estado con fecha — es 37,
  no una fórmula), pagos por clínica (`pagos_paciente` no lleva clínica). El backfill histórico se
  lanza a mano: `curl -H "x-cron-secret: …" "/api/cron/metricas?desde=2026-06-01&hasta=2026-06-30"`.

## 173. Fase 1 · JSON en columnas `text` → `jsonb` con índice
- `objetivos`, `conocimiento`, `evaluacion_json` son texto; Inicio castea `::jsonb` en caliente en
  cada agregación. · **Propuesta:** migración a jsonb + índice GIN antes de que el log crezca. ·
  **Severidad:** deuda que se encarece · **Esfuerzo:** medio día · **Fase 1** · **Fecha:** 2026-09-06 · 🟢
  **HECHA el 2026-09-06** — migración 042: `evaluacion_json` a jsonb con índice GIN (la conversión
  falla si una fila no es JSON válido; ninguna lo era). Lectores migrados a la vez por el único
  camino `leerPayloadEvaluacion` (objeto o texto): ficha, borrador del agente, métricas, Inicio
  (`like '%"usage"%'` → `? 'usage'`), descartes del juez (`~ '^\s*\{'` → `jsonb_typeof`), y los
  cuatro scripts que hacían `JSON.parse`. `objetivos` y `conocimiento` se quedan en text a
  propósito (se leen una vez por turno, no se agregan, y el historial 038 compara su texto).
  **Sorpresa que pagó el QA:** jsonb normaliza el ORDEN de las claves; la ficha componía «qué
  quiere» con `Object.values(camposRecogidos)` y cambió de frase. Ahora ordena por la definición
  del objetivo. El orden es dato: si importa, se declara.

## 174. Fase 1 · Métricas del modelo por día
- Latencia, errores HTTP, fallbacks y descartes del juez solo existen en consola. · **Propuesta:**
  contadores diarios en 172 (métricas `modelo_*`). · **Severidad:** ciega · **Esfuerzo:** 1 día ·
  **Fase 1** · **Fecha:** 2026-09-06 · 🟢 **HECHA el 2026-09-06** — en `metricas_diarias`:
  `coste_usd` (n = turnos con usage), `modelo_errores` (incidencias agente/modelo_no_disponible,
  veces), `descartes_juez`, y `modelo_latencia_mediana_ms` (nuevo: `latenciaMs` medido alrededor
  de la llamada en `evaluarTurno` y persistido en el payload; n = turnos con latencia). Los
  errores HTTP del modelo son el fallback y ya cuentan como `modelo_no_disponible`.

## 175. Fase 1 · Los hilos del lote se evalúan en serie dentro de `after()`
- 20 s + 10 s por hilo; con 3-4 pacientes a la vez se agotan los 60 s. · **Propuesta:** encolar un
  trabajo por hilo (164) o `Promise.all` con tope de 3. · **Severidad:** pierde turnos bajo carga ·
  **Esfuerzo:** 2 h · **Fase 1** · **Fecha:** 2026-09-06 · ✅ **CERRADA el 2026-09-06 por
  verificación, sin código.** Next 16.0.8 ejecuta los `after()` de una petición con `p-queue` SIN
  límite de concurrencia (`node_modules/next/dist/server/after/after-context.js:30`,
  `new PQueue()` = concurrencia infinita): los hilos del lote ya corrían en PARALELO, no en serie —
  la premisa de la entrada era falsa. Y con 164 cada hilo es un trabajo propio de la cola, con
  su propio timeout. Lo que sí sigue siendo cierto: el `after()` de respaldo (cola inactiva)
  comparte los 60 s de la función entre todos los hilos del lote; el barrido lo cubre.

## 176. Fase 2 · Inteligencia de conversación agregada
- `camposRecogidos` (qué le frena, motivo de rechazo, cuándo retomar, urgencia, tratamiento) y los
  motivos literales de los aplazados están en cada turno y solo se ven en la ficha. ·
  **Propuesta:** agregado mensual por clínica: objeciones, motivos de pérdida, qué preguntan; sin
  coste de modelo. · **Severidad:** valor no enseñado · **Esfuerzo:** 3-4 días · **Fase 2** ·
  **Fecha:** 2026-09-06 · 🟢 **HECHA el 2026-09-10** — Analíticas › «Qué dicen» (`lib/metricas/conversacion` +
  `conversacion.tipos` puro, `GET /api/metricas/conversacion`, `qa:conversacion`): por conversación (no por turno, vale
  el último valor), en 30/90/180 días completos vs la ventana anterior: decisión, qué frena, por qué rechazan, cuándo
  retomar, qué preguntan (aplazados por tema con las frases), por qué entrega, qué buscan, urgencia y por qué no quieren
  cita (220). Cubos con el mismo mapeo conservador que los modales de cierre; «Otro» guarda las frases.

## 177. Fase 2 · Mapa de fuga por etapa en €
- Dinero parado, motivo de pérdida y aplazados existen por separado. · **Propuesta:** lead sin
  contactar → sin cita → presupuesto no aceptado → cobro vencido, en € y con el «por qué» de 176. ·
  **Severidad:** valor · **Esfuerzo:** 3-4 días · **Fase 2** · **Fecha:** 2026-09-06 · 🔵
  **HECHA el 2026-09-09** — Analíticas › Dónde se pierde (`analiticas/fuga/FugaView` ← `GET
  /api/metricas/fuga` ← `lib/metricas/fuga`; tipos y copy en `fuga.tipos`, puro). Cuatro etapas
  con los casos que SALIERON del flujo en 30/90/180 días completos hasta ayer, comparados con la
  ventana anterior: leads cerrados «No interesado» sin contacto nuestro / tras contacto sin cita
  (con los que sí tuvieron cita aparte), presupuestos cuyo último paso a PERDIDO cae en la ventana
  y siguen perdidos (importe), cobros que cruzaron a vencido en la ventana (la regla de la cola,
  `GRACIA_VENCIDO_DIAS` con nombre) más lo vencido hoy. El porqué: el motivo que registró la
  persona (vocabularios 42 y F7, con € por motivo y «aún reactivable») y, en los presupuestos
  cerrados sin motivo, la frase que recogió el agente (`extraerMotivoDelLog` + mapeo conservador).
  Dos monedas que NO se suman: € real (presupuestos + cobros) y ≈€ esperado de los leads = casos ×
  tasa lead→aceptado × ticket medio de la propia clínica en 180 días, con la base a la vista y null
  con motivo si hay menos de 5 captados o 5 aceptados. El «por qué» agregado de 176 sigue
  pendiente: aquí solo entra lo persistido por caso. `qa:fuga` 33/33 (dos sedes contadas a mano en
  2020, reloj fijo). Pendiente de mirar en el navegador.

## 178. Fase 2 · Next Best Config — qué publicar para que el agente resuelva más
- `aplazados` por clave (con `NATURALEZA_DE_CLAVE`) y `capacidadesDe(conocimiento)` existen y no
  se cruzan. · **Propuesta:** «14 conversaciones se atascaron en plan de pago: publica tu plan» /
  «conecta la agenda: 9 preguntas de huecos». · **Severidad:** valor · **Esfuerzo:** 2-3 días ·
  **Fase 2** · **Fecha:** 2026-09-06 · 🟢 **HECHA el 2026-09-10** — Agentes › Configuración › «Qué publicar para que
  resuelva más» (`lib/agente/siguiente-config.ts`, puro; `qa:siguiente-config`): los aplazados de 30 días por tema (de
  «Qué dicen») cruzados con lo publicado; cada tema lleva a su sección («Ir a la sección»), lo ya publicado se declara
  cubierto y sigue a la vista, y lo que ninguna configuración arregla (dudas clínicas, cambio de tratamiento, el dato de
  IVA/validez de 89) se dice sin botón. 89 sigue abierta: es el dato, no la pantalla.

## 179. Fase 2 · Confianza del agente
- Vara 66/67, descartes 10 %, coincidencia agente-humano: nada se ve. · **Propuesta:** bloque en
  Ajustes/Agentes: vara sintética hoy, tus conversaciones reales cuando existan. ·
  **Severidad:** valor · **Esfuerzo:** 1 día · **Fase 2** · **Fecha:** 2026-09-06 · 🟢
  **HECHA el 2026-09-09** — Agentes › Configuración › «Cómo decide tu agente»
  (`components/agente/ConfianzaAgentePanel` ← `GET /api/agente/confianza` ← `lib/agente/confianza`).
  Dos fuentes que NO se mezclan, y se dice: (1) **la vara**, leída de `evals/ultima-pasada.json`
  —lo escribe `qa:evals-evaluador` al terminar una pasada ENTERA (una tanda o unos casos no pisan
  la vara)— con el hash (168) del evaluador y del juez medidos; el producto lo compara con el
  hash del prompt que corre HOY y dice «es la misma versión» o «el agente cambió: la vara está por
  pasar» (no se recalcula sola: cuesta modelo). Decide bien 66 de 67 · entrega listo cuando toca
  21 de 21 · el control paró 7 de 73 · coste por turno, y que son 50 casos escritos por nosotros.
  (2) **tus conversaciones reales**, por sede, 30 días completos hasta ayer: turnos, te libera
  (caso listo de entregas), lo paró el control (vs el 10 % de la vara), enviado tal cual, marcado
  como error (2.7); debajo de cada sede, qué sigue exigiendo persona y qué aplazó. (3) **Así lo
  corriges**: el enlace a «Ver por qué» y el recuento de marcados por estado. Solo lo persistido.
  `qa:confianza` 31/31 (dos sedes contadas a mano, aislamiento por alcance, «dos caminos, un
  número» contra la serie diaria, vara legible/ilegible). Pendiente de mirar en el navegador.

## 180. Fase 2 · Tiempo hasta la primera respuesta humana por cola
- Métrica #1 de `PLAN-AGENTE-OFENSIVO §10`; solo existe un comentario en `leads/acciones.ts`. ·
  **Propuesta:** evento `derivado` → primer saliente con `autor='persona'`; serie en 172; en Inicio
  equipo. · **Severidad:** la única que detecta que el agente haga daño · **Esfuerzo:** 1 día ·
  **Fase 2** · **Fecha:** 2026-09-06 · 🟢
  **HECHA el 2026-09-08** — dos métricas en la serie diaria (`respuesta_humana_prioritaria_min`,
  `respuesta_humana_normal_min`; 21 → 23): por cada entrega del agente (`derivado`) del día, minutos
  LABORABLES hasta el primer saliente CONFIRMADO con `autor='persona'` del mismo hilo (en modo A,
  pulsar enviar ES la respuesta humana aunque el texto lo redactara el agente). La cola se deriva
  del hecho con `colaDeDerivacion` (causa + malestar), nunca se lee persistida. Solo cuenta la
  PRIMERA entrega de cada episodio (otra entrega sin respuesta humana entre medias es el mismo caso
  esperando), y las entregas sin contestar NO cuentan: no se inventa un tiempo, y lo que espera ya
  está en la cola de Inicio. Inicio › Tu equipo: una línea visible con las dos colas, n y «solo N
  casos» por debajo de 5; en el detalle, barras + ventana (7 días completos, hasta ayer; en red se
  ponderan las sedes). Sale sola en Antes/después. `qa:metricas` con un segundo día contado a mano
  (agente ≠ persona, pendiente no cuenta, insistencia del mismo episodio se ignora, queja sin
  contestar no cuenta) 33/33.

## 181. Fase 2 · Antes/después por clínica — la comparación contra uno mismo
- Con 167 (marca) + 172 (serie): «aceptaba el 40 % y ahora el 52 % desde el día X», con n, ventana
  igual y aviso de no causalidad. · **Esfuerzo:** 2 días · **Fase 2** · **Fecha:** 2026-09-06 · 🟢
  **HECHA el 2026-09-07** — `lib/metricas/antes-despues`: ventanas IGUALES alrededor de la marca (la
  marca fuera; si no han pasado los días pedidos, las DOS ventanas se acortan a los disponibles;
  último día completo = ayer), agregación por suma o por mediana ponderada por n (y se dice así),
  «no comparable» con motivo (definición cambiada, faltan días con dato, pocos casos para una
  mediana), aviso de no causalidad SIEMPRE. Hitos desde el historial de configuración (167) con
  etiqueta en palabras («Agente encendido»). `GET /api/metricas/antes-despues` (clínicas visibles,
  hitos y las 21 comparaciones en una llamada; acceso por clínica) y **Analíticas › Antes y después**
  (clínica o red, marca por hito o fecha, ventana 7/14/28, color solo donde la dirección significa
  algo, lo no comparable desplegable con su porqué). La demo compara sedes: `demo:reset` regenera la
  serie de 45 días y siembra el hito «agente encendido hace tres semanas». `qa:antes-despues` 22/22.

## 182. Fase 2 · Botón «el agente se equivocó aquí» → caso candidato del eval
- La vara es sintética; el bucle de PLAN-AGENTE fase 4 no tiene UI. · **Propuesta:** un botón en el
  chat que guarda (entrada renderizada 169 + juicio + corrección de la persona) como caso candidato;
  revisión humana antes de entrar en la vara. Es la única forma de que la vara deje de ser
  sintética sin esperar el histórico de RB. · **Severidad:** sin esto el agente no aprende ·
  **Esfuerzo:** 2 días · **Fase 2** · **Fecha:** 2026-09-06 · 🟢
  **HECHA el 2026-09-08** — en el panel «por qué» de Mensajería, pie con «El agente se equivocó
  aquí»: la persona elige qué falló (código cerrado en sus palabras: la opción de la decisión va en
  contra de lo que hizo —«no hacía falta pasarlo» si entregó, «debería haberlo pasado» si siguió—,
  entendió mal, el borrador, un dato, otra cosa; borrador/dato solo si el turno los tiene) y qué
  debería haber hecho (obligatorio con borrador/otro). `POST /api/agente/candidatos` con la regla del
  hilo (`lib/agente/acceso-hilo-sesion`, ahora UNA implementación para ficha, por-qué y candidatos);
  el servidor copia lo PERSISTIDO del turno (el turno explicado que la persona vio, la entrada 169,
  el borrador, la decisión y su causa, la versión 168, el mensaje del paciente) a
  `casos_candidatos_eval` (043, RLS, uno por turno: volver a marcar corrige y reabre la revisión).
  El panel enseña la marca (quién, cuándo, estado) con «Cambiar». Revisión humana fuera del producto:
  `npm run evals:candidatos -- --cliente X [--md | --aceptar id | --descartar id]`; la copia a
  evals/ va a mano, anonimizada y con `origen: real` (107: lo real y lo sintético no se mezclan). Se
  borra con el hilo (supresión y retención) y en el wipe de DEMO. `qa:candidatos` 25/25 (validación,
  copia, upsert, revisión, RLS desde RB).

## 183. Fase 2 · «Ver por qué» por mensaje — inspector de decisiones
- La ficha enseña el último juicio; el resto vive en el log. · **Propuesta:** en el chat, por
  mensaje del agente: juicios, campos, aplazados, descarte, versión (168) y replay en el banco. ·
  **Severidad:** confianza · **Esfuerzo:** 2 días · **Fase 2** · **Fecha:** 2026-09-06 · 🟢
  **HECHA el 2026-09-08** — `lib/agente/por-que`: agrupa por TURNO lo persistido (evento
  `evaluacion` + `aplazado`/`derivado`/`espera_*` del mismo `mensaje_id`) y lo enlaza con el mensaje
  que ve la coordinadora: el entrante que lo provocó y el saliente que redactó el agente (primer
  `sugerido_por_ia` tras la evaluación y antes del siguiente entrante). Enlace evento→mensaje por
  `waba_message_id ?? id`. Solo lo persistido, sin modelo; la cola se deriva del hecho. `GET
  /api/agente/por-que` con el aislamiento exacto de la ficha (404 fuera de scope). En Mensajería:
  «Ver por qué» en la burbuja del mensaje que la persona VE (el saliente del agente, o el entrante
  si no contestó), panel en la columna lateral sustituyendo a la ficha (regla del 11-08) y flotante
  sin oscurecer en móvil (§4 ter), Escape cierra. Orden: qué entendió · qué recogió · qué anotó · qué
  decidió · el control · el borrador · detalles técnicos plegados (modelo, latencia, coste, versión
  168, señales, lo que vio el modelo 169). Vocabulario compartido con el banco
  (`components/agente/etiquetas-agente`, antes tres diccionarios locales del banco). **Replay:**
  «Reproducir en el banco de pruebas» → `/agentes/conversacional?replay=<tel>&hasta=<mensaje>`; el
  banco carga el hilo REAL hasta ese mensaje (solo texto, salientes confirmados, tope 40), lo deja
  escrito, selecciona la clínica del hilo y avisa de que la situación (presupuesto, deuda) es la de
  HOY. `qa:por-que` 26/26 (tres turnos contados a mano: con juicio y saliente del agente, entregado
  sin juicio por audio, descartado por el control con espera fijada).

## 184. Fase 2 · Madurez del agente por clínica
- Ratio `caso_completo` / resto de derivaciones por mes, ya contado en Inicio detalle. ·
  **Propuesta:** «de qué te libera y qué sigue exigiendo persona», por clínica. · **Esfuerzo:**
  medio día · **Fase 2** · **Fecha:** 2026-09-06 · 🟢
  **HECHA el 2026-09-09** — en el bloque de 179, por sede: «Te libera (caso listo)» = entregas con
  `caso_completo` de todas las entregas (`madurezDe`, null sin entregas: no se inventa un 0 %), y
  debajo del nombre de la sede «Sigue exigiendo persona: urgencia ×3 · pidió una persona ×2» y
  «Aplazó: precio ×4 …» (las tres primeras causas/claves, vocabulario de `etiquetas-agente` y
  `aplazamientos`). La sede de un hilo es la del último mensaje con clínica, como en Inicio.

## 185. Fase 2 · La coincidencia agente-humano en Inicio equipo
- `CoincidenciaView` existe aislada. · **Propuesta:** «el equipo envía el borrador tal cual el X %»
  como el disparador declarado del paso de modo A a B. · **Esfuerzo:** medio día · **Fase 2** ·
  **Fecha:** 2026-09-06 · 🟢
  **HECHA el 2026-09-09** — Inicio › Tu equipo: «El equipo envía el borrador del agente tal cual el
  X % de las veces (n envíos) · últimos 30 días» y, en el detalle, el reparto tal cual / editado /
  reescrito, «n de N envíos del equipo salían de un borrador» (el denominador entero) y el
  DISPARADOR DECLARADO: `DISPARADOR_MODO_B = { tasaTalCual: 80, envios: 50 }` en
  `lib/agente/confianza.tipos` —PROVISIONAL, ver 214— con lo que falta en palabras («faltan envíos
  medidos (12 de 50)»). Mismo dato en el bloque de 179 (`coincidenciaDe`, una función). Y la
  métrica `envios_tal_cual` en la serie diaria (172, 23 → 24: valor = tal cual, n = medidos; la
  sede de un envío por `sqlClinicaDeEnvio`, compartida con el bloque), así que sale sola en
  Antes/después. El seed de DEMO mide cada borrador enviado por el equipo (6 de 10 tal cual, 3
  editados, 1 reescrito, en orden fijo) y marca dos turnos como error (uno pendiente, uno aceptado).

## 186. Fase 3 · Next Best Action v1 con cupo diario
- La cola de Seguimiento ordena por cohorte y edad; no por impacto esperado ni por capacidad. ·
  **Propuesta:** impacto = importe × urgencia × plazo; cupo diario declarado por clínica; v2 con
  probabilidad aprendida cuando 170 tenga meses de datos. Sustituye al tablero como cola (53, 54,
  56, 70). · **Esfuerzo:** 2 semanas · **Fase 3** · **Fecha:** 2026-09-06 · 🔵

## 187. Fase 3 · Propietario nominal y escalado por SLA
- «Asumido» es autoasignación; nadie asigna, nadie reasigna, nada escala al vencer el plazo. ·
  **Propuesta:** asignación a persona, reasignación, escalado a segundo nivel con la campana. ·
  **Esfuerzo:** 1 semana · **Fase 3** · **Fecha:** 2026-09-06 · 🔵

## 188. Fase 3 · Motor de políticas consolidado, con historial y con el banco de pruebas como test
- Semáforo, veto, juez, opt-out, plazos, horario, nivel de agenda y conocimiento son políticas
  repartidas en código, prompt, regex y JSON. · **Propuesta:** módulo `politicas` declarado, con
  historial (167) y un test por política en el banco de pruebas. Absorbe 141 (reglas duras solo en
  el juez) y 104 (Vapi). · **Esfuerzo:** 3 semanas · **Fase 3** · **Fecha:** 2026-09-06 · 🔵

## 189. Fase 3 · Tres automatizaciones → una
- Motor de reglas 16b (`reglas_automatizacion`, `eventos_sistema`, `engine.ts`), `secuencias_automaticas`
  y `cola_envios`. · **Propuesta:** la salida es 165; las secuencias pasan a ser políticas (188);
  el motor 16b se retira o su tabla queda como almacén de políticas. Cierra 12, 106, 64. ·
  **Esfuerzo:** 1 semana · **Fase 3** · **Fecha:** 2026-09-06 · 🔵

## 190. Fase 3 · Supabase analítica con service role sin RLS
- `eventos_comportamentales` y `factores_no_show` son un segundo plano de datos fuera del
  aislamiento. · **Propuesta:** fundir en Postgres con RLS o retirar (Sprint B lo tiene congelado).
  · **Severidad:** aislamiento · **Esfuerzo:** 2 días · **Fase 3** · **Fecha:** 2026-09-06 · 🔵

## 191. Fase 3 · Herencia por campo red → clínica
- La fila `clinica_id = null` es el default de red, pero una clínica con su JSON deja de heredar
  campo a campo. · **Propuesta:** merge por campo; la pantalla enseña «heredado de la red» /
  «propio». · **Esfuerzo:** 2 días · **Fase 3** · **Fecha:** 2026-09-06 · 🔵

## 192. Fase 3 · Copilot sobre el log del agente
- 26 tools, ninguna sobre el agente. · **Propuesta:** «¿por qué derivó a X?», «¿qué se aplaza
  más?», «¿cuánto tarda el equipo en contestar lo prioritario?» leyendo el log. · **Esfuerzo:**
  1 semana · **Fase 3** · **Fecha:** 2026-09-06 · 🔵

## 193. Fase 3 · Identidad unificada — la entidad «contacto»
- La identidad es el teléfono, resuelto con `LIKE '%dígitos%'` en cuatro tablas cada turno; la guarda
  de ambigüedad evita elegir mal, no da una entidad. · **Propuesta:** `contactos` (teléfonos
  normalizados, paciente, lead, NHC) como clave de hilo y de oportunidad; tabla de mapeo antes de
  tocar la clave del log. Prerrequisito de la cola por impacto. Cierra 17, 79. · **Esfuerzo:**
  1 semana · **Fase 3** · **Fecha:** 2026-09-06 · 🔵

## 194. Fase 3 · Oportunidad como entidad
- El objetivo se deriva por teléfono en cada turno; la NBA necesita una fila por oportunidad con
  importe, probabilidad y estado. · **Propuesta:** vista primero; tabla cuando NBA v2 lo pida.
  Cierra 143. · **Esfuerzo:** 3 días (vista) · **Fase 3** · **Fecha:** 2026-09-06 · 🔵

## 195. Fase 3 · Vista única de acciones
- Cinco tablas de acciones más los mensajes. · **Propuesta:** vista `acciones` unificada para la
  ficha, la NBA y la auditoría. · **Esfuerzo:** 2 días · **Fase 3** · **Fecha:** 2026-09-06 · 🔵

## 196. Fase 3 · Tanda de retirada declarada
- Nomenclatura Airtable (44, 45), doble sesión (38), Twilio y `CRON_TWILIO_WHATSAPP`, CommandCenter
  huérfano (29), login muerto (47), restos de prototipo (6, 14, 62, 69). · **Propuesta:** una tanda
  con verificación en producción (lección §11). · **Esfuerzo:** 3 días · **Fase 3** ·
  **Fecha:** 2026-09-06 · 🔵

## 197. Fase 4 · Lector de Gesden — la parte independiente del servidor real
- Modelo canónico de ingesta, API con clave por instalación y heartbeat, reconciliación por NHC,
  ciclo de sincronización con cursor, conflictos («Fyllio propone, Gesden confirma»), simulador
  (SQL Server en Docker o JSON) y esqueleto del servicio. Detalle en `PLAN-MAESTRO.md §Gesden`. ·
  **Puede adelantarse desde la fase 2**; se usa desde el primer día en la demo y en un segundo
  conector con API pública (Dentalink). · **Esfuerzo:** 3-4 semanas · **Fase 4** ·
  **Fecha:** 2026-09-06 · 🔵

## 198. Fase 4 · Lector de Gesden — la parte que espera a la firma
- Mapeo del esquema real de la versión de RB, servicio Windows instalado y firmado, pruebas contra
  su volumen, papel (art. 28, NDA, autorización de acceso). · **Objetivo:** 1-2 semanas desde el
  «sí». · **Bloqueada por:** firma de RB · **Fase 4** · **Fecha:** 2026-09-06 · 🔵

## 199. Fase 4 · Enrutado real multi-cliente
- `PILOT_CLIENTE` en seis entradas sin sesión. · **Propuesta:** la tarea escrita en
  `lib/multi-cliente-pendiente.ts` (mapa WABA → cliente, cliente en el token del portal y en la
  metadata de Vapi, crons por cliente). · **Esfuerzo:** 2 días · **Fase 4** · **Fecha:** 2026-09-06 · 🔵

## 200. Fase 4 · Encendido escalonado por sede como diseño experimental
- Comparar entre clínicas pide volumen; encender el agente por sedes escalonadas en una red de diez
  convierte el despliegue en un diseño (stepped-wedge). · **Propuesta:** el orden de encendido se
  decide y se registra (167); 181 lo lee. · **Esfuerzo:** 1 día · **Fase 4** · **Fecha:** 2026-09-06 · 🔵

## 201. Fase 5 · Experimentación online por clínica o por hilo
- Con 168 (versión) y 170 (resultado por id). · **Propuesta:** asignación de variante de prompt,
  cadencia u horario por clínica/hilo, registrada en el payload; comparación en 172. Absorbe 84. ·
  **Esfuerzo:** 3 semanas · **Fase 5** · **Fecha:** 2026-09-06 · 🔵

## 202. Fase 5 · Playbooks versionados que proponen
- El bucle de PLAN-AGENTE fase 4: acumular correcciones (182) y proponer; nunca aplicar solos. ·
  **Esfuerzo:** 3-4 semanas · **Fase 5** · **Fecha:** 2026-09-06 · 🔵

## 203. Fase 5 · Resumen de dirección con anomalías explicadas
- Reglas de anomalía sobre 172 («la aceptación cayó 15 puntos frente a tus ocho semanas») y
  explicación generada desde hechos agregados, como hace el informe IA. · **Esfuerzo:** 2 semanas ·
  **Fase 5** · **Fecha:** 2026-09-06 · 🔵

## 204. Fase 5 · Motor de capacidad — demanda ↔ huecos
- Disponibilidad declarada del paciente × huecos reales; depende de la agenda del PMS (197/198). ·
  **Esfuerzo:** 2 semanas de lógica · **Fase 5** · **Fecha:** 2026-09-06 · 🔵

## 205. Fase 5 · Modo objetivo
- El director fija una meta; la plataforma propone y ejecuta palancas dentro de límites (188). ·
  **Esfuerzo:** 6-12 meses · **Fase 5** · **Fecha:** 2026-09-06 · 🔵

## 206. Demo · la serie de 30 días del total parado sale PLANA (17.000 € todos los días)
- Las fotos derivadas (`calcularDashboardRed({ahora})` con el reloj movido) dan el mismo total de
  presupuestos parados los 30 días: la pertenencia a las líneas «cierre» y «reactivables» no
  depende del instante como debería, o el seed no mueve nada en ese eje. Las líneas de vencidos sí
  varían (10.325 → 11.765 €). Efecto: bandas del bullet colapsadas y «evolución del mes» plana en
  la demo; en producción las fotos son reales y no pasa. · **Propuesta:** revisar qué de la cola
  depende de `ahora` y que el seed mueva casos entre semanas; si no, que el desplegable diga
  «sin variación en 30 días» en vez de pintar una recta. · **Severidad:** afea la demo ·
  **Esfuerzo:** 1-2 h · **Fecha:** 2026-09-06 · 🟢 hecha (2026-09-06: la cola excluye casos cuyo último toque es posterior a `ahora`; las fotos derivadas ya se mueven: 0 → 3.800 → 20.800 €)

## 207. Fase 0 · Los fallos, en nuestra base — no en un servicio externo
- Decisión de Simon (6-sep): los fallos se guardan en Fyllio, no en un drenaje externo (otra
  superficie con contenido que justificar ante el abogado), y se enseñan en el producto.
  **Diagnóstico previo:** (a) de los 273 `console.error`, 161 están en rutas de API (70 justo
  antes de un 500: capturables), 84 en `lib` (catches que loguean y siguen: capturables), 21 en
  componentes cliente (ocurren en el navegador: NO capturables desde el servidor) y 7 en scripts;
  lo que ocurre FUERA de nuestro código —timeout de la función, error del framework antes del
  handler, cold start, la plataforma— no pasa por ningún catch nuestro. (b) Tabla `incidencias`:
  cliente, clínica, tipo, motivo (código), origen, referencia (id, nunca teléfono), `detalle`
  jsonb con escalares técnicos REDACTADOS (entrecomillados, correos y tiras de dígitos fuera; ≤160
  caracteres), veces, primera/última vez, cubo por hora, reintentable. Crecimiento acotado: cubo
  por hora (la misma referencia N veces = una fila), tope de 300 filas por cliente y hora (pasado,
  una sola fila `sistema/tope_incidencias`), caducidad diaria con `INCIDENCIAS_RETENCION_DIAS`
  (90 por defecto, nunca por encima del plazo de conversaciones cuando el abogado lo fije) y borrado
  con el derecho de supresión (la referencia no sobrevive al mensaje). (c) Producto: la campana
  se toca SIEMPRE para lo que es decisión o está roto por definición (tope de turnos, config
  ilegible, reintentos agotados) y solo cuando es SISTEMÁTICO (≥ 3 casos distintos de la misma
  clínica, tipo y motivo en una hora) para lo que la cola reintenta sola; **Ajustes › Incidencias**
  enseña lo que arde ahora y todo lo de 24 h / 7 días agrupado, con enlace al hilo (el teléfono se
  resuelve al leer, bajo RLS). (d) NO cubre y seguiría exigiendo el drenaje: lo que muere antes
  del handler, los errores del navegador, los `console.error` sin cliente en contexto (quedan en
  consola), y el texto técnico completo de un error (aquí va redactado). · **Severidad:** ciega ·
  **Esfuerzo:** 1 día · **Fase 0** · **Fecha:** 2026-09-06 · 🟢 **HECHA el 2026-09-06** —
  migración 040, `lib/incidencias`, `avisos.ts` registra ahí, `/api/admin/incidencias`,
  `qa:incidencias` (redacción, cubo, umbral, caducidad, sin contexto). **Cableado el mismo día:**
  envíos (Meta API en `whatsapp/outbound`, enviar-waba, enviar-manual, recordatorios de cita, y
  «enviado pero no registrado» en `presupuestos/mensajeria` con campana siempre), crons (todos los
  pasos del diario en una sola llamada al final sobre `errors`, `automatizaciones-evaluar`,
  `reevaluar`, `retencion`, el motor de automatizaciones y su opt-out no comprobable), integraciones
  (sync de agendas externas, Vapi al iniciar y en su webhook) y entrada (lote no procesado con
  campana siempre, lead no registrado, pre-guardado). Fuera a propósito: `push/sender` (Airtable,
  legado), el flujo viejo de clasificación (muere con 165) y los `console.error` de lectura en
  `llamadas/repo-pg` (no son fallos que actuar, son consultas que devuelven vacío: MEJORAS §10).
  El texto técnico redactado se mantiene (decisión de Simon, 6-sep) y entra en la consulta legal
  como pregunta (5).

## 208. Gates · la frontera cliente/servidor se comprueba por construcción, no por disciplina
- **Qué pasó:** dos veces en tres días (be26b8e, a583fb1) un «use client» importó un valor de un
  módulo que tira de `pg` y el build de Vercel murió con «Can't resolve 'dns'». El hook de
  pre-commit existía y no lo paró: valida el índice en el momento de la llamada, y `git add` +
  `git commit` en un solo comando le hizo construir HEAD. · **Hecho (2026-09-08):** `qa:frontera`
  (grafo de imports de valor desde cada «use client»; falla con la cadena entera si alcanza
  `app/lib/db/`, un builtin de Node o un paquete solo-servidor; probado contra la fuga real) en
  `prebuild` y en el hook, antes de tsc; el hook deniega la mezcla add+commit y `commit -a`, y
  deniega sin `jq`. Lo puro de las métricas vive en `lib/metricas/definiciones.ts`. Lección §24. ·
  **Severidad:** rompía producción · **Esfuerzo:** 2 h · **Fase 0** · **Fecha:** 2026-09-08 · 🟢

## 209. Demo · Inicio y Antes/después no comparten modelo temporal — el tramo pinado al día 1 desplaza cualquier ventana diaria
- **Qué pasa:** el «mismo tramo» de Inicio siembra 35 presupuestos por sede (`TRAMO_POR_SEDE`, con
  la historia «Sur cae») en los días 1..hoy−1 de este mes y del anterior: el día 2 del mes son 17
  presupuestos en UN día; el 30, uno cada dos días. Cualquier ventana diaria (Antes/después hoy,
  las anomalías de la fase 5 mañana) que pise la primera semana de un mes sale inflada en
  presentados y aceptados, y la ventana contraria, desinflada. El 8-sep el seed pasó a sembrar el
  efecto del agente desde el hito (`HITO_DIAS = 23`, ver DECISIONES) y la ventana por defecto de
  14 días queda limpia de la semana viva de la narrativa — pero no del tramo: del 23 al 31 de cada
  mes la ventana «antes» pisa el tramo del mes anterior y presentados/aceptados «bajan»; y 28 días
  pilla siempre la semana viva (+100 % en todo). · **Arreglo de verdad:** un solo modelo temporal
  para el volumen: presupuestos a TASA diaria por sede (≈1/día en la red) con «Sur cae» como tasa
  de aceptación por mes y sede, no como bloque pinado; el tramo de Inicio sale de ahí solo. Toca
  la historia de Inicio («red que cierra», «salto ×1,5»). **Decisión de Simon (8-sep): anotada,
  NO se ejecuta ahora** — a 7 y 14 días, que es lo que se enseña, la historia ya es la correcta;
  reescribir el modelo temporal entero es riesgo sin premio hoy. No volver a proponerla sin un
  motivo nuevo. · **Severidad:** la demo puede contar lo contrario según el día del mes ·
  **Esfuerzo:** 3-4 h · **Fase 2** · **Fecha:** 2026-09-08 · 🔵 aplazada

## 210. Fase 2 · Revisar los casos candidatos dentro del producto (y desde el banco)
- Hoy la revisión de lo marcado con «el agente se equivocó aquí» (182) es un script
  (`evals:candidatos`) y el botón solo vive en Mensajería. · **Propuesta:** (a) una lista de
  candidatos pendientes en /agentes/conversacional, solo admin, con aceptar/descartar y «copiar como
  caso» ya anonimizado (nombre → «el paciente», teléfono fuera); (b) el mismo botón en el banco de
  pruebas con `origen: banco` (107), que es donde Simon ya prueba y ve errores. · **Principio:**
  anticipación/feedback — un candidato que nadie ve es una corrección perdida. · **Impacto:** medio
  (el bucle de PLAN-AGENTE fase 4 solo arranca si las correcciones se revisan de verdad). ·
  **Esfuerzo:** 1 día · **Fase 2** · **Fecha:** 2026-09-08 · 🔵

## 211. Deuda · el vocabulario legible del agente vive en un componente
- `ETIQUETA_TEMA` / `ETIQUETA_CAUSA` / `ETIQUETA_MOTIVO_JUEZ` están en
  `components/agente/etiquetas-agente.tsx` junto a `Bloque` y `Tag`; `evals-candidatos.mts` (un script
  de Node) tiene que importar un módulo de React para nombrar una causa. · **Propuesta:** mover los
  tres diccionarios a un módulo puro `lib/agente/etiquetas-legibles.ts` y que el componente los
  reexporte; los scripts importan del puro. · **Principio:** coherencia (§6: el vocabulario es UNO y
  no depende de la capa que lo pinta). · **Impacto:** bajo (deuda, no producto). · **Esfuerzo:** 1 h
  · **Fecha:** 2026-09-08 · 🔵

## 212. Deuda · la coincidencia agente-humano se calcula por dos caminos y uno no aísla por sede
- `/api/automatizacion/coincidencia` (pestaña «¿Escribe bien?» de /automatizaciones) usa
  `withPresupuestosAuth` y `enviosMedidos(dias)` SIN filtro de clínica: una coordinadora ve la
  coincidencia de todo el cliente, y en una ventana rodante de 90 días. El bloque de 2.4
  (`lib/agente/confianza` → `enviosPorClinica`) calcula lo mismo por sede, con el scoping de
  Inicio y en días completos. Dos caminos para un número. · **Propuesta:** que la pestaña lea
  `enviosPorClinica` (con su desglose por intención y por semana encima) y retirar `enviosMedidos`/
  `enviosSinSugerido`; una sola ventana declarada. · **Principio:** coherencia (§6) y aislamiento
  (§5 del skill de ingeniería). · **Impacto:** medio (un dato de todo el cliente delante de quien
  solo debería ver su sede). · **Esfuerzo:** 2 h · **Fecha:** 2026-09-09 · 🔵

## 213. Deuda · dos ventanas para el mismo descarte del control
- `DescartesJuezPanel` (151) cuenta con `now() - 30 días` (rodante, cambia entre dos recargas —
  §13) y el bloque de 2.4, justo encima, con 30 días COMPLETOS hasta ayer: el mismo descarte puede
  estar en uno y no en el otro durante el día. · **Propuesta:** que `/api/agente/descartes` use
  `ventanaConfianza` y diga «del dd/mm al dd/mm»; o fundir el desglose por motivo dentro del bloque
  de 2.4 como su detalle plegable. · **Principio:** coherencia. · **Impacto:** bajo (confusión, no
  dato falso). · **Esfuerzo:** 1 h · **Fecha:** 2026-09-09 · 🔵

## 214. Decisión de Simon · el umbral del disparador de modo B
- 2.4 declara `DISPARADOR_MODO_B = { tasaTalCual: 80, envios: 50 }` (`lib/agente/confianza.tipos`) y
  lo enseña en Inicio › Tu equipo y en Agentes › Configuración como «el disparador declarado». Es
  un juicio, no una medida: PLAN-AGENTE.md §fase 4 dice que cada intención tendrá su umbral y su
  histórico, y no hay conversaciones reales con las que calibrarlo. · **Propuesta:** Simon fija el
  número (o lo deja en 80/50 a sabiendas) y, cuando exista el histórico real, se pasa a umbral por
  intención. Cambiarlo es tocar una constante. · **Principio:** el sistema no decide solo un umbral
  de autonomía (esencia §7). · **Impacto:** alto el día que se plantee el modo B; cero hasta
  entonces. · **Esfuerzo:** 0 · **Fecha:** 2026-09-09 · 🔵

## 215. Deuda · el editor de cita de la agenda tiene su propio cascarón de panel flotante
- `EditorCitaFlotante` (`fixed z-50 w-80`, X y Escape propios) es una de las dos copias que quedan del
  cascarón que desde el 9-sep vive en `PanelFlotante` (`components/ui`; lo usan Inicio y agendar).
  Se coloca JUNTO al bloque borrador con `getBoundingClientRect` (a su derecha o a su izquierda según
  el borde), cosa que el primitivo no sabe hacer. · **Propuesta:** un tercer anclaje del primitivo,
  «elemento» (recibe `left/top` ya calculados), y el editor pasa a usarlo; la lógica de colocación se
  queda en el editor. · **Principio:** un solo cascarón para la familia «panel al lado de su
  contexto» (§4 ter). · **Esfuerzo:** 1 h · **Fecha:** 2026-09-09 · 🟢 **HECHA el 2026-09-10** (anclaje «libre» de
  `PanelFlotante` con `estilo`; la colocación junto al hueco sigue en el editor).

## 216. Deuda · la hoja móvil de «por qué» en Mensajería es la otra copia del cascarón
- `MensajeriaView` envuelve `PorQuePanel` en un `fixed inset-y-0 right-0 w-[min(22rem,100vw)]` con
  Escape propio solo por debajo de lg (en escritorio vive en la columna lateral). Es el mismo modo
  «hoja» que `PanelFlotante` ya dibuja por debajo de lg con el anclaje «bloque». · **Propuesta:** un
  anclaje «hoja» del primitivo (solo la hoja, sin la parte absoluta) y Mensajería lo usa en móvil;
  `PorQuePanel` deja de pintar su propia cabecera con X cuando va dentro del primitivo. ·
  **Esfuerzo:** 1 h · **Fecha:** 2026-09-09 · 🟢 **HECHA el 2026-09-10** (anclaje «hoja»; `cabeceraPorQue` la pinta el
  cascarón común y `PorQuePanel` va `sinCabecera` dentro de él).

## 217. Dato · el historial de PERDIDO del seed no lleva sede: `perdidos_n` por clínica sale 0
- `db-seed-demo-rico.mjs` inserta `historial_acciones` (cambio_estado → PERDIDO) sin `clinica_id`
  (37 de 37 filas en DEMO, medido el 9-sep) y `metricas/diarias.ts` filtra `perdidos_n` por
  `historial_acciones.clinica_id`: la serie diaria por sede dice 0 perdidos y Antes/después por sede
  compara 0 con 0. El mapa de fuga (177) lo esquiva uniendo con `presupuestos.clinica_id`. ·
  **Principio:** confianza (§5). · **Propuesta:** (a) el seed escribe `clinica_id` en el historial, y
  comprobar que `registrarAccion` lo hace en producción; (b) `perdidos_n` resuelve la sede por el
  presupuesto, no por la fila del historial, como el mapa — una sola definición. · **Impacto:**
  medio (una métrica de la serie miente por sede). · **Esfuerzo:** 1 h · **Fecha:** 2026-09-09 · 🔵
  **HECHA el 2026-09-09 (noche)** — en tres sitios, porque el dato se perdía en tres: (1)
  `registrarAccion` escribía `clinica_id: null` a mano en PRODUCCIÓN, no solo el seed; ahora resuelve
  la sede por el presupuesto dentro de la misma transacción (el caller no puede olvidarla). (2) El seed
  manda `clinica_id` en sus tres inserts de historial y una invariante nueva revienta `demo:reset` si
  queda un cambio de estado sin sede. (3) `perdidos_n` en la serie diaria atribuye por
  `presupuestos.clinica_id` (coalesce con la columna para huérfanos), la misma atribución que el mapa
  de fuga; `qa:metricas` siembra un perdido cuyo historial va sin sede y exige que la sede lo vea.
  Migración 044 rellena lo ya escrito (idempotente). Medido en DEMO tras `demo:reset`: 37/37 filas con
  sede; `perdidos_n` en 45 días = 25 en la red y 25 sumando sedes (10/8/5/2), antes 25 y 0.
  **Por qué `qa:campos` no lo cazó:** vigila lo que un caller MANDA y la escritura TIRA; aquí nadie
  mandaba la clave (el seed) o se mandaba null a propósito (el escritor). La guarda para esta clase es
  otra: el escritor resuelve solo lo que puede resolver, y una invariante del seed sobre las columnas
  por las que FILTRA una métrica.

## 218. Facilidad · «Ver los casos» del mapa de fuga aterriza en la tabla sin filtrar
- Las tablas de leads y presupuestos no leen filtros de la URL (ninguna llama a `useSearchParams`);
  el mapa enlaza a `/tablas/leads` y `/tablas/presupuestos` y la coordinadora tiene que volver a
  filtrar por «No interesado» / «Perdido» y por fecha. Cobros recibe `?urgencia=vencido` desde el
  dashboard; comprobar que lo aplica. · **Principio:** anticipación (§3). · **Propuesta:** las tres
  tablas aceptan `estado`, `motivo` y `desde`/`hasta` por URL y el mapa los manda. · **Impacto:**
  medio. · **Esfuerzo:** 2 h · **Fecha:** 2026-09-09 · 🟢
  **HECHA A MEDIAS el 2026-09-09 (noche)** — la tabla de LEADS lee `resultado`, `motivo`, `desde` y
  `hasta` (sobre la fecha de cierre) de la URL y enseña el rango como chip quitable; el mapa manda
  `resultado=no_interesado&desde&hasta` en sus dos etapas de leads (la tabla no distingue contacto:
  las dos aterrizan en el mismo filtro). Cobros ya preseleccionaba `?urgencia=vencido`. **Queda** la
  tabla de presupuestos: el mapa ya manda `estado=PERDIDO&desde&hasta` y la tabla los ignora.
  **HECHA el 2026-09-10** — `MaximaView` lee `estado`, `desde` y `hasta` (pill «Cerrados» + chip «Perdidos del X al Y»
  quitable; elegir otro pill lo quita) y `PresupuestosShell` arranca el rango en «Histórico» cuando el enlace trae
  ventana: con las dos semanas por defecto escondía justo lo que el enlace pedía.

## 219. Deuda · la resolución de alcance (clínica | red, 403/404) está copiada en las rutas analíticas
- `api/metricas/antes-despues` y `api/metricas/fuga` resuelven igual qué clínicas ve la sesión, el
  default (red si admin, primera sede si no), «red» sin permiso → 403 y sede fuera de alcance → 404;
  comprobar si `api/agente/confianza` es la tercera copia. Varias copias del mismo filtro de acceso
  son varios sitios donde equivocarse (§5 del skill de ingeniería). · **Propuesta:**
  `resolverAlcanceAnalitico(session, url)` en `lib/auth` y las rutas lo llaman; un QA adversarial
  único. · **Esfuerzo:** 1 h · **Fecha:** 2026-09-09 · 🟢 **HECHA el 2026-09-10** (`lib/auth/alcance-analitico.ts`,
  `resolverAlcanceAnalitico(session, url)`; lo usan Antes/después, Dónde se pierde y Qué dicen. `api/agente/confianza`
  queda con su propio `?clinica=` y lista de ids: es otra forma, no la cuarta copia).

## 220. Fase 2.1 (176) · el objetivo «cita» no recoge por qué un lead declina
- El mapa de fuga enseña frases del agente solo en presupuestos: `que_le_frena` y `motivo_rechazo`
  existen en el objetivo «presupuesto» y no en «cita» (`automatizacion/objetivos.ts`), así que
  cuando un lead dice «no, gracias» el agente no recoge nada y la etapa «sin cita» solo tiene el
  motivo que puso la persona. · **Propuesta:** al diseñar 176, un campo `motivo_no_cita` en «cita»
  (solo si declina) con el mismo mapeo conservador al vocabulario de seis; el mapa lo pinta sin
  cambios. · **Esfuerzo:** entra en 176 · **Fecha:** 2026-09-09 · 🟢 **HECHA el 2026-09-10** (`motivo_no_cita` en el
  objetivo «cita», solo si declina y sin insistir; «Qué dicen» lo agrupa con el vocabulario de leads; el seed DEMO lo
  rellena en los «No interesado». No cambia el hash de la vara: los objetivos van fuera del prompt fijo).

## 221. TRANSVERSAL B (repaso de Simon 9-sep) · censo de paneles y modales: tres familias, trece cascarones a mano
- Censo del 9-sep (grep de `fixed inset-0|inset-y-0|role="dialog"|PanelFlotante|ConfirmDialog`):
  **(a) Panel flotante al lado del contexto, sin oscurecer** (§4 ter): `PanelFlotante` — Inicio ×4,
  `AgendarPanel`. **(b) Drawer lateral a toda altura** (`fixed inset-0 … justify-end`, 8 copias a
  mano, unas oscurecen y otras no): `LlamadasView` (detalle), `KpisLeadsView`, `KpisCobrosView`
  (con blur), `FyllioCopilot`, `NotificacionesPanel`, `panel-accion-ui` (LeadAccionPanel /
  AccionPanel), `MensajeriaView` (hoja móvil), `AppShell` (menú móvil). **(c) Modal centrado con
  fondo oscurecido** (13 copias a mano con CUATRO fondos distintos: `slate-900/40`, `/50`, con o sin
  `backdrop-blur`, `black/50`): `ConfirmDialog` (el primitivo), `ClinicaEquipoView`,
  `EstadoPresupuestoFlow`, `AgendarModal`, `AsistenciaModal`, `MotivoNoInteresModal`, `NewLeadModal`,
  `Paciente360View`, `PagoModal`, `ImportarCSVModal`, `KanbanBoard`, `MotivoPerdidaModal`,
  `NewPresupuestoModal` (hoja abajo en móvil), `PagoCierreModal`. Aparte: el click-catcher del
  calendario de `AgendaView` (no es un panel) y el portal del paciente (app aparte).
- **Principio:** coherencia (§6 esencia, §7 visual): «tiene que ser un estándar único y verse igual».
- **Propuesta:** DOS primitivos y ninguna copia: `PanelFlotante` (ya existe; absorbe la familia b con
  un anclaje «hoja» a toda altura, MEJORAS 215-216) y un `Modal` nuevo en `components/ui` (fondo
  ÚNICO, Escape, foco, cierre por X; `ConfirmDialog` pasa a ser un Modal con dos botones). Tanda en
  dos partes: primero los 8 drawers (misma forma, menos riesgo), luego los 13 modales, uno por commit.
  La regla al estándar visual cuando se decida el fondo único.
- **Impacto:** medio-alto en confianza (hoy el producto se ve como cuatro productos). · **Esfuerzo:**
  1,5-2 días · **Fecha:** 2026-09-09 · 🟢 **HECHA el 2026-09-10** en dos tandas: los ocho drawers sobre `PanelFlotante`
  («hoja» y «libre», ninguno oscurece; el menú móvil del AppShell queda fuera por ser navegación) y los trece modales +
  ConfirmDialog sobre `Modal` (`components/ui`, velo único `--color-overlay`, hoja desde abajo en móvil). Residuos: los
  formularios de ClinicaEquipoView llevan sus botones en el cuerpo y no en el pie; el historial del Copilot sigue siendo
  un velo interior propio.

## 222. TRANSVERSAL A (repaso de Simon 9-sep) · barrido de texto sobrante: «una línea explica»
- Regla nueva en el estándar visual §5. Hecho hoy en «Dónde se pierde» (cabecera a una línea; el
  criterio de cada etapa pasa a tooltip del titular; fuera el pie de definiciones). **Pendiente, en
  este orden:** `ConfianzaAgentePanel` (18 párrafos en 269 líneas; cuatro antes de la tabla y dos
  después — el caso que dio la regla) e Inicio (cabeceras de los cuatro bloques y sus paneles);
  después, barrido del resto (Antes/después, KPIs, Ajustes, Agentes › Configuración). Lo que vaya a
  tooltip tiene que ser prescindible: en móvil no hay cursor. · **Esfuerzo:** Confianza + Inicio
  medio día; barrido 1 día · **Fecha:** 2026-09-09 · 🟢 **HECHA el 2026-09-10**: Confianza (la vara a un dato con el
  origen en tooltip, definiciones en el `title` de cada columna, dos datos en vez de dos párrafos), Inicio (cabeceras y
  los cuatro paneles) y el barrido (Antes/después, KPIs no-shows, Ajustes › configuración/agenda/incidencias, Agentes ›
  Configuración con `matiz` opcional por sección). KPIs de leads/cobros y el Banco de pruebas no tenían párrafos que quitar.

## 223. Dato · un informe guardado para una sede se vuelve «de toda la red» si el nombre no casa
- `informes-pg.ts` traduce `clinica` (texto: el NOMBRE de la clínica, paridad con Airtable) a
  `clinica_id` buscando por nombre exacto, y «nombre sin match ⇒ null = bucket global». Un nombre
  con una tilde distinta, o una clínica renombrada en Ajustes, convierte en silencio un informe de
  sede en un informe de la red — la misma familia que 217 (atribución que se pierde sin error), y
  `qa:atribucion` no la ve porque el resultado no es «todo a null» sino «una fila de más en global».
  Escritores: `api/presupuestos/informes/guardados` y `api/automatizaciones/procesar`. ·
  **Principio:** confianza (§5); identidad por id, no por nombre (§20 del skill de ingeniería). ·
  **Propuesta:** los escritores mandan `clinicaId` (id) y el shim deja de resolver por nombre; si
  llega un nombre sin match, error, no null. · **Impacto:** bajo hoy (dos informes en DEMO, ambos
  globales a propósito), alto el día que un piloto genere informes por sede. · **Esfuerzo:** 1-2 h ·
  **Fecha:** 2026-09-09 · 🔵

## 224. Agente · el evaluador no distingue el AUTOR de los salientes: una plantilla pasa por «yo dije»
- Hallazgo de paso al diseñar los hilos jugados (10-09). El hilo que ve el evaluador (`MensajeHilo`)
  lleva dirección, contenido, timestamp y tipo, pero NO `autor`: un recordatorio de cita o un
  seguimiento de cadencia (`autor = 'cadencia'`, texto de plantilla) le llega igual que un borrador
  suyo enviado por la coordinadora. Puede «recordar» como propio algo que dijo una plantilla
  («como te decía, tu cita es mañana a las 10:30»), disculparse por una insistencia que no fue suya,
  o contar como «ya se le escribió N veces» toques que no eran conversación. Es de PRODUCCIÓN, no
  del runner: el hilo jugado `cadencia_en_medio` lo expone. · **Principio:** el modelo juzga el
  texto, el código decide (§ evaluador); lo que el modelo no sabe distinguir hay que dárselo
  etiquetado. · **Propuesta:** `MensajeHilo.autor` ('persona' | 'agente' | 'cadencia') desde
  `contexto-conversacion`, y en el render del hilo marcar los de cadencia como «[mensaje automático
  de la clínica]» — tres líneas de contexto, coste cero. Regla en el prompt: lo automático no es
  una promesa suya ni un turno de conversación. Medir con la vara y con `hilos:replay` antes y
  después. · **Impacto:** medio (cada recordatorio de cita entra en un hilo vivo). · **Esfuerzo:**
  1-2 h + una pasada de vara ($0,35) + replay ($0,80). · **Fecha:** 2026-09-10 · 🔵

## 225. Agente · el banco y el webhook NO dan la misma entrada al evaluador: el nombre de perfil de WhatsApp cierra un «caso completo» al primer mensaje
- Repro `scripts/repro-banco-vs-runner.mts` (10-09, $0,05), mismo mensaje y misma clínica. `lead_precio`
  («q precio tiene un blanqueamiento?»): el BANCO sigue; PRODUCCIÓN (orquestador) deriva `caso_completo`.
  La entrada de producción con el nombre del banco («+34600000000») → sigue: el `nombre` lo explica. El
  orquestador pasa `ctx.nombre` = nombre de PERFIL de WhatsApp («Marta L.», origen `perfil`); el modelo lo
  apunta como `identificar.nombre = Marta` y el código cierra el caso al primer turno. El banco pone el
  TELÉFONO como nombre «exactamente como producción» (arreglo del 22-08): premisa falsa cuando Meta manda
  perfil. Otras diferencias de entrada: orden de `objetivosAbiertos` (banco cita→identificar; orquestador
  identificar→cita), `clinica` (banco el nombre; orquestador `null`: el evaluador de producción no sabe en
  qué clínica está), `senales` (solo producción las calcula). En `urgencia_ambigua` y
  `presupuesto_financiacion` los dos caminos deciden IGUAL: la carilla como urgencia es del agente, no del
  camino. · **Principio:** un dato que el paciente no dio no es un dato recogido (el código decide, §
  evaluador); dos caminos al mismo juez con la misma situación tienen que dar lo mismo (banco = producción,
  regla dura del banco). · **Propuesta:** (1) el orquestador distingue `nombre` (fichado: paciente/lead) de
  `nombrePerfil` (pista): el evaluador recibe el perfil como pista en el render («su perfil de WhatsApp
  dice Marta L.») y `identificar.nombre` solo cuenta si el paciente lo dice; (2) el banco construye la
  entrada con el MISMO constructor que el orquestador (extraer `entradaDesdeContexto` de
  `evaluar-entrante` y llamarlo desde `banco-pruebas` con un contexto sintético; `clinica` y el orden de
  objetivos dejan de divergir solos); (3) el repro pasa a QA (`qa:banco-vs-runner`) sobre el fixture de
  hilos jugados. Medir antes/después con la vara y `hilos:replay`: varios hilos cambiarán de decisión, y
  eso es lo que se quiere ver. · **Impacto:** ALTO — hoy cualquier desconocido con nombre de perfil se
  «entrega» al primer mensaje, y el banco no lo enseña. · **Esfuerzo:** 2-3 h + ~$1,2 de modelo. ·
  **Fecha:** 2026-09-10 · 🔴

## 226. Banco de pruebas · lo que sigue sin poder probarse ahí (censo del 11-09, tras la cuarta divergencia)
- Con la sesión ya arrastrando aplazados, espera, opt-out y derivado, el banco sigue pasando vacío o
  distinto —a sabiendas, declarado en la cabecera de `banco-pruebas.ts` y en `DECLARADOS` de
  `qa:banco-vs-runner`—: (1) `senales` a null: producción manda tres líneas (minutos desde el último
  saliente, hora local, fuera de horario) que cambian la respuesta; (2) `diasHastaProximaCita` a null:
  ni la regla del antecedente médico con cita próxima (023) ni el modo «paciente con cita futura, sin
  objetivo» se pueden probar; (3) `clinicasDelHilo` null: la red (122) no; (4) `identidadAmbigua`
  null: la guarda del número compartido (139) no; (5) solo texto: un audio o una foto (034) no; (6) sin
  cadencias en el hilo: «el paciente contesta al recordatorio» no; (7) sin escenario de lead FICHADO
  (con nombre, sin ficha de paciente), el caso más frecuente en producción — «lead nuevo» es el
  desconocido total; (8) un solo presupuesto vivo: el juicio «de cuál habla» con letras no. ·
  **Principio:** la prueba corre el camino real o declara qué parte no corre (§25). · **Propuesta:**
  dos escenarios nuevos, por valor: «lead con ficha» y «paciente con cita el [día]» (dos campos del
  escenario); un control «hora del mensaje» que calcule las señales con el reloj sintético; un botón
  «manda un audio». Red, número compartido y cadencias se prueban con los hilos jugados, no aquí. ·
  **Impacto:** MEDIO — hoy la clínica prueba su agente solo con desconocidos y pacientes sin cita. ·
  **Esfuerzo:** 2-3 h. · **Fecha:** 2026-09-11 · 🟡

## 227. Hilos jugados · no pueden probar la insistencia: el hilo entero cabe en la ventana de ráfaga
- `vueltasPorClave` cuenta una vuelta por aplazado separado más de 15 min del anterior (034, a
  propósito: una ráfaga de tres mensajes es una vuelta). `hilos:jugar` juega cada hilo en menos de un
  minuto y los eventos llevan `created_at` real, así que en el fixture las vueltas nunca pasan de 1 y
  ninguna entrega es por «insistencia»: `insistencia_precio` (cinco turnos insistiendo) no la dispara.
  La insistencia se prueba hoy solo con casos escritos a mano (`qa:evals-evaluador`) y en el banco
  (desde hoy, con su reloj de 30 min). · **Principio:** un bug que depende del reloj no se prueba con
  el reloj real (§16). · **Propuesta:** que el jugador pueda fijar el instante del mensaje Y del
  evento (hoy lo pone la base) y avance 30 min por turno, como el banco; alternativa más barata: que
  las vueltas se cuenten por el `timestamp` del mensaje que causó el aplazado (join por `mensaje_id`)
  en vez del `created_at` del evento. · **Impacto:** MEDIO — la insistencia es una de las seis causas
  de entrega y ningún hilo jugado la ejercita. · **Esfuerzo:** 1-2 h. · **Fecha:** 2026-09-11 · 🟡

## 228. Agente · teléfono compartido, versión COMPLETA (hablante por mensaje, contexto por segmento)
- Hoy (11-09, versión barata aprobada por Simon) el juicio `hablaPorOtraPersona` marca que quien
  escribe no es la titular, la plantilla usa su nombre, el cobro de la titular no se cuela y la entrega
  lo dice. Pero la identidad sigue siendo POR TELÉFONO en todo lo demás: el contexto que ve el modelo,
  los eventos (`caso_id` = teléfono), el semáforo y el hilo son de Carmen, y si Lucía y Carmen alternan
  en el mismo hilo el juicio se extrae del hilo entero y no distingue mensajes. · **Principio:** la
  identidad se resuelve por id (§20) — y aquí el id es el número, que es de dos personas. ·
  **Propuesta:** `hablante` por mensaje (id de persona o «desconocido»), contexto por segmento de hilo,
  y un lead propio para la persona sin ficha desde la entrega. · **Impacto:** MEDIO — hoy es un caso
  raro; será frecuente con hijos y mayores. · **Esfuerzo:** grande (2-3 días). · **Cuándo:** cuando un
  cliente real lo pida (decisión de Simon, 11-09). · **Fecha:** 2026-09-11 · 🟡

## 229. Agente · afirma un SERVICIO que no consta («sí, hacemos sedación consciente») y el control no lo caza
- Replay del 11-09 (Nuria t1): el borrador dice «Sí, hacemos sedación consciente para extracciones y es
  una opción muy común» — la clínica no lo tiene publicado y el control (regla clínica) lo dejó pasar.
  El prompt manda «CONFIRMAR lo que la clínica HACE: revisiones, limpiezas… tratamientos habituales», y
  el modelo estira «habitual» a lo que no consta. · **Principio:** solo se afirma lo que consta (§17);
  inventar un dato es el pecado nº 2. · **Propuesta:** (a) al prompt: «habitual» = la lista cerrada
  (revisión, limpieza, valoración, empaste, endodoncia, ortodoncia, implante, blanqueamiento); todo lo
  demás («sedación», «láser», «cirugía guiada») se ANOTA, no se confirma; (b) al control: una regla
  «servicio no publicado» — afirmar que la clínica hace/ofrece X sin X en lo publicado ni en la lista →
  descarte, categoría `clinica`; (c) un caso en la vara. · **Impacto:** ALTO — una clínica que no hace
  sedación recibe a una paciente con pánico que viene por la sedación. · **Esfuerzo:** 1-2 h. ·
  **Fecha:** 2026-09-11 · 🔴

## 230. Agente · tras un entrante NO legible que derivó, un texto posterior no reabre al agente
- Fernando (hilo 15): manda un audio, el agente deriva por «no lo leo» (no_legible), y los dos textos
  que escribe después se quedan sin respuesta del agente porque el semáforo está en rojo
  (no-reversión: el caso es de una persona). La no-reversión está bien para «lo decide una persona»;
  aquí la derivación fue «no puedo leerlo», y el texto que llega después SÍ se puede leer. ·
  **Principio:** perder menos — el paciente escribió dos veces y nadie le contestó. · **Propuesta:**
  que la derivación por no legible sea la única que un texto legible posterior levanta solo (evento
  `soltado` automático con causa «llegó texto»), con la ficha diciéndolo. · **Impacto:** MEDIO. ·
  **Esfuerzo:** 1-2 h. · **Fecha:** 2026-09-11 · 🟡
