---
name: fyllio-lecciones-ingenieria
description: Lecciones de INGENIERÍA de Fyllio destiladas de errores reales ya pagados (auditoría técnica + sprints A/B). Son reglas técnicas obligatorias, no un historial. Úsalo SIEMPRE que escribas o modifiques código de backend o de datos — rutas API, webhooks, crons, scripts, acceso a Airtable/Supabase/KV, mensajería (WhatsApp, llamadas, notificaciones), autenticación, sesiones o filtros de acceso — aunque el cambio parezca pequeño o sea solo un fix. Hermano de fyllio-esencia-producto (qué se construye y para qué) y fyllio-estandar-visual (cómo se ve): este dice cómo se construye por dentro para no perder, inventar ni filtrar un dato.
---

# Lecciones de ingeniería de Fyllio

Esto **NO es un historial** — el historial vive en [`DECISIONES.md`](../../../DECISIONES.md),
en la raíz del repo. Estas son las reglas destiladas de errores que **ya pagamos una vez**:
en la auditoría técnica ([AUDITORIA_FABLE.md](../../../AUDITORIA_FABLE.md)), en el QA de los
sprints A/B, o en producción. Cada mandamiento lleva una línea con el error real que nos lo
enseñó. Si tu código incumple uno, no está listo — aunque funcione en la demo.

Contexto que lo explica todo: Fyllio maneja **datos de salud de dos clientes legalmente
separados**, en **serverless (Vercel)**, sobre **Airtable multi-base**. Los tres pecados
capitales son: **perder un dato, inventar un dato, y enseñar un dato a quien no debe verlo.**

## Los mandamientos

### 1. Persiste antes de confirmar éxito
Nada responde "hecho" (un 200, un `{ok:true}`, un toast) hasta que el dato está escrito y
confirmado. En serverless, el trabajo posterior a la respuesta solo existe dentro de
`after()`/`waitUntil`, y solo para lo prescindible (clasificación IA, notificaciones) —
nunca para persistencia. Si llamas a un tercero (Meta, Vapi), registra ANTES de llamar.
> **Nos lo enseñó:** el webhook de WhatsApp respondía 200 a Meta y guardaba "en segundo
> plano" sin `await` — mensajes de pacientes perdidos sin rastro ni reintento (S1); y el
> kanban decía "hecho" con el update de Airtable fallado (S2).

### 2. Idempotencia en todo lo que envía mensajes o crea registros
Los reintentos ocurren siempre: Meta reentrega, la coordinadora vuelve a pulsar, el cron se
reejecuta. Todo envío y toda creación llevan clave de idempotencia o dedup **atómico**
(nunca "consultar y luego crear"), y los flujos multi-paso se pueden reintentar sin duplicar
lo ya hecho.
> **Nos lo enseñó:** pacientes recibiendo el mismo WhatsApp dos veces (S3), dedup de
> entrantes con race (S4), el cron que duplicaba recordatorios al reejecutarse (S11) y la
> conversión lead→paciente que creaba presupuestos duplicados a mitad de fallo (S8).

### 3. Fail-closed siempre
Sin contexto, sin secreto o sin permiso → error, nunca un default permisivo. Un
`if (secret && ...)` es una puerta abierta cuando falta la variable; un "sin clínica"
tratado como "sin filtro" es una fuga de datos. Si el fail-closed rompe rutas que dependían
del default, ese ruido es el objetivo: mejor romper en QA que filtrar en producción.
> **Nos lo enseñó:** `clinica: null` interpretado como "ver todas las clínicas" — el riesgo
> nº1 de la auditoría; crons abiertos si faltaba `CRON_SECRET`; el JWT legacy con fallback
> público `"dev-secret-change-me-in-prod"`.

**Matiz (también pagado):** fail-closed aplica a decisiones de **acceso y datos**. Una
defensa auxiliar caída se degrada con log, no tumba la puerta principal: el rate limiter
con KV inaccesible bloqueaba el login entero y se degradó a memoria (`ba9daea`).

### 4. Nunca datos falsos como fallback de error
Un fallo devuelve un error visible (500 real en la API, `ErrorState` en la UI). Jamás datos
demo, jamás un empty state que haga pasar el fallo por "no hay nada". Los datos inventados
destruyen la confianza en todos los datos verdaderos.
> **Nos lo enseñó:** ~13 endpoints devolvían presupuestos y pacientes inventados si Airtable
> fallaba (S12), y un fallo de red se pintaba como "¡todo cobrado!" en Cobros.

