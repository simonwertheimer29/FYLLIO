# Diagnóstico estratégico del producto — 6 de septiembre de 2026

Lectura del código completo con la visión delante («tu software registra lo que ocurrió; nosotros
conseguimos que ocurra lo siguiente») y la tesis de inteligencia operativa. Sin tocar código.
Cada nota lleva su evidencia. **Aprobado por Simon el 6 de septiembre de 2026.** Este documento es
la foto; lo vivo está en [`PLAN-MAESTRO.md`](PLAN-MAESTRO.md) (fases, estado, bloqueantes, censo) y
en [`MARCADOR-MISION.md`](MARCADOR-MISION.md) (las notas y su historia). Las tareas son las
MEJORAS 162-205.

Fuentes leídas: las 35 migraciones de `db/migrations`, `lib/agente/*`, `lib/automatizacion/*`,
`lib/automatizaciones/*`, `lib/inicio/*`, `lib/integrations/gesden/*`, `lib/eventos/*`,
`lib/supabase/*`, `lib/db/*`, `lib/contacto/optout`, `lib/copilot/*`, el webhook de WhatsApp, los
crons, `evals/`, `PLAN-AGENTE.md`, `PLAN-AGENTE-OFENSIVO.md`, `CONSULTA-LEGAL-AGENTE.md`,
`MEJORAS-PENDIENTES.md`, `DECISIONES.md` (últimas 30 entradas), `INVESTIGACION-MERCADO-2026-07.md`.

Tamaño del sistema: 118.720 líneas TS/TSX/MTS, 1.025 commits desde diciembre de 2025,
39 tablas de negocio, 130 rutas API, 40 pantallas.

---

## Veredicto en tres líneas

1. **El cerebro está bien construido y la visión NO está cerrada por la arquitectura.** La frontera
   «el modelo juzga, el código decide», el log append-only con taxonomía en CHECKs y el semáforo por
   hechos del sistema son exactamente los cimientos que la visión necesita.
2. **Lo que falta para «inteligencia operativa» no es modelo, es contabilidad**: versión del prompt,
   entrada renderizada, eslabón acción→resultado por id, serie temporal y marca de encendido.
   Todo barato hoy; dos de esas cinco cosas son irrecuperables si se dejan un año.
3. **La integración con el ERP no existe** (un importador CSV y un stub que lanza), y **nada sale
   solo hacia el paciente** en producción. Esas dos cosas son las que separan el producto actual de
   la tesis, y la primera no arranca sin RB.

---

## 1 · Dónde estamos (0–5, con evidencia)

| Área | Nota | Resumen |
|---|---|---|
| Integración ERP y canales | **1** | WhatsApp Meta entrada/salida sólido; Gesden = CSV + stub |
| Modelo de datos | **2,5** | Log del agente excelente; «oportunidad» y «acción» no son entidades; tres logs de eventos |
| Fiabilidad del agente | **3,5** | Idempotencia, fail-closed, juez + veto; sin reintento ni cola de trabajos |
| Derivación | **4** | Causas, cola, cierre por hecho, ficha; sin propietario nominal ni escalado |
| Cumplimiento | **2** | RLS y opt-out bien; sin borrado, consentimiento, aviso de IA ni DPA |
| Observabilidad | **2** | Campana y coste por turno; no se puede reproducir una decisión pasada |
| Resultados | **2** | «Llegó cocinado» heurístico por ventana; nada enlazado por id; sin línea base |
| Experimentación | **1,5** | Harness serio (67 casos, anotación ciega); cero versionado en producción |
| Multi-sede | **2,5** | Tenant por RLS, config por clínica con default de red; excepción todo-o-nada; `PILOT_CLIENTE` |
| Inteligencia de dirección | **2** | Inicio operativo con delta 7d y coste; cero anomalías, cero recomendación |

### 1.1 Integración con ERP y canales — 1

**Qué existe.** `lib/integrations/gesden/connector.ts` define una interfaz `GesdenConnector`
(pacientes, citas, tratamientos) con dos implementaciones: CSV (recibe arrays ya parseados) y API,
que lanza `"not yet activated"`. `columnMap.ts` solo mapea columnas de **pacientes**. Es decir:
hoy leemos de Gesden un CSV de pacientes que alguien exporta a mano; citas, presupuestos y cobros
del ERP no se leen, y no se escribe nada de vuelta. Canales: WhatsApp por Meta con webhook robusto
(lote entero, todos los tipos, dedup en base con `ON CONFLICT`, KV después de persistir,
`maxDuration 60`) y salida por Graph API con clave de idempotencia; Vapi para confirmación de citas
por voz; Google Calendar como primer conector de **agenda externa de solo lectura** con modelo
genérico (`agendas_externas`, `ocupaciones_externas`, 033). Twilio queda apagado
(`CRON_TWILIO_WHATSAPP`).

