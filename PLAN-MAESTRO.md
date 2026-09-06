# Plan maestro — documento vivo

Las fases hacia la visión de inteligencia operativa, con su estado y su fecha. Nace del
[diagnóstico estratégico](DIAGNOSTICO-ESTRATEGICO-2026-09-06.md), aprobado por Simon el 6 de
septiembre de 2026. Las notas por área viven en el [marcador de misión](MARCADOR-MISION.md);
cada tarea concreta es una entrada numerada de [`MEJORAS-PENDIENTES.md`](MEJORAS-PENDIENTES.md)
con **su fase**. Aquí no se repite el detalle: se enlaza.

Dos reglas, de Simon: **cada fase da valor por sí sola y deja la siguiente más cerca**; **nada de
infraestructura que no se use hasta la fase 4**. Y una tercera, del diagnóstico: lo irrecuperable
va primero aunque no duela hoy.

---

## Estado de las fases

| Fase | Qué es | Estado | Abierta | Cerrada |
|---|---|---|---|---|
| **0** | Las tres que duelen con RB en producción (+ log drain) | 🟠 **En curso** | 2026-09-06 | — |
| **1** | Cimientos baratos de la visión — dos irrecuperables | 🟠 **En curso** (va dentro de la 0) | 2026-09-06 | — |
| **2** | Inteligencia visible sin gastar modelo | ⬜ Abierta | — | — |
| **3** | Decidir y ejecutar dentro de reglas | ⬜ Abierta | — | — |
| **4** | El ERP y la infraestructura que ya se usa | ⬜ Abierta · parte independiente puede adelantarse | — | — |
| **5** | Lo que la visión promete | ⬜ Abierta | — | — |

Estados: ⬜ abierta · 🟠 en curso · ✅ cerrada (con fecha y línea en el marcador).

---

## Fase 0 · Las tres que duelen con RB (+ la cuarta)

**Por qué primero:** independientes de la visión; cada una es un incidente en el primer mes real.

| # | Qué | MEJORAS | Estado |
|---|---|---|---|
| 0.1 | El turno perdido no se reintenta → barrido de reevaluación + **cola de trabajos** (decisión: QStash, push, sin worker, funciona en Hobby) | 163, 164, 146 | 🟠 barrido ✅ 6-sep (webhook + `/api/cron/reevaluar` + suelo diario) · cola 164 ⬜ |
| 0.2 | Nada sale solo → **una sola salida** (`cola_envios` → WABA) con dedup, semáforo, opt-out y ventana de 24 h; el motor 16b deja de «enviar» | 165, 9, 10, 11, 24, 39, 74, 83, 98, 115, 132, 133, 154 | ⬜ **Bloqueada por Meta** (ver bloqueantes) — se construye hasta donde no dependa del catálogo y queda **declarada aplazada**, no olvidada |
| 0.3 | Borrado, retención y consentimiento + **log de cambios de configuración** | 147, 166, 167 | ✅ 6-sep en código: 167 (038) · 147 (039: borrado por teléfono desde admin y al dar de baja una ficha, retención SOLO con plazo declarado) · 166 (registro con fecha y origen; el bloqueo detrás de flag) · **del abogado quedan el plazo y la forma del consentimiento** |
| 0.4 | **Log drain** (Vercel Hobby no tiene drains: envío desde `lib/log-drain` a un destino externo, o plan Pro) | 162 | ✅ 6-sep en código · **inerte hasta `LOG_DRAIN_URL`** (bloqueante de Simon) |
| 0.5 | Pequeños de fiabilidad del mismo camino | 130, 134, 145, 155 | 🟠 145 y 155 ✅ 6-sep · 130 y 134 ⬜ (camino manual y composer, siguiente sesión) |

**Cierra cuando:** un entrante sin evaluar se reevalúa solo en menos de 10 minutos; existe un camino
de borrado por teléfono probado; los errores de producción se pueden leer una semana después; la
salida automática está construida o declarada aplazada con el motivo escrito.

