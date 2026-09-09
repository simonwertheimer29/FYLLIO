# ESTADO.md

Dónde está Fyllio hoy, en una pantalla. Se lee al abrir sesión y se regenera al cerrarla.

> **Esto es derivado, nunca fuente.** Todo lo de aquí vive con su detalle en otro archivo y se
> resume enlazando. **Si algo solo existe en ESTADO.md, está en el sitio equivocado** — muévelo
> a su documento y déjalo aquí como una línea.
>
> Se genera leyendo [`MEJORAS-PENDIENTES.md`](MEJORAS-PENDIENTES.md) ·
> [`MERCADO.md`](MERCADO.md) · [`DECISIONES.md`](DECISIONES.md) ·
> [`REUNION-RB-DENTAL.md`](REUNION-RB-DENTAL.md) · [`PLAN-AGENTE.md`](PLAN-AGENTE.md) ·
> [`CONSULTA-LEGAL-AGENTE.md`](CONSULTA-LEGAL-AGENTE.md).

**Regenerado:** 6 de septiembre de 2026.

---

## Ahora mismo

**Hoy (6 sep): el plan maestro gobierna.** Diagnóstico estratégico aprobado (22,5/50 en diez
áreas) → [`PLAN-MAESTRO.md`](PLAN-MAESTRO.md) (fases 0-5 con estado, bloqueantes de Simon, Gesden
sin RB, censo de MEJORAS) y [`MARCADOR-MISION.md`](MARCADOR-MISION.md) (cada nota con su historia).
**Fases 0 y 1 en curso a la vez.** Hecho el 6-sep (migraciones 037-039 aplicadas, cinco commits):
versión + entrada renderizada + señales en cada turno y el eslabón saliente→entrante (168-171);
barrido de reevaluación con QA (163); historial de configuración (167); envío de logs inerte hasta
destino (162); derecho de supresión, retención con plazo declarado y registro de consentimiento
(147, 166); tope de turnos y reintento del interruptor (145, 155).

| Queda en fase 0 | Quién |
|---|---|
| 164 cola ✅ 6-sep (QStash: el turno del evaluador; fallos agotados → `incidencias` + campana) · 207 incidencias ✅ 6-sep (Ajustes › Incidencias) | Simon: `COLA_URL_BASE` en `.env.local` y `npm run cola:programar` (disparador de 10 min del barrido) |
| 165 una sola salida automática | **Bloqueada por el catálogo de Meta** — declarada, no olvidada |
| 134 composer ✅ 6-sep · 130 saliente manual pendiente de confirmar ✅ 6-sep (`qa:modo-manual`) | — |
| Plazo de retención · forma del consentimiento | **Simon** (abogado). El destino de logs (162) se aplaza a clientes reales: lo capturable va a `incidencias` |

**FASE 1 CERRADA (6-sep).** `metricas_diarias` con 21 métricas v1 (incluidas `leads_citados`,
`leads_convertidos`, pagos por clínica y latencia del modelo; migración 041), `evaluacion_json` en
jsonb con GIN (042) y lectores migrados, `after()` verificado en paralelo. `qa:metricas`,
`qa:ficha`, `qa:turno`, `qa:entrante` en verde. Marcador: 22,5 → 28,5
([`MARCADOR-MISION.md`](MARCADOR-MISION.md)). Fase 0 sigue abierta SOLO por bloqueantes externos
(165 Meta; consentimiento y plazo, abogado). Censo y fases: [`PLAN-MAESTRO.md`](PLAN-MAESTRO.md).
**8-sep · a583fb1 rompió el build de Vercel** (un «use client» importando de `metricas/diarias` →
`pg`), con el hook puesto: el hook construía el índice de HEAD porque `git add` y `git commit`
iban en el mismo comando. Arreglado por la vía correcta (`metricas/definiciones.ts` puro) y con
guarda por construcción: `qa:frontera` en `prebuild` y en el hook, que además deniega la mezcla
add+commit (MEJORAS 208, lección §24, DECISIONES 8-sep).

