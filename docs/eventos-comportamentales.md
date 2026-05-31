# Eventos comportamentales — arquitectura (Sprint 18)

Sprint 18 introduce un **log de eventos comportamentales** en Supabase: cada
interacción relevante del ciclo de vida de una cita, lead, presupuesto, mensaje
o llamada se registra como un evento estructurado. Este log es la materia prima
para la analítica del motor de no-shows y, en Sprint 21, para el entrenamiento
del modelo de Machine Learning.

**Principio fundacional: el log NO contiene PII.** Solo IDs estables y metadata
categórica — nunca nombres, teléfonos ni emails. Ver la sección
"[Por qué sin PII](#por-qué-sin-pii)".

## Flujo end-to-end

```
┌─────────────────────────────┐
│ Flujo operacional           │  airtableRepo.ts, acciones.ts, etc.
│  · crear/confirmar/cancelar │
│    cita                     │
│  · asistir / no-show        │
│  · enviar mensaje, llamada  │
└──────────────┬──────────────┘
               │ emitirEventoCitaLifecycle() / emitirEventoFireAndForget()
               ▼
┌─────────────────────────────┐
│ emitter.ts                  │  fire-and-forget, NUNCA bloquea
│  · valida clinica_id        │
│  · valida Supabase config   │
│  · construye la row (IDs +  │
│    jsonb sanitizado)        │
│  · retry 3× backoff lineal  │
└──────────────┬──────────────┘
               │ insert (service role)
               ▼
      ┌─────────────────────┐
      │ Supabase            │  eventos_comportamentales
      │ (service role, RLS) │
      └─────────────────────┘
```

## Componentes

| Capa | Archivos | Responsabilidad |
|---|---|---|
| Schema | `app/scripts/sprint18-bloque1-supabase.sql` | tabla `eventos_comportamentales` + check constraint + índices + RLS |
| Cliente + tipos | `app/lib/supabase/client.ts` | `getSupabaseAdmin`, `isSupabaseConfigured`, tipos `TipoEvento`, `EventoComportamentalRow/Insert` |
| Emitter | `app/lib/eventos/emitter.ts` | `emitirEventoComportamental` (async resiliente), `emitirEventoFireAndForget` |
| Puente Citas | `app/lib/eventos/citas.ts` | `emitirEventoCitaLifecycle` — resuelve contexto sin PII y dispara el evento + cierre de loop |
| Disparadores | `app/lib/scheduler/repo/airtableRepo.ts` | `fireCitaEvento` en create/confirm/cancel/complete/markNoShow |

## Schema de `eventos_comportamentales`

Definido en `app/scripts/sprint18-bloque1-supabase.sql`.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `clinica_id` | `text NOT NULL` | ID de clínica (no PII). Requerido para keying analítico |
| `paciente_id` | `text` | ID de paciente. Opcional (algunos eventos no son por-paciente) |
| `timestamp` | `timestamptz NOT NULL` | `now()` por defecto |
| `tipo_evento` | `text NOT NULL` | uno de los 16 valores del check constraint |
| `contexto` | `jsonb NOT NULL` | metadata categórica, default `{}` |
| `estado_paciente` | `jsonb NOT NULL` | snapshot de estado categórico, default `{}` |
| `resultado_final` | `text` | resultado terminal del flujo (ej. `asistio`, `no_show`) |
| `tiempo_hasta_resultado_seg` | `integer` | latencia hasta el resultado |
| `camino_completo` | `text[]` | secuencia de pasos del flujo |

Índices: por `clinica_id`, `paciente_id`, `tipo_evento`, `timestamp DESC` y el
compuesto `(clinica_id, tipo_evento)`.

### Los 16 tipos de evento (check constraint)

`tipo_evento` está restringido por un **check constraint** (no un enum nativo, a
propósito: permite añadir valores sin migración de tipo). Los 16 valores, tal
cual están en el `.sql` y en el tipo `TipoEvento` de `client.ts`:

| # | `tipo_evento` | Dominio |
|---|---|---|
| 1 | `cita_creada` | Citas |
| 2 | `cita_confirmada` | Citas |
| 3 | `cita_cancelada` | Citas |
| 4 | `cita_no_show` | Citas |
| 5 | `cita_asistio` | Citas |
| 6 | `lead_creado` | Leads |
| 7 | `lead_contactado` | Leads |
| 8 | `lead_respondio` | Leads |
| 9 | `presupuesto_presentado` | Presupuestos |
| 10 | `presupuesto_aceptado` | Presupuestos |
| 11 | `presupuesto_rechazado` | Presupuestos |
| 12 | `mensaje_enviado` | Mensajería |
| 13 | `mensaje_recibido` | Mensajería |
| 14 | `llamada_iniciada` | Voice IA |
| 15 | `llamada_completada` | Voice IA |
| 16 | `accion_cerrada` | Motor / acciones |

> El check constraint y el tipo `TipoEvento` de TypeScript deben mantenerse
> sincronizados. Si se añade un valor, hay que actualizar ambos.

## Cómo emitir un evento

### `emitirEventoFireAndForget(input)` — el patrón normal

Usar desde el flujo operacional. Dispara el evento sin esperar ni propagar
errores:

```ts
emitirEventoFireAndForget({
  tipo: "mensaje_enviado",
  clinica: clinicaId,
  paciente: pacienteId,         // opcional
  contexto: { canal: "whatsapp", plantilla: nombre, origen: "motor_no_shows" },
});
```

### `emitirEventoComportamental(input)` — async, resiliente

