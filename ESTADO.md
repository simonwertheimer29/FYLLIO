# ESTADO.md

Dónde está Fyllio hoy, en una pantalla. Se lee al abrir sesión y se regenera al cerrarla.

> **Esto es derivado, nunca fuente.** Todo lo de aquí vive con su detalle en otro archivo y se
> resume enlazando. **Si algo solo existe en ESTADO.md, está en el sitio equivocado** — muévelo
> a su documento y déjalo aquí como una línea.
>
> Se genera leyendo [`MEJORAS-PENDIENTES.md`](MEJORAS-PENDIENTES.md) ·
> [`MERCADO.md`](MERCADO.md) · [`DECISIONES.md`](DECISIONES.md) ·
> [`REUNION-RB-DENTAL.md`](REUNION-RB-DENTAL.md) ·
> [`guion-demo-fyllio.md`](guion-demo-fyllio.md) ·
> [`PLAN-AGENTE.md`](PLAN-AGENTE.md).

**Regenerado:** 12 de agosto de 2026.

---

## Ahora mismo

**Hoy (3 ago) entran al repo los tres documentos de la capa de automatización.** Son de producto
y estrategia, **no specs**: nada de ellos se implementa sin decisión explícita en
[`DECISIONES.md`](DECISIONES.md).

| Documento | Qué es | Estado |
|---|---|---|
| [`PLAN-AGENTE.md`](PLAN-AGENTE.md) | El plan por fases + anexo de WhatsApp Business API | **Plan de producto, no hoja de ruta comprometida.** De cinco fases, **solo la 0 y la 1 decididas** |
| [`docs/arquitectura-agente-quiebre.html`](docs/arquitectura-agente-quiebre.html) | Dónde trabaja el agente y dónde entra la persona, etapa por etapa | Borrador visual para discusión |
| [`docs/arquitectura-app-automatizacion.html`](docs/arquitectura-app-automatizacion.html) | La app reorganizada por función + la máquina de estados de un caso | Borrador visual para discusión |

Los dos HTML se abren en el navegador y **no forman parte de la aplicación**: viven en
[`docs/`](docs/), fuera de `app/` y de `public/`, así que Next ni los sirve ni los compila
(verificado con `npm run build`). El anexo de WhatsApp lleva **la misma regla de higiene que
[`MERCADO.md`](MERCADO.md)**: son fuentes secundarias del 1 de agosto y sus precios y plazos
**hay que reverificarlos antes de comprometerlos con un cliente**.

**Y el mismo día, dos correcciones al plan recién escrito:**

**1 · La auditoría de WhatsApp — el modo B no está por construir, está construido y desconectado.**
Censo completo del código antes de arrancar la fase 0; detalle en [`DECISIONES.md`](DECISIONES.md).
El envío por Graph API, el webhook con firma y deduplicación, el rate-limit, la idempotencia y el
switch en la UI **ya existen y funcionan**. Lo que falta es el **envío por plantilla**:
`enviarPlantilla` está implementado y **no lo llama nadie**, y sin plantilla no se inicia
conversación fuera de la ventana de 24 h — que es todo lo que hace un recordatorio. **La fase 3 del
plan quedó reescrita entera**: qué está hecho, qué falta, y el catálogo de **11 plantillas** con qué
cadencia usa cuál, sus variables y su coste (medio día de redacción + la espera de Meta, que es lo
que marca el calendario). Estimación honesta: **~1 semana de código + el tiempo de Meta**.

De la auditoría salieron además dos cosas que **ya están cerradas hoy**:

| Qué era | Cómo se cerró |
|---|---|
| **`sendWhatsAppMessage` se tragaba los fallos de envío** — sus 5 callers tenían `try/catch` muerto, `sent++` contaba envíos que no salieron, y el motor de no-shows consumía cooldown y emitía `mensaje_enviado` por mensajes que nadie recibió. Era [`7399c55`](DECISIONES.md) sobreviviendo en la capa de envíos | ✅ Lanza `EnvioWhatsAppError`, que distingue **«sé que no salió»** de **«no lo sé»** (§2: no se reintenta a ciegas). De paso, un envío fallido ya no queda marcado como hecho en el dedup del cron. **12/12** en las cuatro ramas |
| **[MEJORAS 60](MEJORAS-PENDIENTES.md) · `/api/whatsapp/send` daba 404** desde dos paneles | ✅ La arqueología dio la respuesta: la ruta **se borró a propósito** en `a8717a3`, y `NoShowRiskPanel` + `OperationsPanel` eran **los dos supervivientes** de esa limpieza — sin consumidor, llamando a 4 rutas muertas. Borrados (1.599 líneas). La deuda de `?? []` baja de **15 a 12** |