**Lo máximo posible con Gesden G5 sin API pública.** La vía real, la que ya usan EBROTECH e ImaCash
según `INVESTIGACION-MERCADO §2`: un **lector local** (servicio Windows en el servidor de la
clínica) que consulta SQL Server en solo lectura, sube deltas por polling incremental a una API de
ingesta de Fyllio con clave de tenant, con el esquema fijado por versión de Gesden y bajo art. 28 +
NDA. **Escritura de vuelta por base de datos: nunca** (riesgo de corromper y de licencia). El
patrón correcto ya lo tenemos inventado en el semáforo: **«Fyllio propone, Gesden confirma»** — la
cita o el cobro que aparece en Gesden es el hecho del sistema que cierra el caso. El lector no solo
alimenta contexto: cierra bucles. Con Gesden ONE, verificar con Infomed si hay API antes de asumir.

**Qué costaría.** Lector + API de ingesta + reconciliación de identidad (NHC ↔ paciente) +
pruebas contra un esquema real: **4–8 semanas de ingeniería**, más el papel. No arranca sin acceso
al servidor de RB: es la tarea que más depende de la firma.

### 1.2 Modelo de datos — 2,5

**Qué existe.** Pacientes, leads, presupuestos, citas, pagos y cola de envíos son tablas separadas
con `cliente` y RLS forzada (`002_rls`). El log `eventos_automatizacion` es la pieza mejor pensada
del sistema: append-only, 14 eventos con CHECK (`034`), 6 causas de derivación, 10 claves de
aplazamiento con naturaleza `decision`/`dato_ausente` derivada del enum, 4 objetivos, idempotencia
por `(cliente, evento, clave, mensaje_id)` (`024`), y el payload `evaluacion_json` con los juicios,
el borrador, `usage`, `modelo`, `presupuestoReferidoId`, idioma. Los comentarios de las
migraciones explican cada decisión (por qué medida y no categoría, por qué texto y no código).

**Qué le falta para la visión.**
- **«Oportunidad» no es entidad.** El objetivo (cobro > presupuesto > cita > identificar) se deriva
  por teléfono en cada turno (`contexto-conversacion.ts`). Vale para conversar; no vale para una
  cola de Next Best Action que necesita una fila por oportunidad con importe, probabilidad y estado.
- **«Acción» vive en cinco tablas**: `historial_acciones` (solo presupuestos), `acciones_lead`,
  `acciones_pago`, `cola_envios`, `alertas_enviadas`, más `mensajes_whatsapp`. No hay una vista
  única de «qué hizo el sistema o la persona sobre este caso».
- **Tres logs de eventos**: `eventos_automatizacion` (Postgres, RLS), `eventos_comportamentales`
  (Supabase con service role, **sin RLS**, sin PII, fire-and-forget desde `lib/eventos/emitter.ts`)
  y `eventos_sistema` (motor de reglas del Sprint 16b). La taxonomía buena es la primera; las otras
  dos son planos de datos paralelos.
- **El eslabón contexto → acción → resultado está roto en los dos extremos.** El evento `evaluacion`
  guarda la salida del modelo, **no la entrada renderizada** (`renderEntrada` se tira). El saliente
  que envía la coordinadora no referencia la evaluación a la que responde: `mensajes_whatsapp`
  lleva un boolean `sugerido_por_ia`, y `mensaje_enviado` la distancia de edición, pero ningún id.
  El resultado (presupuesto ACEPTADO, cita creada, pago) no referencia ninguna acción.
- **La identidad es el teléfono.** `caso_id` = E.164; pacientes, leads y presupuestos se resuelven con
  `replace(...) like '%dígitos%'` en cada turno. La guarda de ambigüedad (MEJORAS 139) evita
  elegir mal; no da una entidad «contacto» sobre la que colgar oportunidades.

**Qué costaría cerrar el eslabón:** una columna `respuesta_a_mensaje_id` en `mensajes_whatsapp`
escrita por las cuatro rutas de envío, más entrada renderizada y hashes en el payload: **1–2 días**.
Entidad oportunidad: 1 semana cuando la NBA lo pida; hoy puede ser una vista.

