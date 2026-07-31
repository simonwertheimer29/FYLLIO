# REUNION-RB-DENTAL.md

Guion de la reunión con RB Dental — red de 10 clínicas en Madrid (marcas RB Dental y Karen Dental), cliente piloto objetivo.

**Fecha prevista:** semana del 3 de agosto de 2026.
**Última actualización de este documento:** 31 de julio de 2026.

---

## 0 · Qué es esta reunión y qué no es

**No es una demo de venta.** Es una sesión de validación en la que Fyllio se enseña para provocar respuestas, no para cerrar. Si sales con un "sí" pero sin las respuestas de abajo, la reunión ha fallado.

**Los tres objetivos, en orden de importancia:**

1. **Entender cómo trabajan de verdad.** Sus flujos, su volumen, dónde pierden dinero, qué hacen hoy con Excel y qué con su software. Esto vale más que cualquier feedback sobre el producto.
2. **Validar o refutar hipótesis de mercado.** Hay once hipótesis abiertas en `MERCADO.md` y **ocho se tocan en esta reunión** (todas menos H1, H6 y H9, que necesitan datos del piloto).
3. **Enseñar el producto y recoger reacción honesta.** Qué les enciende, qué les sobra, qué les falta.

**Lo que hay que evitar:** hablar más que ellos. La proporción sana es 30/70 — tú preguntas, ellos hablan. Si te descubres explicando funcionalidades durante diez minutos seguidos, has perdido el hilo.

---

## 1 · Antes de la reunión

- [ ] `npm run demo:reset` el mismo día, para que las fechas estén ancladas.
- [ ] Repasar el guion de demo ([`guion-demo-fyllio.md`](guion-demo-fyllio.md)), que trae su propia checklist de preparación.
- [ ] Verificar en preview: `/red`, `/seguimiento`, `/cobros`, `/presupuestos` y la ficha de paciente.
- [ ] **Tener el tenant de RB montado con sus diez clínicas y sus dos marcas.** Es el cierre de la demo y lo que la convierte en propuesta; sin él, el último acto no existe.
- [ ] Llevar con qué tomar notas — y, si aceptan, **grabar la reunión**. Pídelo al principio: "¿os importa que grabe para no perder detalle?". Vale oro después.
- [ ] Decidir de antemano qué NO vas a prometer. Si piden algo que no existe, la respuesta es "eso hoy no lo hace; cuéntame cómo lo resolveríais vosotros" — nunca "sí, se puede hacer".

---

## 2 · Estructura sugerida (90 minutos)

| Tramo | Minutos | Objetivo |
|---|---|---|
| Apertura | 5 | Encuadre: "vengo a entender cómo trabajáis y a enseñaros lo que hay" |
| Bloque A — Cómo trabajan hoy | 25 | Volumen, flujos, dónde pierden, qué usan |
| Bloque B — Demo | 20 | Enseñar, provocar reacción, callarse |
| Bloque C — Encaje y particularidades | 20 | Qué falta, qué sobra, flujos intermedios |
| Bloque D — Piloto y condiciones | 15 | Datos, técnica, legal, precio |
| Cierre | 5 | Siguientes pasos con fecha |

Si el tiempo se acorta, **el bloque A no se recorta**. Se recorta la demo.

El bloque B va por [`guion-demo-fyllio.md`](guion-demo-fyllio.md), que está escrito para 35-45 minutos: en estos 20 se recorta por su §9, y lo que nunca se cae es `/red`, `/seguimiento`, la ficha con el panel de acción y el cierre con su tenant vacío.

---

## 3 · Bloque A — Cómo trabajan hoy

### A.1 · Volumen y negocio

- ¿Cuántas primeras visitas al mes recibe la red? ¿Y por clínica?
- ¿Cuántos presupuestos presentáis al mes y cuál es el ticket medio?
- ¿Qué tasa de aceptación de presupuestos tenéis? ¿La medís o es sensación?
  - *Por qué importa:* el benchmark del sector está en 35-50% sin seguimiento y 65-75% con él. Si RB no lo mide, ya tienes un argumento: no puedes mejorar lo que no ves.
- ¿Qué proporción de vuestros presupuestos nace de un lead de captación y cuál de pacientes que ya tenéis?
  - *Valida la hipótesis H4 de `MERCADO.md`, y decide tu narrativa entera.*
- ¿Cuánto se os queda sin cobrar al mes? ¿Cómo lo perseguís?

### A.2 · Captación

- ¿Por dónde entran vuestros pacientes nuevos? (web, Instagram, WhatsApp, referidos, paso de calle)
- ¿Cuánto invertís al mes en captación y cuánto os cuesta un paciente nuevo?
  - *Referencia del sector: 50-150 € captar uno nuevo, 5-15 € reactivar uno existente. Si sus números se parecen, tienes el argumento más fuerte de la reunión.*
- ¿Quién responde a un lead nuevo y en cuánto tiempo? ¿Qué pasa si entra un sábado?

### A.3 · Herramientas y flujos reales

