# Marcador de misión

Las diez áreas del [diagnóstico estratégico](DIAGNOSTICO-ESTRATEGICO-2026-09-06.md), su nota y
**su historia**: de dónde a dónde, y qué la movió. No es un número, es el relato.

**Suma hoy: 28,5 / 50** (6 de septiembre de 2026, cierre de la fase 1 · línea base 22,5 esa misma
mañana). Siete áreas subieron; tres no se tocan hasta la fase 2 y 4 (dirección, ERP, derivación).

Regla: al cerrar una fase del [plan maestro](PLAN-MAESTRO.md) se añade una línea al área que
tocó, con fecha y con la causa concreta. Nunca se sube una nota por intención: solo por algo
desplegado y verificado (lección 21: se mide lo que el usuario ve).

| Área | Nota hoy | Historia |
|---|---|---|
| Integración ERP y canales | **1** | 6-sep · 1 · línea base: WhatsApp Meta sólido; Gesden = CSV de pacientes + stub |
| Modelo de datos | **3** | 6-sep · 2,5 · línea base: log del agente excelente; oportunidad y acción no son entidades; tres logs · **6-sep · 3 · fase 1 cerrada:** eslabón acción→resultado por id (170), `evaluacion_json` en jsonb con GIN (173), `metricas_diarias` con definición versionada (172), `incidencias` (207). Sigue faltando: oportunidad y acción como entidades, un solo log |
| Fiabilidad del agente | **4** | 6-sep · 3,5 · línea base: idempotencia, fail-closed, juez + veto; sin reintento ni cola · **6-sep · 4 · fases 0+1:** cola de trabajos con reintento y fallos agotados visibles (164/207), idempotencia en dos capas antes de gastar modelo, tope de turnos (145), saliente manual pendiente de confirmar (130), barrido de reevaluación (163); el lote ya corre en paralelo (175). 4,5 exige tope de coste diario |
| Derivación | **4** | 6-sep · 4 · línea base: causas, cierre por hecho, ficha; sin propietario nominal |
| Cumplimiento | **2,5** | 6-sep · 2 · línea base: RLS y opt-out; sin borrado, consentimiento, aviso de IA ni DPA · **6-sep · 2,5 · fase 0:** borrado por petición y al dar de baja (147), retención con plazo declarado (inerte hasta el abogado), consentimiento con fecha y origen (166), incidencias sin contenido. Media nota: el MECANISMO existe, el plazo y la forma los pone el abogado; 3 cuando estén |
| Observabilidad | **4** | 6-sep · 2 · línea base: campana y coste por turno; una decisión pasada no se reproduce · **6-sep · 4 · fases 0+1:** cada turno lleva versión (hash del system, juez, conocimiento, objetivos), entrada renderizada y señales (168-171) — se reproduce; historial de configuración (167); los fallos viven en `incidencias` y se ven en Ajustes › Incidencias con campana solo si sistemático (207, en lugar del drenaje); métricas del modelo por día (174). 4,5 exige «ver por qué» por mensaje (2.8) |
| Resultados | **3** | 6-sep · 2 · línea base: «cocinado» por ventana; nada por id; sin línea base · **6-sep · 3 · fase 1:** el saliente enlaza al entrante que responde (170) y `metricas_diarias` da la serie diaria con definición versionada y `n` (172): 21 métricas, por sede y red, con backfill. 4 exige el antes/después por clínica (2.6) |
| Experimentación | **2** | 6-sep · 1,5 · línea base: harness serio; cero versionado en producción · **6-sep · 2 · fase 1:** versionado en producción (168: hash de cada pieza del prompt en cada turno). 3 exige el botón «el agente se equivocó aquí» (2.7) |
| Multi-sede | **3** | 6-sep · 2,5 · línea base: tenant por RLS, config por clínica todo-o-nada; `PILOT_CLIENTE` · **6-sep · 3 · fase 1:** la serie compara sedes — cada métrica por clínica y red, incluidos leads citados y pagos (por la clínica del paciente); incidencias e historial de configuración por clínica. 3,5 exige herencia por campo y enrutado real |
| Inteligencia de dirección | **2** | 6-sep · 2 · línea base: Inicio operativo; cero anomalías, cero recomendación |

## Qué mueve cada área (para que la subida sea verificable)

- **Integración ERP** → 2 con la parte independiente del lector probada contra un simulador;
  3 con el lector leyendo un Gesden real; 4 con cierre de casos por hecho en Gesden.
- **Modelo de datos** → 3 con el eslabón acción→resultado por id y jsonb; 4 con contacto y
  oportunidad como entidades y un solo log.
- **Fiabilidad** → 4 con reintento y cola de trabajos; 4,5 con paralelismo del lote y tope de coste.
- **Derivación** → 4,5 con propietario nominal y escalado; 5 con voz y portal derivando.
- **Cumplimiento** → 3 con borrado, retención y consentimiento; 4 con DPA firmado y aviso de IA;
  5 con registro de accesos.
- **Observabilidad** → 3,5 con hash del prompt, entrada renderizada y log drain; 4,5 con métricas
  del modelo y «ver por qué» en producto.
- **Resultados** → 3 con resultados enlazados por id y serie diaria; 4 con antes/después por
  clínica y encendido escalonado.
- **Experimentación** → 3 con versionado en producción y botón de corrección; 4 con asignación
  online por clínica/hilo; 5 con playbooks que proponen.
- **Multi-sede** → 3,5 con herencia por campo y enrutado real; 4,5 con comparación normalizada.
- **Dirección** → 3 con inteligencia de conversación y mapa de fuga; 4 con anomalías explicadas;
  5 con modo objetivo.
