# Migración Airtable → Postgres/Supabase — Plan (FASE 0, gate)

**Estado:** propuesta para decisión. **Cero código hasta aprobación.**
Skills aplicados: `fyllio-lecciones-ingenieria` (los 9 mandamientos son la definición de "hecho"),
`fyllio-esencia-producto` (migración que preserva comportamiento; nada de datos inventados),
`fyllio-estandar-visual` (sin regresión de UI; errores honestos si la DB cae).

---

## TL;DR (decisión primero)

1. **Destino: Supabase gestionado, región UE (Frankfurt), un solo proyecto.** Ya está en el
   stack (Sprint 18), la UE es requisito RGPD que Airtable-US hoy NO cumple bien, y el coste es
   plano vs. per-seat de Airtable. **Condición dura:** los datos de negocio NO se acceden con la
   `service_role` key (bypassa RLS); van por un rol de app no-superusuario + `SET LOCAL`.
2. **El trabajo real es ~5× lo que creías.** No son ~87 accesos: son **~400 call-sites de
   `base()`** en ~118 archivos y 38 tablas, **~173 `filterByFormula`** y **~139 `fetchAll`** con
   agregación en memoria. Barato en DATOS (tablas vacías), **caro en INGENIERÍA: 6–10 semanas**
   de un dev competente. No lo endulzo.
3. **RLS iguala el aislamiento del Sprint B a nivel de motor y añade integridad referencial —
   con condiciones.** No es automáticamente "mejor" que dos bases físicas; lo es solo si se
   cumplen 3 condiciones (§3).
4. **Ejecución NO big-bang:** primero una capa de repositorio con Airtable todavía detrás (punto
   único de reversión), luego se voltea esa capa a Postgres por dominios. Como RB/INDEP están
   vacías, no hay backfill ni dual-write.

**Lo que necesito de ti para cerrar FASE 0:** las 4 decisiones del final (§8).

---

## §1 · Destino: Supabase gestionado (UE) vs Postgres puro en otro proveedor

**Recomendación: Supabase gestionado, región UE (`eu-central-1` Frankfurt), un proyecto.**

| Factor | Peso | Veredicto |
|---|---|---|
| **(a) RGPD — hosting UE** | requisito, no preferencia | Datos de salud dental = categoría especial (art. 9 RGPD). **Airtable hoy aloja en EE. UU.** → transferencia a tercer país (SCC/DPF), fricción real. **Migrar a Postgres-UE es una MEJORA RGPD**, no solo un cambio técnico. Supabase ofrece región Frankfurt y firma DPA. ⚠️ **Verificar la región del proyecto Supabase actual (Sprint 18); si es US, se crea uno nuevo en UE** y se mueven allí las 3 tablas de analítica (son regenerables). |
| **(b) Ya en el stack** | alto | Supabase entró en Sprint 18 (`eventos_comportamentales`, `factores_no_show`, `patrones_aprendidos`, predictor de no-shows). Reusarlo = **una plataforma, una conexión, un DPA**, y —clave— negocio + analítica **co-localizados**: hoy no puedes hacer JOIN entre un presupuesto (Airtable) y su predicción de no-show (Supabase); tras la migración, sí. |
| **(c) Coste** | medio | Airtable es **per-seat** (~20–45 $/coordinadora/mes) + rate-limit 5 req/s por base → escala mal con el equipo. Supabase Pro **~25 $/mes plano** + uso, incluye Postgres + pooler + storage. A escala piloto y de crecimiento, Supabase es netamente más barato y sin límite de 5 req/s. |
| **(d) RLS por cliente** | alto | Nativo de Postgres (cualquier proveedor). Supabase lo hace first-class. El punto fino no es el proveedor sino **CÓMO conectas** (§3). |

**¿Por qué no Postgres puro (Neon/RDS/Railway)?** Neon es algo más barato y agradable para
Postgres puro (branching, serverless, regiones UE), pero **re-parte el stack** (la analítica ya
vive en Supabase) y añade un segundo proveedor y un segundo DPA. RDS mete ops (VPC, backups,
parcheo) que no quieres siendo fundador solo. Dado que Sprint 18 ya comprometió Supabase, el
coste de cambiar de proveedor no compra nada. **Si un pentest exigiera separación física por
cliente**, el plan B no es "otro proveedor" sino **esquema-por-tenant dentro del mismo Postgres**
(§3, opción B).

**Driver/ORM (recomendación honesta, roza tu preferencia de Prisma).** `pg` **ya está instalado**
(`package.json`, v8.21). Para RLS necesitas fijar `app.cliente` por transacción (`SET LOCAL`) y
control explícito de transacción; el runtime de Prisma **pelea** con eso (pool propio, `SET LOCAL`
requiere `$transaction`+`$executeRaw`, y choca con el pooler en modo transacción). Recomiendo
**Kysely** (query builder tipado, fino, transacción explícita, pooler-friendly) en runtime +
**migraciones en SQL plano** (o Prisma SOLO para gestionar el esquema si te gusta su DX). No es tu
default de Prisma-todo, pero el requisito de RLS-por-request lo justifica; si prefieres Prisma
igualmente, se puede, con más ceremonia y un caveat de pooler.

---

## §2 · Inventario del trabajo real (sin endulzar)

**El "~87" es un subconteo de ~5×.** Superficie real de producción (deduplicando el árbol
espejo de `.claude/worktrees/`):

| Métrica | Producción (`app/api`+`app/lib`) | Scripts (seed) |
|---|---|---|
| Call-sites `base()` (acceso a negocio) | **~400** (234 API + 169 lib) | ~131 |
| Archivos que tocan `base()` | **118** | — |
| `filterByFormula` a reescribir | **~173** | ~71 |
| `fetchAll` + agregación en JS → SQL | **~139** | ~74 |
| `typecast:true` (selects auto-creados) | **~30** | ~19 |
| Tablas de negocio | **38** (`app/lib/airtable.ts:5-64`) | — |
| Enforcement de aislamiento por clínica | **88 call-sites** | — |

**Qué es fácil vs. qué es el trabajo real:**

- **Mecánico (fácil):** igualdad `{Campo}='x'`, `RECORD_ID()='id'` → `WHERE id IN (...)`, fechas
  `IS_AFTER/IS_BEFORE` → `WHERE ts > $1`. La mayor parte del volumen, poco riesgo.
- **El trabajo real (3 focos):**
  1. **`FIND(x, ARRAYJOIN({Link}))`** — hoy es un JOIN *falseado* dentro de una fórmula porque
     Airtable no filtra links por record-id (`llamadas/repo.ts:132`, `waitlistRepo.ts:96`,
     `clinica-scope.ts:89`). Arrastra **columnas-espejo de texto** (`Paciente_RecordId`,
     `PresupuestoId` como texto, `Clinica` como texto) inventadas para poder filtrar
     (`pagos.ts:52-55`, `auth/users.ts:131`). En Postgres **desaparecen**: son JOINs por FK real.
     Cada call-site se reescribe, pero el modelo queda más limpio.
  2. **~139 `fetchAll` + agregación en memoria** → `GROUP BY`/`SUM`/`HAVING`/`ORDER BY`. Son los
     KPIs (`presupuestos/kpis`, `leads/kpis`, `no-shows/kpis`, `dashboard/stats`). Riesgo:
     paridad exacta (zona `Europe/Madrid`, redondeos, umbrales `HAVING total>=3`).
  3. **Fórmulas complejas** (las 5 peores, citadas): cola de intervención `AND(OR(AND()))` de 4
     niveles (`presupuestos/intervencion/route.ts:138`), cooldown con JOIN-por-texto+fecha
     (`engine.ts:460`), inactivos con `OR(BLANK, fecha)` (`cron/automatizaciones-evaluar:221`).
     Todas son `WHERE` triviales en SQL una vez hay FKs — la dificultad es de volumen, no de lógica.

