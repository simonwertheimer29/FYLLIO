# Sprint A — Blindaje de datos · Plan de ejecución

**Rama:** `sprint-A-blindaje-datos` (desde `main`). Merge a `main` solo tras tu QA.
**Regla por commit:** `npx tsc --noEmit` + `next build` limpios antes de cada commit. Un commit granular por fix, mensaje en inglés.
**Objetivo:** que no se pierda ni se filtre ningún dato. NO toco aislamiento multi-cliente (Sprint B), Postgres, UI, motor de conversión ni la rama Sprint 18.

Orden de ejecución: primero los **[SEGURO]** (los hago y commiteo, contándote cada uno en una frase); luego paro en los **[CHECKPOINT]** y te pregunto antes de tocar nada.

---

## [SEGURO] — los ejecuto en este orden

### 1. P0.5 — Webhook de WhatsApp entrante fiable
**En cristiano:** hoy el sistema le dice "recibido" a Meta y guarda el mensaje después, sin garantía; lo cambio para guardar primero y responder después, así no se pierde ningún WhatsApp de paciente.
- **Archivo:** `app/api/webhooks/whatsapp/route.ts` (líneas 89-94).
- **Cómo:** usar `after()` de Next 16 (import de `next/server`) para el trabajo pesado NO crítico (clasificación IA, notificación), pero **guardar el mensaje de forma síncrona antes del 200** (el `create` en `Mensajes_WhatsApp` y el `preGuardarRespuesta`). Guardo el `WABA_message_id` como parte de esto (enlaza con el punto 3).
- **Riesgo:** el webhook tarda algo más; vigilo que quede muy por debajo del límite de Meta (~20s). Si el guardado tardara, la IA queda en `after()`, no bloquea el 200.
- **Reutiliza:** el helper de dedup KV existente (punto 3).

### 2. P0.6 — Escrituras sin "modo demo" falso
**En cristiano:** hoy, si Airtable falla al guardar un cambio de presupuesto, la pantalla dice "hecho" igualmente y el cambio se pierde; lo cambio para que un fallo sea un fallo visible y la tarjeta vuelva a su sitio.
- **Servidor:** `app/api/presupuestos/kanban/[id]/route.ts:136` (devuelve `{ok:true,demo:true}` con 200 aunque falle) y `app/api/presupuestos/kanban/route.ts:337` (POST crea y devuelve `{presupuesto:null,demo:true}` con 201). → devolver **500 real** ante error.
- **Cliente:** `app/components/presupuestos/PresupuestosShell.tsx:186-211` (`handleChangeEstado`) → comprobar `res.ok` y hacer **rollback puntual**, copiando el patrón que YA funciona en `app/(authed)/leads/LeadsView.tsx:213-227` (guardar estado previo, revertir en catch/!ok, toast de error con `sonner`).
- **Riesgo:** ninguno nuevo; hago visible un fallo que hoy se oculta. Solo el modo demo legítimo (sin Airtable configurado) hay que preservarlo con un flag explícito de entorno, no como fallback de error — te lo señalo si aparece esa ambigüedad.

### 3. P0.7 — Idempotencia en WhatsApp (no duplicar, no perder)
**En cristiano:** evito que un mensaje entrante se procese dos veces (Meta reenvía) y que un envío saliente se mande dos veces si el registro falla.
- **Entrante:** `app/api/webhooks/whatsapp/route.ts:164-172` → sustituir el "consultar-y-crear" (race) por el dedup atómico con KV que ya existe: `isDuplicateMessage()` en `app/lib/scheduler/idempotency.ts`, keyeado por `WABA_message_id`.
- **Saliente:** `app/lib/presupuestos/mensajeria.ts` (`enviarMensaje` ~227↔266, `enviarPlantilla` ~325↔366) → registrar un log "pendiente" **antes** de enviar y actualizarlo tras el envío, con clave de idempotencia para que el reintento no reenvíe. Mismo criterio en `app/api/leads/intervencion/enviar-waba/route.ts:36-47`.
- **Riesgo:** medio-bajo; reordeno la secuencia de un camino frágil. Pruebo doble-POST y reenvío simulado.
- **Reutiliza:** `idempotency.ts` (ya usado por el stack Twilio; lo extiendo al webhook Meta).