**FASE 2 ABIERTA (7-sep) por 2.6, hecha:** Analíticas › Antes y después (clínica o red, marca por
hito o fecha, ventana igual 7/14/28, n, no comparable con motivo, aviso de no causalidad;
`qa:antes-despues` 22/22). `demo:reset` regenera la serie de 45 días y el hito «agente encendido».
Simon cerró lo suyo: Vercel sin protección en producción (405), `COLA_URL_BASE` y `cola:programar`
hechos → la cola está viva. Backfill histórico real cuando haya clientes:
`npm run metricas:backfill -- --cliente RB --desde … --hasta …`.
**8-sep · 2.5 hecha (MEJORAS 180):** dos métricas en la serie (`respuesta_humana_prioritaria_min`
y `_normal_min`): de la entrega del agente al primer saliente confirmado de una persona, en minutos
laborables, por cola derivada del hecho; solo la primera entrega del episodio; lo sin contestar no
cuenta (está en la cola). Inicio › Tu equipo la enseña con n y ventana (7 días completos). De paso:
el join evento→mensaje por clínica solo miraba `waba_message_id`, que el seed no rellena → todas las
métricas del agente POR SEDE eran 0 en DEMO; ahora enlaza como el barrido (`waba ?? id`).
**8-sep · 2.8 hecha (MEJORAS 183):** «Ver por qué» en cada mensaje del agente en Mensajería
(`lib/agente/por-que` + `GET /api/agente/por-que` con el aislamiento de la ficha): qué entendió,
qué recogió, qué anotó, qué decidió, el control, el borrador y lo técnico plegado (versión 168,
lo que vio el modelo 169). Panel en la columna lateral (flotante en móvil), botón en el mensaje
que la persona ve (saliente del agente o, si no contestó, el entrante). «Reproducir en el banco»
carga el hilo real hasta ese mensaje con la configuración de hoy. `qa:por-que` 26/26.
**8-sep · 2.7 hecha (MEJORAS 182):** «El agente se equivocó aquí» en el pie del panel «por qué»: qué
falló (cinco opciones en palabras de coordinadora; la de la decisión va en contra de lo que hizo) y
qué debería haber hecho. El servidor copia lo persistido del turno (turno explicado, entrada 169,
borrador, decisión, versión 168) a `casos_candidatos_eval` (043, RLS, uno por turno, volver a marcar
reabre la revisión). Revisión humana: `npm run evals:candidatos -- --cliente X` (lista, `--md`,
`--aceptar`/`--descartar`); la copia a evals/ es a mano y anonimizada. La regla de acceso al hilo es
ahora UNA función (`acceso-hilo-sesion`) para ficha, por-qué y candidatos. Se borra con el hilo
(supresión/retención) y en el wipe de DEMO. `qa:candidatos` 25/25. Pendiente de mirar en el
navegador (el QA cubre el módulo y la ruta, no el panel).
**9-sep · 2.4 hecha (MEJORAS 179, 184, 185):** «Cómo decide tu agente» en Agentes › Configuración
(`lib/agente/confianza` + `GET /api/agente/confianza`, scoping de Inicio). La VARA sale de
`evals/ultima-pasada.json` (lo escribe `qa:evals-evaluador` al terminar una pasada entera; hoy,
transcrita de la del 5-sep: 66/67, listo 21/21, control 7/73) con el hash 168 de los dos prompts
medidos, comparado con el que corre hoy («es la misma versión» / «el agente cambió: la vara está
por pasar»). Las CONVERSACIONES REALES por sede, 30 días completos hasta ayer: turnos, te libera
(caso listo de entregas), lo paró el control, enviado tal cual, marcado como error (2.7), y debajo
qué sigue exigiendo persona y qué aplazó. En Inicio › Tu equipo, «el equipo envía el borrador tal
cual el X %» con el reparto y el DISPARADOR DECLARADO hacia modo B (80 % sobre 50 envíos,
provisional — decisión de Simon pendiente, MEJORAS 214). `envios_tal_cual` en la serie diaria (23 →
24) y en Antes/después. El seed de DEMO mide los borradores enviados y marca dos turnos como error.
`qa:confianza` 31/31 · `qa:metricas` en verde. Pendiente de mirar en el navegador (como 2.7).
**Siguiente sesión, en frío: 2.9** (Inicio: lo que ya está en marcha, motivos honestos, pantallas de
demo). Antes, Simon prueba en el navegador el formulario de 2.7, el bloque de 2.4 y los cuatro
paneles de detalle de Inicio (abajo).
**9-sep (tarde) · El detalle de cada bloque de Inicio ya no se despliega en línea** (al abrir el del
equipo, Dinero se iba de la pantalla): se abre en un panel flotante AL LADO del bloque, 32 rem, sin
oscurecer, con el titular del bloque repetido en la cabecera. Cascarón nuevo `PanelFlotante`
(`components/ui`), que ya usa también el panel de agendar; el editor de cita y la hoja móvil de «por
qué» quedan como [MEJORAS 215-216](MEJORAS-PENDIENTES.md). Detalle en DECISIONES 9-sep.
**8-sep · Antes/después contaba la historia contraria** («leads citados» 0 → 0 y, tras encender
el agente, respuesta más lenta y −22 % convertidos): el volumen del seed no sabía del hito ni
tenía citas de leads. Ahora siembra el efecto del agente desde `HITO_DIAS = 23` (respuesta en
minutos, 0,30 → 0,42 con cita, visita más cerca, diez aceptados más, log del agente solo desde
el hito) y el volumen evita fines de semana y el pico del día 1. Límite estructural que queda:
el tramo de Inicio pinado al día 1 desplaza las ventanas según el día del mes ([MEJORAS
209](MEJORAS-PENDIENTES.md)). Detalle en DECISIONES 8-sep.

