# Auditoría técnica de Fyllio — antes de pilotos

**Auditor:** ingeniería senior (revisión de código real, no asunciones)
**Fecha:** 6 de julio de 2026
**Alcance:** repo completo `fyllio-mvp` (491 archivos, ~105.700 líneas TS/TSX, 166 rutas API) + rama `sprint-18-motor-no-shows` (Supabase/eventos, aún sin mergear a `main`).
**Método:** lectura directa del código por 8 líneas de auditoría en paralelo (arquitectura, aislamiento multi-cliente, seguridad/RGPD, fiabilidad de datos, Leads/Presupuestos, Copilot/IA, onboarding, UI/UX), con verificación manual de los hallazgos críticos.
**Encargo:** ser brutalmente honesto. Lo soy. Esto no es una lista de quejas cosméticas: hay cosas que impiden firmar un contrato de datos con una clínica sin mentir, y hay caminos por los que hoy se pierden mensajes de pacientes.

---

## 1. Resumen ejecutivo (para fundador)

**Estado real.** Fyllio es mucho producto. Hay módulos con buen criterio (el Copilot está bien diseñado, el kanban de Leads es sólido, hay un sistema de diseño real, la clasificación de respuestas por IA es IA de verdad). Pero por debajo hay **tres productos superpuestos** que se fueron acumulando sprint tras sprint sin borrar las capas viejas: el MVP original de agenda (hoy una demo pública), el CRM real (Leads/Presupuestos/Pacientes) y el módulo no-shows (un fork aislado). Cerca del **27% del código está muerto o desconectado**, y parte de ese código muerto **sigue vivo y accesible por internet, y escribe en la base de producción sin pedir contraseña.** El producto funciona bien en demo y con poca carga; **no está listo, tal cual, para dos clientes reales con datos de pacientes.**

**Los 3 riesgos más grandes para los pilotos:**

1. **Los datos de un cliente pueden verse desde el otro (aislamiento roto).** Hoy todas las clínicas viven en una sola base de Airtable, separadas solo por una etiqueta. Y el candado que debería impedir que una coordinadora vea la clínica de al lado **está roto por un bug concreto**: al entrar, el sistema le entrega una credencial "sin clínica asignada", y varias pantallas clave (todo el módulo de Presupuestos, no-shows, llamadas) interpretan "sin clínica" como "enséñaselo todo". Para dos clientes **legalmente separados**, esto es el riesgo número uno: no es un bug estético, es una fuga de datos entre empresas.

2. **Se pierden mensajes de pacientes y cambios de estado, en silencio.** El punto donde entra un WhatsApp de un paciente responde "recibido" a Meta **antes** de guardarlo, y luego lo guarda "en segundo plano" — pero en el hosting que usáis (Vercel), ese segundo plano no está garantizado: si Airtable va lento en ese instante, el mensaje **desaparece sin rastro y Meta no lo reintenta.** En paralelo, cuando una coordinadora arrastra un presupuesto a "Aceptado" o "Perdido" y Airtable falla, la pantalla dice "hecho" pero **el cambio no se guardó.** Esto choca de frente con vuestra prioridad número uno: "que no se pierda ningún dato".

3. **Superficie abierta sin autenticación + credenciales débiles.** Hay una familia entera de endpoints (`/api/db/*`) que leen y **borran/crean** citas, pacientes y presupuestos **sin pedir login**, accesibles desde internet. Las contraseñas del módulo de presupuestos se guardan **en texto plano** en Airtable. Y hay un "secreto interno" que en realidad se publica en el código que descarga el navegador. Con datos de salud reales, esto no pasa una revisión de RGPD.

**Recomendación Airtable vs Supabase (la pregunta clave):**

- **Para los pilotos: NO migrar ahora. Quedaos en Airtable y blindadlo.** Migrar a Supabase/Postgres hoy es una **reescritura de la capa de datos** (~90 archivos hablan con Airtable directamente, sin una capa intermedia que se pueda "cambiar de enchufe"), no un cambio de configuración. Hacerlo ahora **bloquearía los pilotos meses.** Vuestra prioridad es entrar a pilotos con infra segura, y eso se consigue **antes** blindando lo que hay.

- **PERO con una decisión de arquitectura que hay que tomar ya:** como los dos clientes son legalmente separados, la forma más robusta y barata de garantizar que sus datos nunca se mezclen es **darle a cada cliente su propia base de Airtable física** (separación de verdad), en vez de confiar en que hemos arreglado perfectamente todos los filtros por software. Un fallo de filtro dentro de una base solo mezcla clínicas del **mismo** cliente (malo, pero recuperable); un fallo de filtro con los dos clientes en la **misma** base mezcla dos empresas (catástrofe legal). Esto requiere trabajo (hoy el código asume una sola base en todas partes), pero es mucho menos que migrar a Postgres. **Esta es la primera decisión que necesito de ti** (ver §4).

- **A medio plazo (después de los pilotos, con ingresos): sí, consolidar en Supabase/Postgres, módulo a módulo, empezando por Pacientes y Presupuestos.** Postgres tiene "seguridad a nivel de fila" (RLS), que es exactamente el mecanismo de multi-cliente que Airtable no tiene; ya pagáis Supabase; y evita los límites de la API de Airtable bajo carga. Pero es el paso 2, no el paso 1.