**Estimación honesta por módulo** (dev competente; incluye reescritura + tests de paridad):

| Módulo | Días | Notas |
|---|---:|---|
| Andamiaje: esquema 38 tablas + migraciones + conexión/pooler + patrón repo + RLS plumbing | 4–6 | Fundacional, bloquea el resto |
| Identidad/Auth (Usuarios, Usuario_Clinicas, Clínicas, login PIN, sesiones) | 2–3 | Lo más sensible; 8 usuarios reales |
| Agenda núcleo (Citas, Pacientes, Tratamientos, Staff, Sillones, Lista_espera) | 3–4 | Muchos links → FKs |
| **Presupuestos** (31 rutas + 12 libs, scoring bidireccional, soft-FKs, ~20 KPIs) | **5–8** | El monstruo |
| Leads (+ Acciones_Lead, Plantillas_Lead, KPIs) | 2–3 | |
| No-shows (score.ts + predictor ya en Supabase; deriva de Citas) | 2–3 | Analítica ya migrada |
| Automatizaciones (Reglas, Acciones, Eventos, engine, cron) | 3–4 | Idempotencia real por constraint |
| Pagos (Pagos_Paciente, Acciones_Pago, Inconsistencias) | 2–3 | |
| Copilot, mensajería, notificaciones, plantillas, WABA, push, informes, Vapi | 3–5 | Cola larga |
| Webhooks + crons (resolución de cliente, idempotencia por unique) | 2–3 | |
| Seed DEMO + scripts (~131 accesos) → SQL | 2–3 | DEMO es regenerable |
| QA adversarial (re-Sprint B) + paridad de KPIs + carga | 3–4 | Gate de corte |
| **Total** | **~35–50 días** | **≈ 6–10 semanas** foco solo |

**La tensión honesta:** es **barato en riesgo de datos** (verificado: RB 4 pac./4 presup., INDEP
2/2, cero citas/leads/usuarios; DEMO regenerable; CENTRAL 8 usuarios) pero **no es barato en
ingeniería**. El argumento de "ahora" es correcto porque cada semana de piloto añade datos reales
y sube el coste — pero es 6–10 semanas, no un fin de semana.

---

## §3 · Esquema, foreign keys y RLS

### Esquema: FKs reales matan la clase de bug de `logAccionLead`

38 tablas → Postgres con **FK reales**, eliminando los hacks de texto:

- `Presupuestos.Clinica` (texto) → `clinica_id` FK → `clinicas.id`.
- `Contactos_Presupuesto.PresupuestoId` (soft-FK texto) → FK real `presupuesto_id`.
- `Pacientes.Paciente_RecordId` y espejos varios → **se borran**; el JOIN es por FK.
- Metadata empaquetada en `Notas` y parseada por regex (`kanban/route.ts:155`) → columnas propias.

**Por qué esto mata el bug de `logAccionLead`** (lección §8): aquel `create` escribía un link
`Usuario` con un id de otra base → fallaba SIEMPRE y el `catch` lo tragaba (lección §9). Con FK
real en un solo Postgres: o el id existe (FK válida) o el `INSERT` **falla en voz alta** con un
error de constraint. Es estructuralmente imposible "escribir un link a un id de otra base".

### Multi-tenant + RLS: cómo, y si iguala el Sprint B

**Modelo recomendado (opción A):** un esquema, columna `cliente` (`NOT NULL`, enum RB/INDEP/DEMO)
en cada tabla de negocio, **RLS forzada** con política:
```
USING (cliente = current_setting('app.cliente', true))
```
La conexión usa un **rol de app no-superusuario (sin BYPASSRLS)**. `runWithCliente(cliente, fn)`
—que hoy fija el AsyncLocalStorage— pasa a **abrir transacción + `SET LOCAL app.cliente = $1`** y
ejecutar `fn`. El seam del Sprint B mapea **1:1**.

**¿RLS replica o mejora el aislamiento del Sprint B? Respuesta honesta, sin rubber-stamp:**

- **Cliente↔cliente (RB/INDEP/DEMO):** hoy = **bases físicas separadas** (máxima contención de
  radio: un bug de query no puede cruzar de base). RLS = lógico, una DB. **No es automáticamente
  "mejor":** introduce un modo de fallo nuevo (una política mal escrita, o una query con
  service-role, cruza inquilinos) que las bases físicas no tienen. **RLS IGUALA la garantía del
  Sprint B a nivel de motor —y añade integridad referencial— SOLO SI:**
  1. **Los datos de negocio NUNCA usan la `service_role` key** (bypassa RLS). Hoy el cliente
     Supabase existente ES service-role (`supabase/client.ts:124`). → guard de CI que prohíba
     service-role fuera de la analítica.
  2. **Toda tabla de negocio tiene `cliente NOT NULL` + RLS forzada.** Sin `SET LOCAL`,
     `current_setting('app.cliente', true)` es `NULL` → 0 filas (**fail-closed por defecto**,
     igual que el `throw` de `base()` hoy). El repo además lanza si no hay cliente (defensa en
     profundidad, paridad con hoy).
  3. **Se re-corre el QA adversarial del Sprint B contra Postgres y pasa** (§5).
- **Clínica↔clínica (dentro de un cliente):** hoy es **app-level** (88 call-sites,
  `clinica-scope.ts`, `verificarPresupuestoPermitido`) y ya se rompió una vez (el filtro estaba
  muerto y una coordinadora veía todas las clínicas — comentario `clinica-scope.ts:5-8`).
  **Propuesta: subirlo TAMBIÉN a RLS** con una 2ª variable `app.clinicas` (array) y política
  `clinica_id = ANY(...)` con bypass admin. Esto es una **MEJORA real** sobre el Sprint B: los 88
  chequeos que hoy se pueden olvidar pasan a ser imposibles de saltar. El motor, no el código.

**Opción B (si se exige separación física):** **esquema-por-tenant** (`rb.*`, `indep.*`,
`demo.*`) en el mismo Postgres → contención de radio casi física, pero migraciones ×3 y más DDL.
La recomiendo solo si un pentest lo pide; por defecto, opción A.

---

## §4 · Orden de ejecución (NO big-bang)

**El principio:** si algo falla, se revierte en **un punto**, no en 400.

