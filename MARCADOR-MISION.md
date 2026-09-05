# Marcador de misión

Las diez áreas del [diagnóstico estratégico](DIAGNOSTICO-ESTRATEGICO-2026-09-06.md), su nota y
**su historia**: de dónde a dónde, y qué la movió. No es un número, es el relato.

**Suma hoy: 22,5 / 50** (6 de septiembre de 2026, línea base).

Regla: al cerrar una fase del [plan maestro](PLAN-MAESTRO.md) se añade una línea al área que
tocó, con fecha y con la causa concreta. Nunca se sube una nota por intención: solo por algo
desplegado y verificado (lección 21: se mide lo que el usuario ve).

| Área | Nota hoy | Historia |
|---|---|---|
| Integración ERP y canales | **1** | 6-sep · 1 · línea base: WhatsApp Meta sólido; Gesden = CSV de pacientes + stub |
| Modelo de datos | **2,5** | 6-sep · 2,5 · línea base: log del agente excelente; oportunidad y acción no son entidades; tres logs |
| Fiabilidad del agente | **3,5** | 6-sep · 3,5 · línea base: idempotencia, fail-closed, juez + veto; sin reintento ni cola |
| Derivación | **4** | 6-sep · 4 · línea base: causas, cierre por hecho, ficha; sin propietario nominal |
| Cumplimiento | **2** | 6-sep · 2 · línea base: RLS y opt-out; sin borrado, consentimiento, aviso de IA ni DPA |
| Observabilidad | **2** | 6-sep · 2 · línea base: campana y coste por turno; una decisión pasada no se reproduce |
| Resultados | **2** | 6-sep · 2 · línea base: «cocinado» por ventana; nada por id; sin línea base |
| Experimentación | **1,5** | 6-sep · 1,5 · línea base: harness serio; cero versionado en producción |
| Multi-sede | **2,5** | 6-sep · 2,5 · línea base: tenant por RLS, config por clínica todo-o-nada; `PILOT_CLIENTE` |
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