### 1.3 Fiabilidad del agente — 3,5

**Qué existe.** La frontera está en código de verdad: `colaDeDerivacion()` deriva la cola de la
causa, la insistencia se cuenta del log desde el último resuelto con ráfaga = una vuelta
(`vueltasPorClave`), el caso completo sale de los campos, la espera tiene tope de 14 días, la
no-reversión la impone el semáforo. Dos guardas independientes sobre el borrador: el juez (otro
prompt, tarea de detección, fail-closed a plantilla) y el veto determinista de agenda por regex en
tres idiomas. `temperature: 0` con justificación medida. Timeouts de 20 s (evaluador) y 10 s (juez).
Config ilegible → el agente no actúa y suena la campana. Dedup en base y evaluación una por hilo y
lote.

**Qué le falta.**
- **Sin reintento.** Si Anthropic devuelve 529 o expira el timeout, el turno se pierde; el caso queda
  en «Sin evaluar» hasta que un humano lo vea o el paciente vuelva a escribir. `after()` de Vercel no
  es una cola de trabajos: no garantiza ejecución ni reintento.
- **Los hilos del lote se evalúan en serie dentro de `after()`** (`webhooks/whatsapp/route.ts:353`).
  Con 3–4 pacientes escribiendo a la vez, 20 s + 10 s por hilo se comen los 60 s.
- Crons de Vercel en Hobby: dos, una vez al día (`vercel.json`). Cualquier cadencia «a la hora
  correcta» o reevaluación periódica es imposible con eso.
- El veto de agenda es léxico: alta precisión, cobertura limitada; el juez cubre el resto.

**Qué costaría.** Barrido de reevaluación (ruta + cron): 1 día. Cola de trabajos real (pg-boss sobre
la misma Postgres, o QStash/Inngest): 1 semana. **La decisión hay que tomarla ahora**, porque NBA,
cadencias, retención y reintentos la necesitan.

### 1.4 Derivación — 4

**Qué existe.** Causa con CHECK (6), cola prioritaria/normal derivada, `objetivo_activo`, motivo
literal del paciente, cierre por hecho del sistema por causa (`semaforo.ts`: cita creada, pago,
objetivo cerrado, dos hechos para queja), edad visible sin caducidad (decisión del 17-08 reafirmada),
`resuelto_manual`, `asumido`/`asumido_manual`/`soltado` con `actor_id`, push solo para la cola
prioritaria, la ficha compuesta por código (`ficha-caso.ts`: qué quiere, pendientes, recogido,
presupuestos con fuente declarada, borrador, opt-out, ambigüedad, lead), SLA por plazos laborables
configurables (30/120/240/60 min) que alimenta la cohorte «fuera de plazo», hilo único por persona
en red con acceso por cualquiera de sus clínicas.

**Qué le falta.** **Propiedad nominal**: nadie asigna el caso a una persona concreta; «asumido» es
autoasignación. Sin reasignación ni escalado a segundo nivel al vencer el SLA. **La métrica número
uno de `PLAN-AGENTE-OFENSIVO §10`** (tiempo desde la entrega hasta la primera respuesta humana, por
cola) **no está calculada**: el único rastro es un comentario en `lib/leads/acciones.ts:167`. La
derivación solo existe en WhatsApp; voz y portal no derivan.

**Qué costaría:** 1 semana (asignación, escalado, la métrica).

### 1.5 Cumplimiento — 2

**Qué existe.** RLS forzada por cliente con `SET LOCAL`; roles admin/coordinación con alcance por
clínica; opt-out de fuente única con detección conversacional y respuesta por código (`034`,
`lib/contacto/optout`); regla 3 del juez (dato de salud no pedido) + reglas duras en el prompt;
texto del paciente delimitado contra inyección en los tres prompts.

**Qué le falta** (todo en `CONSULTA-LEGAL-AGENTE.md`, correcto y completo): sin registro de
consentimiento; **sin retención ni borrado** (mensajes y eventos van por teléfono; borrar la ficha no
los toca); sin aviso de sistema automático; datos de salud a Anthropic sin DPA firmado ni ZDR; sin
registro de accesos (quién abrió qué hilo); **sin historial de cambios de configuración** (quién
apagó el agente y cuándo — esto pesa también para atribución y para experimentación).

**Qué costaría.** Borrado por teléfono + cron de caducidad: 1 día cuando el abogado dé el plazo.
Consentimiento: medio día. Log de cambios de configuración: 1 día. DPA: papel.