**Una nota de tranquilidad:** casi todo esto es arreglable en semanas, no en meses, si se prioriza bien. El equipo que escribió esto sabe hacer las cosas bien — se ve en los sitios donde SÍ están bien hechas (idempotencia con KV, verificación de firma del webhook de Meta, el Copilot). El problema no es capacidad, es que la deuda de 18 sprints nunca se pagó y los caminos "calientes" (WhatsApp, aislamiento) se quedaron sin blindar.

---

## 2. Diagnóstico por área

### Área 1 — Arquitectura y capa de datos

**Qué está bien.**
- Hay un punto único de acceso a Airtable (`app/lib/airtable.ts`) con un mapa de tablas (`TABLES`) y un helper de paginación correcto (`fetchAll`, `airtable.ts:91`).
- Tres módulos SÍ tienen una capa de repositorio limpia (patrón correcto): `app/lib/scheduler/repo/*`, `app/lib/automatizaciones/repo.ts`, `app/lib/llamadas/repo.ts`.
- El paquete `airtable@0.12` reintenta automáticamente ante saturación (429), lo que da un colchón parcial.

**Qué está frágil.**
- **Acoplamiento masivo y directo a Airtable.** 102 archivos importan `lib/airtable`; **87 de 166 rutas API (~53%) llaman a `base()` en línea**, construyendo fórmulas de filtro y mapeando campos a mano dentro de cada endpoint. `filterByFormula` aparece **212 veces en 87 archivos**. No hay frontera de datos que sustituir: la lógica de negocio y el dialecto de Airtable están entrelazados en cada handler.
- **Tres productos superpuestos.** El MVP-agenda original (~18.000 líneas) hoy solo cuelga de la demo pública; el módulo no-shows (~10.200 líneas) es un fork aislado; y el CRM real. Los sprints nunca borraron lo viejo.
- **Datos maestros con nombres en español y campos calculados** hacen que cualquier cambio de esquema sea artesanal.

**Evidencia.** `airtable.ts:69` (singleton `_base`, asume una sola base), 102 imports de `lib/airtable`, `app/api/presupuestos/kanban/route.ts` / `app/api/no-shows/hoy/route.ts` (handlers que van "a pelo" a Airtable con fórmula + mapeo inline).

---

### Área 2 — Airtable vs Supabase/Postgres (la pregunta clave)

**Diagnóstico honesto.** Airtable **aguanta técnicamente** el volumen de 11 clínicas para arrancar, con dos condiciones: (a) que blindéis los caminos calientes (webhook, escrituras) y (b) que resolváis el aislamiento entre los dos clientes legales. Airtable **NO es adecuado a medio plazo** para datos de salud multi-cliente por tres razones estructurales:

1. **Aislamiento.** Airtable no tiene multi-tenancy nativa (ni RLS ni row-level security). Todo el aislamiento es "por software" en vuestro código, y ese código ya ha demostrado tener agujeros (§Área 3). Para datos de categoría especial (salud) de clientes legalmente separados, "confía en que filtramos bien" es una postura frágil.
2. **Límites de API.** 5 peticiones/segundo por base. Con 11 clínicas y ráfagas reales (`Promise.all` sobre Airtable en pagos, KPIs, cola de envíos con `maxRecords: 5000`), el reintento automático evita perder datos pero **acumula latencia**, que alimenta los timeouts de funciones serverless sin `maxDuration` (§Área 4).
3. **RGPD.** Airtable está en EE. UU. Datos de salud → transferencia internacional que exige cláusulas contractuales tipo y figurar en el registro de subprocesadores.

**Recomendación por fases (NO big-bang).**

- **Fase 0 (pilotos):** quedarse en Airtable. Separar **físicamente** a los dos clientes legales en **dos bases distintas** (la forma más barata de garantizar la separación legal). Blindar seguridad y fiabilidad. — *Esto es el P0 de este informe.*
- **Fase 1 (post-piloto, ~1 mes de trabajo):** introducir una **capa de repositorio** para Pacientes y Presupuestos (hoy no existe para ellos). Es el prerrequisito que hace posible cambiar de backend sin tocar 90 archivos. Se puede hacer sin cambiar Airtable todavía — solo mover el acceso a datos detrás de una interfaz.
- **Fase 2 (~2-3 meses):** migrar Pacientes y Presupuestos a Postgres/Supabase detrás de esa interfaz, con RLS por clínica. El resto de módulos (KPIs, informes, no-shows) van después.

**Qué se puede romper al migrar.** Los campos "linked record" de Airtable (relaciones) hoy llegan como arrays de IDs; en SQL son claves foráneas — hay que reescribir cada consulta que los use. Las fórmulas con `DATETIME_DIFF`, `FIND`, `LOWER` hay que reimplementarlas en SQL. Y hay ~13 endpoints que ante fallo de Airtable devuelven **datos demo falsos** (§Área 4, S12) que hay que quitar antes de migrar o darán falsos verdes.

**Esfuerzo real estimado** (basado en el código que vi): capa de repo para Pacientes+Presupuestos ≈ 3-4 semanas; migración de esos dos módulos a Postgres ≈ 6-10 semanas; migración total ≈ 3-4 meses de un ingeniero. **No es un fin de semana. Por eso va después de los pilotos.**

---

### Área 3 — Multi-tenancy / aislamiento (el riesgo nº1 para dos clientes legales)

