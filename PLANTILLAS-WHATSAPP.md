# PLANTILLAS-WHATSAPP.md

Las once plantillas de utilidad que Fyllio envía por WhatsApp Business API. Es el catálogo de la
**fase 3** de [`PLAN-AGENTE.md`](PLAN-AGENTE.md).

**Escritas el 7 de agosto de 2026. Sin enviar a aprobación.**

---

## ⏸️ El reloj de Meta NO ha empezado a correr

Tenerlas escritas **no adelanta plazo**. Enviarlas a aprobación exige una cuenta de Meta Business
creada con el nombre legal, la dirección fiscal y el NIF, y eso depende del **alta fiscal, que sigue
sin resolver** (ver el bloqueo declarado en [`ESTADO.md`](ESTADO.md)).

Así que esto queda **listo para el día que se pueda**, no antes. Es trabajo hecho, no tiempo ganado —
y conviene no confundirlo, porque planificar la fase 3 contando con que la aprobación ya está en
marcha daría una fecha falsa.

Lo que sí evita: que el día que se resuelva lo fiscal, el envío a aprobación sea de horas y no de
días.

---

## Las dos reglas que cumplen todas

**1 · Ninguna nombra el tratamiento ni el importe.**
Un tratamiento dental concreto asociado a una persona es **dato de salud del artículo 9 del RGPD**, y
la Política de mensajes de WhatsApp Business restringe enviar información de salud donde la
regulación lo limita. El patrón es siempre el mismo: **mensaje neutro + enlace al portal**, donde el
paciente se identifica y ve su información en un entorno controlado.

Es [MEJORAS 83](MEJORAS-PENDIENTES.md), y la hipótesis **H9** de [`MERCADO.md` §4](MERCADO.md) mide
si el mensaje neutro convierte igual. **Si H9 se refuta, esto se replantea entero** — pero se
replantea con el dato delante, no antes.

**2 · Cada una declara qué conversación abre y con qué cadencia se usa.**
Porque eso es lo que hace la plantilla: **abrir la ventana de 24 horas**. Fuera de esa ventana solo
sale una plantilla aprobada; dentro, el agente puede conversar libremente. Una plantilla sin saber
qué conversación abre es una plantilla que no se sabe para qué se manda.

---

## Decisiones de redacción, para que se puedan discutir

- **Tuteo.** Coherente con el resto del producto. El plan de la fase 4 contempla el tono formal como
  configurable por clínica — y hay que saber que eso significa **un segundo juego de plantillas
  aprobadas**, no un ajuste: Meta aprueba textos, no tonos.
- **Sin emojis.** Estándar visual del producto, y además reducen la tasa de aprobación.
- **URL completas**, nunca acortadas: Meta rechaza acortadores.
- **Sin urgencia falsa** («¡última oportunidad!», mayúsculas). Es la causa nº 2 de rechazo tras la
  categoría equivocada.
- **La firma es el nombre de la clínica**, que va como variable — no «el equipo de Fyllio». El
  paciente tiene relación con su clínica, no con nosotros.
- **Un solo objetivo por mensaje.** Meta rechaza los que mezclan.

---

## 1 · Recordatorio de cita · 48 h antes

| | |
|---|---|
| **Nombre** | `recordatorio_cita_48h` |
| **Categoría** | Utilidad · idioma `es` |
| **Cadencia** | Automático, 48 h antes de la cita |
| **Abre conversación para** | Reagendar, cancelar, o preguntar cualquier cosa de la visita |

```
Hola {{1}}, te recordamos tu cita en {{2}} el {{3}} a las {{4}}.

Si te viene mal, dínoslo por aquí y lo cambiamos sin problema.
```

`{{1}}` nombre · ej. `Ana` — `{{2}}` clínica · ej. `Clínica Demo Centro`
`{{3}}` fecha · ej. `jueves 14 de agosto` — `{{4}}` hora · ej. `10:30`

---

## 2 · Confirmación de cita · 24 h antes

| | |
|---|---|
| **Nombre** | `confirmacion_cita_24h` |
| **Categoría** | Utilidad · idioma `es` |
| **Cadencia** | Automático, 24 h antes. **Solo si no confirmó** tras el recordatorio de 48 h |
| **Abre conversación para** | Confirmar asistencia, o avisar de que no puede |

```
Hola {{1}}, mañana te esperamos a las {{2}} en {{3}}.

¿Nos confirmas que podrás venir? Con un "sí" nos vale.
```

`{{1}}` nombre — `{{2}}` hora · ej. `10:30` — `{{3}}` clínica