**2 · Tres afinados de metodología en [`PLAN-AGENTE.md`](PLAN-AGENTE.md)**, todos dentro de la fase 1
o la 4, ninguno cambia el orden: **la tasa de coincidencia agente-humano** (medir si la coordinadora
envía tal cual, edita o reescribe — es el criterio objetivo para subir de modo, en vez de una
corazonada), **el conjunto de evaluación** de 30-50 conversaciones reales anotadas contra el que pasa
cada cambio de prompt, y **la autonomía concedida por intención en vez de por fase entera** (dentro
de presupuestos, «sigue vigente» puede ser autónomo y «cualquier cosa que roce el precio» no lo es
nunca). Los tres entran en la fase 1 salvo la matriz, que es de la 4.

**Sesión anterior (31 jul – 1 ago) cerrada: pasada visual completa y reconciliación de cifras.**
Nació de una revisión externa que recorrió producción sección por sección; el detalle de cada
cierre está en [`DECISIONES.md`](DECISIONES.md).

| Qué | Estado |
|---|---|
| El crash de Automatizaciones → Operativo | ✅ y con él la causa de fondo: **no había ni una frontera de error** en toda la app (ahora 15) |
| El dinero de `/red` cambiaba entre dos F5 | ✅ el umbral pasa de ventana rodante a **días de calendario de la clínica** |
| "Una tarjeta que desaparece" | ✅ no era avería: el filtro de clínica persiste. Ahora se **declara en las 8 pantallas** que lo siguen |
| La gráfica de 6 meses, plana el día 1 | ✅ [MEJORAS 88](MEJORAS-PENDIENTES.md) — pre-existente, cazado al cambiar de mes |
| Las 02:00 de `/llamadas` | ✅ el dato era correcto; fallaba el render. Cerrada la **última familia de MEJORAS 52** |
| `/alertas` no decía el dinero | ✅ y de paso murió su cálculo paralelo de cobros |
| Las "cuatro cifras que no cuadran" | ✅ censadas: **cero errores de cálculo**, tres definiciones legítimas |

**La pasada visual pantalla por pantalla está TERMINADA:** `/red` · `/kpis` · `/presupuestos` ·
`/cobros` · `/pacientes` · `/leads` · `/llamadas` · `/alertas` · `/seguimiento`.

### En cola, ya aprobado, para después de la reunión

- ~~Fusión de `/automatizaciones` + `/ajustes`~~ · ~~`/informes` como pantalla propia~~ —
  **las dos hechas el 10 de agosto** ([MEJORAS 13](MEJORAS-PENDIENTES.md) ·
  [81](MEJORAS-PENDIENTES.md), y de paso [74](MEJORAS-PENDIENTES.md)). `/ajustes` es el único centro
  de configuración con una URL por sección; `/automatizaciones` se queda con Motor, ¿Escribe bien? y
  Operativo; `/informes` sale del cajón de `/kpis`. El paso de riesgo era mayor de lo escrito: no
  eran dos editores duplicados, era **una tabla con dos idiomas** (migración 017).
- **Fase 1 de [`PLAN-AGENTE.md`](PLAN-AGENTE.md)** — estado de automatización por caso, cohorte de
  quiebre en Seguimiento, **tasa de coincidencia agente-humano** y **conjunto de evaluación**.
  Decidida, **no depende de WhatsApp**, y mejora el modo A que ya funciona hoy. Sin prioridad
  fijada frente a las dos de arriba.
- **El resto del informe externo**, que es flujo y no fallos: KPIs clicables, modo cola en el
  drawer, paginación de Pacientes ([MEJORAS 87](MEJORAS-PENDIENTES.md), sin priorizar).

---

## 🔴 Bloqueante de la demo — lo único que impide enseñarla

**El código no bloquea nada.** Lo que falta es de montaje, **y la semana de la reunión es esta**.

| Qué | Por qué bloquea | Quién |
|---|---|---|
| **`npm run demo:reset` el mismo día** | Ancla las fechas a "hoy". Sin él, la demo envejece y las comparativas del mes salen raras. **Es el único bloqueante que queda** | Simon, el mismo día |

**El tenant de RB dejó de ser bloqueante el 3 de agosto: la demo se hace íntegramente sobre DEMO.**
No se monta antes de la reunión porque **faltan decisiones que solo salen de esa conversación**, así
que pasa a ser el primer paso del onboarding. El §5 del guion ya no cambia de tenant: cierra
enseñando el **selector multi-clínica de DEMO** —«así es como van a mirar su red»— y coloca el alta
de su entorno como arranque del piloto. Sale más barato de recortar que el cierre anterior (dos
minutos sobre `/red`, sin cambiar de sesión) y no enseña ni una pantalla vacía.