Devuelve `Promise<boolean>` (`true` si insertó, `false` si se descartó/falló).
**Resuelve siempre, nunca rechaza.** Útil si necesitás saber el resultado.

### Contrato fire-and-forget (no bloqueante)

El emitter es deliberadamente a prueba de fallos: **emitir un evento NUNCA debe
bloquear ni romper el flujo operacional principal**.

- Si **falta `clinica_id`**: descarta en silencio y devuelve `false` (sin
  `clinica_id` no se puede keyear; no es un error).
- Si **Supabase no está configurado** (`isSupabaseConfigured()` false): descarta;
  en desarrollo avisa por `console.warn`.
- **Retry**: hasta **3 intentos** con **backoff lineal** (250 ms, 500 ms entre
  reintentos). Si tras 3 intentos sigue fallando, loguea el error y devuelve
  `false`.
- Cualquier excepción se captura; el emitter nunca lanza.

Acceso a Supabase: **100% server-side con la SERVICE ROLE key** (que bypassea
RLS). Inicialización lazy del cliente.

## Eventos del ciclo de cita que se emiten hoy

El puente `emitirEventoCitaLifecycle(lifecycle, appointmentRecordId)`
(`app/lib/eventos/citas.ts`) traduce un `CitaLifecycle` a su `TipoEvento` y emite
el evento fire-and-forget. Se dispara desde `app/lib/scheduler/repo/airtableRepo.ts`
vía `fireCitaEvento` (import dinámico, swallow de errores):

| Lifecycle | `tipo_evento` | Disparado desde |
|---|---|---|
| `creada` | `cita_creada` | `createAppointment()` |
| `confirmada` | `cita_confirmada` | `confirmAppointment()` |
| `cancelada` | `cita_cancelada` | `cancelAppointment()` |
| `asistio` | `cita_asistio` | `completeAppointment()` |
| `no_show` | `cita_no_show` | `markNoShow()` |

El `contexto` que se persiste para estos eventos es **categórico y sin PII**:

```ts
contexto = {
  cita_id,                 // ID de cita (no PII)
  tratamiento,             // nombre del tratamiento (categórico)
  fecha_hora_inicio,       // timestamp
  profesional_id,          // ID de staff (no PII)
  origen,                  // canal de captación (categórico)
  estado,                  // estado de la cita (categórico)
}
```

Para `asistio` / `no_show` además se setea `resultadoFinal` y se **dispara el
cierre de loop del predictor** (`cerrarLoopNoShow`), que actualiza
`factores_no_show.resultado_real` y `prediccion_correcta` (ver
`docs/motor-no-shows.md`). El cierre de loop es best-effort y se importa de forma
dinámica para no acoplar el repo al predictor en tiempo de carga.

Otros eventos también se emiten desde el motor de acciones
(`app/lib/no-shows/acciones.ts`): `mensaje_enviado` al enviar una plantilla,
`llamada_iniciada` al programar una llamada IA, y `accion_cerrada` al marcar una
cita como contactada — todos con `contexto` categórico y `origen`
(`motor_no_shows` / `motor_no_shows_auto`).

## Por qué sin PII

El log de eventos guarda **solo IDs estables y metadata categórica**. Nunca
nombres de paciente, teléfonos, emails ni nombres de clínica. Las razones:

1. **Coherencia con la política de anonimización del producto.** Fyllio ya
   anonimiza los nombres de clínica antes de enviarlos a Claude
   (`app/lib/anonimizacion.ts`: real → "Clínica A/B/..." → desanonimizar la
   respuesta). El objetivo —que datos identificables de clientes no salgan ni se
   acumulen fuera de la fuente de verdad— se extiende al log de eventos: si el
   log se usa para analítica o se cruza con servicios de IA, no debe contener
   PII de partida.

2. **Minimización de datos.** El propósito del log es **aprender patrones de
   comportamiento**, no reconstruir personas. Un `paciente_id` + metadata
   categórica (tratamiento, origen, día, hora, resultado) es suficiente para
   entrenar el predictor; el nombre o el teléfono no aportan señal y sí riesgo.

3. **Superficie de exposición reducida.** El acceso a Supabase es server-side con
   la **SERVICE ROLE key**, que por diseño **bypassea RLS**. Aun así, RLS está
   **activado** en las tres tablas con una política explícita `service_role` (los
   filtros `using(true) with check(true)` aplican solo al service role) como
   defensa en profundidad. Hay una política multi-tenant por `clinica_id`
   **preparada y comentada** en el `.sql` para cuando el frontend consuma
   Supabase directamente con la ANON key + JWT (el JWT deberá incluir un claim
   `clinica_id`). Mantener el log sin PII hace que esa apertura futura sea segura
   por defecto.

El contrato es explícito en el código: el **caller es responsable** de pasar solo
IDs y datos sanitizados en `contexto` / `estadoPaciente`; el emitter no inspecciona
ni filtra el contenido del jsonb. El puente `citas.ts` cumple este contrato
construyendo el `contexto` solo con IDs y campos categóricos.

## Las otras tablas del schema

`sprint18-bloque1-supabase.sql` crea tres tablas, todas sin PII y con RLS +
política `service_role`:

- **`eventos_comportamentales`** (esta doc) — log de eventos.
- **`factores_no_show`** — predicción de riesgo por cita con cierre de loop
  (`resultado_real`, `prediccion_correcta`). Detallada en
  `docs/motor-no-shows.md`.
- **`patrones_aprendidos`** — **preparada para Sprint 21 (ML)**, sin uso en
  Sprint 18. Almacenará patrones aprendidos (globales o por clínica) con su
  `precision_actual` y `veces_aplicado`.
