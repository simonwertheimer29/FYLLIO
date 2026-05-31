# Motor de No-shows — arquitectura (Sprint 18)

Sprint 18 entrega el **motor de predicción de no-shows v0**: un predictor
heurístico ponderado que evalúa el riesgo de que un paciente falte a su cita,
persiste la predicción en Supabase, cierra el loop contra el resultado real y
ofrece acciones de mitigación. La evolución a un modelo de Machine Learning
real queda para Sprint 21 (la tabla `patrones_aprendidos` ya está preparada).

El predictor es **v0 = heurístico**: pesos diseñados a mano, transparentes y
auditables. No hay entrenamiento ni modelo estadístico todavía. La razón es que
sin un volumen mínimo de citas cerradas (asistió / no-show) no hay señal para
entrenar nada; mientras tanto un heurístico explicable es más útil y más seguro
que una caja negra.

## Flujo end-to-end

```
┌─────────────────────────────┐
│ Ciclo de vida de la Cita    │  app/lib/scheduler/repo/airtableRepo.ts
│  · createAppointment()      │──┐
│  · updateAppointment()      │  │  (solo si cambia Hora inicio = reagenda)
│    (reagenda)               │  │
└─────────────────────────────┘  │ fireEvaluarRiesgo() fire-and-forget
                                  ▼
┌─────────────────────────────┐
│ /api/cron/daily             │  reevaluarCitasProximas({ horasAdelante: 48 })
│ (Vercel cron, 1×/día)       │──┐  re-evalúa todas las citas en ventana now→+48h
└─────────────────────────────┘  │
                                  ▼
                       ┌───────────────────────────────┐
                       │ evaluarRiesgoNoShow(citaId)   │  lib/no-shows/predictor.ts
                       │  1. lee Cita (Airtable)       │
                       │  2. historial paciente        │
                       │  3. datos paciente            │
                       │  4. 8 factores ponderados     │
                       │  5. score = base + Σpesos     │
                       │  6. nivel + acción recomendada│
                       │  7. persiste (best-effort)    │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │ Supabase        │  factores_no_show
                              │ (service role)  │  (1 predicción "actual"/cita)
                              └─────────────────┘
                                       ▲
                                       │ cierre de loop
┌─────────────────────────────┐       │ resultado_real + prediccion_correcta
│ Ciclo de vida de la Cita    │       │
│  · completeAppointment()    │───────┤  cerrarLoopNoShow(citaId, "asistio")
│  · markNoShow()             │───────┘  cerrarLoopNoShow(citaId, "no_show")
└─────────────────────────────┘
```

## Componentes

| Capa | Archivos | Responsabilidad |
|---|---|---|
| Schema Supabase | `app/scripts/sprint18-bloque1-supabase.sql` | `factores_no_show`, `eventos_comportamentales`, `patrones_aprendidos` + RLS |
| Cliente + tipos | `app/lib/supabase/client.ts` | `getSupabaseAdmin`, `isSupabaseConfigured`, tipos `FactorNoShowRow`, `RiesgoNivel`, `FactorPonderado` |
| Predictor v0 | `app/lib/no-shows/predictor.ts` | `evaluarRiesgoNoShow`, `cerrarLoopNoShow`, `reevaluarCitasProximas`, `nivelFromScore`, `accionRecomendadaPorNivel` |
| Acciones | `app/lib/no-shows/acciones.ts` | `aplicarAccionNoShow` (manual), `estaContactado`, `aplicarAccionesAutomaticasNoShow` (librería, no cableada al cron) |
| Configuración | `app/lib/no-shows/config.ts` | `getMotorConfig`, `setMotorConfig`, `MOTOR_NO_SHOWS_DEFAULT` (persistido en `Configuraciones_Clinica`) |
| Disparadores | `app/lib/scheduler/repo/airtableRepo.ts` | `fireEvaluarRiesgo` al crear/reagendar; `cerrarLoopNoShow` vía `emitirEventoCitaLifecycle` al asistir/no-show |
| Cron | `app/api/cron/daily/route.ts` | re-evalúa citas próximas (ventana +48h) 1×/día |

## El predictor v0 (heurístico)

### Cálculo del score