### Lo anterior (5 sep)

**Hoy (5 sep): auditoría profunda del agente y su resolución en el mismo día.** Detalle en las
tres entradas del 2026-09-05 de [`DECISIONES.md`](DECISIONES.md); cada hallazgo, en
[MEJORAS 117-155](MEJORAS-PENDIENTES.md) con severidad y esfuerzo.

| Qué se cerró | Dónde |
|---|---|
| **Nada se pierde en la entrada**: lote entero de Meta, todos los tipos (audio, foto, documento, botón), dedup en base y KV marcado después de persistir, `maxDuration` en el webhook | 034 · `webhooks/whatsapp` · MEJORAS 117-118, 129 |
| **Un solo borrador**: composer y chat embebido enseñan el del evaluador; el de entrada solo en el relevo; veto determinista en los dos; la coincidencia se mide contra ese texto | `lib/agente/borrador-agente` · MEJORAS 119 |
| **Estados que se pudrían**: coletilla del cobro una vez, botón «Respondido», insistencia desde el último resuelto, espera fuera de tope visible | MEJORAS 120, 121, 123, 124 |
| **Fallos que nadie veía**: avisos en la campana + filtro y banda «Sin evaluar» | `lib/agente/avisos` · MEJORAS 128 |
| **Opt-out con una fuente** y detección conversacional | `lib/contacto/optout` · MEJORAS 135 |
| Idioma, rangos de config, inyección delimitada + tanda I del eval, caso 35 a código, señales del hilo, panel de descartes del juez | MEJORAS 136-138, 149-151 |

**Lección nueva en el skill de ingeniería (§21):** se verifica lo que el usuario VE, no lo que el
pipeline produce. Dos veces se midió un artefacto que no era el producto.

**QA en verde:** parseo · conocimiento · tipos · bandeja · ficha · turno · semáforo · contexto ·
entrante (siembra su propio estado) · tanda I 4/4 · casos 16/6 10/10 en cinco corridas · vara
completa 99 %. Gasto de modelo de la sesión: $0,43 (`evals/pasadas/GASTO.md`).

### Las cuatro decisiones, tomadas y ejecutadas el mismo día

Hilo único por persona con una sola regla de acceso (122) · rojo por queja cerrado con dos hechos y
edad visible (125) · guarda de ambigüedad para el teléfono compartido (139) · 49 remapeado a A
(152). Detalle en DECISIONES 2026-09-05.