**Qué está bien.**
- El sistema de sesión moderno (`app/lib/auth/session.ts`) es correcto: JWT firmado con `AUTH_SECRET`, cookie `httpOnly`+`sameSite`+`secure` en producción, 24h, y lleva `clinicasAccesibles`.
- Las rutas "nuevas" (Leads, Pacientes, cola-cobros, configuraciones, Copilot) **sí** validan la pertenencia server-side con `listClinicaIdsForUser()` contra la tabla `Usuario_Clinicas` y devuelven 403. Bien hecho.
- Las rutas admin usan `withAdmin` (403 si no es admin). Correcto.

**Qué está frágil (crítico).**
- **El bug raíz:** al hacer login, `emitLegacyCookies()` emite las cookies legacy con **`clinica: null` fijo** (`app/lib/auth/legacy-cookies.ts:52` y `:66`, verificado). Como todo el módulo de Presupuestos, no-shows y varios de automatizaciones filtran con la condición `rol === 'encargada_ventas' && session.clinica`, y `session.clinica` es siempre `null`, **la condición nunca se cumple → se cae a "sin filtro = todas las clínicas".** Una coordinadora de la Clínica A puede pedir `/api/presupuestos/maxima` y recibir presupuestos (paciente, importe, doctor) de todas.
- **El helper de seguridad `canAccessClinica()` existe pero tiene CERO usos** en todo el repo (`session.ts:71`, verificado). Está escrito y nunca se llama.
- **Familia `/api/db/*` sin autenticación alguna** (14 rutas): leen y **crean/borran** citas, pacientes, presupuestos sin login y sin filtro de clínica (`app/api/db/today/route.ts`, `app/api/db/appointments/route.ts`, verificado — ningún `getSession`).
- **IDOR en Presupuestos:** `/api/presupuestos/mensajes`, `/historial`, `/contactos` devuelven datos por `?presupuestoId=` **sin comprobar que ese presupuesto pertenezca al usuario** — enumerando IDs se leen conversaciones de otro cliente.
- **El Copilot filtra bien en escritura pero tiene 3 fugas en lectura:** `consultar_llamadas_recientes` no filtra por clínica en absoluto (`tools-exec.ts:811`), y `get_facturado_periodo` devuelve facturación **global** si la coordinadora tiene ≥2 clínicas (`tools-exec.ts:524`).
- **Inyección en fórmulas:** las consultas de login (`no-shows/auth/login/route.ts:22`, `presupuestos/auth/login/route.ts:20`) interpolan el email sin escapar dentro del `filterByFormula` — manipulable.

**Veredicto.** Con los dos clientes en una sola base y estos agujeros, **hoy NO se puede garantizar que un cliente no vea datos del otro.** Es el trabajo P0 más importante.

---

### Área 4 — Fiabilidad e integridad (que no se pierda nada)

**Qué está bien.**
- El webhook de Meta verifica firma HMAC con `timingSafeEqual` y falla cerrado (503) si falta el secreto — correcto.
- Las escrituras de Airtable son **patch por campo** (no read-modify-write completo), así que editar campos distintos no se pisa.
- Hay idempotencia real con Vercel KV en el scheduler (`idempotency.ts`, `holdStore.ts`), y el motor de pagos recalcula en absoluto con log de inconsistencias (`pagos.ts:352`). El equipo sabe hacerlo — solo que no lo aplicó en los caminos calientes.

**Qué está frágil (los escenarios reales de pérdida de datos, por probabilidad × impacto):**

| # | Escenario | Evidencia | Severidad |
|---|---|---|---|
| **S1** | **WhatsApp entrante se pierde.** El webhook procesa "en segundo plano" (`processIncomingMessage(payload).catch(...)` **sin `await`**) y devuelve 200 al instante. En Vercel el trabajo tras la respuesta no está garantizado, y no se usa `waitUntil`/`after` en ningún sitio del repo. Airtable lento → mensaje perdido → Meta no reintenta. | `webhooks/whatsapp/route.ts:90-94` (verificado) | **Crítica** |
| **S2** | **Cambio de estado de presupuesto se pierde en silencio.** El endpoint devuelve `{ok:true}` con 200 aunque el `update` de Airtable falle; el cliente no comprueba `res.ok`. Arrastras a "Perdido", la UI dice hecho, no se guardó → el presupuesto "perdido" sigue recibiendo mensajes automáticos. | `presupuestos/kanban/[id]/route.ts:136`, `PresupuestosShell.tsx:187` | **Crítica** |
| **S3** | **Doble envío de WhatsApp.** Se envía a Meta **antes** de registrar en Airtable; si el registro falla, el mensaje ya salió, la coordinadora reintenta → paciente recibe el mensaje dos veces. Sin clave de idempotencia. | `presupuestos/mensajeria.ts:227↔266` | **Alta** |
| **S4** | **Dedup de entrantes race-prone.** Es "consultar y luego crear" (no atómico); dos entregas del mismo mensaje de Meta → duplicado + doble clasificación IA. El dedup robusto con KV existe pero solo se usa en el stack viejo de Twilio, no en el webhook de Meta vivo. | `webhooks/whatsapp/route.ts:164-172` | **Alta** |
| **S5** | **Lead de primer contacto invisible.** Un WhatsApp de un número desconocido (prospecto nuevo) se guarda huérfano pero **no crea Lead** ni aparece en ninguna cola. No hay captación automática. Choca con "no perder ningún lead". | `webhooks/whatsapp/route.ts:224-227` | **Alta** |
| **S6** | **Resultado de llamada IA (Vapi) perdido.** La llamada se crea en Vapi antes de registrarla; si el registro falla, el webhook de resultado no encuentra la llamada y lo descarta. Promete reconciliación por cron que **no existe**. | `llamadas/iniciar.ts:293↔318`, `webhooks/vapi/route.ts:116` | **Media-alta** |
| **S8** | **Conversión lead→paciente no atómica.** Crea paciente → marca convertido → crea presupuesto → actualiza lead, sin rollback. Si falla a mitad, al reintentar se crea un **presupuesto duplicado** (registro económico duplicado). | `leads/[id]/convertir/route.ts` | **Media** |
| **S11** | **Cron diario sin `maxDuration` y no idempotente.** No hay `maxDuration` en ningún sitio; el cron tiene `sleep(5000)` por llamada. Con 11 clínicas puede pasar el timeout y cortarse a mitad (citas sin recordatorio); si se reejecuta, mensajes duplicados. | `cron/daily/route.ts:207-233` | **Media** |
| **S12** | **Lecturas caen a datos DEMO falsos ante fallo de Airtable.** ~13 endpoints devuelven presupuestos/pacientes inventados si Airtable falla → la coordinadora ve un pipeline falso o cree que sus datos desaparecieron. | `presupuestos/kanban/route.ts:260`, `paciente:53`, etc. | **Media** |