## Fase 1 · Cimientos baratos (dentro de la 0)

**Por qué dentro de la 0:** 3–4 días, y dos cosas (eslabón por id y entrada renderizada) son
irrecuperables — cada turno que pasa sin ellas es histórico perdido.

| # | Qué | MEJORAS |
|---|---|---|
| 1.1 | Hash del system prompt, del juez, del conocimiento y de los objetivos en el payload de cada turno | 168 |
| 1.2 | Entrada renderizada persistida (replay de cualquier decisión) | 169 |
| 1.3 | `respuesta_a_mensaje_id` en salientes: el eslabón acción→resultado | 170 |
| 1.4 | Señales del hilo persistidas | 171 |
| 1.5 | `metricas_diarias` con `definicion_v` y backfill desde datos crudos | 172, 37 |
| 1.6 | JSON en `text` → `jsonb` con índice | 173 |
| 1.7 | Métricas del modelo por día (latencia, errores, fallback) | 174 |
| 1.8 | Paralelismo del lote en `after()` con tope, o vía cola | 175 |
| 1.9 | Deuda que estorba a lo anterior | 35, 63, 65, 66, 72, 80, 91, 126, 136, 142, 144, 161 |

**Estado (6-sep):** 1.1, 1.2, 1.4 ✅ y 1.3 ✅ en su mitad irrecuperable (migración 037); quedan
1.5–1.9 (la serie 172 es la que abre la fase 2).

**Valor visible al cerrar:** «ver por qué» en cada mensaje, sparkline de 30 días de dinero parado,
tiempo de respuesta por clínica.

## Fase 2 · Inteligencia visible sin gastar modelo

Todo sale de lo ya persistido (diagnóstico §2b y §2c).