```
score = clamp( SCORE_BASE + Σ(peso de cada factor aplicable) , 0 , 100 )
```

- **`SCORE_BASE = 30`**: punto de partida neutral. Una cita sin ninguna señal de
  riesgo arranca en 30 (nivel bajo).
- Cada uno de los 8 factores devuelve un **peso** (positivo sube el riesgo,
  negativo lo baja) o `null` si el dato no está disponible — en ese caso el
  factor **no aplica** (peso 0, no penaliza ni premia).
- La suma se acota a `[0, 100]` con `Math.max(0, Math.min(100, ...))`.

### Los 8 factores y sus pesos exactos

Pesos copiados literalmente del código (`app/lib/no-shows/predictor.ts`).

| # | Factor (`factor`) | Condición / valor | Peso |
|---|---|---|---|
| 1 | `historico_no_shows` | 0 no-shows previos | **−10** |
|   |  | 1 no-show | **+20** |
|   |  | 2 no-shows | **+35** |
|   |  | 3 o más | **+50** |
| 2 | `historico_cancelaciones` | 0 cancelaciones | **0** |
|   |  | 1-2 cancelaciones | **+10** |
|   |  | 3 o más | **+20** |
| 3 | `tiempo_agendamiento` | reservada <24h antes | **−5** |
|   | (días entre `createdTime` y `Hora inicio`) | 1-7 días | **0** |
|   |  | 8-30 días | **+10** |
|   |  | >30 días | **+25** |
| 4 | `dia_semana` | lunes mañana (<14h) | **+10** |
|   |  | viernes tarde (≥14h) | **+5** |
|   |  | sábado | **+15** |
|   |  | resto | **0** |
| 5 | `hora` | antes de las 9h | **+10** |
|   |  | mediodía (13-15h) | **+5** |
|   |  | resto | **0** |
| 6 | `tipo_tratamiento` | urgencia / dolor | **−20** |
|   |  | cosmético (blanqueamiento, estética, carillas, diseño de sonrisa) | **+10** |
|   |  | tratamiento en curso (ortodoncia, implante, endodoncia, periodoncia, prótesis) | **−10** |
|   |  | revisión periódica (con historial previo) | **+20** |
|   |  | primera revisión (sin historial) | **+15** |
|   |  | otro | **0** |
| 7 | `origen_lead` | referido | **−10** |
|   | (canal de captación del paciente) | pago (Facebook, Instagram, Google Ads) | **+10** |
|   |  | web (orgánico, landing, directa, WhatsApp) | **0** |
|   |  | reactivado | **+20** |
|   |  | otro / desconocido | *no aplica* |
| 8 | `edad` | <25 años | **+15** |
|   |  | 25-50 años | **0** |
|   |  | 51-65 años | **−5** |
|   |  | >65 años | **+10** |

Notas sobre cómo se obtiene cada dato:

- **Histórico (factores 1 y 2)**: se buscan todas las citas pasadas del paciente
  por teléfono (`Paciente_teléfono` o `Paciente_tutor_teléfono`, hasta 200
  registros). Un no-show es `Estado` ∈ {NO_SHOW, NO SHOW, NOSHOW} **o** un
  cancelado cuya nota contiene `[NO_SHOW]`. Una cancelación es cualquier otro
  `Estado` cancelado.
- **`tiempo_agendamiento`**: usa el `createdTime` del registro de Airtable vs.
  la `Hora inicio`. Si no hay `createdTime` válido el factor no aplica.
- **`dia_semana` / `hora`**: derivados de `Hora inicio` en la zona `ZONE`
  (Europe/Madrid).
- **`tipo_tratamiento`**: clasificación por regex sobre `Tratamiento_nombre`.
- **`origen_lead`**: campo `Canal_Origen` del registro del paciente.
- **`edad`**: campo `Edad` (number) o derivada de `Fecha_Nacimiento` /
  `Fecha de nacimiento` del paciente.

### Niveles de riesgo

`nivelFromScore(score, umbralAlto)`:

| Rango de score | Nivel |
|---|---|
| 0 – 30 | **bajo** |
| 31 – `umbralAlto` | **medio** |
| > `umbralAlto` | **alto** |