Dato que sostiene la decisión, censado el 3 ago: **RB e INDEP devuelven 0 pacientes y 0 leads**, por
el mismo camino por el que DEMO devuelve 434 — así que están vacíos de verdad, no es un filtro. Se
creía que faltaban solo los doctores; falta todo. Sus **diez clínicas sí están creadas**, con sus
nombres reales y sus dos marcas, así que eso es cierto y se puede decir en la reunión — pero no se
enseña.

**No bloquean la demo, pero conviene saberlo antes de entrar:**

- **Sin dominio propio** — la URL es un `.vercel.app` con hash. Es lo primero que se ve, **y desde
  hoy bloquea también el trámite de WhatsApp** (ver abajo): Meta rechaza las verificaciones hechas
  con Gmail.
- **`FYLLIO_COOKIE` bloquea ya DOS cosas, no una.** Sin ella no corre `verificar:produccion` **ni**
  se puede leer `/api/salud`, que es lo único que responde desde fuera «¿este entorno sirve datos
  reales?». El 3 ago hizo falta y no estaba: `SUPABASE_DB_URL_APP` está marcada **Sensitive** en
  Vercel, así que `vercel env pull` devuelve `"[SENSITIVE]"` y **no hay forma de comprobar por
  valor** que la base de `.env.local` es la de producción. Con `/api/salud` se sabría en un GET.
  Ha subido de prioridad.
- **Los teléfonos del seed** no están en el rango reservado +34 600 000 xxx.
- **`/automatizaciones` y `/llamadas` no se enseñan** (guion §6). Llamadas ya lo dice en pantalla;
  Automatizaciones no.
- **La automatización no se promete.** Los tres documentos de hoy son borradores internos: en la
  reunión se enseña lo que existe, no el plan. Si sale el tema, lo honesto es "está diseñado, no
  construido, y arranca por lo que no depende de WhatsApp".

---

## Bloqueado (más allá de la demo)

| Qué | Por qué | Lo desbloquea |
|---|---|---|
| Piloto con datos reales de RB | Sin art. 28 y NDA firmados no se toca un dato de paciente | Firma de ambas partes |
| **Medir el clasificador** | **Se agotaron los créditos de la API de Anthropic** (6 ago). El eval no corre: su sonda aborta con código 2, que es lo correcto —«no pude comprobar» no es «falla»— pero deja sin medir el último cambio. **Último número fiable: 98 % (42/43)**, de ANTES de la regla de los dos intentos, que está **implementada y sin medir**. Y hay **sospecha de que ese 98 % estuviera inflado**: la red vieja de «Sin clasificar → quiebra» cazaba por accidente disparadores de fase 2 (tono negativo, pide persona), y en las dos corridas con crédito antes de agotarse (89 % y 87 %) fallaban justo esos | Simon: recargar créditos |
| **Consulta legal · Reglamento europeo de IA** | **En vigor desde el 2 de agosto de 2026:** quien habla con un sistema de IA tiene derecho a saberlo. El primer mensaje dice hoy *«soy asesor de la clínica»* — identifica al emisor, **no la naturaleza del interlocutor**, y probablemente no basta. Hay que preguntar **qué formulación cumple y dónde va** (¿solo el primer mensaje de cada conversación, o también al reanudar?). Detalle en [`MERCADO.md` §5](MERCADO.md) | Simon: asesoría jurídica |
| **Enviar las 11 plantillas a Meta** | **Escritas y revisadas el 7 ago** ([`PLANTILLAS-WHATSAPP.md`](PLANTILLAS-WHATSAPP.md)), texto aprobado, sin enviar. Exige cuenta de Meta Business con nombre legal y NIF → **depende del alta fiscal**. Tenerlas escritas **NO adelanta plazo**: el reloj de Meta no ha empezado a correr. **Ninguna está bloqueada por datos**: `seguimiento_sigue_vigente` lo estuvo y se reescribió sin el plazo de validez ([MEJORAS 89](MEJORAS-PENDIENTES.md)) para que las once salgan el mismo día | Solo el alta fiscal |
| **Piloto real por WhatsApp — fase 0 de [`PLAN-AGENTE.md`](PLAN-AGENTE.md)** | **Cadena de dependencia declarada: sin registro fiscal no hay verificación de empresa de Meta, y sin verificación no hay piloto real.** El 036/037 con NIF (o Fyllio S.L. constituida) es lo que habilita la verificación; la verificación es lo que da el **número real** de la clínica, quita el techo de **250 destinatarios únicos / 24 h** y es requisito de Tech Provider (fase 5). Es **el camino crítico del piloto, y no es código** | Simon: alta fiscal ante Hacienda **+** email de dominio propio |