### 1.6 Observabilidad — 2

**Qué existe.** 265 `console.error` con contexto; `avisarFalloAgente` convierte fallos sistemáticos
en campana (uno por hora/motivo/clínica); coste USD por turno persistido y sumado en Inicio; panel
de descartes del juez por clínica y motivo (`/api/agente/descartes`, montado en Agentes); contador
de etiquetas fuera de vocabulario; `instrumentation.ts` aborta el arranque con entorno incompleto;
banco de pruebas que enseña «qué hizo por dentro».

**Qué le falta.** Sin log drain ni logger estructurado (Vercel Hobby retiene los logs un día). Sin
request id ni traza. Sin series de latencia/errores del modelo. **No se puede reproducir una
decisión pasada**: se guarda el juicio, no la entrada que lo produjo, ni la versión del prompt, ni
la configuración vigente en ese instante. Cuando RB diga «el agente no contestó bien el martes», hoy
no hay forma de saber qué vio.

**Qué costaría.** Hash del system prompt + entrada renderizada en el payload: medio día. Log drain:
una hora. Métricas del modelo: 2 días.

### 1.7 Resultados — 2

**Qué existe.** `lib/inicio/calcular.ts` computa «llegó cocinado» por proceso: presupuesto aceptado,
lead citado, pago registrado, cita confirmada, si hubo una entrega de caso completo **del mismo
teléfono y objetivo en los 30 días anteriores** (política declarada en pantalla). `confirmada_por`
en citas (034). Coincidencia agente-humano por distancia de edición medida en servidor.
`TasaCierre` = € aceptado / € presentado con lo abierto en el denominador (fase 5). Fotos diarias
de «dinero parado» en `inicio_snapshots` desde el 4 de septiembre.

**Qué le falta.** Ninguna acción enlaza por id con su resultado; la atribución es heurística por
ventana, sin grupo de control ni línea base (`LINEA-BASE-CIERRE.md` salió degenerada por el seed y
lo dice). La única serie histórica es dinero parado, y tiene dos días. La conversión por cohorte se
enseña sin n ni «cohorte abierta» (MEJORA 156).

### 1.8 Experimentación — 1,5

**Qué existe.** `evals/`: 67 casos (51 en `.esperado.jsonl` + tandas C1/R1/I), anotación a ciegas
por Simon, test-retest para medir el techo humano, remapeos declarados con motivo, `_promptOverride`
y `--modelo` en `evaluarTurno`, corpus del juez capturado con `CAPTURA_JUEZ`, gasto anunciado y
acumulado en `GASTO.md`. Vara 66/67 con Haiku a $0,35 la pasada. Es un harness serio.

**Qué le falta.** **Cero versionado en producción.** `SYSTEM_PROMPT_EVALUADOR` es una constante de
código; el payload lleva `v: 1` y `modelo`, ningún hash del prompt. `evaluador_activo` es un boolean
sin fecha. `conocimiento` y `objetivos` son JSON en columnas `text` sin historial. No hay asignación
de variantes por clínica ni por hilo. Las cadencias viven en `secuencias_automaticas` y en
constantes, sin versión. La vara es sintética y lo declara.

### 1.9 Multi-sede — 2,5

**Qué existe.** Tenant por RLS en el motor. `configuracion_automatizaciones` por clínica con fila
`clinica_id = null` como default de red (el fallback existe en `calcular.ts:229`). Conocimiento,
objetivos, plazos y horario por clínica. Config del **número que recibió** manda sobre la ficha
(MEJORAS 122). Hilo único por persona etiquetado por clínica. Tabla de clínicas en Inicio ordenada
por «necesitan persona» con solo la que cayó resaltada.

**Qué le falta.** La excepción local es **todo-o-nada por blob**: una clínica con su JSON deja de
heredar los defaults de red campo a campo. No hay noción de «política central + excepción declarada».
`PILOT_CLIENTE` sigue hardcodeado en seis entradas sin sesión (dos webhooks, dos crons, portal,
generar-portal). La comparación entre sedes es una tabla de recuentos sin normalizar por volumen.

**Qué costaría.** Herencia por campo: 2 días. Enrutado real por WABA/token/metadata: 2 días,
obligatorio antes del segundo cliente.

### 1.10 Inteligencia de dirección — 2