- El umbral medio es fijo (**30**).
- El umbral alto es **configurable** por clínica (`umbralRiesgoAlto`, default
  **60**). Con el default: 0-30 bajo, 31-60 medio, 61-100 alto.

### Acciones recomendadas por nivel

`accionRecomendadaPorNivel(nivel)` devuelve un texto descriptivo (lo que la UI
muestra como sugerencia, no una acción que se ejecute sola):

| Nivel | Acción recomendada |
|---|---|
| **alto** | Recordatorio 48h + llamada IA + recordatorio 2h + alerta overbooking |
| **medio** | Recordatorio 24h + recordatorio 2h + plantilla personalizada |
| **bajo** | Recordatorio estándar |

## Persistencia y cierre de loop

### Persistencia (`factores_no_show`)

`evaluarRiesgoNoShow(citaId, { persist: true })` guarda **una sola predicción
"actual" por cita** mediante un `upsert` atómico con `onConflict: "cita_id"`
(índice único `ux_factores_cita`). Cada re-evaluación sobreescribe la fila previa
sin race condition y reabre el loop (`resultado_real`/`prediccion_correcta` a `null`).

La fila persiste: `cita_id`, `paciente_id`, `clinica_id`, `riesgo_score`,
`riesgo_nivel`, el array `factores` (cada uno `{factor, peso, valor}`),
`accion_recomendada` y `evaluado_at`. La persistencia es **best-effort**: si
Supabase no está configurado o falla, se loguea y la evaluación se devuelve
igual (nunca bloquea el flujo).

### Cierre de loop (`cerrarLoopNoShow`)

Cuando la cita se marca como asistió o no-show, `cerrarLoopNoShow(citaId,
resultado)` busca la última predicción persistida y la actualiza con:

- **`resultado_real`**: `"asistio"` o `"no_show"`.
- **`prediccion_correcta`** (boolean):
  - `no_show` → correcta si `riesgo_nivel === "alto"`.
  - `asistio` → correcta si `riesgo_nivel !== "alto"` (bajo o medio).

Si no había predicción previa para la cita, no hace nada. Es best-effort: nunca
lanza. Este cierre es lo que alimentará el cálculo de precisión y, en Sprint 21,
el entrenamiento del modelo ML.

## Dónde y cuándo se evalúa

| Disparador | Dónde | Cuándo |
|---|---|---|
| **Al crear** | `createAppointment()` → `fireEvaluarRiesgo()` | toda cita nueva |
| **Al reagendar** | `updateAppointment()` → `fireEvaluarRiesgo()` | solo si cambia `Hora inicio` |
| **Cron daily** | `/api/cron/daily` → `reevaluarCitasProximas({ horasAdelante: 48 })` | 1×/día, todas las citas en ventana now→+48h (excluye canceladas/no-show) |
| **Cierre de loop** | `completeAppointment()` / `markNoShow()` → `emitirEventoCitaLifecycle` → `cerrarLoopNoShow()` | al asistir / no-show |

Todas las evaluaciones disparadas desde el ciclo de vida de la cita son
**fire-and-forget**: import dinámico + `.catch()` que traga el error, para no
acoplar el repo a Supabase en tiempo de carga ni romper el flujo operacional.

## Configuración (Motor_NoShows)

`getMotorConfig(clinicaId)` / `setMotorConfig(clinicaId, patch)` leen/escriben en
`Configuraciones_Clinica` con `Categoria = "Motor_NoShows"` y `Valor = JSON`
(mismo patrón que `horario_laboral` / `Llamadas_IA`). Resolución en cascada:
**config de la clínica → config global (sin `Clinica_Link`) → defaults del
producto**.

| Toggle | Tipo | Default | Efecto |
|---|---|---|---|
| `activarPrediccion` | boolean | **true** | Activa la evaluación + persistencia y habilita las acciones automáticas |
| `llamadaIaAuto` | boolean | **false** | Programar llamada IA automática para riesgo alto |
| `plantillasExtraAuto` | boolean | **true** | Envío automático de plantillas extra (medio/alto) |
| `umbralRiesgoAlto` | number 0-100 | **60** | Score por encima del cual una cita es riesgo alto |

`setMotorConfig` hace upsert respetando el scope: nunca pisa la config global con
una de clínica ni al revés.

## Acciones de mitigación

