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

**Matiz (pagado en el portal del paciente) — una escritura que no toca ninguna fila NO es
un éxito.** `await` no basta: `UPDATE … WHERE id = ?` sobre una fila que no existe, o que
RLS no deja ver, **afecta a cero filas y no lanza nada**. El await se cumple, el catch no
salta, y el flujo sigue confirmando. Toda escritura por id que confirma algo a alguien
comprueba su recuento de filas (`lib/db/escritura` → `actualizarUna`). Excepción, y se
comenta en su línea: cuando cero filas es un resultado legítimo (un opt-out por un teléfono
que no es de nadie, un "marcar todas leídas" sin nada pendiente) — ahí forzar un error es
ruido que acaba silenciado con un catch, que es peor.
> **Nos lo enseñó:** aceptar un presupuesto desde el portal era un no-op silencioso para
> TODOS los clientes. El portal resolvía su cliente a `PILOT_CLIENTE` (RB) porque el token
> no lo guardaba; RB está vacío, así que RLS filtraba la fila, el update afectaba a cero
> filas, la ruta marcaba el token como respondido y devolvía `{ok:true}`. El paciente leía
> "gracias por aceptar" y la clínica no se enteraba nunca. El ORDEN de escritura era
> correcto desde meses antes: lo que faltaba era comprobar que la escritura escribió.

**Matiz 2 — un `await` sobre algo que se traga su propio fallo es una garantía falsa.**
Si una función tiene un `catch` interno que loguea y no relanza, `await`arla no persiste
nada: solo espera. Cuando lo que escribe ES el dato (la firma de una aceptación, que no
tiene columna propia y vive en el historial), hay que pedirle explícitamente que falle
(`registrarAccion({ obligatorio: true })`).

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

**Matiz — esto aplica también a nuestras herramientas, y ahí el fallo silencioso tiene otra
forma: el error sin nombre, repetido.** Un script de QA o de verificación que devuelve N
fallos idénticos y anónimos no está informando, está degradando — y encima parece que
funciona. Reglas:
- **Sonda antes de la batería.** Si lo primero que se comprueba delata que no estamos
  hablando con lo que creemos (contesta otro servidor, la URL no es la nuestra, la respuesta
  no tiene la forma esperada), se **aborta con un motivo** y un código de salida propio, en
  vez de arrastrar el mismo error por las N comprobaciones. N fallos iguales son **un** fallo
  de la herramienta, no N hallazgos.
- **Distingue "no pude comprobar" de "comprobé y está mal".** Códigos de salida distintos:
  el CI y la persona toman decisiones opuestas ante cada uno.
- **Renderiza el error, no lo concatenes.** Un `error` puede llegar como texto, como objeto
  o como `Error`; `"… " + err` imprime `[object Object]` y borra justo el dato que hacía
  falta.

> **Nos lo enseñó:** el fallo del mandamiento 8 vivía en un catch silencioso — el registro
> de acciones llevaba roto desde la separación de bases, y con él el KPI de tiempo de
> respuesta, sin que nadie lo supiera. Y el matiz, `verificar-produccion`: daba 401 en sus
> ocho comprobaciones contra un despliegue sano porque la petición ni llegaba a la app (la
> paraba Deployment Protection de Vercel), y el motivo se imprimía como `[object Object]`
> porque Vercel manda su error dentro de un objeto. Una herramienta que informa mal
> convierte un problema de dos minutos en una tarde.

### 10. Un fallo de carga nunca se convierte en una lista vacía
`?? []` sobre la respuesta de un fetch es el bug, no un descuido: convierte
"no se pudo preguntar" en "no hay nada", y para la coordinadora son
indistinguibles — salvo que la segunda es la que hace que deje de mirar. La
regla operativa: **ningún cliente escribe `fetch` a pelo**; todos pasan por
`cargarJSON()` de `lib/fetch-json`, que comprueba el status, el cuerpo y el
campo `error` (varias rutas lo mandaban con 200), y **lanza** en vez de
devolver un valor por defecto. Y del lado del servidor, un catch devuelve
**status real**: mientras una ruta responda 200 con `{lista: []}`, cada cliente
tiene que acordarse de mirar un campo que nadie mira.
El patrón de consumo, entero: **conservar lo último bueno + error honesto +
reintentar**. Vaciar la pantalla ya es perder información que sí teníamos.
> **Nos lo enseñó:** tres veces el mismo bug — un 401 dejaba la cola de
> presupuestos vacía, otro 401 pintaba Cobros como "¡todo cobrado!", y en
> julio de 2026 un dev server roto hizo que /presupuestos anunciara "0
> presupuestos abiertos · 0 €" con 123 en la base. El censo que siguió
> encontró 8 clientes y 11 rutas con la misma forma, más una ruta que
> devolvía **presupuestos demo inventados** a un paciente real cuando la base
> fallaba.