**Veredicto: NO aguanta 2 pilotos (11 clínicas) sin perder datos en su estado actual.** S1 es exactamente vuestra prioridad nº1 y está roto por diseño en serverless.

---

### Área 5 — Módulos de conversión (Leads y Presupuestos) — el foco del piloto

**Qué está bien.**
- **Leads carga instantáneo** (SSR, 0 fetches al montar, `leads/page.tsx:38`) con **UI optimista y rollback real** en drag, "no asistió" y envío WhatsApp (`LeadsView.tsx:191-230`). Es el módulo más pulido.
- **Chat de WhatsApp bidireccional visible** en el panel lateral de ambos módulos (burbujas, timestamps, auto-scroll).
- **Clasificación de respuestas por IA real** (Claude Haiku) con salida validada contra categorías.
- **Cola de intervención priorizada** con secciones por intención y envío en bloque.

**Qué está frágil (huecos para el piloto, priorizados):**
- **[P0 producto] Crear un presupuesto manual PIERDE nombre y teléfono del paciente al recargar.** El POST solo persiste `Tratamiento_nombre/Estado/Fecha/Importe/Notas/OrigenLead`; nombre y teléfono se devuelven a la pantalla pero **nunca se escriben en Airtable** (`presupuestos/kanban/route.ts:297-305`, verificado). Tras refrescar: tarjeta "Paciente" sin teléfono → imposible contactar. Es el bug de mayor impacto del módulo estrella del piloto.
- **[P0 producto] La cola de intervención solo ve pacientes que YA respondieron** (`intervencion/route.ts:157`). Un presupuesto "presentado hace 5 días sin ningún contacto" (el caso más común al arrancar un piloto importando CSV) **no aparece en la cola operativa**, solo en la vista Máxima. No hay disparo proactivo de seguimiento por antigüedad.
- **[P1] Sin búsqueda ni filtros persistentes.** Los filtros se resetean en cada recarga (`FiltersBar.tsx:177`, sin `localStorage`). Una coordinadora 8h/día re-teclea filtros constantemente.
- **[P1] Recordatorios/tareas/caducidad de presupuestos: el código existe pero está huérfano** (`TareasView`, `EnviosView`, `ColaMensajes` con 0 importadores alcanzables). No hay concepto de "presupuesto caduca en N días" ni "lead frío hace N días" que escale o notifique.
- **[P1] "Marcar contactado" es implícito y débil** — se marca al abrir `wa.me`, sin saber si el mensaje salió.
- **[P1] La "prioridad IA" de la cola es una fórmula heurística, no IA** (`urgency.ts:8`, `intervencion/route.ts:76`). Funciona, pero conviene no venderla como IA de lo que no es.

**Duplicación medida.** De ~3.500 líneas de UI+API de intervención, **~1.400-1.600 son duplicación evitable**: `LeadAccionPanel` (896 líneas) vs `IntervencionSidePanel` (799) son ~90% idénticos; los endpoints de intervención de Leads y Presupuestos son gemelos 1:1; el scoring bidireccional está copiado carácter por carácter entre `intervencion/route.ts` y `maxima/route.ts`; `getSession()` está copy-pasteado en 31 rutas.

---

### Área 6 — Motor predictivo reorientado a conversión

**Qué está bien.**
- La **infraestructura de captura de eventos está bien diseñada y es reutilizable** (rama `sprint-18`): emitter resiliente que nunca bloquea el flujo (`emitter.ts`), sin PII (solo IDs), con reintentos; esquema Supabase con `eventos_comportamentales`, `factores_no_show`, `patrones_aprendidos`; predictor v0 heurístico con cierre de loop.
- El diseño "misma maquinaria, otro objetivo" es viable: el esquema de eventos ya contempla tipos `lead_creado`, `presupuesto_presentado`, `presupuesto_aceptado`, etc.