**Vara completa tras el system nuevo: 66/67 (99 %)**, desde el 95 %. Único fallo el 35, que ahora
sigue sin anotar (S) donde la vara pide A: **decisión de vara pendiente de Simon** (remapear a S,
como el 49).

### Lo que no se toca sin el abogado

[`CONSULTA-LEGAL-AGENTE.md`](CONSULTA-LEGAL-AGENTE.md): lo que viaja a Anthropic (anonimización
que no anonimiza), retención y borrado, transparencia de IA (MEJORAS 108), consentimiento y
menores. Una página, con lo que costaría cada respuesta.

### Pendiente de comprobar a mano

- **Fluid Compute**: confirmado ACTIVO por Simon en Vercel; `maxDuration = 60` se queda.
- **Transcripción de audio** (MEJORAS 153): decisión aparte, con coste por minuto y otro proveedor
  de salud hablada.

---

## Bloqueado (sin cambio conocido desde el 12 de agosto)

| Qué | Por qué | Lo desbloquea |
|---|---|---|
| Piloto con datos reales de RB | Sin art. 28 y NDA firmados no se toca un dato de paciente | Firma de ambas partes |
| Consulta legal · Reglamento de IA + los cuatro puntos de la auditoría | La fórmula de transparencia condiciona el catálogo de Meta; la retención condiciona el borrado | Simon: asesoría jurídica |
| Enviar las 11 plantillas a Meta | Cuenta de Meta Business con NIF → alta fiscal | Alta fiscal + consulta legal |
| Piloto real por WhatsApp (fase 0 de [`PLAN-AGENTE.md`](PLAN-AGENTE.md)) | Sin registro fiscal no hay verificación de empresa ni número real | Alta fiscal + email de dominio propio |

---

## Próximos tres hitos

1. **Caso 35 en la vara** — remapear a S o no; una línea en el harness.
2. **Consulta legal** con [`CONSULTA-LEGAL-AGENTE.md`](CONSULTA-LEGAL-AGENTE.md) — bloquea el
   catálogo de Meta y el borrado.
3. **Arranque del piloto** — condición: RB, art. 28, NDA, alta fiscal.

---

## Hipótesis abiertas esperando validación

Once, en [`MERCADO.md` §4](MERCADO.md). Las de la reunión de RB (H2, H3, H4, H5, H7, H8, H10, H11)
y las del piloto (H1, H6, H9). H9 sigue condicionando el texto de las plantillas y ahora también la
fórmula de transparencia: hay que medirlas por separado.

---

## Pendientes que no son código

De [`REUNION-RB-DENTAL.md` §9](REUNION-RB-DENTAL.md): contrato art. 28, NDA, alta fiscal, dominio
propio, carga de pacientes y doctores de RB, censo de teléfonos (`npm run qa:telefonos`) antes de
cualquier envío, plantillas de cobranza de RB, teléfonos del seed al rango reservado.

---

## Salud del repo

| | |
|---|---|
| Rama | `main`, limpia y al día |
| Migraciones | hasta la **042** aplicadas; `qa:tipos` al día (25 tablas declaradas) |
| Tipos | `tsc` en verde |
| QA determinista | `qa:parseo` · `qa:conocimiento` en verde |
| QA con base | `qa:bandeja` · `qa:ficha` · `qa:turno` en verde; `qa:entrante` 4/4 en el orquestador (sus 2 rojos: el interruptor del seed está encendido en DEMO y el QA espera apagado) |
| Eval del evaluador | **99 % (66/67)** en la pasada completa del 2026-09-05 con el system nuevo; el 35 es decisión de vara. Una pasada completa cuesta ~$0,35 |
| MEJORAS | 155 entradas · las 117-155 de la auditoría: 21 hechas 🟢 · 1 parcial (136) · 17 abiertas 🔵 |
| Lint | limpio en los archivos nuevos; los `any` que quedan en `webhooks/whatsapp` y `mensajeria.ts` son anteriores |