### 11. Retirar una dependencia se verifica en el entorno real, no en local
Quitar una integración no termina cuando el código deja de usarla: termina cuando se ha
comprobado **en el entorno donde corre de verdad**. El peligro no es el código que la
llamaba —ese se borra y se ve—, sino el que **decidía su comportamiento** con sus
variables. Al desaparecer del entorno, ese código cambia de rama sin que nadie lo toque, y
en local no se nota porque las variables siguen en `.env.local`.
Reglas operativas al retirar algo:
1. **Censar quién DECIDE con sus variables**, no solo quién las usa: `if (!process.env.X)`
   es el patrón peligroso; `process.env.X` a secas, no.
2. **Quitar esas ramas ANTES de quitar las variables** del entorno, no después.
3. **Comprobar contra el entorno desplegado** que las rutas afectadas devuelven datos
   reales y que **una escritura persiste al releerla** — un 200 no demuestra que se haya
   escrito (`npm run verificar:produccion`).
4. Lo que el entorno necesita se **declara** (`lib/entorno`) y se comprueba al arrancar
   (`instrumentation.ts`): en producción aborta, en desarrollo grita. Fallar al arrancar es
   barato; degradar en silencio no.
> **Nos lo enseñó:** al retirar Airtable se quitaron `AIRTABLE_API_KEY` y `AIRTABLE_BASE_ID`
> de Vercel. Trece archivos decidían con ellas, así que **producción degradó en silencio
> durante semanas**: seis escrituras confirmaban éxito sin escribir (incluido un importador
> de CSV que respondía "importados N" con cero escritos), el motor de automatizaciones
> abortaba en cada ejecución, la cola de intervención salía vacía con 28 casos reales, y
> /presupuestos devolvía 500 que la pantalla pintaba como "0 presupuestos abiertos". Ningún
> QA local podía verlo: en local las variables seguían existiendo. Lo destapó una pregunta
> del fundador sobre unos ceros en pantalla, no una alarma.

### 12. Un valor que viene de datos nunca se indexa a pelo, y una sección nunca tumba la app
Dos caras del mismo día. **(a)** `DICC[x].campo` donde `x` sale de la base es un crash esperando
su fila: el tipo NO garantiza nada, porque entre la columna y el componente hay siempre un casteo
(`String(f["Estado"]) as Estado`) o un seed que escribe otra cosa. Se lee con `deDiccionario`
(`lib/diccionario`), que devuelve un fallback **y avisa una vez por clave** — un fallback mudo
esconde el desajuste igual de bien que un catch mudo (§9). **(b)** Y toda sección tiene su
`error.tsx`: sin frontera, un fallo de render en un widget desmonta el árbol entero y deja al
usuario sin menú, con la URL como única salida.
> **Nos lo enseñó:** `EVENTO_CONFIG[sec.tipoEvento].color` con `tipo_evento="seguimiento"` —valor
> que escribía nuestro propio seed— tumbaba Automatizaciones y con ella la navegación de todo el
> producto. En el MISMO archivo, 194 líneas más abajo, el diccionario de al lado ya tenía su `??`:
> por eso la respuesta es una función compartida, no acordarse. Y el censo destapó que la "columna
> Tipo vacía" de /llamadas era el mismo bug con otra sintaxis (`DICC[x]` en vez de `DICC[x].campo`):
> uno rompía y el otro borraba un dato en silencio.

### 13. Un umbral de negocio se cuenta en días de la clínica, no en una ventana rodante
"Hace 72 h" contra `Date.now()` se cruza al SEGUNDO: la cifra cambia sola entre dos recargas y no
hay nada que el usuario pueda hacer para explicárselo. El negocio de una clínica se mide en días de
calendario ("hace tres días que le escribimos"), así que la CLASIFICACIÓN se ancla al día de la
clínica y solo cambia a las 00:00. El tiempo transcurrido exacto se sigue mostrando: precisión en lo
que se lee, estabilidad en lo que se decide.
Corolario, y es donde está el peligro: **cambiar la unidad de una constante exige cambiar su NOMBRE
y, si se puede, su tipo.** `48*3600*1000` y `2` son los dos `number`: un caller sin migrar compila y
significa otra cosa por un factor de 86 millones, en silencio.
> **Nos lo enseñó:** el titular «cuánto hay en juego hoy» de /red subía 1.750 € en dos minutos y un
> 62 % en 24 h sin que nadie tocara nada, y dos cruces separados 1,2 s daban el salto de 310 € que
> reportó una revisión externa. Al migrar, el compilador cazó 6 callers — y se escaparon dos que
> hacían aritmética en milisegundos con la constante, precisamente porque el tipo no cambiaba.