**Qué está frágil.**
- **Todo esto está en la rama `sprint-18-motor-no-shows`, SIN mergear a `main`** (10 commits por delante, verificado). **En producción hoy no se captura NADA en Supabase.** La "captura viva en silencio" que quieres **aún no está viva.**
- **Aunque se mergee, solo se emiten eventos de citas y no-shows.** Los eventos de conversión (`lead_creado`, `presupuesto_*`) están **definidos en el tipo pero nunca se emiten a Supabase.** El único `lead_creado` que se emite va al motor de automatizaciones de **Airtable** (`Eventos_Sistema`), que es otro sistema distinto (verificado). Es decir: **para predecir conversión, hoy no fluye ni un solo dato.**
- El predictor es heurístico (score base + 8 factores ponderados), explícitamente "ML en Sprint 21". Correcto como v0, pero es para no-shows y lee Airtable, no los eventos de Supabase.

**La buena noticia:** para el "wow" del día 1 ("a quién llamar hoy y qué decir", "estos presupuestos están a punto de perderse") **NO necesitas el motor predictivo todavía.** La cola de intervención existente (score de urgencia + clasificación IA de respuestas) ya da esa señal de forma heurística. El motor predictivo debe correr **en silencio acumulando datos** mientras la cola heurística da valor visible desde el primer día.

---

### Área 7 — UI/UX y sensación de producto maduro

**Qué está bien (se siente maduro).**
- **Sistema de diseño real:** tokens en `globals.css`, primitivos `Card`, `StatePill`, `Skeleton`, `KpiCard` con microinteracciones (contador animado, shimmer, fade-in escalonado).
- **Login mobile-first y accesible** (`NumericKeypad`, `PinScreen` con paste/autosubmit).
- **`LlamadasView` es el ejemplar de madurez** (Card + Skeleton + toasts + drawer + reintento por rol).
- **Empty states diseñados** y **confirmación destructiva persistible** en el kanban ("no volver a mostrar").
- **Deep links `tel:`/`wa.me`** en cada card (llamar/WhatsApp desde el móvil entre pacientes es fluido).

**Qué está frágil (lo que grita "prototipo"):**
- **IDs de Airtable expuestos al usuario:** la "respuesta rápida" pide teclear a mano un `ID Presupuesto ("rec...")` (`IntervencionView.tsx:503`); la columna "Paciente" de Llamadas muestra un trozo de ID, no el nombre (`LlamadasView.tsx:237`).
- **Diálogos nativos del navegador** (`alert()`/`confirm()`) en Ajustes y acciones (`ConfiguracionView.tsx` 7 veces, cancelar cita, "¿Enviar WhatsApp a…?").
- **Tabs "(legacy)" visibles para el admin** (`AutomatizacionesTopView.tsx:41`) y **banners "Datos de demostración"** con jerga de infra ("Vercel → Settings → Environment Variables") en producción.
- **Mobile a medias:** kanban con `PointerSensor` pero **sin sensor táctil** → arrastrar cards en el móvil probablemente frustra; **no hay `manifest`** (no instalable como app) y los iconos PWA son placeholders de 69 bytes.
- **Inconsistencia de implementación:** 6 "KpiCard" distintos conviviendo (el compartido se usa en 1 solo sitio); emoji vs iconos lucide mezclados para el mismo concepto (teléfono, WhatsApp, cerrar); color de acento sky vs violet según módulo.
- **Errores silenciosos que parecen "vacío":** varios fetch tragan el error y muestran el empty state → un fallo de red se ve como "¡todo cobrado!" (`CobrosTabView.tsx:92`).
- Tildes faltantes en copy visible ("pestanas", "apareceran aqui", `IntervencionView.tsx:773`).

**Veredicto.** El look es limpio y consistente. La sensación de prototipo no viene del diseño, sino de **fugas de la capa técnica al usuario** (IDs `rec...`, diálogos nativos, banners de demo) y de **inconsistencias de implementación**.

---

### Área 8 — Seguridad y RGPD (pacientes reales)

**Qué está bien.**
- Sesión moderna correcta (bcrypt, JWT firmado, cookies seguras).
- Webhook de Meta con firma HMAC fail-closed; webhook de Vapi con secreto; endpoint de debug con doble verja y 404 en prod.
- `.env` **no está en git** y el historial está limpio de claves hardcodeadas (verificado).

**Qué está frágil (vulnerabilidades, por severidad):**

**Críticas:**
- **`/api/db/*` sin autenticación** — lectura masiva de PII de pacientes + creación/borrado de citas desde internet (verificado).
- **Webhook de Twilio sin verificación de firma** (`twilio/whatsapp/route.ts`, verificado) — un atacante con un teléfono falsificado puede enumerar la próxima cita de cualquier paciente (dato de salud) y cancelar/reagendar citas. Y `dev/whatsapp-sim` reenvía a ese handler sin ninguna verja.
- **Contraseñas en texto plano** en el login legacy de presupuestos y no-shows (`String(f["Password"]) !== password`, verificado) + credenciales demo hardcodeadas (`demo@fyllio.com/demo2024`).
- **"Secreto interno" publicado en el navegador:** `NEXT_PUBLIC_INTERNAL_API_SECRET` se inyecta en el bundle del cliente (`ConfigAutomatizaciones.tsx:617`) y es el mismo que protege `/api/push/enviar` → cualquiera puede enviar push a todos los dispositivos de todas las clínicas.