> **Por qué solo si no confirmó:** mandar los dos a todo el mundo es el camino más corto a que dejen
> de leerlos. La condición la evalúa la cadencia, no la plantilla.

---

## 3 · Cita reagendada

| | |
|---|---|
| **Nombre** | `cita_reagendada` |
| **Categoría** | Utilidad · idioma `es` |
| **Cadencia** | Inmediato, al cambiar la cita en la agenda |
| **Abre conversación para** | Confirmar el nuevo hueco o pedir otro |

```
Hola {{1}}, tu cita queda para el {{2}} a las {{3}} en {{4}}.

Si ese día tampoco te encaja, dínoslo y buscamos otro.
```

`{{1}}` nombre — `{{2}}` fecha nueva — `{{3}}` hora nueva — `{{4}}` clínica

---

## 4 · Hueco disponible

| | |
|---|---|
| **Nombre** | `hueco_disponible` |
| **Categoría** | Utilidad · idioma `es` |
| **Cadencia** | Al liberarse un hueco, a quien esté en lista de espera. **Uno cada vez**, no a todos |
| **Abre conversación para** | Aceptar el hueco |

```
Hola {{1}}, se nos ha quedado libre un hueco el {{2}} a las {{3}} en {{4}}.

¿Te lo reservamos? Si no me dices nada en un par de horas se lo ofrezco a otra persona.
```

`{{1}}` nombre — `{{2}}` fecha — `{{3}}` hora — `{{4}}` clínica

> **Ojo con «un par de horas»:** es información real (el hueco se ofrece a otro), no urgencia
> fabricada. Pero **si la cadencia no lo cumple de verdad, hay que quitarlo del texto** — prometer
> una ventana que no se respeta es peor que no darla.

---

## 5 · Seguimiento de presupuesto · toque 1

| | |
|---|---|
| **Nombre** | `seguimiento_info_disponible` |
| **Categoría** | Utilidad · idioma `es` |
| **Cadencia** | ~3 días después de presentar el presupuesto |
| **Abre conversación para** | **Toda la conversación de la cadencia** — dudas, precio, decisión. Es la plantilla más importante del catálogo |

```
Hola {{1}}, tienes disponible la información de tu visita a {{2}} en este enlace: {{3}}

Si te surge cualquier duda, escríbenos por aquí.
```

`{{1}}` nombre — `{{2}}` clínica — `{{3}}` enlace del portal · ej. `https://app.fyllio.com/p/abc123`

> **Aquí es donde más se nota la restricción del art. 9:** el mensaje no puede decir «tu presupuesto
> de ortodoncia de 3.400 €», que es justo lo que más convertiría. Por eso **H9 mide exactamente esta
> plantilla**.

---

## 6 · Seguimiento de presupuesto · toque 2

| | |
|---|---|
| **Nombre** | `seguimiento_sigue_vigente` |
| **Categoría** | Utilidad · idioma `es` |
| **Cadencia** | ~10 días después de presentar, si no ha respondido |
| **Abre conversación para** | Dudas y objeciones — casi siempre **quiebra** hacia una persona |

```
Hola {{1}}, te escribimos de {{2}} para recordarte que lo que hablamos sigue disponible hasta el {{3}}.

Puedes verlo aquí cuando quieras: {{4}}
```

`{{1}}` nombre — `{{2}}` clínica — `{{3}}` fecha de vigencia · ej. `30 de septiembre`
`{{4}}` enlace del portal

> ⚠️ **Esta plantilla necesita un dato que HOY NO EXISTE.** `presupuestos` no tiene columna de plazo
> de validez ([MEJORAS 89](MEJORAS-PENDIENTES.md)). Sin ella, `{{3}}` no se puede rellenar. **Es
> bloqueante de esta plantilla concreta**, no de las otras diez.

---

## 7 · Reactivación

| | |
|---|---|
| **Nombre** | `reactivacion_sin_reproche` |
| **Categoría** | Utilidad · idioma `es` |
| **Cadencia** | Último toque de la cadencia, o reactivación de un caso enfriado |
| **Abre conversación para** | Reabrir el caso — o cerrarlo con un motivo, que también vale |

```
Hola {{1}}, soy de {{2}}. Hace un tiempo que no sabemos de ti y no queremos darte la lata.

Si sigues interesado, aquí lo tienes: {{3}}. Y si no, dínoslo y no volvemos a escribirte.
```

`{{1}}` nombre — `{{2}}` clínica — `{{3}}` enlace del portal