**Lo legal NO corre en paralelo: bloquea la fase 3.** Es la consecuencia que apareció al anotar el
Reglamento el 12 de agosto, y cambia el orden de las cosas. Si la fórmula de transparencia tiene que
ir **dentro del texto** de las plantillas, entonces:

- **el catálogo no se puede enviar a Meta antes de saber qué dice**, porque cambiar una plantilla ya
  aprobada es una **reedición que vuelve a revisión** — y el reloj de Meta se reinicia;
- así que la consulta legal deja de ser un pendiente de fondo y pasa a ser **camino crítico de la
  fase 3**, al lado del alta fiscal y no detrás de ella;
- y conviene lanzarla **ya**, porque no depende de Hacienda: se puede resolver mientras el alta
  fiscal avanza, y es lo único de los dos que hoy no está esperando a nadie.

Traducción: **dos bloqueos en paralelo, no uno detrás de otro.** El alta fiscal habilita la cuenta;
la consulta legal fija el texto. Faltando cualquiera de los dos, el catálogo no sale.

**Y arrastra una decisión de medición que no se puede posponer** ([`MERCADO.md` §4](MERCADO.md)): las
plantillas van a cambiar por dos motivos a la vez —el mensaje neutro del art. 9, que es lo que mide
**H9**, y la declaración de IA— y si entran juntas en el mismo texto, **la caída de conversión no se
podrá atribuir a ninguna de las dos**. Hay que decidir cómo separarlas **antes del primer dato**,
porque después ya estarán mezclados.

**Dónde corta exactamente, para no declarar el bloqueo más grande de lo que es.** Sin registro
fiscal se puede crear la app de Meta, coger el **número de prueba** con su plantilla ya aprobada,
montar el webhook y **enviar y recibir mensajes reales a cinco destinatarios**: o sea, **construir y
probar la fase 3 entera**. El alta fiscal desbloquea tres cosas y ninguna es de código —
verificación de empresa, número real, y salir de los 250 destinatarios diarios. **Bloquea atender
pacientes a escala, no el desarrollo.** Las fases 1 y 2 pueden avanzar hoy, y **la 3 también en
código** — lo que no puede avanzar de la 3 es **enviar el catálogo**, que ahora espera a dos cosas
(alta fiscal y consulta legal), no a una.

Y con la auditoría de arriba, ese margen es aún mayor de lo que parecía: buena parte de la fase 3
**ya está escrita**.

---

## Próximos tres hitos

1. **Reunión con RB Dental** — **esta semana** (semana del 3 de agosto de 2026). Es la fecha que
   manda: ocho de las once hipótesis abiertas se tocan ahí. Preguntas y checklist previo en
   [`REUNION-RB-DENTAL.md`](REUNION-RB-DENTAL.md); cómo se enseña el producto, en
   [`guion-demo-fyllio.md`](guion-demo-fyllio.md).
2. **Fusión de ajustes + `/informes`** — condición: que pase la reunión. Ambas aprobadas y con
   propuesta escrita.
3. **Arranque del piloto** — condición: que RB diga que sí, más los pendientes de onboarding de
   abajo. Fecha a fijar en la propia reunión.

Y en paralelo, sin depender de nada de lo anterior: **fase 0** (el trámite, que solo avanza si
avanza el alta fiscal) y **fase 1** del plan de automatización.

---

## Hipótesis abiertas esperando validación

Once, todas en [`MERCADO.md` §4](MERCADO.md). Lo que las cierra:

| Se cierran en la reunión de RB | Necesitan datos del piloto |
|---|---|
| **H2** motor universal · **H3** tratamiento en pausa · **H4** captación vs cartera · **H5** estándar/premium · **H7** convivir con el PMS · **H8** el panel es el foso, no ser capa · **H10** precio 89-149 €/mes · **H11** decide gerencia, mata la coordinadora | **H1** dinero recuperado vs pago único · **H6** el tratamiento predice el no-show · **H9** el mensaje neutro convierte igual |

Refutadas y por qué, en la misma sección: **R1** (el 52% salía del seed de DEMO) y **R2** (los
9.000 de Madrid eran dentistas colegiados, no clínicas).

