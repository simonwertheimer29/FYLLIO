# guion-demo-fyllio.md

Guion de la demostración de Fyllio. Pensado para la reunión con RB Dental (agosto 2026), reutilizable con cualquier clínica.

Complementa a [`REUNION-RB-DENTAL.md`](REUNION-RB-DENTAL.md): allí está la estructura de la reunión y las preguntas; aquí, cómo se enseña el producto.

**Duración: la manda la estructura de la reunión, no este guion.** En el plan de 90 minutos de `REUNION-RB-DENTAL.md` el bloque de demo son **20 minutos**, así que este guion se recorta — ver §9, qué se cae primero. Si la reunión se alarga a ~2h, la demo completa son 35-45 minutos. En ningún caso es el bloque más largo ni el más importante — entender cómo trabajan lo es.

---

## 0 · La regla que gobierna toda la demo

**No enseñes funcionalidades. Cuenta una historia de dinero.**

El hilo narrativo es siempre el mismo, y tiene tres actos:

1. **Dónde se está perdiendo dinero hoy** (Red)
2. **Quién lo recupera y cómo** (Seguimiento → ficha → Cobros)
3. **Cómo se sabe si está funcionando** (KPIs)

Si en algún momento te descubres explicando cómo funciona algo por dentro, has salido del guion. La pregunta que gobierna cada pantalla es: *¿qué decisión permite tomar esto que hoy no se puede tomar?*

**Y la regla de oro: después de cada pantalla, cállate y pregunta.** Los silencios incómodos son donde aparece la información valiosa.

---

## 1 · Preparación (el mismo día)

- [ ] `npm run demo:reset` — ancla las fechas para que "hoy" tenga sentido.
- [ ] Verificar en el navegador que cargan: `/red`, `/seguimiento`, `/leads`, `/presupuestos`, `/pacientes`, `/cobros`, `/kpis`.
- [ ] Abrir las pestañas por adelantado, en el orden del guion. Nada de navegar por el menú delante del cliente.
- [ ] Modo claro. El oscuro está bien, pero en proyector o pantalla compartida el claro se lee mejor.
- [ ] Tener el tenant de RB preparado y accesible (ver §5).
- [ ] Cerrar Slack, correo y notificaciones.
- [ ] Comprobar que el enlace de portal de paciente funciona, por si sale la conversación.

**Si algo falla en vivo:** dilo y sigue. *"Esto es un entorno de demostración corriendo en mi portátil; en producción va contra su base."* Nunca improvises una explicación técnica ni finjas que era lo esperado.

---

## 2 · Acto I — Dónde se pierde el dinero (`/red`, ~8 min)

**Qué enseñar:** la pantalla completa, sin tocar nada durante los primeros diez segundos. Que la lean.

**Qué decir:**

> "Esto es lo primero que ve la dirección de una red al abrir Fyllio por la mañana. La pregunta que responde es una sola: ¿dónde estoy perdiendo dinero hoy?"

Señala la fila de riesgo, ítem por ítem, siempre en euros:

> "Aquí hay X € parados en presupuestos a los que se escribió, nadie respondió y nadie ha vuelto a insistir. Aquí, X € de pacientes que ya dijeron que sí y están esperando respuesta para cerrar. Aquí, cobros fuera de plazo. Y aquí, leads que llegaron y todavía no han recibido ni un mensaje."

Luego la fila de logros:

> "Y esto es lo contrario: lo que sí está funcionando esta semana."

Después baja a la tabla de clínicas:

> "Y aquí cada clínica comparada con el mes anterior, ordenada por la que más cae. Se hace clic en una y todo el panel se filtra a ella."

**Haz el clic.** Que vean el filtrado.

**Preguntas — y espera la respuesta:**
- "¿Esto os dice algo que hoy no sepáis?"
- "¿Sabéis ahora mismo cuánto tenéis parado en presupuestos sin seguimiento?"

**Ojo con:** los deltas del seed pueden salir raros según el mes. Si alguno chirría, no lo defiendas: *"eso es un artefacto de los datos de demostración, con datos reales cuadra."*

---

## 3 · Acto II — Quién lo recupera (~15 min)

### 3.1 · `/seguimiento` (~7 min)

**Qué decir:**

> "Si lo anterior es lo que ve dirección, esto es lo que ve la coordinadora al llegar por la mañana. No es una lista de pacientes: es una lista de decisiones."

Recorre las cohortes de Leads sin prisa:

> "Citados: los que vienen y hay que confirmar. Nuevos: los que acaban de entrar y aún no ha hablado nadie con ellos — y los que llevan más de dos días sin contactar suben arriba con aviso. En conversación: los que ya respondieron y esperan respuesta nuestra. Y sin respuesta: los que se escribieron y se enfriaron."

Cambia a la pestaña de Presupuestos:

> "Y lo mismo para presupuestos. Aquí el orden lo manda el dinero: el que más vale y más tiempo lleva parado, primero."

**El punto clave, y merece énfasis:**

> "Esto no lo mantiene nadie a mano. Sale de leer las conversaciones reales: quién escribió el último, cuándo, y si hay cita de por medio. Nadie tiene que marcar nada."

**Preguntas:**
- "¿Cómo sabe hoy vuestra coordinadora a quién tiene que escribir cuando llega el lunes?"
- "¿Quién decide eso y con qué?"

### 3.2 · La ficha y el panel de acción (~8 min)

Abre un caso de "sin respuesta" con importe alto. **Este es el momento más importante de la demo.**

> "Cuando abre un caso, ve lo que pasó: la conversación entera, qué se le dijo, cuándo, y qué respondió."

Señala la recomendación:

> "Y aquí la propuesta: se le escribió hace X días sobre este tratamiento, no ha respondido, y este sería el mensaje para insistir. Redactado ya, con su nombre y su tratamiento."

**Y ahora el matiz que los diferencia de un chatbot — dilo explícitamente:**

> "Fíjense en una cosa: el sistema no envía nada solo. Propone. La coordinadora lee la conversación, decide si tiene sentido, ajusta el mensaje si quiere, y envía ella. Eso es deliberado: en seguimiento comercial, el mensaje equivocado a la persona equivocada cuesta más que el minuto que ahorras automatizándolo."

Envía el mensaje o simula el envío. Muestra que queda registrado.

**Preguntas:**
- "¿Cuánto tiempo dedica hoy vuestro equipo a esto?"
- "¿Y qué pasa con los que se quedan sin hacer?"

---

## 4 · Acto III — Cerrar el círculo (~12 min)

### 4.1 · `/cobros` (~6 min)

> "Un presupuesto aceptado no es dinero cobrado. Esta es la parte que normalmente no persigue nadie."

Enseña las tres pestañas:

> "Vencidos, los que superaron su plazo. Por vencer, para adelantarse. Y estancados: aceptaron hace más de un mes y no han pagado ni un euro. Cada uno con su importe."

Abre uno y muestra el panel de recordatorio de pago con su historial.

> "Y el registro completo debajo: cada paciente, cuánto firmó, cuánto pagó, cuánto queda."

**Pregunta:** "¿Cuánto tenéis pendiente de cobro ahora mismo? ¿Y cómo lo sabéis?"

### 4.2 · `/pacientes` y el ciclo que se reabre (~4 min)

Este bloque existe para responder una objeción antes de que la hagan.

> "Hasta aquí he contado el ciclo del paciente que entra como lead. Pero en una clínica establecida, la mayoría de los presupuestos no vienen de captación: vienen de gente que ya es paciente vuestro."

Enseña la tabla y el buscador del modal de presupuesto:

> "Por eso desde aquí se puede crear un presupuesto sobre cualquier paciente con historial. Busca por nombre, lo selecciona, y ese presupuesto entra en el mismo seguimiento y en los mismos cobros que cualquier otro. El ciclo se cierra con el cobro y se vuelve a abrir cuando hay tratamiento nuevo."

**Pregunta clave, de las que valen la reunión entera:**
- "¿Qué proporción de vuestros presupuestos sale de pacientes que ya tenéis frente a pacientes nuevos?"

### 4.3 · `/kpis` (~2 min, rápido)

No te detengas. Es material de apoyo, no protagonista.

> "Y todo esto se mide: tasa de aceptación por doctor, por tratamiento, por clínica, y la evolución mes a mes."

Enseña el ranking por doctor y para.

> "Este número, la aceptación por doctor, suele ser el más incómodo y el más útil."

---

## 5 · El cierre — su Fyllio, vacío (~5 min)

Cambia al tenant de RB. **Esto es lo que convierte una demo en una propuesta.**

> "Todo lo que han visto era un entorno de demostración con datos inventados. Esto es lo suyo."

Enseña sus clínicas configuradas con sus nombres reales, y las pantallas vacías.

> "Está montado, aislado, y esperando sus datos. Sus diez clínicas, sus dos marcas. Lo que falta es cargar sus pacientes y sus doctores, conectar el WhatsApp, y empezar."