> **«Y si no, dínoslo y no volvemos a escribirte» es deliberado.** Da salida, que es lo que hace que
> el mensaje no se lea como acoso — y además **es la forma más barata de conseguir un motivo de
> pérdida**, que hoy no se registra casi nunca. Si el paciente dice que no, ese «no» vale.
> **Y hay que cumplirlo:** si dice que no y la cadencia sigue escribiendo, la plantilla miente.

---

## 8 · Aviso de pago próximo

| | |
|---|---|
| **Nombre** | `pago_proximo` |
| **Categoría** | Utilidad · idioma `es` |
| **Cadencia** | 3 días antes del vencimiento de una cuota |
| **Abre conversación para** | Pedir aplazamiento — **quiebra** hacia una persona |

```
Hola {{1}}, te recordamos que tienes un pago programado para el {{2}} con {{3}}.

Puedes consultarlo aquí: {{4}}
```

`{{1}}` nombre — `{{2}}` fecha — `{{3}}` clínica — `{{4}}` enlace del portal

---

## 9 · Pago vencido

| | |
|---|---|
| **Nombre** | `pago_vencido` |
| **Categoría** | Utilidad · idioma `es` |
| **Cadencia** | Al vencer, **una sola vez**. La insistencia es decisión de la clínica, no del sistema |
| **Abre conversación para** | Negociar o avisar de un problema — **quiebra** hacia una persona |

```
Hola {{1}}, nos consta que hay un pago pendiente con {{2}}.

Si ya lo has hecho, avísanos y lo comprobamos. Y si necesitas comentarlo con nosotros, escríbenos por aquí: {{3}}
```

`{{1}}` nombre — `{{2}}` clínica — `{{3}}` enlace del portal

> **«Si ya lo has hecho, avísanos y lo comprobamos» va primero a propósito.** El error de cobro
> existe y es nuestro; dar por hecho que el paciente no ha pagado es la forma más rápida de que una
> reclamación se convierta en una queja.

---

## 10 · Pago recibido

| | |
|---|---|
| **Nombre** | `pago_recibido` |
| **Categoría** | Utilidad · idioma `es` |
| **Cadencia** | Al registrar un pago |
| **Abre conversación para** | Pedir la factura, o preguntar por el siguiente paso |

```
Hola {{1}}, hemos recibido tu pago. Gracias.

Si necesitas la factura o quieres saber cuál es el siguiente paso, dínoslo por aquí.
```

`{{1}}` nombre

> **Sin importe a propósito**, aunque aquí no habría problema de art. 9. El motivo es otro: si el
> importe registrado no coincide con lo que el paciente pagó, el mensaje convierte un desajuste
> interno en una discusión. Que lo vea en la factura.

---

## 11 · Primer contacto con un lead

| | |
|---|---|
| **Nombre** | `lead_primer_contacto` |
| **Categoría** | Utilidad · idioma `es` |
| **Cadencia** | Inmediato, al entrar un lead de formulario o campaña **que aún no ha escrito** |
| **Abre conversación para** | **Toda la captación** — motivo de consulta, agendar, precio |

```
Hola {{1}}, soy de {{2}}. Nos ha llegado tu consulta y estamos aquí para ayudarte.

¿Nos cuentas qué necesitas y te buscamos hueco?
```

`{{1}}` nombre — `{{2}}` clínica

> **Solo para leads que NO han escrito ellos.** Si el paciente escribió primero, la ventana de 24 h
> ya está abierta y no hace falta plantilla: se responde directamente, que además sale gratis.

---

## Antes de enviarlas a aprobación

- [ ] **Revisión de Simon** — el texto que ve un paciente es criterio de negocio, no técnico.
- [ ] Resolver el **alta fiscal** y crear la cuenta de Meta Business (bloqueo de `ESTADO.md`).
- [ ] Sustituir `app.fyllio.com` por el **dominio real** en los ejemplos de URL.
- [ ] Decidir el **tuteo o el usted** — cambiarlo después es un catálogo nuevo, no un ajuste.
- [ ] La nº 6 necesita el **plazo de validez** en el modelo ([MEJORAS 89](MEJORAS-PENDIENTES.md)):
      o se añade el dato, o esa plantilla se reescribe sin `{{3}}`.
- [ ] Comprobar que **la nº 4 y la nº 7 dicen la verdad**: la ventana de dos horas y el «no volvemos
      a escribirte» tienen que cumplirse en la cadencia, o se quitan del texto.

**Las diez restantes se pueden enviar sin nada más.**