- **¿Qué software de gestión usáis y en qué versión?**
  - Si es **Gesden**: ¿G5 (escritorio) o ONE (cloud)?
  - *Esta respuesta decide tu arquitectura de integración. G5 = agente local leyendo SQL Server, delicado. ONE o Dentalink = camino más limpio. Ver `INVESTIGACION-MERCADO-2026-07.md` §2.*
- ¿Qué hacéis en ese software y qué hacéis fuera de él? ¿Hay Excel de por medio? ¿Para qué exactamente?
- ¿Quién toca cada herramienta: coordinadora, gerencia, doctores?
- ¿Cuántas personas de coordinación tenéis y cuánto tiempo dedican a perseguir presupuestos y cobros?
- ¿Las 10 clínicas trabajan igual entre sí, o hay diferencias de flujo entre RB Dental y Karen Dental?
  - *Valida H2. Su variación interna es tu primer test de flexibilidad, gratis.*
- ¿Cambiaríais de software de gestión, o Fyllio tiene que convivir con el que ya tenéis sí o sí?
  - *Valida H7. Si la respuesta es "ni de broma", la capa es obligatoria y la integración deja de ser opcional.*
- ¿Habéis probado alguna herramienta que se "sume" a vuestro software? ¿Qué pasó?
  - *Mide cómo de gastado está el discurso de la capa, que ya vende Engrana.*

### A.4 · Casos que Fyllio hoy no cubre

- ¿Tenéis tratamientos parados esperando a un especialista externo o a que el paciente vuelva? ¿Cuántos? ¿Cómo los seguís?
  - *Valida H3 — el "tratamiento en pausa" que describió Alfredo Flores.*
- ¿Qué porcentaje de tratamientos se financia o fracciona? ¿Financiáis vosotros o una financiera externa (Pepper, Cofidis, Aplazame)?
  - *Decide si el módulo de pagos fraccionados se construye y cómo. Si la financiera es externa, el módulo es otro producto.*
- ¿Qué hacéis con los no-shows? ¿Los medís?
  - *Y contrasta la observación de Flores: ¿falta más gente a limpiezas que a urgencias? Si lo confirman, el tipo de tratamiento es la variable predictiva y ya la tienes en cada cita (H6).*

---

## 4 · Bloque B — Demo

**Enséñala en este orden y con esta narrativa:**

1. **`/red`** — "esto es lo primero que ve dirección: dónde se está perdiendo dinero hoy, en euros."
2. **`/seguimiento`** — "esto es lo que ve la coordinadora al llegar: a quién hay que escribir hoy y por qué."
3. **`/cobros`** — "y esto es lo que normalmente no persigue nadie."
4. **Ficha de paciente y panel de acción** — el hilo, el mensaje precargado, el registro.

**Reglas durante la demo:**
- Después de cada pantalla, una pregunta: *"¿esto os dice algo que hoy no sepáis?"*
- Cuando alguien frunza el ceño, para y pregunta. Ahí está el oro.
- No expliques cómo funciona por dentro. Explica qué decisión permite tomar.

**Preguntas al terminar:**
- ¿Qué le sobra a esto?
- ¿Qué haríais vosotros distinto?
- Si mañana tuvierais esto funcionando, ¿quién de vuestro equipo lo abriría cada mañana?
  - *Valida H11: decide gerencia, pero si la coordinadora no lo abre a diario, la renovación está en riesgo aunque dirección esté contenta.*
- ¿Esto os parece distinto de la lista de presupuestos pendientes que ya tenéis en vuestro software?
  - *Valida H8, y es la pregunta más incómoda de la reunión. Si no ven la diferencia sin que se la expliques, el foso todavía no existe.*

---

## 5 · Bloque C — Encaje y particularidades

- ¿Qué pasos de vuestro día a día no aparecen aquí?
  - *Cada respuesta es candidata a flujo intermedio del plan premium.*
- ¿Qué querríais poder configurar vosotros: estados, plazos, motivos de pérdida, roles, vocabulario?
- ¿Hay algo aquí que os obligaría a trabajar de una forma que no es la vuestra?
  - *Es la pregunta de Flores, formulada para ellos. Si la respuesta es larga, el producto es demasiado rígido.*
- ¿Con qué aseguradoras trabajáis y qué porcentaje de vuestro volumen representan?
- ¿Quién usa el producto a diario y qué edad tiene?
  - *Calibra el tono de la comunicación por WhatsApp. Si el interlocutor habitual es alguien de 55-65 años, el tono cercano con emojis puede estar mal calibrado.*

---

## 6 · Bloque D — Piloto: datos, técnica, legal y precio

### D.1 · Datos y PMS

- ¿Cuántos pacientes activos tenéis en total?
- ¿Vuestro PMS permite exportar los datos? ¿Habéis migrado alguna vez?
- ¿Vuestro sistema da a cada paciente un identificador estable?
  - *Si no lo expone, leer del PMS solo sirve para consultar, y la migración a Fyllio pasa a ser la única vía. Está anotado en `DECISIONES.md`.*