**H9** es ahora también la hipótesis que condiciona el diseño de las plantillas del agente: si el
mensaje neutro con enlace al portal no convierte igual, la restricción de datos de salud del art. 9
(anexo de [`PLAN-AGENTE.md`](PLAN-AGENTE.md), [MEJORAS 83](MEJORAS-PENDIENTES.md)) deja de ser
sólo una regla de cumplimiento y pasa a ser un coste medible.

---

## Pendientes que no son código

De [`REUNION-RB-DENTAL.md` §9](REUNION-RB-DENTAL.md), que es la lista viva:

- [ ] **Contrato art. 28 RGPD** firmado — bloqueante, antes de tocar un dato real.
- [ ] **NDA con RB** — bloqueante.
- [ ] **Alta fiscal ante Hacienda** (036/037 con NIF, o Fyllio S.L. constituida) — **nuevo, y es el
      camino crítico de la capa de automatización.** Ver Bloqueado.
- [ ] **Dominio propio** (`app.fyllio.com` o similar) — ahora con **dos** razones: una URL de Vercel
      con hash no se enseña a un cliente, **y** Meta rechaza o retrasa la verificación de empresa
      hecha con Gmail. Dejó de ser cosmético.
**Pasos de onboarding del tenant de RB** — dejaron de ser bloqueantes de la demo el 3 ago y son el
primer trabajo del piloto, en este orden:

- [ ] **Cargar pacientes y leads de RB.** Hoy: **0 y 0**. Las diez clínicas ya existen con sus
      nombres y sus dos marcas; lo que falta son los datos. Depende de qué PMS usen y de si se puede
      exportar — que es una de las preguntas de la reunión.
- [ ] **Alta de los doctores de RB** en Postgres: `staff` está vacía y el selector de doctor saldría
      vacío.
- [ ] **Censo de teléfonos con `npm run qa:telefonos`** en cuanto haya datos cargados, y **antes** de
      cualquier envío. Hoy no dice nada porque no hay a quién censar; el día que carguen, dice
      cuántos números saldrían mal a Meta, cuántos son fijos (WhatsApp no entrega ahí) y cuántos hay
      que mirar a mano. Es requisito de entrada a la fase 3 de [`PLAN-AGENTE.md`](PLAN-AGENTE.md).
- [ ] **Plantillas de cobranza de RB** actualizadas a `{{pendiente}}`.
- [ ] **Teléfonos del seed de DEMO** al rango reservado +34 600 000 xxx.

Y uno que salió de la investigación de mercado y sí es de producto, pero decide Simon:
[MEJORAS 83](MEJORAS-PENDIENTES.md) — nuestras plantillas de ejemplo nombran tratamiento e
importe en el mismo WhatsApp, que es dato de salud del art. 9.

---

## Salud del repo

| | |
|---|---|
| Rama | `main`, limpia y al día con `origin` |
| Fronteras de error | **15** (13 secciones + grupo + global) |
| Aviso de filtro de clínica | en las **8** pantallas que siguen al selector |
| Deuda de `?? []` | **12** (eran 15; las 3 de `OperationsPanel` se pagaron borrando el archivo), y el trinquete solo deja bajar (`npm run qa:sin-fallbacks`) |
| Rutas inexistentes llamadas desde componentes | **0** (eran 4, todas en los dos huérfanos retirados) |
| QA verde | `qa:fechas` **52/52** en 4 husos · `qa:cohortes` · `qa:estado-conversacion` · `qa:sin-fallbacks` · **`qa-dashboard-red`** (paridad + días 1/2/15) · `demo:reset` con 4 invariantes |
| QA de /kpis | 18/18 (`npm run qa:kpis`, necesita el server en :3100) |
| MEJORAS | 88 entradas · **64 abiertas** 🔵 · 30 hechas 🟢 · 19 cerradas ✅ · 4 descartadas ⚪ |
| Migraciones | 011 · 012 · 013 (visto hoy) aplicadas |
| Documentos de discusión | **2** HTML en [`docs/`](docs/), fuera del build. Verificado: `npm run build` no los sirve ni los empaqueta |
| Zona WhatsApp (censada 3 ago) | Envío WABA, webhook, rate-limit e idempotencia **vivos y completos** · **plantillas: 0 call sites** (es lo que falta) · siguen muertos `whatsapp/outbound.ts` y `whatsapp/llm.ts` (352 líneas, **sin retirar**: `outbound.ts` es el único que usa `META_WHATSAPP_TOKEN`/`META_PHONE_NUMBER_ID`, un segundo juego de env vars para lo mismo que `WABA_*`) · Twilio ya **no** traga fallos |
| Sin verificar en producción | Ver Bloqueado. Lo verificado la sesión pasada fue en navegador real contra el build de producción **en local** |