**Altas:**
- **Secreto JWT legacy con fallback público** `"dev-secret-change-me-in-prod"` en **60 archivos** (`legacy-cookies.ts:19`, etc.). Si esa variable de entorno falta en producción, **cualquiera puede forjar sesiones** legacy que ven todas las clínicas.
- **Crons abiertos si falta `CRON_SECRET`:** el chequeo es `if (secret && ...)` → sin variable, se salta (`cron/reminders/route.ts:14`, verificado).
- **Endpoints `dev` destructivos** (`no-shows/dev/purge` borra tablas enteras) protegidos solo por una variable de entorno.

**Medias:**
- **PIN de coordinación de 4 dígitos** (10.000 combinaciones) con **rate-limiting en memoria** (no persiste entre instancias serverless) → fuerza bruta viable.
- **PII de pacientes en logs de Vercel** (teléfonos, nombres, contenido de mensajes en varios `console.log`).
- **Anonimización engañosa:** `anonimizacion.ts` solo oculta nombres de **clínica**; nombre del paciente + mensaje literal + nombres de doctores se envían **en claro** a Anthropic y OpenAI (incluido audio a Whisper). El comentario "Anthropic nunca ve nombres reales" es inexacto.

**Para firmar un contrato de tratamiento de datos (RGPD) sin mentir, como mínimo:**
1. Cerrar el plano de datos abierto (`/api/db/*`, Twilio sin firma, `whatsapp-sim`, `push` con secreto público).
2. Contraseñas a bcrypt (ya existe `hashing.ts`); quitar credenciales demo; fijar todos los secretos en Vercel y eliminar el fallback público.
3. Registro de subprocesadores real: los datos de paciente salen a **Airtable (EE.UU.), Anthropic, OpenAI (incl. Whisper), Vercel (hosting + KV 90 días + logs), Twilio, Meta** — todos necesitan DPA + cláusulas contractuales tipo. Hoy no se puede declarar "no hay transferencia internacional" ni "se anonimiza antes de la IA".
4. Logs sin PII + política de retención (portal en KV vive 90 días) + mecanismo de borrado a petición.
5. Rate-limiting persistente y verificación de pertenencia a clínica en las rutas de datos.

---

### Área 9 — Onboarding de una clínica nueva

**Qué está bien.**
- La parte administrativa tiene UI: crear clínica, crear coordinadoras + PIN (mostrado una vez), horario laboral, llamadas IA, config de negocio por clínica con override. **~5-15 min/clínica por UI.**
- Un usuario puede pertenecer a varias clínicas (junction `Usuario_Clinicas`).

**Qué está frágil (bloqueantes para escalar a 11 clínicas):**
- **El import de pacientes (Gesden) está roto para multi-clínica:** crea pacientes **sin vincular la clínica** (verificado — solo escribe `Nombre/Teléfono/NHC/Email/Fecha_nac`, `import/gesden/route.ts:106`), y `listPacientes` **descarta** a los pacientes sin clínica → **todo paciente importado queda huérfano e invisible** para las coordinadoras. Además el upsert por teléfono es **global** → el mismo teléfono en dos clínicas colisiona. Este es el peor momento posible para un bug: es exactamente la carga inicial de datos reales del piloto.
- **Un solo número de WhatsApp global para las 11 clínicas** (credenciales en variables de entorno, `waba-credentials.ts:17`). No se puede dar a cada clínica su propio número sin tocar código.
- **Los "módulos activables por clínica" son aspiracionales — no existen.** La tabla `Clínicas` solo tiene `Nombre/Ciudad/Telefono/Activa`. No hay campo de módulos/plan. La visibilidad se decide por rol y ruta, igual para todas.
- **No hay rol "dueño de red".** El dueño de las 10 clínicas tendría que ser `admin`, lo que le da acceso total de configuración a las 11 (incluida la clínica independiente del otro cliente, si comparten instancia).
- **El primer admin y el esquema se crean por script a mano** (`npx tsx`), no cableados en `package.json`.
- **No hay clínica plantilla ni clonado.** Doctores/tratamientos/sillones se meten por script o a mano.

**Estimación de fricción.** Administrativo: ~1-3 horas para las 11. Pero el onboarding **operativo con datos reales** (pacientes importados y visibles, WhatsApp usable) **no está listo**: import huérfano y WhatsApp único global son bloqueantes que exigen ingeniería antes del piloto. Realista: **1 día de data-entry + varios días de ingeniería** para desbloquear.

---

## 3. Plan priorizado

Notación de esfuerzo: **S** = ≤1 día, **M** = 2-4 días, **L** = ~1 semana, **XL** = 2+ semanas. Son estimaciones de un ingeniero a tiempo completo.

### P0 — Imprescindible antes del piloto (seguridad, aislamiento, no perder datos)