- ¿Preferiríais que Fyllio lea de vuestro sistema o que tenga su propia base de pacientes?
- ¿Quién administra el servidor de la clínica y quién autorizaría que leamos la base?
  - *Si es Gesden G5, esto es la integración entera: agente local sobre SQL Server, bajo NDA y contrato art. 28.*
- ¿Os incomoda que los datos de vuestros pacientes vivan también en Fyllio?
  - *Aquí entra el contrato de encargado de tratamiento (art. 28 RGPD) que hay que firmar antes del piloto.*

### D.2 · WhatsApp y cumplimiento

- ¿Cómo os comunicáis hoy con los pacientes por WhatsApp? ¿Número personal, WhatsApp Business, API?
- ¿Recogéis consentimiento explícito para ese canal? ¿Dónde?
- ¿Los mensajes que mandáis mencionan el tratamiento y el importe?
  - *Un tratamiento dental identificable asociado a una persona es dato de salud (art. 9 RGPD). Si ya lo hacen, el riesgo existe hoy y Fyllio lo hereda. Si no lo tienen resuelto, resolvérselo es argumento de venta, no solo cumplimiento. **Y ojo: nuestras plantillas de ejemplo hoy nombran los dos — MEJORAS 83.***
- ¿Alguien os ha planteado alguna vez este tema?

### D.3 · Competencia

- ¿Os ha llamado alguien con una propuesta parecida a esta? (Engrana, Kandent, agencias de automatización con IA)
- Si sí: ¿qué os convenció y qué no?
- ¿Qué os haría pagar cada mes en lugar de una vez?
  - *La objeción del pago único (Gesden cuesta 2.000-3.000 € una sola vez) es la más peligrosa. Escucha su respuesta antes de dar la tuya.*
- ¿Precio por clínica o por red?
  - *Valida H10. El mercado complementario se mueve en 29-150 €/mes por clínica; Engrana está en 89 € plano. Señal negativa: piden precio por red.*

### D.4 · El piloto

- ¿Cuántas clínicas entrarían y en qué orden?
- ¿Quién sería el responsable por vuestra parte?
- ¿Qué tendría que pasar en tres meses para que digáis "esto funciona"?
  - *Su respuesta es tu definición de éxito. Anótala literal.*
- ¿Qué os haría dejarlo?

---

## 7 · Lo que hay que decir, no solo preguntar

Tres cosas que conviene que salgan de tu boca en algún momento:

**La cifra.** "En una clínica de 500.000 €, subir diez puntos la aceptación de presupuestos son 48.000 € al año. No hace falta captar más ni bajar precios." *(Benchmark del sector; se lo puedes enseñar como referencia, no como promesa.)*

**El posicionamiento.** "Fyllio no sustituye a vuestro software de gestión. Vuestra historia clínica, vuestra agenda y vuestras facturas se quedan donde están. Fyllio se ocupa de que ningún presupuesto ni ningún cobro se pierda."

**El modelo.** "Esto es el producto estándar. Entendemos que cada clínica tiene sus particularidades, y esas se cubren como flujos intermedios en el plan superior, sin romper el ciclo."

---

## 8 · Después de la reunión — el mismo día

1. **Volcar todo a `MERCADO.md` §2.1 (Evidencia de campo)**, con fecha y nombre de quien lo dijo. Solo lo que dijeron; las conclusiones van a §3 marcadas como interpretación.
2. **Actualizar el estado de las hipótesis H1 a H11.** Las refutadas se marcan con el motivo y se mueven a la tabla de refutadas — no se borran.
3. **Anotar en `DECISIONES.md`** lo que cambie del producto, citando la entrada de `MERCADO.md` que lo justifica.
4. **Escribir la lista de lo que hay que construir** antes de que el piloto arranque, separando lo bloqueante de lo deseable.
5. Si aceptaron el piloto: fijar fecha de arranque y responsable por ambas partes.
6. **Regenerar `ESTADO.md`**, que es lo que se lee al abrir la siguiente sesión.

---

## 9 · Pendientes de onboarding que ya conocemos

Independientemente de lo que salga en la reunión, estas cosas hay que hacerlas antes de que RB opere. *(Resumidas también en [`ESTADO.md`](ESTADO.md), que es derivado: la lista viva es esta.)*

**Bloqueantes — sin esto no se toca un dato real**
- [ ] Contrato de encargado de tratamiento (art. 28 RGPD) firmado.
- [ ] NDA con RB.

**Técnicos**
- [ ] Dar de alta a los doctores de RB en Postgres (la tabla `staff` está vacía en las bases piloto; el selector de doctor saldría vacío). **Esto se nota ya en la demo**: el guion manda avisar antes de que lo vean.
- [ ] Revisar las plantillas de cobranza de la base de RB y actualizarlas a `{{pendiente}}`.
- [ ] Cambiar los teléfonos del seed de DEMO al rango reservado +34 600 000 xxx.

**Presentables**
- [ ] Dominio propio (`app.fyllio.com` o similar) — una URL de Vercel con hash no es presentable ante un cliente.