| # | Qué | MEJORAS |
|---|---|---|
| 2.1 | Inteligencia de conversación: objeciones, motivos de pérdida, qué frena | 176 |
| 2.2 | Mapa de fuga por etapa en € | 177, 51, 48 |
| 2.3 | Next Best Config: aplazados × capacidades de la clínica | 178, 89 |
| 2.4 | Confianza del agente (vara, descartes, coincidencia) y madurez por clínica | 179, 184, 185 |
| 2.5 | Tiempo hasta primera respuesta humana por cola (métrica #1 del plan ofensivo) | 180 |
| 2.6 | Antes/después por clínica con n y ventana igual | 181 |
| 2.7 | **Botón «el agente se equivocó aquí»** → caso candidato del eval | 182, 107 |
| 2.8 | «Ver por qué» por mensaje (inspector de decisiones) | 183 |
| 2.9 | Inicio: lo que ya está en marcha + motivos honestos que el mapa necesita + pantallas de demo | 156, 157, 158, 159, 160, 4, 42, 43, 55, 61, 73, 15 |
| 2.10 | **Tanda «seed honesto»** (aprobada 6-sep, adelantada por la demo): el seed respeta el vocabulario real y lo comprueba con invariantes (§15) | 82, 110, 112 · ✅ 6-sep (demo:reset en verde con cuatro invariantes nuevas) |

**Deja lista** la NBA: impacto y urgencia por caso ya existen.

## Fase 3 · Decidir y ejecutar dentro de reglas

| # | Qué | MEJORAS |
|---|---|---|
| 3.1 | Next Best Action v1 con cupo diario por clínica | 186, 3, 16, 40, 53, 54, 56, 70 |
| 3.2 | Propietario nominal y escalado por SLA | 187, 102, 67 |
| 3.3 | Motor de políticas consolidado con historial; el banco de pruebas como su test | 188, 141, 104, 103, 99, 100, 21, 22, 33, 96 |
| 3.4 | Tres automatizaciones → una | 189, 12, 106, 8, 64 |
| 3.5 | Supabase analítica sin RLS → fundir o retirar | 190 |
| 3.6 | Herencia por campo red → clínica | 191, 114 |
| 3.7 | Copilot sobre el log del agente | 192, 7 |
| 3.8 | **Identidad unificada (contacto)** — prerrequisito de la cola por impacto | 193, 17, 79 |
| 3.9 | Oportunidad y acción como entidades (vista primero) | 194, 195, 143 |
| 3.10 | **Calendario de clínica** (festivos y cierres) | 116 |
| 3.11 | Tanda de retirada declarada: clasificador viejo, Airtable, doble sesión, Twilio, huérfanos | 94, 196, 44, 45, 38, 29, 47, 6, 14, 62, 69, 101 |

**Deja lista** la experimentación: políticas versionadas y resultados por id.

## Fase 4 · El ERP y la infraestructura que ya se usa

| # | Qué | MEJORAS | Depende de |
|---|---|---|---|
| 4.1 | Lector de Gesden — **parte independiente del servidor** (ver §Gesden sin RB) | 197 | Nada: puede adelantarse desde la fase 2 |
| 4.2 | Lector de Gesden — parte dependiente (esquema real + servicio Windows) | 198 | Firma de RB |
| 4.3 | Enrutado real multi-cliente | 199 | Segundo cliente o segunda WABA |
| 4.4 | Encendido escalonado por sede como diseño experimental | 200 | RB en producción |
| 4.5 | Lo que Gesden trae y hoy no existe | 27, 58, 77, 92, 113 | 4.2 |

## Fase 5 · Lo que la visión promete

| # | Qué | MEJORAS |
|---|---|---|
| 5.1 | Experimentación online por clínica/hilo | 201, 84 |
| 5.2 | Playbooks versionados que proponen (nunca aplican solos) | 202 |
| 5.3 | Resumen de dirección con anomalías explicadas | 203 |
| 5.4 | Motor de capacidad sobre la agenda del PMS | 204 |
| 5.5 | Modo objetivo | 205 |

---

## Gesden sin RB — cuánto se adelanta hoy

**Verificado el 6-sep-2026:** Gesden ONE **no tiene API pública documentada**. EBROTECH (integrador,
2026): «Gesden no tiene API REST pública oficial. Eso es lo primero que hay que decir claro»; Cloud
lo evalúan «caso por caso». Cliniflux solo habla de Gesden Win («no ofrece una API abierta a
terceros»). El API Exchange de Henry Schein One cubre Dentrix y Dentrix Ascend en EE. UU. y no
menciona Gesden, Infomed ni Europa. Conclusión: diseñar para **sin API**; preguntar a Infomed por
ONE es tarea de Simon (bloqueante menor, abajo).

**Lo que es igual para cualquier ERP y se construye sin tocar un servidor real** (≈ 60–70 % del
lector, **3–4 semanas**):

1. **Modelo canónico de ingesta**: paciente (con `nhc`), cita, presupuesto, cobro, profesional,
   tratamiento; `origen_sistema = 'importado'` y `external_id` (citas ya lo tiene desde la 031).
   Regla de «quién manda» por campo: el PMS es fuente de verdad de paciente, agenda y cobro; Fyllio
   lo es del lead y del seguimiento. Fyllio **nunca escribe de vuelta**.
2. **API de ingesta** con clave por instalación (`instalaciones_lector`: cliente, clínica, hash de
   la clave, última sincronización, versión del esquema, heartbeat — cierra MEJORAS 146), lotes
   idempotentes por (fuente, `external_id`, `updated_at`), cursor por tabla.
3. **Reconciliación de identidad**: NHC ↔ paciente; teléfono normalizado como respaldo; cola visible
   de «sin casar», con el mismo trato honesto que la ambigüedad de teléfono.
4. **Ciclo de sincronización**: carga inicial + incremental por cursor; estado en Ajustes con la edad
   de la lectura («leído hace 3 min»), exactamente como la agenda externa.
5. **Conflictos y cierre de bucles**: una cita creada en Fyllio se enseña «pendiente de aparecer en
   Gesden» hasta que el lector la vea; el semáforo ya cierra por cita creada y por pago — solo hay que
   dejar que las filas importadas cuenten. **«Fyllio propone, Gesden confirma».**
6. **Simulador**: un Gesden sintético (SQL Server en Docker con un esquema inventado pero realista, o
   JSON) contra el que corre todo el ciclo, como `qa:agenda-externa` con sus 18 checks. Y un segundo
   conector contra un ERP **con** API pública (Dentalink) para probar la ingesta con algo real.
7. **Esqueleto del servicio Windows** (Go o Node empaquetado): lectura por consulta parametrizada,
   cursor, reintentos, envío por lotes, actualización — probado contra el simulador.

**Lo que espera a la firma** (**1–2 semanas** desde el día del «sí»): el mapeo de tablas y columnas
del esquema real de la versión de RB (3–5 días con el esquema delante), la instalación y firma de
código del servicio, las pruebas contra su volumen, y el papel (art. 28, NDA, autorización de
acceso a la base). **Objetivo declarado: dejarlo a una o dos semanas de distancia del «sí».**

Cuándo empezar la parte independiente: **desde la fase 2**, en paralelo, sin saltarse la regla de
«infraestructura que se usa»: el simulador y la ingesta se usan desde el primer día para el segundo
conector (Dentalink) y para la demo.

---

## Bloqueantes de Simon (no de ingeniería)

| Bloqueante | Qué se para sin él | Qué sigue igual |
|---|---|---|
| **Catálogo de plantillas con Meta** (alta fiscal + Meta Business + fórmula de transparencia) | La salida automática (0.2), el modo B, cadencia de leads (100), no-shows a la cola (98), plantillas neutras (83), guarda de categoría (154), ventana 24 h (133), estados de entrega (132) | Todo el modo A, fases 1 y 2 completas, fase 3 salvo el envío |
| **Consulta legal** ([`CONSULTA-LEGAL-AGENTE.md`](CONSULTA-LEGAL-AGENTE.md)) | El plazo de retención (147: el mecanismo se construye igual, con plazo configurable), la transparencia de IA (108/148, que a su vez condiciona el catálogo), seudonimización o ZDR con Anthropic (127), menores (140), la forma del consentimiento (166) | El resto de la fase 0 y todas las demás |
| **Firma de RB** (art. 28 + NDA + acceso al servidor + histórico de WhatsApp) | La parte dependiente del lector (198), el piloto real, el corpus real del eval (D.2 bis), el encendido escalonado (200), el «antes» real para 181 | La parte independiente del lector (197) y todo lo de las fases 0–3 sobre DEMO e INDEP |
| **Plan de Vercel** (Hobby → Pro, decisión de gasto) | Log drains nativos (0.4 tiene alternativa desde código), crons por minuto (0.1 tiene alternativa: QStash) | Nada más |
| **Pregunta a Infomed**: ¿Gesden ONE expone API o webhooks para partners? | Solo la elección de vía para clínicas ONE (la de G5 no cambia) | Todo |

---

## Censo de MEJORAS (6-sep-2026)

Método: 161 entradas; estado leído del emoji de cada una (🟢 hecha 37 · ✅ cerrada 19 · ⚪
descartada 2 · 🔵 abierta 81 · 🟡 parcial 6 · sin marca 16). **Abiertas o parciales: ≈ 103.**
Nuevas hoy: 162–205 (44), todas con fase. Reparto de las abiertas anteriores:

| Destino | Números | Cuántas |
|---|---|---|
| Fase 0 | 9, 10, 11, 24, 39, 74, 83, 98, 115, 130, 132, 133, 134, 145, 146, 147, 154, 155 | 18 |
| Fase 1 | 35, 37, 63, 65, 66, 72, 80, 91, 126, 136, 142, 144, 161 | 13 |
| Fase 2 | 4, 42, 43, 48, 51, 55, 61, 73, 89, 107, 156, 157, 158, 159, 160 | 15 |
| Fase 3 | 3, 6, 7, 8, 12, 14, 16, 17, 21, 22, 29, 33, 38, 40, 44, 45, 47, 62, 64, 67, 69, 79, 94, 96, 99, 100, 101, 102, 103, 104, 106, 114, 116, 141, 143 | 35 |
| Fase 4 | 27, 58, 77, 92, 113 | 5 |
| Fase 5 | 84 | 1 |
| Bloqueadas por Simon (legal o decisión) | 108, 127, 140, 148, 153, 87 | 6 |
| Verificadas el 6-sep | 49, 68, 90, 97 **cerradas** (ya resueltas por F4, §20, fase D y G2) · 15 ver nota abajo | 5 |
| Fuera del plan — **decididas el 6-sep** | 36, 53, 54, 56, 70 **muertas** a favor de la NBA (186) · 41, 82, 110, 112 → tanda «seed honesto» en 2.9 | 9 |

**Las nueve que llevan semanas anotadas y no entran en ninguna fase.** Propuesta, pendiente de OK:

| # | Qué | Desde | Propuesta |
|---|---|---|---|
| 36 | Cobros · vista compacta / toggle de densidad | 24-jul | **Matar**: UI menor; si RB lo pide, renace |
| 41, 82, 110, 112 | El seed escribe fuera del vocabulario (motivos, acciones antes del lead, reglas decorativas, motivo_perdida libre) | jul–ago | **Una tanda «seed honesto» de un día antes de la próxima demo**, o matar si no hay demo a la vista; hoy engañan a quien mide sobre DEMO |
| 53, 54, 56, 70 | Leads y Presupuestos en móvil, tablero sin prioridad, «ver 151 anteriores» | 27-jul | **Matar a favor de 3.1**: la NBA sustituye al tablero como cola; rehacer el tablero hoy es trabajo doble |

**Decidido por Simon el 6-sep:** 36 y 53/54/56/70 muertas (⚪ en MEJORAS); 41/82/110/112 entran como
tanda «seed honesto» de un día (2.10), adelantada porque la demo con tres clínicas a cero y el bullet
plano es hoy el peor argumento de venta. Las cinco «a verificar»: 49, 68, 90 y 97 cerradas con la
evidencia en su entrada; **15 sigue abierta** (el botón Agendar de la ficha del paciente manda a
`/no-shows?tab=agenda`, zona congelada, sin preseleccionar a nadie) y pasa a 2.9. Corrección del
censo: 41 ya estaba cerrada desde el 27-07 (el emoji de su primera línea engañó al recuento); la
tanda «seed honesto» es 82, 110 y 112.

---

## Historial del plan

- **2026-09-06** — Nace del diagnóstico aprobado. Fases 0 y 1 abiertas juntas. Censo hecho.
- **2026-09-06** — Primer bloque ejecutado: 168, 169, 170 (mitad irrecuperable), 171 (fase 1);
  163, 167, 162 (fase 0). Migraciones 037 y 038 aplicadas. Queda en fase 0: 164 (cola), 165
  (salida, bloqueada por Meta), 147 y 166 (borrado y consentimiento), 130/134/145/155.
- **2026-09-06** — Segundo bloque: 147 (borrado, retención con plazo declarado) y 166 (registro de
  consentimiento) en la migración 039. Fase 0 pendiente: 164 (cola), 165 (salida, Meta),
  130/134/145/155, y el cableado del bloqueo por consentimiento cuando el abogado fije la forma.
- **2026-09-06** — 145 y 155 hechas. Simon decide las nueve fuera del plan: cinco muertas a favor
  de la NBA, tanda «seed honesto» (82, 110, 112) hecha el mismo día; 49/68/90/97 cerradas, 15 a 2.9.
  Simon asume: cuenta Upstash, destino de logs, catálogo de Meta, consulta legal y RB.