`aplicarAccionNoShow({ citaId, accion, manual?, plantillaNombre? })` ejecuta una
acción concreta (los botones de las cards en la UI):

| Acción | Qué hace |
|---|---|
| `programar_llamada_ia` | Llama `iniciarLlamada()` (confirmación). Hereda las salvaguardas de Voice IA |
| `enviar_plantilla_recordatorio` | Envía una plantilla WhatsApp (default `recordatorio_personalizado_alto_riesgo`) |
| `considerar_overbooking` | Crea una alerta a coordinación (`Alertas_Enviadas`, urgencia media) |
| `marcar_contactado` | Marca la cita como contactada (flag KV 14 días) para que la UI no la re-sugiera |

`estaContactado(citaId)` devuelve si la cita fue marcada como contactada (flag
KV). Nunca lanza.

## Salvaguardas

- **Opt-out del paciente**: `enviarPlantilla` consulta
  `paciente.optoutAutomatizaciones` y aborta si el paciente optó por no recibir
  automatizaciones (motivo `paciente_optout`).
- **Cooldown de plantilla extra**: máximo **1 plantilla extra cada 24h** por
  paciente (flag Vercel KV `noshow:plantilla-extra:{pacienteId}`). Se respeta
  también en envíos manuales para evitar spam.
- **Salvaguardas heredadas de Voice IA**: `programar_llamada_ia` delega en
  `iniciarLlamada()`, que aplica internamente sin teléfono, opt-out, cooldown
  24h, cooldown 1×/día, ventana horaria, horario laboral de la clínica, límite
  diario por clínica y pausa automática (ver `docs/voice-ia-architecture.md`).
- **Logs / auditoría en Supabase**: cada predicción queda en `factores_no_show`
  y cada acción ejecutada emite un evento en `eventos_comportamentales`
  (`mensaje_enviado`, `llamada_iniciada`, `accion_cerrada`), siempre **sin PII**
  (ver `docs/eventos-comportamentales.md`).

## Limitaciones conocidas v0

- **Factor `edad` prácticamente inactivo**: la tabla `Pacientes` no tiene hoy
  `Edad` ni `Fecha_Nacimiento` poblados de forma fiable, así que el factor casi
  siempre devuelve `null` (no aplica). El código ya lo soporta para cuando el
  dato exista.
- **Auto-aplicación de acciones DESHABILITADA desde el cron**: la librería
  `aplicarAccionesAutomaticasNoShow` existe y respeta los toggles
  (`llamadaIaAuto`, `plantillasExtraAuto`), pero **NO está cableada al cron
  daily** en este sprint. La decisión de diseño es no duplicar la mensajería con
  los recordatorios/confirmaciones que ya manda el cron existente. Hoy el cron
  solo **re-evalúa y persiste** el riesgo; las acciones se disparan
  **manualmente** desde la UI vía `aplicarAccionNoShow`.
- **Heurístico, no ML**: los pesos son fijos y no aprenden. El cierre de loop ya
  acumula la señal (`resultado_real` / `prediccion_correcta`) para medir
  precisión y, más adelante, entrenar.
- **Histórico por teléfono**: el match de citas pasadas es por teléfono del
  paciente/tutor, limitado a 200 registros. Pacientes sin teléfono no tienen
  histórico (factores 1 y 2 quedan en sus valores de "0 previos").
- **Una predicción por cita**: el `upsert` por `cita_id` no guarda el historial
  de re-evaluaciones de una misma cita; solo la última (vigente). Para auditar la
  evolución habría que cambiar a append + flag de "vigente".

## Evolución a ML (Sprint 21)

La tabla `patrones_aprendidos` (en `sprint18-bloque1-supabase.sql`) ya está
creada y sin uso en Sprint 18. Está pensada para almacenar patrones aprendidos
(globales o por clínica) con su `precision_actual` y `veces_aplicado`. En
Sprint 21:

1. Se usará el histórico de `factores_no_show` (predicción vs `resultado_real`)
   como dataset de entrenamiento.
2. Los eventos de `eventos_comportamentales` aportarán señal adicional de
   comportamiento del paciente.
3. El predictor heurístico v0 seguirá como baseline / fallback mientras el
   modelo no alcance una precisión superior demostrada.