**Qué existe.** Inicio operativo bien diseñado (desde el último cierre de jornada, dinero parado con
delta 7d, equipo por cohorte y SLA, qué hizo Fyllio este mes con cocinado y coste). KPIs con
tendencia 12 meses y comparación mismo tramo. Informe IA sobre agregados. Copilot con 26 tools
(14 de lectura, 12 de acción con confirmación humana).

**Qué le falta.** Cero detección de anomalías, cero recomendación, el «por qué» nunca se explica. Sin
serie por clínica no hay contra qué comparar.

---

## 2 · Las tres preguntas

### 2a · Qué hay que acertar AHORA (qué no cerrar)

| Cimiento | Estado | Evidencia | Si se deja un año |
|---|---|---|---|
| **Taxonomía de eventos** | ✅ Bien | CHECKs en 014/020/021/022/024/026/034, append-only, idempotente, naturaleza derivada del enum | Nada que temer. Única salvedad: tres logs; los otros dos deben morir o fundirse |
| **Versionado de prompts y playbooks** | ❌ No existe | `SYSTEM_PROMPT_*` constantes; payload sin hash; `evaluador_activo` sin fecha; JSON en `text` sin historial | **Caro**: ningún juicio del histórico es atribuible a una versión. No hay «v2 mejor que v1» sobre datos reales |
| **Política separada de la lógica** | 🟡 A medias | Decisiones en código ✅ (`estado.ts`, `semaforo.ts`, `aplazamientos.ts`); reglas duras en prompt + regex 🟡; hechos de clínica en `conocimiento` ✅ pero sin historial ❌ | Media: la política es recuperable; lo que se pierde es «desde cuándo» |
| **Eslabón acción → resultado por id** *(no lo nombraste)* | ❌ No existe | `sugerido_por_ia` boolean; `mensaje_enviado` sin id; entrada renderizada no persistida | **Irrecuperable**: no se puede reconstruir qué borrador respondió a qué evaluación |
| **Registro de cambios de configuración** *(no lo nombraste)* | ❌ No existe | `configuracion_automatizaciones` se sobreescribe | **Caro**: sin marca de intervención no hay antes/después, ni auditoría, ni rollback |
| **Identidad = teléfono** | 🟡 Vivible | Guarda de ambigüedad; LIKE por dígitos | Se puede vivir un año. Regla: nunca cambiar la clave del log sin tabla de mapeo |

**Las dos irrecuperables son el eslabón por id y la entrada renderizada**: el resto admite backfill.
Coste total de los cuatro ❌: **3–4 días**. Es la inversión con mejor ratio de todo el diagnóstico.

### 2b · Qué tenemos construido y no enseñamos

| Dato que ya existe | Dónde vive | Qué se ve hoy | Valor visible casi gratis |
|---|---|---|---|
| Descartes del juez por clínica y motivo | `evaluacion_json.borradorDescartado` | Panel en Agentes (5-sep) | Una línea en Inicio/Ajustes: «el agente se calló 7 veces por *económica*: publica tu plan de pago» |
| Aplazados por clave con motivo literal | eventos `aplazado` | Recuento en detalle expandible de Inicio | **Next Best Config**: cruzar `NATURALEZA_DE_CLAVE` (dato ausente vs decisión) con `capacidadesDe(conocimiento)` → «lo que tus pacientes preguntan y el agente no puede contestar, y qué publicar para que pueda» |
| `camposRecogidos`: `que_le_frena`, `motivo_rechazo`, `cuando_retomar`, `urgencia`, `tratamiento_o_molestia` | payload de cada turno | Solo en la ficha del caso | **Inteligencia de conversación** sin coste de modelo: objeciones y motivos de pérdida agregados por mes y clínica |
| Causa de derivación por mes | eventos `derivado` | Recuento en Inicio | Ratio `caso_completo` / resto = madurez del agente en esa clínica; «de qué te libera y qué sigue exigiendo persona» |
| Vara 66/67, descartes 10 %, $0,35/pasada | `evals/pasadas` | Nada | «Confianza del agente» en Ajustes: vara sintética hoy, tus conversaciones reales cuando existan |
| Juicios por turno | `evaluacion_json` | El último, en la ficha | «Por qué» por mensaje en el chat embebido: la traza que la coordinadora necesita para confiar |
| Coincidencia agente-humano | `distancia_edicion` | `CoincidenciaView` | «El equipo envía el borrador tal cual el X %» en el bloque equipo de Inicio; y el disparador declarado de modo A → B |
| Señales del hilo (minutos sin respuesta, salientes sin respuesta) | calculadas y tiradas cada turno | Nada | Persistirlas en el payload: sale la métrica #1 del plan ofensivo sin consulta nueva |
| Fotos diarias de dinero parado | `inicio_snapshots` | Delta 7d | Sparkline 30 días por línea de riesgo |
| `cambio_estado→PERDIDO` + `motivo_perdida` | `historial_acciones` | Columna en Tablas (F7) | Mapa de fuga por etapa en € |
| Uso del banco de pruebas | `uso_banco_pruebas` | Nada | «Has probado el agente N veces» + correcciones |
| `sugerencias_categoria` | tabla 016 | Nada | **Muerta**: solo la escribía el clasificador viejo. Retirar |