### 14. Un parámetro que el código ignora es peor que no tenerlo
`calcularDashboardRed({ ahora })` existía, nadie lo pasaba, y la función que decidía la mitad de la
pantalla llamaba a `Date.now()` por dentro. El QA creía estar fijando el instante y no fijaba nada:
no podía afirmar nada sobre esa sección, y su comprobación de paridad podía fallar sola si un caso
cruzaba el umbral entre las dos lecturas del reloj. Si un cálculo depende del tiempo, el instante se
**inyecta desde el borde y se enhebra hasta el fondo**; si no se va a enhebrar, no se acepta el
parámetro.

### 15. El seed respeta el vocabulario real, y hay una invariante que lo comprueba
Un seed que escribe un valor fuera del union no son "datos de prueba": es una demo que miente, y a
veces una demo que se cae. La comprobación va **dentro** del seed (transaccional, con rollback), no
en un script aparte que nadie corre, y declara el vocabulario a mano: cambiar un union sin pensar en
el seed tiene que romper en el próximo `demo:reset`.
> **Nos lo enseñó:** tres veces. Motivos de descarte en texto libre (MEJORAS 41), `"Primera Visita"`
> vs `"Primera visita"` (MEJORAS 77), y `tipo_evento="seguimiento"` + `tipo_llamada="recordatorio"`
> el 31 de julio. Las tres se cazaron mirando una pantalla, ninguna con un test.

## Checklist antes de dar por bueno un cambio de backend

- [ ] ¿Todo "éxito" que comunico está **persistido antes** de comunicarse? (§1)
- [ ] Si es una escritura por id, ¿**compruebo que tocó una fila**? ¿Y la función que llamo relanza su fallo o se lo traga? (§1, matices)
- [ ] ¿Qué pasa si esto se ejecuta **dos veces**? ¿Duplica mensajes o registros? (§2)
- [ ] Si falta contexto/secreto/permiso, ¿esto **falla con error** o cae a un default? (§3)
- [ ] Ante un fallo de la fuente de datos, ¿el usuario ve un **error honesto**? (§4)
- [ ] Si toqué un filtro de acceso, ¿**intenté saltármelo**? (§5)
- [ ] Si el código corre sin sesión, ¿su cliente/base es **explícito**? (§6)
- [ ] ¿Puedo citar `archivo:línea` de la causa que estoy arreglando? (§7)
- [ ] Si toqué esquema/bases de Airtable, ¿revisé los **linked fields** afectados? (§8)
- [ ] ¿Algún catch de este cambio puede **tragarse un fallo sistemático**? (§9)
- [ ] Si es una herramienta de QA/verificación: ¿tiene **sonda previa**, distingue "no pude comprobar" de "está mal", y **renderiza** el error en vez de concatenarlo? (§9)
- [ ] Si el cambio carga datos, ¿usa `cargarJSON()` y **no** hay ningún `?? []`? (§10)
- [ ] Si retiro una dependencia, ¿he censado quién **decide** con sus variables, y lo he verificado **en el entorno desplegado**? (§11)
- [ ] ¿Indexo un diccionario con una clave que viene de datos? ¿Pasa por `deDiccionario`? ¿Tiene su sección `error.tsx`? (§12)
- [ ] Si hay un umbral de tiempo, ¿se cuenta en **días de la clínica**? Y si cambié la unidad de una constante, ¿cambié también su **nombre**? (§13)
- [ ] ¿Algún parámetro de este cálculo se ignora por dentro (`ahora`, `ahoraMs`)? (§14)
- [ ] Si toqué un union o un enum, ¿el seed lo respeta y la invariante lo comprueba? (§15)

## Cómo crece este skill

Cuando se pague un error nuevo: el **qué pasó** se anota en `DECISIONES.md` (2-4 líneas,
mismo cambio que lo cierra); si además destila una **regla general** que el código nuevo
debe cumplir, se añade aquí como mandamiento con su línea de "Nos lo enseñó". Las
referencias S1-S12 son de la tabla de fiabilidad de
[AUDITORIA_FABLE.md](../../../AUDITORIA_FABLE.md) (§Área 4).