| # | Qué | Por qué importa | Esfuerzo | Qué se puede romper |
|---|---|---|---|---|
| P0.1 | **Decidir e implementar la separación de los dos clientes legales** (dos bases Airtable físicas, o single-base con scoping blindado — ver §4 Q1). Si es dos bases: hacer `base()` consciente del tenant y enrutar por sesión. | Es la garantía de que un cliente nunca vea al otro. Riesgo legal máximo. | L–XL | Todo el acceso a datos (102 archivos) si se hace dos bases; hay que probar cada módulo. |
| P0.2 | **Arreglar el bug raíz de aislamiento:** `legacy-cookies.ts` debe emitir la clínica real del usuario, no `null`; y aplicar `canAccessClinica()`/`listClinicaIdsForUser()` en todas las rutas de Presupuestos, no-shows, llamadas y automatizaciones. | Cierra la fuga entre clínicas del mismo cliente. | L | Rutas legacy que hoy "funcionan" mostrando todo; hay que revisar cada filtro. |
| P0.3 | **Cerrar la superficie abierta:** meter `/api/db/*`, `/api/dashboard/*`, `/api/scheduler/*`, `/api/whatsapp/send`, `/api/ai-suggestions` bajo autenticación o borrarlas (son de la demo); firma real en el webhook de Twilio; borrar/gate `dev/whatsapp-sim` y `dev/purge`. | Hoy cualquiera lee/borra datos de pacientes sin login. | M | La demo pública (`/demo`) dejará de funcionar — hay que decidir si se conserva. |
| P0.4 | **Eliminar `NEXT_PUBLIC_INTERNAL_API_SECRET`** del navegador; contraseñas legacy a **bcrypt**; quitar credenciales demo; fijar todos los secretos en Vercel y quitar el fallback `"dev-secret-change-me-in-prod"`. | Credenciales y secretos débiles = RGPD imposible. | M | Logins legacy si alguien los usa (están huérfanos, bajo riesgo). |
| P0.5 | **S1 — Webhook entrante fiable:** procesar el mensaje **antes** de responder 200, o usar `after()` de Next 16. | Es tu prioridad nº1 y hoy se pierden mensajes. | S–M | Latencia del webhook sube un poco; hay que vigilar el timeout de Meta (<20s). |
| P0.6 | **S2 — Quitar el "modo demo" de las escrituras** (devolver 500 real ante fallo) y comprobar `res.ok` + rollback en el cliente de Presupuestos (copiar el patrón de Leads). | Cambios de estado que se pierden en silencio. | S | Nada; es hacer visible un fallo que hoy se oculta. |
| P0.7 | **S3/S4 — Idempotencia en WhatsApp:** registrar antes de enviar (o log "pendiente" pre-envío) + clave de idempotencia; usar el dedup por KV en el webhook de Meta. | Evita doble envío al paciente y duplicados. | M | Poco; mejora un camino frágil. |
| P0.8 | **Arreglar el import de Gesden:** añadir selector de clínica y escribir `Clínica: [id]`; upsert por teléfono **dentro de la clínica**. | Sin esto, los pacientes importados del piloto son invisibles. | S–M | Nada nuevo; corrige un flujo roto. |
| P0.9 | **S11 — `maxDuration` en crons + idempotencia** (dedup de recordatorios; quitar el `sleep(5000)` bloqueante). | Cron que se corta a mitad = citas sin recordatorio, o mensajes duplicados. | M | Comportamiento del cron; hay que probar con volumen. |

### P1 — Hace que los pilotos digan "wow" (conversión, velocidad, inteligencia, UX)

| # | Qué | Por qué importa | Esfuerzo | Qué se puede romper |
|---|---|---|---|---|
| P1.1 | **Cola de intervención proactiva:** que los presupuestos "presentados sin contacto hace N días" entren en la cola, no solo los que ya respondieron. + concepto de "presupuesto caduca en N días" y "lead frío". | Es el corazón del piloto: seguimiento que no se escapa. | M–L | Lógica de la cola; hay que recalibrar prioridades. |
| P1.2 | **Persistir nombre + teléfono al crear presupuesto** (arreglar el bug P0-adyacente de pérdida de datos del módulo estrella). | Sin teléfono no se puede contactar. | S | Nada. |
| P1.3 | **Filtros y búsqueda persistentes** (localStorage) en Leads y Presupuestos. | Coordinadora 8h/día no re-teclea filtros. | S | Nada. |
| P1.4 | **Reactivar/conectar la UI de tareas y recordatorios** (hoy huérfana) o construir "siguiente acción" clara por card. | "A quién llamar hoy y qué decir" visible. | M | Nada (código muerto → vivo). |
| P1.5 | **Mergear la captura de eventos de Sprint 18 a `main`** (con no-shows apagado en UI) + **emitir eventos de lead/presupuesto a Supabase**. | Empieza a acumular datos de conversión desde el día 1, en silencio. | M | Riesgo bajo: el emitter no bloquea nada; probar que no mete PII. |
| P1.6 | **Pulido "anti-prototipo":** quitar IDs `rec...` de la UI, sustituir `alert()`/`confirm()` por modales, ocultar tabs "(legacy)" y banners de demo, sensor táctil en el kanban, `manifest` + iconos PWA reales. | Es lo que separa "demo" de "software con años en el sector". | M–L | Cosmético, bajo riesgo. |
| P1.7 | **Feedback consistente:** un solo patrón de toast (sonner) en todas las mutaciones; que un fallo de red no parezca "todo vacío". | Confianza de la coordinadora. | S–M | Nada. |

### P2 — Después (incluye no-shows como gancho comercial de futuras clínicas)