### 5. Todo filtro de acceso se prueba intentando saltárselo
Un filtro que nadie ha intentado romper es decorativo. QA de acceso = intentar activamente
ver lo prohibido — otro cliente, otra clínica, enumerar IDs (`?presupuestoId=`), llamar sin
sesión — y verificar 403/404. Siempre con datos seed reconocibles: un entorno vacío da
falsos aprobados.
> **Nos lo enseñó:** `canAccessClinica()` llevaba meses escrito con CERO usos mientras había
> IDOR reales; el aislamiento del Sprint B solo se dio por válido tras 5 escenarios
> adversariales (SPRINT-B-QA.md).

### 6. Los caminos sin sesión resuelven su contexto explícitamente
Webhooks, crons y scripts no tienen sesión de la que derivar cliente/base/clínica. Su
contexto se declara **explícito en el punto de entrada** (p. ej. `PILOT_CLIENTE`, un
parámetro del job) — nunca se hereda de un singleton ni de un default global. Y `base()`
sin contexto lanza error (mandamiento 3).
> **Nos lo enseñó:** el patrón "sin clínica = todas" nació de rutas que asumían un contexto
> que nadie establecía; el Sprint B enrutó cada entrada sin sesión a un cliente explícito
> (`ac59f4e`).

### 7. Verifica la causa en el código real antes de arreglar
No se arregla de oídas ni por patrón ("esto suele ser X"). Se abre el archivo, se localiza
la línea culpable, y el fix la cita (`archivo:línea`). Si no puedes señalar la causa en el
código, todavía no sabes qué estás arreglando.
> **Nos lo enseñó:** el cron "lento" no era "Airtable saturado": era un `sleep(5000)` por
> llamada sin `maxDuration`, y solo apareció leyendo el código del cron. Toda la auditoría
> siguió esta regla ("revisión de código real, no asunciones") y por eso cada hallazgo fue
> accionable.

### 8. Los links de Airtable no cruzan bases — verifícalos al mover tablas
Un linked record solo puede apuntar a registros de **su misma base**. Al separar o mover
tablas entre bases (o crear una base nueva), se audita cada linked field que las
relacionaba: o la tabla viaja con él, o el campo pasa a texto plano (id como string), o se
elimina — pero nunca se deja apuntando al viejo id de otra base.
> **Nos lo enseñó:** tras la separación de bases del Sprint B, `logAccionLead` seguía
> escribiendo el link `Usuario` con un record id de la base central → el `create` fallaba
> SIEMPRE (`app/lib/leads/acciones.ts:53`).

### 9. Los fallos nunca son silenciosos
Fire-and-forget "para no romper el flujo principal" solo es aceptable si el fallo queda
**observable**: log con contexto suficiente para actuar y, si el fallo es sistemático
(falla el 100% de las veces), tiene que acabar delante de alguien — no enterrado en un
`console.error` que nadie lee. Un catch que traga convierte un bug de un día en semanas de
datos perdidos.
> **Nos lo enseñó:** el fallo del mandamiento 8 vivía en un catch silencioso — el registro
> de acciones llevaba roto desde la separación de bases, y con él el KPI de tiempo de
> respuesta, sin que nadie lo supiera.

## Checklist antes de dar por bueno un cambio de backend

- [ ] ¿Todo "éxito" que comunico está **persistido antes** de comunicarse? (§1)
- [ ] ¿Qué pasa si esto se ejecuta **dos veces**? ¿Duplica mensajes o registros? (§2)
- [ ] Si falta contexto/secreto/permiso, ¿esto **falla con error** o cae a un default? (§3)
- [ ] Ante un fallo de la fuente de datos, ¿el usuario ve un **error honesto**? (§4)
- [ ] Si toqué un filtro de acceso, ¿**intenté saltármelo**? (§5)
- [ ] Si el código corre sin sesión, ¿su cliente/base es **explícito**? (§6)
- [ ] ¿Puedo citar `archivo:línea` de la causa que estoy arreglando? (§7)
- [ ] Si toqué esquema/bases de Airtable, ¿revisé los **linked fields** afectados? (§8)
- [ ] ¿Algún catch de este cambio puede **tragarse un fallo sistemático**? (§9)

## Cómo crece este skill

Cuando se pague un error nuevo: el **qué pasó** se anota en `DECISIONES.md` (2-4 líneas,
mismo cambio que lo cierra); si además destila una **regla general** que el código nuevo
debe cumplir, se añade aquí como mandamiento con su línea de "Nos lo enseñó". Las
referencias S1-S12 son de la tabla de fiabilidad de
[AUDITORIA_FABLE.md](../../../AUDITORIA_FABLE.md) (§Área 4).