- **FASE 0 — Plan + decisión (este documento).** Gate. ✅ cuando apruebes §8.
- **FASE 1 — Capa de repositorio, Airtable TODAVÍA detrás.** Se definen módulos repo por dominio
  (`repos/presupuestos.ts`, `repos/pacientes.ts`, …) con métodos que revelan intención
  (`listPresupuestosCola(clinicas)`, no `.select({filterByFormula})`). Los ~400 call-sites pasan a
  llamar al repo; **el repo por dentro sigue llamando a `base()`/Airtable**. **Cero cambio de
  comportamiento.** Es la fase mecánica grande, pero **segura y revertible por-repo** (Airtable
  sigue siendo la verdad). Gate: KPIs y flujos idénticos (tests golden).
- **FASE 2 — Postgres detrás de la misma interfaz.** Se levanta el esquema + RLS, se re-siembra
  DEMO en Postgres y se re-crean los 8 usuarios CENTRAL. Cada repo voltea su interior de Airtable
  a Postgres tras un flag `DATA_BACKEND=airtable|postgres`, **dominio a dominio**. Como RB/INDEP
  están vacías, **no hay backfill ni dual-write**. Gate por dominio: QA + paridad de KPIs.
- **FASE 3 — Aislamiento a RLS + matar los hacks.** Se activa RLS (`cliente` + `clinicas`), se
  borran las columnas-espejo de texto, `runWithCliente` pasa a abrir transacción con `SET LOCAL`.
  Gate: **QA adversarial completo del Sprint B contra Postgres**.
- **FASE 4 — Corte y baja de Airtable.** Se voltea producción; Airtable queda **read-only como
  rollback** unas semanas; luego se retira la dependencia `airtable` y `base()`.

**Sobre "migrar los 3 clientes por fases":** con Postgres único + RLS **no hay migración
per-cliente** — los tres viven en la misma DB y cortan juntos cuando un dominio se voltea. El
staging real es **por DOMINIO de código, no por cliente** (ahí está el riesgo). Vehículo de
validación: **DEMO primero** (tiene los datos de seed, stakes bajos); RB/INDEP van detrás
"gratis" porque están vacías. Lo aclaro porque el fraseo original imaginaba fases per-cliente que
aquí no aportan nada.

---

## §5 · Qué se rompe y cómo lo verificamos

| Zona | Qué se rompe | Verificación (gate) |
|---|---|---|
| **Aislamiento** | El corazón del riesgo. | **Re-correr los 5 escenarios adversariales de `SPRINT-B-QA.md`** contra Postgres (cliente↔cliente, clínica↔clínica, IDOR por id, gestión cross-cliente, Copilot) + tests RLS nuevos: conexión sin `SET LOCAL` → 0 filas; **guard de CI: service-role prohibida en negocio**; clínica por RLS. Lección §5: se prueba **intentando saltárselo**, con datos `[SEED_QA]` reconocibles. |
| **KPIs** | ~139 agregaciones en JS → `GROUP BY` SQL: off-by-one, zona `Europe/Madrid`, redondeo, `HAVING`. | **Paridad golden:** correr ambos backends sobre el mismo seed y **diff de cada endpoint de KPI**. Lección §4: un KPI que difiere en silencio es un dato inventado. |
| **Login** | Identidad pasa de base CENTRAL a Postgres (bcrypt, email único, sesiones). | Todas las variantes: `identify`→`select-clinica`, admin, coord; rate-limit (KV se queda); rechazo del ident-token; **fail-closed si no hay cliente**. |
| **Webhooks** | WhatsApp (match teléfono→presupuesto/lead pasa a JOIN por FK), Vapi, portal. | Idempotencia **MEJORA**: `unique(message_id)` en DB sustituye el dedup solo-KV (lección §2). Test: **reenviar el webhook 2× → 1 fila**. Cliente sin sesión sigue por `PILOT_CLIENTE`, ahora con `SET LOCAL`. |
| **Crons** | `daily` (07:00) y `automatizaciones-evaluar` (12:00). | Deben abrir transacción con `SET LOCAL app.cliente`. Re-ejecución → sin duplicar (lección §2). |
| **Fechas** | luxon `Europe/Madrid` en 138 archivos. | `timestamptz`, guardar UTC, convertir en los bordes. Zona de bugs; test explícito de límites de día. |

---

## §6 · Riesgos que no preguntaste (pero que muerden)

- **Pooling en serverless.** Vercel + Postgres = tormenta de conexiones. Obligatorio el **pooler
  de Supabase (PgBouncer, modo transacción)**. `SET LOCAL` es transaccional → compatible con
  modo-transacción. Pero **prepared statements chocan** con PgBouncer transaction-mode: configurar
  `pg`/Kysely sin prepared statements o con el pooler-safe. Gotcha real, se planifica desde el día 1.
- **`typecast:true` (30 sitios) auto-crea opciones de select en Airtable.** En Postgres los enums
  son fijos → un valor nuevo **falla el INSERT**. Decisión por campo: `TEXT + CHECK`, tabla de
  catálogo, o enum extensible. Si no se decide, rompe escrituras al primer valor nuevo.
- **Persistencia antes de confirmar (lección §1).** Hoy hay escrituras fire-and-forget; con FK una
  escritura fallida **error visible** (bien), pero NO mover persistencia a `after()`/`waitUntil`.