Las cuatro primeras filas **son** «vender inteligencia» y se construyen con SQL sobre lo que ya se
persiste. Coste conjunto: 1–2 semanas, cero gasto de modelo.

### 2c · La comparación contra uno mismo

Para poder decir «aceptaba el 40 % y ahora el 52 % desde que el agente contesta en diez minutos»
hacen falta cinco cosas. Tres ya están a medias; dos no existen.

1. **Definiciones congeladas y versionadas.** Existen (`TasaCierre` en €, cohortes, SLA), pero la
   tasa cambió de definición el 4-sep. Sin `definicion_v` en la serie se compara peras con manzanas.
2. **Marca de intervención.** No existe: `evaluador_activo` es un boolean sin fecha. Es el log de
   cambios de configuración de 2a. Sin él no hay «desde que».
3. **Serie temporal por clínica.** No existe salvo dinero parado (2 días). Falta una tabla
   `metricas_diarias (cliente, clinica_id, dia, metrica, valor, n, definicion_v)` alimentada por
   cron. **Buena noticia: casi todo es reconstruible hacia atrás** desde datos crudos que ya tienen
   timestamp: tiempo de respuesta (entrante → primer saliente en `mensajes_whatsapp`), aceptación
   (`fecha` / `fecha_aceptado`), pérdida (historial), lead → cita (`created_at` / `fecha_cita`).
4. **Tiempo de respuesta.** Derivable para todo el histórico; hoy solo existe en vivo
   (`sinRespuestaDesde`). Es la palanca que la frase de arriba atribuye y no la medimos.
5. **Atribución honesta.** Antes/después en una sola clínica no es causal y hay que decirlo (n,
   ventanas iguales, estacionalidad). Pero RB tiene diez sedes: **encender el agente por sedes
   escalonadas** convierte el despliegue en un diseño experimental (stepped-wedge) y la comparación
   entre sedes de la misma red en el mismo mes sí vale. El «no tenemos volumen entre clínicas» se
   resuelve con el orden de encendido, no con más clientes.

Coste: **1 semana** (tabla, cron, backfill, marca, pantalla mínima). Salvedad: el «antes» de RB vive
en Gesden y en su WhatsApp personal; sin el histórico de conversaciones (D.2 bis) o el lector de
Gesden, la línea base empieza el día que Fyllio entra.

---

## 3 · Qué propongo

### 3.1 Capacidades más cerca de lo que parece, en orden de valor por sí solas

| # | Capacidad | Qué existe ya | Falta | Coste |
|---|---|---|---|---|
| 1 | **Inteligencia de conversación + mapa de fuga** | Todo persistido (2b) | Agregación y pantalla | 1–2 sem, sin modelo |
| 2 | **Comparación contra la propia historia** | Datos crudos con timestamp; definiciones | Serie + marca + backfill (2c) | 1 sem |
| 3 | **Next Best Config** (qué publicar para que el agente resuelva más) | `aplazados` × `capacidadesDe()` | Cruce y recomendación | 2–3 días |
| 4 | **Derivación con propietario y escalado** | Ficha, SLA, cohortes | Asignación nominal, escalado, métrica #1 | 1 sem |
| 5 | **Next Best Action v1** | Cola de Seguimiento con cohortes y prioridad | Impacto esperado = importe × urgencia × plazo; cupo diario por clínica | 2 sem. v2 con probabilidad aprendida cuando haya resultados por id |
| 6 | **Motor de políticas** | Semáforo, veto, juez, opt-out, plazos, horario, nivel de agenda, conocimiento | Consolidar en un módulo declarado con historial; el banco de pruebas como test de política | 3 sem |
| 7 | **Operación en lenguaje natural sobre el agente** | Copilot con 26 tools y confirmación | Tools sobre el log («¿por qué derivó a X?», «¿qué se aplaza más?») | 1 sem |
| 8 | **Resumen de dirección con anomalías** | Inicio, KPIs, informe IA | Reglas de anomalía sobre la serie + explicación generada desde hechos agregados | 2 sem tras #2 |
| 9 | **Motor de capacidad** (demanda ↔ huecos) | Agenda nivel 2, slots por duración (G3), disponibilidad declarada del paciente | Casar declaraciones con huecos; **depende del PMS**: Google Calendar no es la agenda de una clínica Gesden | 2 sem lógica; meses la conexión |
| 10 | **Experimentación online y playbooks versionados** | Harness offline | Hashes, asignación por clínica/hilo, resultados por id | 4–6 sem tras 2a |
| 11 | **Modo objetivo** | — | NBA + políticas + capacidad + experimentación | 6–12 meses |