**Por qué funciona:** ver su propio nombre en el producto lo hace real de una forma que ninguna demo con datos ficticios consigue.

**Cuidado con dos cosas:**
- Que las pantallas vacías se vean **intencionadas, no rotas**. Un estado vacío que dice "todavía no hay presupuestos" es honesto; una pantalla en blanco parece un error.
- Si el selector de doctores sale vacío o algo chirría, dilo antes de que lo vean: *"esto se llena al dar de alta a su equipo, es parte del arranque."*

---

## 6 · Lo que NO se enseña

- **Automatizaciones.** El motor está construido pero el envío por WhatsApp aún no está operativo. Enseñarlo abre una promesa que hoy no se cumple.
- **No-shows.** El módulo está congelado. Si preguntan, la respuesta honesta: *"medimos la tasa y guardamos los datos desde el día uno; la gestión activa llega después."*
- **El Copilot**, salvo que la conversación lo pida. Es potente pero desvía del hilo del dinero.
- **Nada que esté a medias.** Si dudas de si una pantalla está lista, no la abras.

---

## 7 · Preguntas que van a hacer, y qué responder

**"¿Esto sustituye a nuestro software de gestión?"**
> "No, y no queremos. Su historia clínica, su agenda, sus radiografías y sus facturas se quedan donde están. Fyllio se ocupa de que ningún presupuesto ni ningún cobro se pierda por el camino."

**"¿Esto no es lo mismo que la lista de presupuestos pendientes que ya tenemos?"**
> Deja que respondan ellos primero: *"¿ustedes qué creen? ¿lo ven distinto?"*
>
> Si no ven la diferencia, **no la defiendas: anótalo**. Es la señal más valiosa de la reunión y significa que el foso todavía no existe. Si la ven, que la digan ellos con sus palabras — vale más que cualquier argumento tuyo.
>
> *(Es la hipótesis H8 de `MERCADO.md`. La respuesta se anota literal.)*

**"¿Se conecta con nuestro programa?"**
> "Depende de cuál usen y en qué versión — es una de las cosas que quiero preguntarles hoy. Hay sistemas que se dejan integrar bien y otros que no tienen forma de conectarse, y eso cambia cómo lo montamos."
>
> **No prometas una integración sin saber qué PMS y qué versión tienen.**

**"¿Manda los mensajes solo?"**
> "Propone, no envía. Su coordinadora lee la conversación y decide. Eso es una decisión de diseño, no una limitación."

**"¿Qué pasa con la protección de datos?"**
> "Los datos viven en Europa, con aislamiento por clínica, y firmamos contrato de encargado de tratamiento antes de tocar un solo dato real. Y hay una cosa que quiero comentarles sobre WhatsApp, porque probablemente nadie se lo haya planteado." *(Y entras en el bloque D.2 del guion de reunión.)*

**"¿Cuánto cuesta?"**
> Si el precio no está cerrado, no improvises. *"Antes de hablar de precio quiero entender bien cómo trabajan y qué les aporta esto de verdad. Se lo llevo por escrito esta semana."*

---

## 8 · Después de la demo

Anota en caliente, el mismo día:

- Qué pantalla les enganchó y en cuál desconectaron.
- Qué preguntaron que no supiste responder.
- Qué dijeron que les falta.
- Si vieron o no la diferencia con lo que ya tienen.
- Las frases literales que usaron para describir su problema — esas frases son tu copy de venta para el próximo cliente.

Todo eso va a `MERCADO.md`, sección **Evidencia de campo** (§2.1), con fecha.

---

## 9 · Si solo hay 20 minutos

El orden de arriba está pensado para 35-45. En el plan de 90 minutos de la reunión, la demo son 20 — y el bloque A (cómo trabajan hoy) **no se recorta**, así que se recorta esto. Qué se cae, en este orden:

1. **`/kpis`** (§4.3). Es material de apoyo; si preguntan por medición, se enseña al final si sobra tiempo.
2. **`/pacientes`** (§4.2). La objeción del paciente con historial se puede responder hablando, sin pantalla.
3. **`/cobros`** (§4.1) se acorta a las tres pestañas y su importe, sin abrir el panel de recordatorio.

**Lo que no se toca nunca:** `/red` (§2), `/seguimiento` (§3.1), la ficha con el panel de acción (§3.2) y el cierre con su tenant vacío (§5). Ahí está la historia entera: dónde se pierde, quién lo recupera, y que ya está montado a su nombre.