### 4. P0.8 — Import de Gesden con clínica
**En cristiano:** hoy los pacientes que importas quedan "sin clínica" y por eso invisibles; lo arreglo para que cada paciente importado quede vinculado a su clínica y no choque con el mismo teléfono de otra.
- **Archivos:** `app/api/import/gesden/route.ts` (añadir `clinicaId` requerido → escribir `Clínica: [clinicaId]`; upsert por teléfono **dentro** de esa clínica, no global — línea 24) y `app/components/import/GesdenImporter.tsx` (añadir selector de clínica, reutilizando el patrón de `ClinicSelector`/`ClinicContext`).
- **Riesgo:** bajo; corrige un flujo hoy roto. No toco el formato CSV ni el parser.

### 5. P0.9 — Crons robustos
**En cristiano:** evito que el cron diario se corte a mitad con 11 clínicas (dejando pacientes sin recordatorio) y que mande mensajes duplicados si se reejecuta.
- **Archivo:** `app/api/cron/daily/route.ts` → añadir `export const maxDuration`, quitar el `sleep(5000)` bloqueante (línea ~232), y dedup de recordatorios/confirmaciones (marca de "ya enviado hoy" por cita, reutilizando el patrón `Procesado` que ya existe en `automatizaciones-evaluar`).
- **Riesgo:** medio; cambia el comportamiento del cron. Lo pruebo con volumen simulado. No cablearé nada que asuma un único número global permanente (Q3).

### 6. P0.4a — Secreto fuera del navegador + fallar cerrado
**En cristiano:** quito un "secreto" que hoy viaja al navegador de cualquiera, y hago que, si en producción falta un secreto de sesión, el sistema falle cerrado en vez de abrirse con una clave pública conocida.
- **Secreto en el bundle:** `app/components/presupuestos/ConfigAutomatizaciones.tsx:617` usa `NEXT_PUBLIC_INTERNAL_API_SECRET` (es un botón de prueba solo-dev). → eliminar el uso; el endpoint `app/api/push/enviar/route.ts` ya falla cerrado si falta el secreto server-side (verificado, líneas 9-12), así que no lo debilito.
- **Fallback público:** el literal `"dev-secret-change-me-in-prod"` aparece en **60 archivos** como fallback de `PRESUPUESTOS_JWT_SECRET`. → centralizar en un único módulo (`app/lib/auth/legacy-secret.ts`) que lea la env y **lance error si falta** (fail-closed, igual que `session.ts` hace con `AUTH_SECRET`), y reemplazar los 60 fallbacks por ese import. Es el fix más extenso del sprint (mecánico, bajo riesgo por archivo, pero muchos archivos).
- **Riesgo:** si `PRESUPUESTOS_JWT_SECRET` no estuviera fijado en Vercel, tras este cambio los módulos legacy fallarían cerrados (correcto) en vez de funcionar con clave pública. **Antes de commitear esto confirmo contigo que la env está fijada en producción** para no tumbar presupuestos sin querer. *(Este es el único [SEGURO] con una mini-confirmación de infra; el código es seguro, pero quiero evitar un susto en prod.)*

---

## [CHECKPOINT] — PARO y te pregunto antes de tocar

### 7. P0.4b — Contraseñas legacy en texto plano
- **Necesito de ti (Q5):** ¿qué ruta de login usan realmente los pilotos? (el PIN unificado `/api/auth/pin-login`, o el login legacy email+password de `/api/presupuestos/auth/login`?). Solo endurezco/migro ESE a bcrypt; los logins legacy que nadie use, los **desactivo** (no los migro). Quito las credenciales demo hardcodeadas (`demo@fyllio.com/demo2024`).
- **No toco ningún login hasta tu respuesta.**

### 8. P0.3 — Cerrar la superficie abierta
- **Necesito de ti (Q2):** ¿qué endpoints alimentan la demo pública que quieres conservar? Voy a autenticar o retirar `/api/db/*`, `/api/dashboard/*`, `/api/scheduler/*`, `/api/whatsapp/send`, `/api/ai-suggestions`, poner firma real en el webhook de Twilio, y cerrar `dev/whatsapp-sim` y `dev/purge`. Como esto **puede romper la demo**, antes de cerrar nada te enseño la lista exacta de qué alimenta la demo (solo datos falsos, según Q2) para no cortar lo que sigues usando para vender.
- **No cierro ningún endpoint hasta tu confirmación.**

---

## Fuera de alcance (anotado para Sprint B/C, no lo toco ahora)
- Aislamiento multi-cliente (bug `legacy-cookies.ts:52` `clinica:null` + filtrado solo client-side en `MaximaView`) → **Sprint B con las dos bases**. Es grave, pero es el sprint siguiente.
- Migración a Postgres, dedup Leads/Presupuestos, capa de repositorio, UI, motor de conversión, rama Sprint 18.