### 3.2 Qué no está en la lista y debería estar

- **El lector local de Gesden.** Es *la* integración con el ERP; sin él, «no pedimos que nadie se
  mude» es un CSV. Además cierra bucles (cita en Gesden = caso cerrado) y da la línea base del ERP.
  4–8 semanas + legal. Arranca el día que RB dé acceso al servidor.
- **Una cola de trabajos.** Reintentos del turno, cadencias a la hora correcta, reevaluación,
  retención, recálculo de NBA. `after()` y dos crons diarios no lo sostienen. Elegir una (pg-boss
  sobre la misma Postgres es la que menos piezas añade).
- **Registro de cambios de configuración + hashes de prompt** = el versionado de facto. 1–2 días.
- **Inspector de decisiones**: entrada renderizada + prompt + config → botón «ver por qué» y replay
  en el banco de pruebas. Es confianza para la coordinadora y depuración para nosotros.
- **El bucle de corrección con un botón**: «el agente se equivocó aquí» en el chat, que genera un
  caso candidato del eval. Es la única forma de que la vara deje de ser sintética sin esperar el
  histórico de RB. PLAN-AGENTE fase 4 lo describe; no hay UI.
- **La métrica de los humanos**: tiempo desde la entrega hasta la primera respuesta humana por cola.
  El plan ofensivo la pone primera; no está.
- **Consentimiento, retención y borrado como capacidad visible.** Engrana ya vende «art. 28
  firmable». Es tabla mínima y hoy es un hueco.
- **Identidad unificada (contacto)** y **calendario de clínica (festivos, MEJORAS 116)**: los dos
  son prerrequisito de cadencias y SLA correctos en red.

### 3.3 Callejones sin salida: rehacer antes de que crezcan

1. **El clasificador viejo** (`lib/presupuestos/intervencion.ts`) y sus columnas en `presupuestos`
   (`requiere_persona`, `mensaje_sugerido`, `intencion_detectada`, `urgencia_intervencion`,
   `accion_sugerida`, `fase_seguimiento`) más la rama de `estado.ts` que las lee. Dos cerebros
   sobre el mismo mensaje. MEJORAS 94 ya lo condena: ejecutarlo (B5).
2. **Tres automatizaciones**: motor de reglas del Sprint 16b (`reglas_automatizacion`,
   `eventos_sistema`, `engine.ts` con envío *skeleton* que nunca envía), `secuencias_automaticas` y
   `cola_envios`. La visión pide **un** motor de políticas. Elegir la salida (`cola_envios` → WABA)
   y retirar el motor o convertir su tabla en el almacén de políticas.
3. **Supabase analítica con service role sin RLS** (`eventos_comportamentales`, `factores_no_show`,
   Sprint 18). Segundo plano de datos fuera del aislamiento. Fundir en Postgres con RLS o retirar.
4. **Twilio**: apagado; borrar código y `CRON_TWILIO_WHATSAPP`.
5. **Nomenclatura Airtable** (`airtableRepo.ts`, `lib/airtable` re-export): ya es Postgres; el nombre
   engaña a quien entre nuevo. MEJORAS 44/45.
6. **Sesión doble** (`fyllio_session` + cookie legacy de presupuestos, MEJORAS 38): dos autenticaciones
   en las rutas del agente (`withPresupuestosAuth` en enviar-waba).
7. **Crons de Vercel Hobby**: no sirven para nada de lo anterior.
8. **JSON en columnas `text`** (`objetivos`, `conocimiento`, `evaluacion_json`): pasar a `jsonb` con
   índice antes de que el log tenga cientos de miles de filas (la agregación de Inicio ya castea
   `::jsonb` en caliente).