- **Scope creep.** La tentación de "arreglar todo" (matar los patrones paralelos de
  `MEJORAS-PENDIENTES.md` #8) durante la migración. **Recomendación: migración que preserva
  comportamiento PRIMERO; refactors como follow-ups separados.** No mezclar, o el gate de paridad
  se vuelve imposible de leer.
- **Región del proyecto Supabase actual.** Si Sprint 18 creó el proyecto en US, hay que crear uno
  **nuevo en UE** antes de tocar nada (RGPD). Verificar en día 1.

---

## §7 · Definición de "hecho" = los 9 mandamientos (`fyllio-lecciones-ingenieria`)

1. **Persiste antes de confirmar** — ningún 200/toast antes del COMMIT.
2. **Idempotencia** — webhooks/crons/creaciones con `UNIQUE`/upsert atómico (mejora vs. KV-only).
3. **Fail-closed** — sin `SET LOCAL app.cliente` → 0 filas (RLS) + repo lanza. Nunca default permisivo.
4. **Nunca datos falsos** — DB caída → error honesto (500/`ErrorState`), jamás demo ni empty-state.
5. **Aislamiento probado saltándoselo** — re-Sprint B + tests RLS (§5).
6. **Caminos sin sesión resuelven contexto explícito** — webhooks/crons declaran cliente y hacen `SET LOCAL`.
7. **Verificar causa en código real** — este plan salió de leer los 400 call-sites, no de asumir.
8. **FKs en vez de links cross-base** — el corazón de la ganancia; mata la clase `logAccionLead`.
9. **Fallos nunca silenciosos** — quitar los `catch` que tragan; constraint viola = ruido visible.

Esencia de producto: la migración **no cambia ningún flujo** que ve la coordinadora; el gate es
paridad. Visual: sin regresión de UI; si la DB cae, error honesto (no "todo cobrado").

---

## §8 · Decisión pendiente (gate — qué necesito de ti)

1. **¿Apruebas Supabase-UE, un proyecto, opción A (single-schema + RLS)?** ¿O quieres que evalúe
   esquema-por-tenant (opción B) por separación tipo-física?
2. **Runtime: ¿Kysely + SQL migrations (mi recomendación por RLS) o Prisma** (tu default, con el
   caveat de pooler)?
3. **¿Confirmas la ventana ahora** (6–10 semanas) sabiendo que es barato en datos pero no en
   ingeniería, y que cada semana de piloto la encarece?
4. **¿Migración que preserva comportamiento y refactors aparte**, o aceptas mezclar algún
   cleanup de #8 (sube riesgo y complica el gate de paridad)?

**No escribo código hasta que apruebes.**

---

## §9 · FASE 0 cerrada + FASE 1 en curso (decisiones 2026-07-20)

Simon aprobó: **(1)** opción A single-schema + RLS; **(2)** Kysely + SQL migrations;
**(3)** ventana confirmada con gate: FASE 1 completa → parar y reevaluar antes de FASE 2
según piloto/legal; **(4)** comportamiento-preservado, refactors de #8 como follow-ups.
Región Supabase verificada por Simon: `eu-west-1` (Irlanda, UE) → se reutiliza el proyecto
del Sprint 18. **Las 3 tablas de analítica (`eventos_comportamentales`, `factores_no_show`,
`patrones_aprendidos`) quedan FUERA de la migración e intactas** — paridad y RLS por
`cliente` aplican solo a las tablas de negocio; la analítica va en la allowlist del guard
de service-role.

### Patrón repo validado (dominio piloto: Leads)

Reglas que siguen los demás dominios:

1. **Propiedad por TABLA, no por ruta.** El gate de un dominio es: cero accesos a sus
   tablas fuera de `app/lib/<dominio>/` — verificado por grep. Lo que una ruta toca de
   tablas ajenas migra con el dominio dueño de esa tabla.
2. **Un archivo por tabla** dentro del dominio (`leads.ts`, `acciones.ts`, `plantillas.ts`),
   métodos que revelan intención (`ultimasAccionesDireccionPorLead()`, no
   `.select({filterByFormula})`). Los tipos que salen del repo son de dominio (`Lead`,
   `AccionLead`) — ningún record de Airtable cruza la frontera.
3. **Paridad estricta**: fórmulas, catch→[] y semántica de errores se preservan tal cual,
   rarezas incluidas y documentadas (p. ej. `crearAccionAutomatizacion` escribe
   `Tipo`/`Descripcion` como hacía el motor, distinto de `logAccionLead` — unificar es
   follow-up, no migración).
4. **Verificación por dominio**: gate grep vacío + `tsc` + `build` + smoke de los
   endpoints afectados contra DEMO.

Estado Leads (hecho): 3 tablas (Leads, Acciones_Lead, Plantillas_Lead) tras el repo;
11 call-sites migrados (rutas del dominio, pacientes/[id], cola-cobros, webhook WhatsApp,
cron automatizaciones, engine, mensajería, alertas). Smoke DEMO: ultima-saliente,
plantillas, kpis, cola-cobros, alertas, leads → 200 con shapes idénticos. Caveat honesto:
el camino `listAccionesByLead` vía ficha de paciente no es ejercitable en el seed actual
(ningún paciente con `leadOrigenId`); queda cubierto por tipos y código compartido.

**Siguientes dominios sugeridos** (de menos a más riesgo): Pacientes → Agenda núcleo →
Automatizaciones → Pagos → Presupuestos (el monstruo, al final, con el patrón ya rodado).

### Estado Pacientes (hecho, 2º dominio)

1 tabla (Pacientes), ~14 métodos nuevos en `app/lib/pacientes/pacientes.ts`, **20+
call-sites** migrados en 16 archivos: pagos (cruce financiero, suma Pendiente, recalculo
Pagado/Pendiente ×2), engine (opt-out), predictor no-shows (canal/edad), scheduler
(waitlist por teléfono/tutor, contacto, opt-out Twilio, altas del scheduler, upsert),
copilot (nota cobranza), alertas, convertir lead→paciente, marcar-contactado, import
Gesden, buscador no-shows, superficie demo `/api/db` (shim al shape de fields que espera
su código), introspección dev. Gate grep vacío + tsc 0 + build OK + smoke DEMO
(pacientes, detalle, alertas, cola-cobros, leads/kpis → 200 con shapes idénticos).

**Follow-ups detectados en Pacientes (documentados, NO tocados — paridad):**
- `createPacienteDesdeConversion` NO escribe `CreatedAt` (los pacientes convertidos
  quedan al final del sort nativo) ni el link `Lead_Origen` (el enlace vive solo en el
  lado Lead via `Paciente_ID`). Unificar con `createPaciente` tras la migración.
- 🔴 **PRIORITARIO (decisión de Simon 2026-07-20) — doble flag de opt-out**: `Opt_Out`
  (scheduler/Twilio STOP) vs `Optout_Automatizaciones` (motor de reglas) — dos opt-outs
  paralelos que nada unifica; **un paciente que dice STOP por Twilio sigue opted-in para
  el motor. Es un problema de CONSENTIMIENTO (RGPD/mensajería), no solo técnico.**
  Resolver antes de que cualquier envío automático real (WABA #5B) entre en producción:
  como mínimo, que el motor respete AMBOS flags.
- (De Leads, ya anotado): `crear_accion_lead` del motor escribe campos
  `Tipo`/`Descripcion` que no coinciden con los de `logAccionLead`
  (`Tipo_Accion`/`Detalles`).

### Gate adicional de FASE 2 (decisión de Simon 2026-07-20): ejercitar ESCRITURAS

Los caminos de escritura que en FASE 1 solo se cubren por tipos y paridad textual de
campos (no por smoke, para no ensuciar la base DEMO) **deben ejercitarse de verdad antes
de voltear su dominio a Postgres** — las escrituras son donde la paridad se rompe.
Registro acumulado de escrituras pendientes de ejercitar:
- **Leads**: `crearAccionAutomatizacion` (motor), `logAccionLead`/`appendLeadLog` (webhook),
  `markLeadConvertido`.
- **Pacientes**: `createPacienteDesdeConversion` (convertir), `upsertPacienteImportPorTelefono`
  (Gesden), `appendNotaPaciente` (cobros/copilot), `syncFinancieroPaciente` (pagos),
  `marcarOptOutPorTelefono`, `createPacienteBasico`/`SinTelefono` (scheduler).
- **Agenda**: `updateCitaEstado` (Vapi ×2, no-shows), `registrarAccionNoShowEnCita`,
  `createCitaMinima` (nueva cita), `reprogramarCita` (mover),
  `updateTratamientoInstrucciones`, `updateWaitlistEstado`, `createWaitlistEntradaFlexible`
  (demo), `createWaitlistEntry` (twilio test) + los ya existentes del scheduler
  (`createAppointment`, `cancelAppointment`, `completeAppointment`, `markNoShow`,
  `confirmAppointment`, `updateAppointment`).
- **Automatizaciones**: `patchSecuencia` (enviar/descartar/editar), `createSecuenciaRaw`
  (procesar), `updateConfigRaw`/`createConfigRaw` (PUT configuración),
  `marcarEventoProcesado` (cron), `destroySecuencias`/`createSecuenciasRaw` (seed demo),
  más las ya existentes del motor (`logAccion`, `incrementarDisparos`, `updateRegla`).
- **Pagos**: las escrituras ya vivían dentro de `lib/pagos.ts` (alta/edición/borrado de
  pagos, log en Acciones_Pago, inconsistencias) — ejercitarlas igualmente en FASE 2.
- (Se amplía con cada dominio; el smoke de FASE 2 los dispara contra el Postgres de DEMO
  con seed regenerable, donde ensuciar no importa.)

### Estado Pagos (hecho, 5º dominio)

3 tablas (Pagos_Paciente, Acciones_Pago, Inconsistencias_Pagos) tras `app/lib/pagos.ts`.
Acciones_Pago e Inconsistencias ya estaban encapsuladas (cero call-sites externos); de
Pagos_Paciente había 5 lecturas casi idénticas en 4 archivos (cola-cobros, kpis/cobros,
copilot ×2, alertas) → consolidadas en UN método tipado `listPagosResumen({desde?, hasta?})`
con periodo opcional. Gate vacío ×2 + tsc 0 + build OK + smoke DEMO (cola-cobros,
kpis/cobros con cifras idénticas a smokes previos, alertas → 200).

### Estado Presupuestos + Clínicas-negocio (hecho, 6º y 7º dominio — el del piloto)

**Presupuestos** (5 tablas: Presupuestos, Contactos_Presupuesto, Doctores_Presupuestos,
Usuarios_Presupuestos, Objetivos_Mensuales) tras `app/lib/presupuestos/` (nuevos `repo.ts`,
`contactos.ts`, `objetivos.ts`, `doctores-repo.ts`). ~45 call-sites migrados: las 17 rutas
del módulo con acceso directo + externas (webhook WhatsApp, portal público, convertir,
cron, procesar, cola-cobros, kpis/cobros, export CSV, ficha paciente, copilot ×7,
alertas, plantillas, db/quotes incl. su literal). **Convención de este dominio: passthrough
máximo** (los callers componen fields/fórmulas idénticos; el repo posee el acceso) — elegida
deliberadamente para paridad con lupa en el módulo del piloto.

**Clínicas-negocio** (mini-dominio, decisión de Simon): tabla "Clínicas" de la base de
NEGOCIO tras `app/lib/clinicas-negocio.ts` (`listClinicasNegocioCamposRaw`), bien
distinguida de la Clínicas de identidad (via `baseCentral`, migra con Identidad). El lookup
copiado ×9 en no-shows quedó en un método; migrados también db/clinics y copilot.

**Paridad con lupa (protocolo pedido por Simon):** goldens pre-cambio de 5 endpoints
(intervención con orden+scoring, KPIs, kanban, máxima, objetivos) y re-captura post. El
primer diff mostró desviaciones SOLO en campos derivados del reloj (`daysSince`,
`urgencyScore`, textos relativos) — la medianoche de Madrid cruzó entre capturas. Prueba
definitiva con captura en el MISMO instante (stash↔pop): **los 5 endpoints byte-idénticos**
entre Airtable-directo y repo. Cola de intervención: mismo orden, mismos scores. Gate doble
vacío + tsc 0 + build OK.

**Escrituras de Presupuestos para el gate de FASE 2** (23): create ×3 (convertir, importar
CSV, kanban), update ×12 (portal aceptar/rechazar, webhook respuesta, kanban edición,
intervención registrar ×2 + mensaje sugerido, contactos contador, copilot ×3, db/quotes),
contactos create ×3, objetivos upsert ×2.

### Barrido final (hecho) — y FASE 1 CERRADA ✅ (2026-07-20)

Cola larga completada: Mensajes_WhatsApp (→ mensajeria), Push_Subscriptions (→ push/sender),
Configuracion_WABA (→ waba-credentials), Notificaciones (→ notificaciones), Cola_Envios
(→ cola-envios-repo nuevo), Informes_Guardados (→ lib/informes nuevo), Plantillas_Mensaje
(→ plantillas, incl. el único destroy), Configuracion_Recordatorios (→ recordatorios-config
nuevo), Historial_Acciones (→ historial/registrar), Alertas_Enviadas (→ alertas/historial,
consolida el create duplicado ×4), Configuraciones_Clinica (→ configuraciones, consolida el
patrón categoría+clínica ×6), e **Identidad completa** (Clínicas central → auth/users;
Usuarios/Usuario_Clinicas ya estaban; Llamadas_Vapi y Conversaciones_Copilot ya tenían home
único).

**GATES GLOBALES FINALES — los tres VACÍOS:**
1. `base(TABLES.*)` fuera de homes de dominio → 0 resultados.
2. Literales `base("Tabla")` fuera de homes → 0 resultados.
3. `baseCentral(` fuera de `lib/auth/` → 0 resultados.

**Cada acceso a Airtable de la app (negocio + identidad) pasa por un repo de dominio.**
Verificación de cierre: tsc 0, build OK, re-diff de los 5 goldens de Presupuestos tras el
barrido → 5/5 idénticos, smoke de 11 endpoints de las zonas tocadas → todos 200.

Escrituras añadidas al registro de FASE 2 por el barrido: push (upsert/desactivar),
configWABA (upsert), notificaciones (marcar leídas en lote), cola_envios (create/update),
informes (upsert ×2), plantillas mensaje (CRUD + destroy), recordatorios (upsert), alertas
coordinación (create ×4 consumidores), configuraciones clínica (upsert horario/llamadas
IA/motor), clínicas central (create/update admin).

**FASE 1: 100% COMPLETA** (cerrada 2026-07-20). FASE 2 autorizada por Simon el mismo día
con orden y gates innegociables (ver §10).

---

## §10 · FASE 2 — Postgres pasa a ser la verdad (EN CURSO, por gates)

Mandato de Simon (2026-07-20): por fases con gates, NO big-bang; los 9 mandamientos son la
definición de "hecho"; Airtable queda read-only como rollback hasta que el QA adversarial
pase; producción no se toca.

### Gate 1 — ANDAMIAJE (hecho, pendiente de revisión de Simon) ✋

**Esquema — una sola fuente** (`scripts/db-schema-spec.mjs` genera SQL y tipos; no pueden
divergir):
- `db/migrations/001_esquema_negocio.sql` — 35 tablas de negocio + 3 de identidad.
- `db/migrations/002_rls.sql` — RLS forzada + rol `fyllio_app`.
- `app/lib/db/types.ts` — interfaz Kysely generada.

**Decisiones de diseño D1-D10** (codificadas y comentadas en la spec — el gate de revisión):
- **D2 (la fuerte): FKs COMPUESTAS `(cliente, id)`** — cada tabla tiene
  `UNIQUE(cliente,id)` y cada link referencia `(cliente, ref)`: un enlace entre clientes es
  estructuralmente imposible. Mata la clase `logAccionLead` a nivel de motor.
- **D4 (mandato enums):** CHECK solo en conjuntos cerrados por los tipos TS (Estado de
  presupuesto, Resultado de ejecución, etc. — fallo EN VOZ ALTA si llega un valor nuevo);
  campos con `typecast:true` en Airtable (extensibles: Metodo/Tipo de pago, plantillas,
  categorías) → TEXT abierto. Decisión POR CAMPO visible en la spec.
- **D7:** UNA tabla `clinicas` (negocio+central unificadas) — el puente por-nombre entre
  las dos tablas Clínicas de Airtable era un artefacto de bases separadas; en un Postgres
  es la misma entidad. `clinicas-negocio.ts` se vuelve trivial al voltear.
- **D8:** espejos de texto → FK reales (`Paciente_RecordId`→`paciente_id`,
  `PresupuestoId`→`presupuesto_id`, clinica-por-nombre→`clinica_id`; los repos traducen
  nombre↔id al voltear). Excepciones documentadas: `eventos_sistema.entidad_id`
  (polimórfico), `cola_envios.presupuesto_ref` (ambigüedad recId/Presupuesto-ID a resolver
  antes de voltear ese flujo), `doctor` como nombre libre.
- **D9:** `usuarios` con política RLS de identidad (`using true` para fyllio_app — el
  login email+PIN es cross-cliente por diseño; control por bcrypt); TODO lo demás exige
  `app.cliente` en contexto.
- D1/D3/D5/D6/D10: cliente NOT NULL en todo; ids TEXT-uuid opacos; JSON-strings quedan
  TEXT (paridad; jsonb es follow-up); lookups se sintetizan por JOIN; timestamptz/date/text
  según formato.

**Conexión** (`app/lib/db/client.ts`): Kysely + pg por el **pooler transaction-mode
(6543)**, sin prepared statements con nombre (gotcha §6, documentado en el archivo), pool
pequeño por instancia, TLS. Usuario `fyllio_app` (LOGIN, **NOBYPASSRLS**). Fail-closed sin
`SUPABASE_DB_URL_APP`.

**Seam de aislamiento** (`app/lib/db/context.ts`): `runWithClienteDb(cliente, fn)` =
transacción + `set_config('app.cliente', $1, true)` (SET LOCAL parametrizado, muere con la
transacción → pooler-safe). `dbActual()` lanza fuera de contexto — espejo exacto del
`base()` fail-closed del Sprint B. RLS: sin SET LOCAL → `current_setting` NULL → 0 filas.

**Guard de CI** (`npm run guard:rls`): service_role prohibida fuera de la allowlist de
analítica (en su primer run cazó el init del Sprint 18 → allowlist); `SUPABASE_DB_URL_ADMIN`
prohibida fuera de scripts de migración. Además 002 hace `revoke` de `anon`/`authenticated`:
las tablas de negocio NO se sirven por la API REST de Supabase.

**Migrador** (`npm run db:migrate` / `db:migrate:dry`): transaccional por archivo, registro
en `_migraciones`, usa `SUPABASE_DB_URL_ADMIN` (solo migraciones); post-paso opcional fija
el password de `fyllio_app` desde `FYLLIO_APP_DB_PASSWORD` (nunca en el repo).

**Env que falta (Simon)**: `SUPABASE_DB_URL_ADMIN` (conexión directa 5432, usuario
postgres — Dashboard→Settings→Database), `FYLLIO_APP_DB_PASSWORD` (password a elegir para
el rol de app) y tras la primera migración `SUPABASE_DB_URL_APP` (pooler 6543 con
`fyllio_app.<project-ref>` + ese password).

**Intocables verificados**: las 3 tablas del motor predictivo no aparecen en ninguna
migración; la analítica sigue con su cliente service-role actual.

### Gate 2 — MIGRACIONES + SMOKE RLS (hecho 2026-07-20) ✅

Aplicado contra el proyecto Sprint 18 (eu-west-1): 001 + 002 en transacción, password de
fyllio_app fijado desde env, `SUPABASE_DB_URL_APP` apuntada al rol `fyllio_app.<ref>`.
Estado del proyecto: 42 tablas en public (3 analítica INTACTAS con recuentos idénticos
antes/después + _migraciones + 38 negocio/identidad), 62 FKs compuestas, 41 tablas con RLS.

**Smoke RLS (npm run db:smoke-rls): 10/10 al primer intento, con el rol de la app:**
sin SET LOCAL → 0 filas e INSERT rechazado (42501) · DEMO inserta y ve lo suyo · RB no ve
ni actualiza filas DEMO · FK compuesta rechaza link RB→clínica-DEMO (23503) · vista D7a
legible sin contexto y con exactamente 5 columnas · fyllio_app sin BYPASSRLS · fyllio_app
sin acceso a la analítica (42501).

Nota de aplicación: el password admin inicial falló (corchetes de plantilla + password
equivocado — diagnosticado sin exponer secretos); resuelto por Simon con reset del
database password.

### Gate 3 — SEED DEMO + PRIMER VOLTEO: dominio Leads (hecho 2026-07-21) ✅

**Flag de volteo 2D** (`app/lib/db/data-backend.ts`): `DATA_BACKEND_PG_DOMINIOS` ×
`DATA_BACKEND_PG_CLIENTES` — un acceso va a Postgres solo si dominio Y cliente están en
ambas listas. Rollback = quitar de la lista. Default vacío: producción intacta.

**Seed por COPIA** (`scripts/db-seed-demo.mjs`): Airtable DEMO → Postgres preservando los
record-ids (ids TEXT) — los goldens comparan los mismos datos y las FKs entre backends
casan durante el volteo escalonado. Este gate: clinicas(4), staff(8), pacientes(25, como
destino de FK), leads(22), acciones_lead(17), plantillas_lead(4). Idempotente, transaccional.

**Volteo Leads**: `app/lib/leads/pg.ts` (implementación Kysely completa, mismos shapes) +
delegación por flag en cada export de leads/acciones/plantillas. El cliente sale del
contexto de `runWithCliente` existente → callers intactos; cada operación abre su
transacción RLS.

**Paridad golden (mismo instante, dos `next start` simultáneos AT vs PG):** los 4
endpoints del dominio (leads, kpis, ultima-saliente, plantillas) → **contenido 100%
idéntico**. Única clase de diferencia: ORDEN DE ITERACIÓN (el view-order de Airtable nunca
fue determinista ni contractual; empates de charts pueden permutar). Decisión: PG ahora es
DETERMINISTA (created_at,id / timestamp,id) — más estable que Airtable. La cola de Actuar
Hoy ordena en cliente por prioridad con inputs idénticos → orden visible sin cambio.

**Escrituras ejercitadas DE VERDAD (7/7 contra el server PG, verificando filas via SQL):**
createLead → fila DEMO con uuid; updateLead (estado+llamado); logAccionLead via
registrar-respuesta → WhatsApp_Saliente en acciones_lead; lectura-tras-escritura en
ultima-saliente; estado del CHECK cerrado acepta "Convertido"; FK a paciente existente ok;
**FK a paciente inexistente RECHAZADA en voz alta (23503)** — el guard funcionando.

**Entanglement documentado**: `convertir` cruza leads(PG)+pacientes(AT)+presupuestos(AT) —
en DEMO volteado fallaría EN VOZ ALTA por FK (por diseño, demostrado en W7). Se ejercita
end-to-end al voltear pacientes (siguiente) y presupuestos. El typecast del Copilot
(prioridad de Simon) se ejercita al voltear Presupuestos. El flag solo está activo en env
local — el DEMO de Vercel sigue en Airtable.

### Gates 5-8 — Agenda, Automatizaciones, Pagos y Presupuestos volteados (2026-07-21) ✅

DEMO corre COMPLETO sobre Postgres+RLS (los 6 dominios del flag). Protocolo idéntico por
dominio: seed por copia → implementación PG → goldens mismo-instante → escrituras reales.

**Causas raíz cazadas por el protocolo** (todas del tipo diasDesdeAceptacion — parar,
causa, re-verificar):
- Campos retro-datados (CreatedAt/Created_At/creado_en) → precedencia campo>createdTime en seed.
- Paciente_Test_Id apunta a id inexistente POR DISEÑO (seguridad modo test) → sin FK (003).
- Auditoría con FK RESTRICT bloqueaba eliminarPago → ON DELETE SET NULL (004) + footgun de
  FK COMPUESTA (SET NULL anulaba cliente NOT NULL) → PG15 SET NULL(pago_id) (005).
- Side-effects fire-and-forget saltados por la delegación (emitirEvento en createLead).
- Contactos huérfanos legacy → presupuesto_id NULLABLE (006); tipo_contacto excedía el set
  TS → abierto (007). D4 funcionando: los datos reales redefinen qué conjuntos están cerrados.
- Doctores_Presupuestos no existe en la base DEMO → paridad del fallback (PG lanza si vacía).

**Presupuestos**: evaluador del subconjunto de fórmulas Airtable en pg.ts — la fórmula de
4 niveles de intervención corre tal cual. Paridad 7/7 (intervención con orden+scoring
byte-idéntico, KPIs, kanban, máxima, objetivos, doctores, tonos). TYPECAST DEL COPILOT
verificado en ambas direcciones: válido aplica; inventado RECHAZADO en voz alta por CHECK
(Airtable lo habría creado en silencio). CONVERTIR CON PRESUPUESTO end-to-end: 3 dominios
en PG con FKs reales.

**Pendiente de volteo (van con RB por PILOT_CLIENTE o superficie diferida):** scheduler
tipado legacy (cron daily/twilio), waitlist activo, mini-dominios menores (mensajes,
notificaciones, plantillas-mensaje, cola_envios, informes, llamadas_vapi, configuraciones,
alertas_enviadas, push, identidad). Sus tablas ya existen en el esquema; el patrón de
volteo está rodado.

### GATE FINAL (QA adversarial Sprint B contra RLS) — PASADO ✅ (2026-07-21)

**Veredicto: cliente↔cliente VERDE — garantía de MOTOR.** Ningún cliente ve,
modifica ni borra datos de otro. Corrido INTENTANDO saltárselo (§5), con datos
reconocibles `[QA_SB]` en RB+INDEP+DEMO, como el rol real `fyllio_app`
(NOBYPASSRLS). Dos harnesses reproducibles (commiteados):

- `scripts/qa-rls-sprint-b.mjs` — motor/RLS, **122/122**: Esc 1 (RB/INDEP/DEMO
  no ven filas de otro en 8 tablas), Esc 1b (UPDATE/DELETE cruzado → 0 filas;
  INSERT estampando otro cliente → 42501 WITH CHECK), Esc 3 (IDOR por id → 0
  filas), Esc 4 (usuario_clinicas/clinicas scoped; `usuarios` cross-cliente POR
  DISEÑO D9), Esc 5 (copilot: mensajes/llamadas/conversaciones → 0), fail-closed
  sin contexto, y COMPLETITUD (38 tablas de negocio con FORCE RLS + política
  `app.cliente`; `usuarios` única permisiva; fyllio_app sin BYPASSRLS ni acceso a
  analítica). Auto-limpieza sin residuos (verificado).
- `scripts/qa-clinica-pg.ts` — Esc 2 (clínica↔clínica) contra el read-path PG
  real (`selectPresupuestosRawPg`) + `formulaClinicaPermitida`/`permiteClinica`
  sobre el seed DEMO, **14/14**: coord de 1 clínica ve solo la suya, de 2 solo
  esas, sin clínicas → 0 (fail-closed), IDOR intra-cliente denegado.
- Regresión: `db:smoke-rls` 10/10 sigue verde.

**⚠️ Aislamiento clínica↔clínica = garantía de CÓDIGO, no de MOTOR (hasta Fase 3).**
RLS solo separa por `app.cliente`. Dentro de un cliente, el motor deja ver TODAS
las clínicas; la barrera la ponen los repos (`clinica-scope.ts`,
`formulaClinicaPermitida`, `verificarPresupuestoPermitido`). Verificado que HOY
filtra bien sobre PG — pero si alguien rompe ese filtro, el motor NO lo respalda.
No es regresión (Sprint B era igual); queda escrito. Subirlo a RLS (2ª variable
`app.clinicas`) es Fase 3.

**Findings del gate (clasificados):**
1. 🟢 **HECHO** — `guard:rls` llevaba ROJO desde gate 3/8: `scripts/db-seed-demo.mjs`
   usa `SUPABASE_DB_URL_ADMIN` (legítimo: bypassa RLS para sembrar DEMO) sin estar
   en el allowlist. Un guard siempre-rojo no caza una violación real (§9) → la red
   de §5 estaba inservible. Fix: `db-seed-demo.mjs` añadido a `ALLOWLIST_ADMIN`.
2. 🟢 **HECHO (2026-07-21)** — era hueco del gate 8: `verificarPresupuestoPermitido`
   y `mapaPresupuestoClinica` (`clinica-scope.ts`) resolvían el presupuesto con
   `base(TABLES.presupuestos).find()` = **Airtable SIEMPRE**, sin delegar por flag,
   aunque el dominio esté volteado a PG. Usado por 7 rutas (historial, contactos,
   registrar-respuesta, enviar-waba, cola-envios, kanban/[id], mensajes). Solo
   afectaba a sesiones de COORDINACIÓN (el admin con `["*"]` devuelve "ok" antes de
   leer). **Muerde DEMO**: las 2 cuentas coord (`demo-coord4`, `demo-coord1`,
   `demo-seed.ts:61-62`) que abran un presupuesto creado en PG tras el volteo →
   Airtable no lo tenía → 404 en acceso legítimo; y permisos leídos de un Airtable
   congelado podían AUTORIZAR por una clínica vieja. **Fix**: los 2 lookups pasan por
   `getPresupuestoPorIdRaw` / `selectPresupuestosRaw` (repos que YA delegan por
   `usaPostgres`) → mismo backend que se sirve. Cubierto en `qa-clinica-pg.ts` con
   prueba DISCRIMINANTE (presupuesto PG-only → coord dueña "ok", ajena "forbidden";
   antes daba "not_found"). Cliente↔cliente sigue respaldado por RLS.
3. 🟡 **Fase 3** — Identidad (usuarios/usuario_clinicas/clínicas central) NO
   volteada: el path vivo del Esc 4 (gestión de usuarios) corre en Airtable. Las
   políticas RLS de identidad en PG están y son correctas (verificado a nivel de
   esquema), pero la app no las toca aún. Además, la resolución id→nombre de clínica
   (`nombresClinicasPermitidas`→`listClinicas`) lee Airtable central: el filtro de
   clínica sobre PG depende de esa identidad Airtable hasta Fase 3.

### Identidad — DIFERIDA al corte (decisión 2026-07-21, con evidencia)

Se evaluó subir identidad primero (para matar el cabo del filtro de clínica, #3).
**Verificado que identidad es el dominio MÁS entrelazado, no el menos** — dos
bloqueos que impiden un volteo DEMO-only por flag:

1. **Login cross-cliente.** `findUsersByEmail` (`users.ts:106`) busca por correo en
   TODOS los clientes sin conocer el cliente. Voltear solo DEMO obliga a consultar
   los dos backends (PG DEMO + Airtable RB/INDEP) y mezclar candidatos → **login
   dual-backend**, lo más delicado del sistema. La alternativa es migrar los 3
   clientes a la vez = migrar ya los usuarios reales de RB/INDEP (lo que se difiere).
2. **Id de clínica de la sesión ≠ id de PG (4/4).** La sesión lleva ids de clínica
   de IDENTIDAD central; PG tiene ids de NEGOCIO (el seed copió de la base de negocio).
   Verificado: Centro `recyfwA8XygnNReoM`(central) vs `recAP3f5g8sr0aYQ8`(PG), y las
   otras 3 igual. Hoy el filtro funciona porque `listClinicas({cliente})` lee central
   (ids que casan) y compara por NOMBRE. Mover `listClinicas` a PG rompe el mapeo
   id→nombre (los ids de la sesión no existen en PG) → coordinadora vería CERO.

**Conclusión:** matar el cabo #3 exige que el login emita sesiones con ids de PG =
identidad completa (usuarios+junction+clínicas con ids reconciliados) sobre PG. Por el
login cross-cliente, eso es dual-backend o migrar los 3 clientes juntos — trabajo del
corte, no un flag. **Decisión (Simon): identidad se voltea como paso ATÓMICO en el
corte** (todos los clientes, ids reconciliados). El cabo #3 queda fail-closed y
documentado hasta entonces (no es fuga).

### Gates siguientes (orden REVISADO 2026-07-21, cada uno se enseña antes de seguir)
- **AHORA — dominios no-entrelazados en LOCAL** (per-cliente, sin el problema de
  identidad; mismo protocolo seed→PG→golden mismo-instante→escrituras): mini-dominios
  (notificaciones, plantillas-mensaje, informes, cola_envios, configuraciones, alertas,
  push), mensajes_whatsapp + llamadas_vapi (Copilot), scheduler legacy (cron
  daily/twilio) + waitlist.
- **DESPUÉS — RB/INDEP (vacías)** detrás.
- **EN EL CORTE — identidad atómica** (los 3 clientes, ids reconciliados) → mata el
  cabo #3. Lo decide Simon con Airtable como rollback y el plan Pro de Supabase resuelto.
- ~~Cerrar #2 antes de RB/INDEP~~ → **HECHO 2026-07-21**. Producción/Vercel siguen
  100% Airtable; el flag vive solo en env local.

### Estado Automatizaciones (hecho, 4º dominio)

5 tablas (Reglas_Automatizacion, Acciones_Automatizacion, Eventos_Sistema,
Secuencias_Automaticas, Configuracion_Automatizaciones) tras `app/lib/automatizaciones/`
(repo.ts ampliado + `secuencias.ts` y `configuracion.ts` nuevos). Migrados: cron
automatizaciones-evaluar (eventos sin procesar, marcar procesado ×3, y
`yaDisparadaRecientemente` MOVIDA al repo — la pieza que el dedup pendiente del nº 9 de
MEJORAS reutilizará), rutas secuencias/configuracion/procesar/seed-demo. Re-verificación
previa: **gates de Leads y Pacientes re-pasados con el grep ampliado (TABLES + literales)
→ ambos vacíos de verdad**. Gate propio vacío ×2 + tsc 0 + build OK + smoke DEMO
(reglas, kpis motor, acciones → 200; secuencias/configuracion devuelven 401 PRE-EXISTENTE
del auth legacy `withPresupuestosAuth` con el harness de smoke — verificado idéntico
pre/post cambio via stash).

### Estado Agenda núcleo (hecho, 3er dominio)

5 tablas (Citas, Tratamientos, Staff, Sillones, Lista_de_espera) tras los repos de
`app/lib/scheduler/repo/` (airtableRepo=Citas, treatmentsRepo, staffRepo, sillonesRepo
nuevo, waitlistRepo). ~35 métodos nuevos; **~47 call-sites en ~30 archivos** migrados:
familia no-shows completa (hoy/riesgo/agenda/acciones/kpis/motor/staff + escrituras
registrar/actualizar-estado/nueva-cita/mover + seeds dev), crons (daily,
automatizaciones-evaluar), webhook Vapi, predictor, llamadas IA, procesar, dashboards
(revenue, noshow-risk), familia demo /api/db (today/gaps/week/recall/ongoing/staff/
treatments/appointments/waitlist), api/waitlist, twilio, 4 mapas de nombres de doctor
(cola-cobros, leads/kpis, kpis/cobros, copilot) y plantillas. Los 7 patrones repetidos del
catálogo quedaron consolidados en un método cada uno (ej.: la ventana de citas de no-shows,
duplicada ×6, es ahora `listCitasDesdeRaw`). Gate grep vacío ×2 + tsc 0 + build OK + smoke
DEMO (cola-cobros, kpis/cobros, leads/kpis, kpis/no-shows → 200). Nota: `/api/db/*` sigue
**fail-closed pre-existente** del Sprint B (sin sesión → error de aislamiento) — sin cambio.

**Lección incorporada al patrón (regla 1 ampliada):** el gate por `TABLES.<clave>` no caza
accesos por string literal (`base("Staff")`); el seeder dev de no-shows llegó a evadir así
el gate de Pacientes (`base("Pacientes")`, cerrado en este dominio). **El gate de cada
dominio grepa AMBAS formas: `TABLES.<clave>` y `base("<NombreTabla>")`.** Queda pendiente
para sus dominios: `base("Clínicas")` (tabla de negocio Clínicas, módulo no-shows) y
`base("Presupuestos")` (db/quotes) — anotados para que sus gates los incluyan.

**Convención de retorno en FASE 1 (explícita):** los métodos `*Raw` devuelven records de
Airtable tal cual cuando el consumidor actual lee fields crudos (superficie diferida
no-shows y demo /api/db). La ganancia de FASE 1 es el punto único de acceso con queries de
intención (SQL-traducibles); el re-tipado de retornos se hace al voltear cada módulo en
FASE 2 — no antes, para no reescribir dos veces.