| # | Qué | Por qué importa | Esfuerzo |
|---|---|---|---|
| P2.1 | **Borrar/archivar el código muerto** (~28.700 líneas: cluster demo-agenda, crons superseditados, `DoctorView` sin usar, outputs binarios en `scripts/output`). | Reduce superficie de ataque y confusión; acelera todo lo demás. | M |
| P2.2 | **Deduplicar Leads/Presupuestos** (paneles gemelos, endpoints de intervención, scoring, `getSession` ×31) tras una capa compartida. | ~1.500 líneas menos, un solo sitio que mantener. | L |
| P2.3 | **Capa de repositorio para Pacientes y Presupuestos** (prerrequisito de la migración a Postgres). | Habilita cambiar de backend sin tocar 90 archivos. | L–XL |
| P2.4 | **Migración por fases a Supabase/Postgres** (Pacientes + Presupuestos primero) con RLS por clínica. | Aislamiento nativo + límites de API + RGPD. | XL |
| P2.5 | **Motor predictivo de conversión** sobre los eventos ya acumulados (heurístico primero, ML después). | "Estos presupuestos están a punto de perderse" con datos reales. | L–XL |
| P2.6 | **No-shows como gancho comercial:** una vez estable, reactivar el módulo (hoy oculto) para futuras clínicas que sí lo prioricen. | Diferenciador de venta. | M (ya está construido) |
| P2.7 | **Un número de WhatsApp por clínica** + rol "dueño de red" + módulos activables reales. | Escalar a más clientes sin tocar código. | L |

---

## 4. Decisiones que necesito de ti antes de codear

Estas son las ambigüedades que no debo resolver por mi cuenta. En orden de urgencia:

**Q1 (bloqueante, la primera). Modelo de aislamiento de los dos clientes legales.** ¿Separamos a los dos clientes en **dos bases de Airtable físicas** (más trabajo ahora, pero garantía de que jamás se mezclan aunque haya un bug), o los dejamos en **una sola base** y confiamos en blindar los filtros por software (más rápido, más frágil)? Mi recomendación fuerte: **dos bases**. Necesito tu decisión porque condiciona toda la arquitectura del P0.

**Q2. ¿Qué hacemos con la demo pública (`/demo`, `/dashboard`, `/api/db/*`)?** Cerrarla bajo login rompe la demo; borrarla elimina ~18.000 líneas y una superficie de riesgo grande. ¿La sigues usando para vender, o la retiramos?

**Q3. WhatsApp: ¿un número global para todo, o número por clínica?** Hoy es global. Un número por clínica es más profesional pero requiere rediseño (P2.7). ¿Los pilotos aceptan un único número compartido al arranque?

**Q4. El dueño de la red de 10 clínicas: ¿debe ver las 10 juntas?** Hoy eso implica hacerlo `admin`, lo que le daría acceso también a la clínica del otro cliente si comparten instancia. ¿Creamos un rol "dueño de red" acotado, o cada cliente va en instancia/base separada (encaja con Q1)?

**Q5. Contraseñas legacy en texto plano.** Para migrarlas a bcrypt sin fricción, ¿forzamos reset de PIN/contraseña a los usuarios existentes, o migramos en el próximo login? (Afecta a cuántas coordinadoras hay que reonboardear.)

**Q6. Motor predictivo: ¿confirmas la reorientación a conversión con no-shows apagado en UI pero captura viva?** Si sí, el P1.5 mergea la captura y añade los eventos de lead/presupuesto. Quiero tu OK explícito antes de tocar la rama de Sprint 18.

---

## 5. Propuesta de sprints (secuenciada para no bloquear los pilotos)

La regla: **primero que no se pueda perder ni filtrar un dato, luego que enamore.** Ramas por sprint, merge a `main` tras QA.

**Sprint A — "Blindaje de datos" (P0 de fiabilidad + seguridad de superficie).** ~1-1,5 semanas.
Webhook entrante fiable (P0.5), quitar modo-demo de escrituras + rollback (P0.6), idempotencia WhatsApp (P0.7), cerrar `/api/db/*` y Twilio sin firma (P0.3), eliminar secreto en navegador + bcrypt + fallback de secreto (P0.4), `maxDuration` en crons (P0.9), arreglar import Gesden (P0.8). *Depende de Q2, Q5.*

**Sprint B — "Aislamiento multi-cliente" (P0 de tenancy).** ~1-2 semanas.
Implementar la decisión de Q1 (dos bases o scoping blindado), arreglar `legacy-cookies` (P0.2), aplicar verificación de pertenencia en todas las rutas legacy y en las 3 fugas de lectura del Copilot. QA específico: intentar activamente ver datos de otra clínica/cliente y confirmar 403. *Depende de Q1, Q4.* **No entrar a piloto antes de cerrar este sprint.**

**Sprint C — "Conversión impecable" (P1 producto).** ~1-1,5 semanas.
Cola proactiva + caducidad (P1.1), persistir paciente en presupuesto (P1.2), filtros persistentes (P1.3), tareas/siguiente-acción (P1.4), feedback consistente (P1.7). Este es el sprint que hace que las coordinadoras digan "wow".

**Sprint D — "Producto maduro + captura viva" (P1 UX + motor).** ~1 semana.
Pulido anti-prototipo (P1.6), mergear captura de eventos + eventos de conversión (P1.5, tras Q6). No-shows sigue oculto.

**Sprint E+ — "Consolidación" (P2).** Post-piloto, con ingresos.
Borrar código muerto, deduplicar, capa de repositorio, y arrancar la migración por fases a Supabase. El motor predictivo de conversión y el número-por-clínica van aquí.

**Los pilotos pueden arrancar tras Sprint B** (datos seguros y aislados), idealmente con Sprint C también hecho para que la experiencia enamore. Todo lo demás va en paralelo o después sin bloquear.

---

*Fin del informe. Detalle técnico con `archivo:línea` en cada sección. Para cualquier ítem puedo ampliar el diagnóstico o preparar el plan de implementación de un sprint concreto cuando me des el visto bueno y respondas Q1.*