---

## 4 · El plan

Reglas: cada fase da valor sola y deja la siguiente más cerca; nada de infraestructura que no se use
hasta la fase 4. Duraciones de ingeniería, no de calendario.

### Fase 0 · Las TRES que duelen con RB en producción (1–2 semanas, antes de la visión)

1. **El turno perdido no se reintenta.** Modelo caído o timeout → el paciente queda «Sin evaluar»
   hasta que alguien mire. Barrido de reevaluación (entrantes legibles sin `evaluacion` en N
   minutos, con evaluador activo, idempotente por `mensaje_id`) + **decidir la cola de trabajos** y
   mover ahí la evaluación y el barrido. 2 días + 1 semana.
2. **Nada sale solo hacia el paciente, y lo que podría salir no es seguro.** Recordatorios por Twilio
   apagados; `engine.ts` no envía; `cola_envios` se genera por cron pero **se envía a mano**
   (MEJORAS 11); motor de reglas sin dedup (MEJORAS 9/10). Decidir UNA salida (`cola_envios` →
   plantillas WABA) con dedup por (persona, plantilla, día), semáforo y opt-out ya integrados, en la
   cola de trabajos. 1 semana. Depende del catálogo de Meta: si no llega, el modo A sigue y esto
   queda **declarado** como aplazado, no olvidado.
3. **Borrado, retención y consentimiento.** Un derecho de supresión el primer mes no se puede
   atender. Borrado por teléfono (mensajes + eventos + anotación sin contenido), cron de caducidad
   con el plazo del abogado, columna de consentimiento con bloqueo de envío, y **log de cambios de
   configuración** (sirve aquí y en las fases 1 y 2). 2 días.

El cuarto que casi entra: **log drain** (una hora). Sin él, «el agente no contestó el martes» no se
investiga.

### Fase 1 · Cimientos baratos de la visión (1 semana)

Hash del system prompt y del juez, hash de `conocimiento` y `objetivos`, entrada renderizada en el
payload; `respuesta_a_mensaje_id` en salientes; señales del hilo persistidas; tabla
`metricas_diarias` con `definicion_v` y backfill desde datos crudos; marca de encendido (viene del
log de config). **Valor visible**: «ver por qué» por mensaje, sparkline 30 días de dinero parado,
tiempo de respuesta por clínica.

### Fase 2 · Inteligencia visible sin gastar modelo (3–4 semanas)

Inteligencia de conversación (objeciones, motivos de pérdida, qué frena); mapa de fuga por etapa en €;
Next Best Config (aplazados × capacidades); confianza del agente (vara + descartes + coincidencia);
tiempo hasta primera respuesta humana por cola; antes/después por clínica con n y ventana igual.
Todo sale de 2b y 2c. **Deja lista** la NBA: ya hay impacto y urgencia por caso.

### Fase 3 · Decidir y ejecutar dentro de reglas (4–6 semanas)

NBA v1 con cupo diario; propietario nominal y escalado; motor de políticas consolidado con
historial y el banco de pruebas como su test; retirar el clasificador viejo y el motor 16b; herencia
por campo red → clínica; copilot sobre el log. **Deja lista** la experimentación: políticas
versionadas y resultados por id.

### Fase 4 · El ERP y la infraestructura que ya se usa (6–10 semanas, en paralelo desde la firma)

Lector local de Gesden + API de ingesta + reconciliación por NHC; cierre de casos por hecho en
Gesden; encendido escalonado por sede como diseño experimental; enrutado real multi-cliente. Aquí
la cola de trabajos y la serie ya llevan semanas en uso.

### Fase 5 · Lo que la visión promete (después)

Experimentación online por clínica/hilo; playbooks versionados que proponen (nunca aplican solos,
como manda PLAN-AGENTE fase 4); resumen de dirección con anomalías explicadas; motor de capacidad
sobre la agenda del PMS; modo objetivo. Seis a doce meses, y solo tiene sentido con dos o tres
clientes en producción.

---

## Lo que este diagnóstico NO ha comprobado

- Nada se ha ejecutado contra la base ni contra producción; la evidencia es el código y sus
  comentarios, que en este repo son fiables porque cada decisión lleva fecha y motivo.
- No se ha medido rendimiento del `LIKE` por dígitos con volúmenes de RB (estimación: irrelevante
  por debajo de 100k filas).
- La existencia de API en Gesden ONE sigue sin verificar con Infomed.
