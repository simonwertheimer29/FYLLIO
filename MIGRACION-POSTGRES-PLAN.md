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
- **Doble flag de opt-out**: `Opt_Out` (scheduler/Twilio STOP) vs
  `Optout_Automatizaciones` (motor de reglas) — dos opt-outs paralelos que nada unifica;
  un paciente que dice STOP por Twilio sigue opted-in para el motor. Decisión de
  producto pendiente.
- (De Leads, ya anotado): `crear_accion_lead` del motor escribe campos
  `Tipo`/`Descripcion` que no coinciden con los de `logAccionLead`
  (`Tipo_Accion`/`Detalles`).
