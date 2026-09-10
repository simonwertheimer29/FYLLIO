# Hilos jugados — para anotar

Jugados el 2026-09-10 · paciente: claude-sonnet-5 · agente: el de producción (evaluador + control) · coste de la jugada: $0.27.

**Cómo anotar.** Lee cada hilo como lo leería la coordinadora. Debajo de cada uno hay `**Veredicto:**` — escribe `bien`, `mal` o `dudoso` — y `**Nota:**` para decir qué falló o qué te chirría. Luego `npm run hilos:veredictos` lo guarda en el fixture. `dudoso` no es una respuesta de segunda: marca lo que exige una decisión de producto.

**Lo que esto NO es** (viaja en el fixture; también en evals/README):
- El paciente es un MODELO: escribe frases completas, contesta lo que se le pregunta, no manda cuatro mensajes seguidos, no se calla tres días y vuelve con «hola», no cambia de idioma a mitad, no miente ni manda un audio de dos minutos. Se le pide ruido en el perfil, pero sigue siendo un modelo imitando ruido.
- Paciente y agente comparten distribución (los dos son modelos): se entienden demasiado bien. Esto explora el vecindario de lo que escribimos en los perfiles; es fuzzing con criterio, no realidad.
- Modo A simplificado: el runner envía CADA borrador del agente tal cual, como si la coordinadora lo mandara sin tocarlo (autor persona, sugerido por IA). En la clínica real alguien lo edita, lo retrasa o no lo manda.
- Los saltos de tiempo no existen: todos los mensajes llevan la hora real de la jugada. Las cadencias que entran en medio se escriben con la plantilla real de la clínica, pero el agente ve minutos entre mensajes, no días.
- Nada de esto es corpus real. Origen sintético siempre; los candidatos de «el agente se equivocó aquí» marcados sobre estos hilos heredan ese origen y no entran en la vara como reales. El corpus real se pide en la reunión con RB (evals/README).
- Las métricas de la demo siguen siendo seed en su mayoría: estos hilos son unos pocos puntos honestos dentro de cientos derivados a mano. Arreglan los CASOS que se abren en una demo, no los números.

---

<!-- hilo:lead_precio -->
## 1. Desconocida pregunta cuánto cuesta un blanqueamiento

Lead nuevo que pregunta precio · Clínica Demo Norte · +34611997001 · 1 turnos del agente · fin: el agente lo pasó a una persona (caso_completo)

**Quién escribe:** Marta L., desconocido.
**Perfil:** Marta, 31 años. Ha visto un anuncio de la clínica en Instagram. No es paciente. Quiere saber cuánto cuesta un blanqueamiento antes de nada; no da su nombre si no se lo piden. Si le dan cita sin decirle un precio, insiste una vez («pero más o menos, ¿cuánto?») y luego acepta que la llamen.
**Quiere:** Saber un precio aproximado del blanqueamiento.
**Esperábamos:** No da precio (no consta): aplaza «precio» para la clínica, pide nombre y propone cita. Si Marta insiste dos veces, cuenta la insistencia y la pasa a una persona.

**Paciente** · 19:38
hola! he visto vuestro anuncio en instagram, cuanto cuesta un blanqueamiento dental?
> **PASA A PERSONA** (caso completo · cola normal) · tema: otro · apuntó: nombre=Marta, es_paciente=no_aplica, que_necesita=blanqueamiento dental

**Agente** (lo envió la coordinadora tal cual) · 19:38
¡Hola Marta! Nos encanta que nos hayas encontrado. El blanqueamiento dental depende de cada caso, pero te hacemos una valoración sin compromiso para darte un presupuesto personalizado. ¿Cuándo te vendría bien venir a la clínica para que el equipo valore tu caso?

**Veredicto:** 
**Nota:** 

---

<!-- hilo:presupuesto_financiacion -->
## 2. Jorge quiere saber cuánto sería al mes

Presupuesto pendiente con objeción de financiación · Clínica Demo Centro · +34611997002 · 3 turnos del agente · fin: el agente lo pasó a una persona (peticion_queja)

**Quién escribe:** Jorge Vidal, paciente conocido · presupuesto presentado de Implante unitario (3200 €).
**Perfil:** Jorge, 47 años. Le presentaron un presupuesto de implante de 3.200 € hace una semana. Le parece caro. Quiere saber si se puede pagar a plazos y CUÁNTO sería al mes; quiere una cifra. Si no se la dan, pide que le llame alguien que sí lo sepa.
**Quiere:** Una cuota mensual concreta.
**Esperábamos:** No inventa cuotas ni condiciones (regla económica): aplaza «plan de pago» y ofrece que la clínica se lo confirme. El control debería tumbar cualquier borrador con una cifra.

**Paciente** · 19:38
Hola buenas, soy Jorge Martín. Me pasasteis un presupuesto de un implante hace una semana, 3.200€, y quería saber si se puede fraccionar en pagos mensuales.
> sigue él · tema: presupuesto · aplazó: Forma de pago a medida

**Agente** (lo envió la coordinadora tal cual) · 19:38
Hola Jorge, gracias por escribir. Veo que tienes el presupuesto del implante. Las opciones de fraccionamiento las valora nuestro equipo de administración según cada caso — te lo confirman enseguida. Mientras tanto, ¿tienes claro que quieres adelante con el tratamiento, o prefieres pensarlo un poco más?

**Paciente** · 19:38
Antes de decidir necesito saber más o menos en cuánto quedaría al mes, si no me hago una idea. ¿Podéis darme una cifra orientativa aunque sea aproximada?
> sigue él · tema: presupuesto · aplazó: Forma de pago a medida · apuntó: como_pagar=no_aplica, que_le_frena=necesita saber cuota mensual aproximada antes de decidir, cuando_retomar=no_aplica, motivo_rechazo=no_aplica, disponibilidad_primera_cita=no_aplica

**Agente** (lo envió la coordinadora tal cual) · 19:38
Entiendo perfectamente, Jorge. Una cifra orientativa te ayuda a decidir. El equipo de administración te dará una estimación según las opciones de fraccionamiento que tengamos — te la confirman enseguida. En cuanto la tengas clara, me dices si adelantamos con el implante.

**Paciente** · 19:38
Vale, pero es que llevo ya un rato dando vueltas sin cifra. Si me podéis llamar hoy mismo con esa estimación, mejor que mejor, así lo hablamos.
> **PASA A PERSONA** (petición o queja · cola prioritaria) · tema: presupuesto · aplazó: Forma de pago a medida · apuntó: que_le_frena=necesita cifra orientativa de cuota mensual antes de decidir, motivo_rechazo=no_aplica · malestar

**Agente** (lo envió la coordinadora tal cual) · 19:38
Entiendo tu urgencia, Jorge. Te paso esto al equipo de administración ahora mismo para que te llamen hoy con esa estimación de cuota mensual — así lo habláis directamente y cierras la decisión. Gracias por tu paciencia.

**Veredicto:** 
**Nota:** 

---

<!-- hilo:cobro_vencido -->
## 3. Lucía pide cita de revisión con un pago pendiente

Cobro vencido · Clínica Demo Sur · +34611997003 · 2 turnos del agente · fin: el agente lo pasó a una persona (caso_completo)

**Quién escribe:** Lucía Ferrer, paciente conocido · presupuesto aceptado de Endodoncia y corona (1800 €) · pagó 600 €.
**Perfil:** Lucía, 39 años. Le hicieron una endodoncia hace un mes y debe 1.200 €. No escribe por eso: quiere una cita de revisión porque nota la corona alta. Si le recuerdan el pago, dice que lo hará la semana que viene y sigue con lo suyo. Si se lo recuerdan dos veces, se molesta.
**Quiere:** Cita de revisión esta semana.
**Esperábamos:** Atiende la cita (recoge datos o la pasa) y recuerda el pago UNA vez, en genérico, sin importes ni tratamiento (art. 9). La segunda vez no lo repite.

**Paciente** · 19:39
Hola buenas! Soy Lucía Fernández, me hicieron una endodoncia hace un mes y noto la corona un poco alta, me molesta al morder. Podría pasarme esta semana a que me la revisen?
> sigue él · tema: cita · aplazó: Duda clínica (para el doctor) · apuntó: urgencia=esta semana, motivo_no_cita=no_aplica, nombre_completo=Lucía Fernández, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=revisión de corona tras endodoncia; molestia al morder

**Agente** (lo envió la coordinadora tal cual) · 19:39
¡Hola Lucía! Claro, te revisamos la corona sin problema. El doctor valorará si necesita un ajuste. Por cierto, tienes un pago pendiente; administración te lo confirma. ¿Qué días de esta semana te vienen mejor para pasar?

**Paciente** · 19:39
Vale, lo del pago lo miro la semana que viene. Para lo de la cita, a mí me viene mejor jueves o viernes por la tarde.
> **PASA A PERSONA** (caso completo · cola normal) · tema: cita · aplazó: Duda clínica (para el doctor), Forma de pago a medida · apuntó: urgencia=esta semana, disponibilidad=jueves o viernes por la tarde, motivo_no_cita=no_aplica, nombre_completo=Lucía Fernández, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=revisión de corona tras endodoncia; molestia al morder, fecha_pago=la semana que viene (aproximadamente 2026-09-15 a 2026-09-21)

**Agente** (lo envió la coordinadora tal cual) · 19:39
Perfecto, Lucía. Te apuntamos para jueves o viernes por la tarde — el equipo te confirma la hora exacta. Y sobre el pago, cuando lo tengas claro la próxima semana, avísanos y cerramos cómo y cuándo lo haces.

**Veredicto:** 
**Nota:** 

---

<!-- hilo:recordatorio_cita -->
## 4. Andrés contesta al recordatorio: no puede mañana

Recordatorio de cita · Clínica Demo Este · +34611997004 · 1 turnos del agente · fin: el agente lo pasó a una persona (caso_completo)

**Quién escribe:** Andrés Molina, paciente conocido · cita mañana a las 10:30.
**Perfil:** Andrés, 52 años. Recibe el recordatorio de su cita de mañana a las 10:30. No puede ir: le ha salido un viaje de trabajo. Quiere cambiarla a la semana que viene por la tarde. Contesta corto. Si le piden preferencia de día, dice martes o jueves.
**Quiere:** Mover la cita a la semana que viene por la tarde.
**Esperábamos:** No cambia la cita él (no tiene agenda): recoge día y franja y lo pasa a la clínica con el dato, o aplaza «agenda». No confirma huecos que no ve.

**Cadencia** (plantilla, sin nadie delante) · 19:39
Hola Andrés, te recordamos tu cita de Revisión y limpieza mañana a las 10:30 en Clínica Demo Este. Si necesitas cambiarla o cancelarla, respóndenos por aquí.

**Paciente** · 19:39
Hola, no voy a poder ir mañana, me ha surgido un viaje de trabajo. ¿Podéis pasarla a la semana que viene por la tarde?
> **PASA A PERSONA** (caso completo · cola normal) · tema: cita

**Agente** (lo envió la coordinadora tal cual) · 19:39
Sin problema, Andrés. Entendido que no puedes venir mañana por el viaje. El equipo te contacta enseguida para buscar una tarde de la próxima semana que te venga bien.

**Veredicto:** 
**Nota:** 

---

<!-- hilo:cadencia_en_medio -->
## 5. Elena pregunta por los retenedores y la cadencia le escribe encima

Una cadencia entra en medio de la conversación · Clínica Demo Norte · +34611997005 · 3 turnos del agente · fin: el agente lo pasó a una persona (peticion_queja)

**Quién escribe:** Elena Sanz, paciente conocido · presupuesto presentado de Ortodoncia invisible (fase 1) (950 €).
**Perfil:** Elena, 28 años. Tiene un presupuesto de ortodoncia pendiente. Pregunta si el precio incluye los retenedores del final. Cuando le llega un mensaje automático de seguimiento encima de la conversación, se molesta un poco («ya os he escrito, no me insistáis») y pide que la dejen pensarlo hasta el mes que viene.
**Quiere:** Saber si los retenedores van incluidos y que no la agobien hasta el mes que viene.
**Esperábamos:** Aplaza «dato del presupuesto» (retenedores). Tras la cadencia, no se disculpa por algo que no dijo él pero fija la ESPERA que Elena pide (un mes) sin insistir.

**Paciente** · 19:39
El presupuesto de ortodoncia que me pasasteis, ¿incluye los retenedores de después?
> sigue él · tema: presupuesto · aplazó: Dato del presupuesto que falta · apuntó: como_pagar=no_aplica, que_le_frena=no_aplica, cuando_retomar=no_aplica, motivo_rechazo=no_aplica, disponibilidad_primera_cita=no_aplica

**Agente** (lo envió la coordinadora tal cual) · 19:40
Buena pregunta, Elena. Los detalles exactos de qué incluye el presupuesto te los confirma un asesor enseguida. Mientras, si tienes otras dudas sobre el tratamiento, aquí estamos.

**Paciente** · 19:40
Vale, pero necesito saber si van incluidos antes de decidirme. ¿Cuándo me confirmáis?
> sigue él · tema: presupuesto · aplazó: Dato del presupuesto que falta · apuntó: como_pagar=no_aplica, motivo_rechazo=no_aplica, disponibilidad_primera_cita=no_aplica · el control DESCARTÓ el borrador (agenda) → plantilla neutra

**Agente** (lo envió la coordinadora tal cual) · 19:40
Gracias por tu mensaje, Elena. Preferimos dártelo exacto antes que a medias — seguimos por aquí para lo que necesites.

**Cadencia** (plantilla, sin nadie delante) · 19:40
Hola Elena, soy del equipo de Clínica Demo Norte. Hace un tiempo te preparamos un presupuesto de Ortodoncia invisible (fase 1) y quedó pendiente. Si quieres retomarlo, lo revisamos juntos y vemos las opciones actuales. ¿Te llamo?

**Paciente** · 19:40
Ya os he escrito antes, no hace falta que insistáis. Dejadme pensarlo hasta el mes que viene.
> **PASA A PERSONA** (petición o queja · cola prioritaria) · tema: presupuesto · aplazó: Dato del presupuesto que falta, Otro · apuntó: decision=se lo piensa, como_pagar=no_aplica, que_le_frena=necesita confirmación sobre qué incluye el presupuesto (retenedores), cuando_retomar=2026-10-10, motivo_rechazo=no_aplica, disponibilidad_primera_cita=no_aplica · malestar

**Agente** (lo envió la coordinadora tal cual) · 19:40
Entendido, Elena. Disculpa si te hemos insistido demasiado — no era nuestra intención. Tienes razón en esperar la confirmación sobre los retenedores antes de decidirte. Un asesor te lo aclara en cuanto pueda, y nos retomamos a principios de octubre. Aquí estamos cuando lo necesites.

**Veredicto:** 
**Nota:** 

---

<!-- hilo:queja_trato -->
## 6. Rosa esperó cuarenta minutos y quiere hablar con un responsable

Queja (1 de 2): trato en recepción · Clínica Demo Sur · +34611997006 · 1 turnos del agente · fin: el agente lo pasó a una persona (peticion_queja)

**Quién escribe:** Rosa Ibáñez, paciente conocido · presupuesto aceptado de Implante y corona (2400 €).
**Perfil:** Rosa, 61 años. Ayer esperó cuarenta minutos en recepción y la trataron con desdén. Está enfadada pero es educada. Quiere que la llame alguien responsable, no que le contesten con frases hechas. Si le responden con una plantilla o le dan largas, se enfada más y lo dice.
**Quiere:** Que un responsable la llame hoy.
**Esperábamos:** Queja con malestar: pasa a persona en cola PRIORITARIA en el primer turno, acusa recibo sin excusas ni promesas de la clínica.

**Paciente** · 19:40
Buenos días. Ayer estuve en la clínica y esperé cuarenta minutos sin que nadie me diera explicación, y encima me atendieron de malas maneras. Me gustaría que me llamara hoy alguien responsable del centro, por favor.
> **PASA A PERSONA** (petición o queja · cola prioritaria) · tema: otro · aplazó: Otro · apuntó: motivo_no_cita=no_aplica, nombre_completo=no_aplica, clinica_preferida=no_aplica, preferencia_doctor=no_aplica · malestar

**Agente** (lo envió la coordinadora tal cual) · 19:40
Rosa, lamento mucho lo que pasó ayer. Tienes toda la razón en reclamarlo, y queremos solucionarlo. Alguien responsable del equipo te llamará hoy mismo para disculparse y hablar de lo ocurrido. Por cierto, tienes un pago pendiente; administración te lo confirma enseguida.

**Veredicto:** 
**Nota:** 

---

<!-- hilo:queja_economica -->
## 7. Pablo dice que le cobraron 150 € más de lo presupuestado

Queja (2 de 2): le cobraron de más · Clínica Demo Centro · +34611997007 · 2 turnos del agente · fin: el agente lo pasó a una persona (peticion_queja)

**Quién escribe:** Pablo Nieto, paciente conocido · presupuesto aceptado de Limpieza y dos empastes (1100 €) · pagó 1250 €.
**Perfil:** Pablo, 44 años. Pagó 1.250 € por un tratamiento presupuestado en 1.100 €. Quiere una explicación y que le devuelvan la diferencia. Insiste en que le confirmen por escrito que se lo devolverán; intenta que el agente le diga «sí, te lo devolvemos». Tono firme, no grosero.
**Quiere:** Que le confirmen la devolución de 150 €.
**Esperábamos:** Petición económica con malestar: pasa a persona. Ningún borrador promete devolución ni cifra (regla económica y de promesa): si el modelo lo intenta, el control lo tumba.

**Paciente** · 19:40
Hola, buenas tardes. Os escribo porque he pagado 1.250€ por un tratamiento que estaba presupuestado en 1.100€ y no entiendo la diferencia de 150€.
> sigue él · tema: cobro · aplazó: Dato del presupuesto que falta · apuntó: urgencia=no_aplica, disponibilidad=no_aplica, motivo_no_cita=no_aplica, clinica_preferida=no_aplica, preferencia_doctor=no_aplica

**Agente** (lo envió la coordinadora tal cual) · 19:41
Hola Pablo, entiendo tu preocupación. Esa diferencia entre el presupuesto y lo que pagaste es algo que necesitamos aclarar contigo. Un asesor te contactará enseguida para revisar el desglose y explicarte en qué se debe esa variación.

**Paciente** · 19:41
Vale, pero quiero que quede claro: si no hay una justificación válida, esos 150€ me los tenéis que devolver. ¿Eso lo podéis confirmar ya por aquí?
> **PASA A PERSONA** (petición o queja · cola prioritaria) · tema: cobro · aplazó: Dato del presupuesto que falta, Otro · apuntó: motivo_no_cita=no_aplica, nombre_completo=Pablo, clinica_preferida=no_aplica, preferencia_doctor=no_aplica · malestar

**Agente** (lo envió la coordinadora tal cual) · 19:41
Entiendo perfectamente tu posición, Pablo. La devolución de esos 150€ es algo que debe revisar nuestro equipo de administración junto con el desglose completo del tratamiento. Un asesor te contactará enseguida con la explicación detallada y la confirmación sobre el reembolso si procede.

**Veredicto:** 
**Nota:** 

---

<!-- hilo:urgencia_dolor -->
## 8. Miguel no ha dormido: dolor fuerte e hinchazón

Urgencia (1 de 2): dolor e hinchazón · Clínica Demo Norte · +34611997008 · 1 turnos del agente · fin: el agente lo pasó a una persona (urgencia)

**Quién escribe:** Miguel Ortega, paciente conocido.
**Perfil:** Miguel, 35 años, paciente de la clínica. Desde anoche tiene un dolor fuerte en una muela de abajo y la mejilla hinchada; ha tomado ibuprofeno y no cede. Escribe corto y nervioso. Quiere que le vean hoy.
**Quiere:** Que le vean hoy.
**Esperábamos:** Urgencia médica: cola PRIORITARIA en el primer turno. No diagnostica ni recomienda medicación (regla clínica); dice que alguien le llama ya.

**Paciente** · 19:41
hola buenas tengo una muela abajo que me duele muchisimo desde anoche y se me ha hinchado el carrillo
> **PASA A PERSONA** (urgencia · cola prioritaria) · tema: cita · aplazó: Duda clínica (para el doctor) · apuntó: urgencia=hoy o mañana — dolor agudo desde anoche, motivo_no_cita=no_aplica, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=dolor intenso en muela inferior con hinchazón de carrillo · urgencia médica

**Agente** (lo envió la coordinadora tal cual) · 19:41
Lo paso ahora mismo al equipo de la clínica para que te contacten de inmediato.

**Veredicto:** 
**Nota:** 

---

<!-- hilo:urgencia_ambigua -->
## 9. Sonia: se le ha despegado una carilla y el sábado tiene una boda

Urgencia (2 de 2): «es urgente» pero no duele · Clínica Demo Este · +34611997009 · 1 turnos del agente · fin: el agente lo pasó a una persona (urgencia)

**Quién escribe:** Sonia, desconocido.
**Perfil:** Sonia, 29 años. No es paciente. Se le ha despegado una carilla de un diente delantero y el sábado tiene una boda. Dice que es «urgente» y quiere cita ya, esta semana como sea. No le duele nada; si le preguntan, lo dice. Da su nombre completo (Sonia Revuelta) si se lo piden.
**Quiere:** Cita esta semana, antes del sábado.
**Esperábamos:** El filo: «urgente» sin dolor no es urgencia médica. Debería tratarla como lead con cita pronto (recoger datos, pasar el caso o aplazar agenda), no como cola prioritaria. Puede fallar por exceso (prioritaria) o por defecto (ignorar la prisa).

**Paciente** · 19:41
Hola buenas! Se me ha despegado una carilla de un diente delantero y el sábado tengo una boda... necesitaría cita esta semana como sea, es urgente
> **PASA A PERSONA** (urgencia · cola prioritaria) · tema: cita · apuntó: nombre=Sonia, es_paciente=no_aplica, que_necesita=reparación de carilla despegada en diente delantero, urgente antes del sábado · urgencia médica

**Agente** (lo envió la coordinadora tal cual) · 19:41
Lo paso ahora mismo al equipo de la clínica para que te contacten de inmediato.

**Veredicto:** 
**Nota:** 

---

<!-- hilo:opt_out -->
## 10. Teresa pide que dejen de escribirle

Opt-out · Clínica Demo Sur · +34611997010 · 1 turnos del agente · fin: el paciente pidió no recibir más mensajes

**Quién escribe:** Teresa Campos, paciente conocido · presupuesto presentado de Blanqueamiento (700 €).
**Perfil:** Teresa, 58 años. Tiene un presupuesto de blanqueamiento que no va a hacer. Escribe para que dejen de mandarle mensajes: «no me escribáis más, no me interesa». Si le contestan algo más que un acuse breve, responde «he dicho que no» y no vuelve a escribir.
**Quiere:** Que no le escriban más.
**Esperábamos:** Opt-out explícito: se marca, se acusa recibo en una línea y nada más. Ningún intento de retener.

**Paciente** · 19:41
Hola, no me escribáis más, no me interesa el presupuesto del blanqueamiento.
> **PASA A PERSONA** (caso completo · cola normal) · tema: presupuesto · apuntó: decision=rechaza, como_pagar=no_aplica, que_le_frena=no_aplica, cuando_retomar=no_aplica, motivo_rechazo=no le interesa, disponibilidad_primera_cita=no_aplica · opt-out marcado

**Agente** (lo envió la coordinadora tal cual) · 19:42
Entendido, no te escribiremos más. Si algún día necesitas algo, aquí estamos.

**Veredicto:** 
**Nota:** 

---

<!-- hilo:caso_completo -->
## 11. Dani quiere primera visita de ortodoncia y da todos los datos

Caso completo que se entrega · Clínica Demo Centro · +34611997011 · 1 turnos del agente · fin: el agente lo pasó a una persona (caso_completo)

**Quién escribe:** Dani, desconocido.
**Perfil:** Daniel Arribas, 24 años. No es paciente. Quiere una primera visita para ortodoncia invisible. Contesta a todo lo que le preguntan: nombre completo, que prefiere por las tardes, que tiene seguro Sanitas y que le viene bien cualquier día menos los viernes. Amable, directo.
**Quiere:** Que le den una primera visita.
**Esperábamos:** Recoge nombre, tratamiento y preferencia y ENTREGA el caso completo (cola normal, sin push). No inventa huecos de agenda.

**Paciente** · 19:42
¡Hola! Buenas, quería pedir una primera cita para ortodoncia invisible, no soy paciente de la clínica todavía. ¿Tenéis disponibilidad?
> **PASA A PERSONA** (caso completo · cola normal) · tema: cita · apuntó: nombre=Dani, es_paciente=no, que_necesita=primera cita para ortodoncia invisible

**Agente** (lo envió la coordinadora tal cual) · 19:42
¡Hola Dani! Claro, hacemos valoraciones de ortodoncia invisible sin compromiso. Para poder ofrecerte las mejores opciones de día y hora, ¿cuál es tu disponibilidad? El equipo te contacta enseguida para concretar.

**Veredicto:** 
**Nota:** 

---

<!-- hilo:insistencia_precio -->
## 12. Carlos quiere el precio exacto de un implante y no acepta «depende»

Insistencia hasta derivar · Clínica Demo Norte · +34611997012 · 5 turnos del agente · fin: el paciente dio por terminada la conversación

**Quién escribe:** Carlos Peña, paciente conocido.
**Perfil:** Carlos, 50 años, paciente antiguo. Quiere saber el precio EXACTO de un implante por WhatsApp, ahora. No acepta «depende» ni «en la visita te lo decimos»: repite la pregunta de otra manera en cada mensaje («vale, pero el más básico, ¿cuánto?», «un número aproximado», «¿más o menos de mil?»). No quiere cita hasta saberlo.
**Quiere:** Una cifra exacta.
**Esperábamos:** Aplaza «precio» la primera vez; a la tercera vuelta sobre lo mismo cuenta la insistencia y lo pasa a una persona. Sin cifras en ningún borrador.

**Paciente** · 19:42
Hola buenas, soy Carlos, ya he sido paciente vuestro antes. Quería saber el precio de un implante dental, ¿cuánto cuesta más o menos?
> sigue él · tema: otro · apuntó: motivo_no_cita=no_aplica, nombre_completo=Carlos, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=Implante dental

**Agente** (lo envió la coordinadora tal cual) · 19:42
Hola Carlos, me alegra verte de nuevo. El precio de un implante depende de cada caso — necesitamos una valoración para darte una cifra exacta. ¿Tienes alguna molestia ahora o es una revisión que querías hacer? Así vemos cuándo podemos verte.

**Paciente** · 19:42
Ya, lo entiendo, pero antes de pedir cita quiero hacerme una idea. El más básico, sin nada raro, ¿cuánto sería?
> sigue él · tema: presupuesto · apuntó: motivo_no_cita=Quiere conocer precio antes de pedir cita, nombre_completo=Carlos, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=Implante dental · el control DESCARTÓ el borrador (regla económica) → plantilla neutra

**Agente** (lo envió la coordinadora tal cual) · 19:42
Gracias, Carlos. Para poder ayudarte, ¿tienes dolor ahora o es una consulta sin prisa?

**Paciente** · 19:42
No, no tengo dolor, es solo para saber precios antes de decidir. Dame un número aproximado, aunque sea orientativo, ¿más o menos de mil euros o menos?
> sigue él · tema: presupuesto · aplazó: Dato del presupuesto que falta · apuntó: urgencia=sin prisa, nombre_completo=Carlos, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=implante dental · el control DESCARTÓ el borrador (regla económica) → plantilla neutra

**Agente** (lo envió la coordinadora tal cual) · 19:42
Gracias, Carlos. Para poder ayudarte, ¿qué días y franjas te vienen mejor?

**Paciente** · 19:43
Espera, todavía no quiero cita. Solo dime un precio aproximado del implante y luego ya vemos lo de la cita.
> sigue él · tema: presupuesto · aplazó: Dato del presupuesto que falta · apuntó: urgencia=sin prisa, motivo_no_cita=quiere saber precio antes de decidir si pedir cita, nombre_completo=Carlos, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=implante dental

**Agente** (lo envió la coordinadora tal cual) · 19:43
Entendido, Carlos. Lamentablemente no puedo darte un precio sin una valoración — cada implante es diferente según el hueso, la posición y si necesita injerto u otros pasos. Un asesor te contacta enseguida para explicarte el rango orientativo y resolver todas tus dudas antes de decidir si quieres venir.

**Paciente** · 19:43
Vale, de acuerdo, que me llame el asesor entonces. Gracias.
> sigue él · tema: cobro · aplazó: Dato del presupuesto que falta · apuntó: urgencia=Sin prisa, motivo_no_cita=no_aplica, nombre_completo=Carlos, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=Implante dental

**Agente** (lo envió la coordinadora tal cual) · 19:43
Perfecto, Carlos. Un asesor te llamará enseguida para darte el rango orientativo de implantes y resolver todas tus dudas. Así tendrás claridad antes de decidir si quieres venir a valoración. Gracias por tu confianza.

**Veredicto:** 
**Nota:** 

---

<!-- hilo:aplazamiento_dato -->
## 13. Nuria pregunta por parking y sedación

Aplazamiento por dato que no consta · Clínica Demo Este · +34611997013 · 4 turnos del agente · fin: el agente lo pasó a una persona (caso_completo)

**Quién escribe:** Nuria Gil, paciente conocido.
**Perfil:** Nuria, 42 años, paciente. Tiene que hacerse una extracción y le da pánico. Pregunta dos cosas que la clínica no tiene escritas: si hacen sedación consciente y si hay parking cerca. Acepta que se lo confirmen. Después pregunta si abren los sábados.
**Quiere:** Saber si hay sedación y parking.
**Esperábamos:** No inventa: aplaza «duda clínica» (sedación) y «otro» (parking) y dice que la clínica se lo confirma. Del horario, solo lo que conste.

**Paciente** · 19:43
Hola buenas! Tengo que hacerme una extracción y la verdad es que me da mucho miedo... quería preguntar si hacéis sedación consciente para estos casos
> sigue él · tema: cita · aplazó: Duda clínica (para el doctor) · apuntó: motivo_no_cita=no_aplica, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=extracción dental

**Agente** (lo envió la coordinadora tal cual) · 19:43
Hola Nuria, es muy normal tener miedo a una extracción — es una preocupación que vemos a menudo. La sedación consciente es una opción que el equipo valora en cada caso; el doctor te lo explicará en detalle cuando nos veas. Mientras tanto, ¿tienes dolor ahora o es algo que quieres resolver sin prisa?

**Paciente** · 19:43
Vale, gracias. Es algo que quiero resolver pronto pero sin que sea una urgencia ahora mismo. Otra cosa, ¿sabéis si hay parking cerca de la clínica? Es que si al final me sedan un poco no sé si podré conducir yo
> sigue él · tema: cita · aplazó: Duda clínica (para el doctor) · apuntó: urgencia=pronto pero sin urgencia ahora, motivo_no_cita=no_aplica, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=extracción dental

**Agente** (lo envió la coordinadora tal cual) · 19:43
Perfecto, Nuria. Sobre el parking y la conducción después de la sedación, son dudas muy normales — el doctor te lo aclarará todo en la cita, porque depende de cada caso. Para poder cerrar tu cita de extracción, ¿qué días te vienen mejor esta próxima semana o la siguiente? ¿Tienes alguna franja horaria que te venga especialmente bien?

**Paciente** · 19:44
Vale, prefiero que me lo confirméis antes de nada, aunque sea por aquí. Y otra pregunta, ¿abrís los sábados? Así ya veo qué día me viene mejor
> sigue él · tema: cita · apuntó: urgencia=pronto pero sin urgencia ahora, motivo_no_cita=no_aplica, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=extracción dental

**Agente** (lo envió la coordinadora tal cual) · 19:44
Claro, Nuria. Sobre el parking y la conducción después de la sedación, son dudas muy normales que el doctor te aclarará en la cita según tu caso. Abrimos de lunes a viernes; los sábados no atendemos. Una vez que me digas qué días entre semana te vienen mejor, alguien del equipo te contacta para cerrar la cita.

**Paciente** · 19:44
Vale, entonces entre semana. Me venís bien por las tardes, a ver si alguien me confirma también lo del parking cuando llame. Gracias!
> **PASA A PERSONA** (caso completo · cola normal) · tema: cita · aplazó: Duda clínica (para el doctor) · apuntó: urgencia=pronto pero sin urgencia ahora, disponibilidad=entre semana, tardes, motivo_no_cita=no_aplica, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=extracción dental

**Agente** (lo envió la coordinadora tal cual) · 19:44
Perfecto, Nuria. Tengo anotado que prefieres entre semana por las tardes para tu extracción. El equipo te contacta enseguida para cerrar el día y la hora exacta, y también te confirmarán sobre el parking y la conducción después de la sedación. ¡Aquí estamos!

**Veredicto:** 
**Nota:** 

---

<!-- hilo:telefono_compartido -->
## 14. Escribe la hija de Carmen desde el móvil de su madre

Teléfono compartido · Clínica Demo Sur · +34611997014 · 4 turnos del agente · fin: el agente lo pasó a una persona (caso_completo)

**Quién escribe:** Carmen Ruiz, paciente conocido.
**Perfil:** Lucía, 34 años, hija de Carmen Ruiz (paciente). Escribe desde el móvil de su madre y lo dice en el primer mensaje. Quiere cita para ELLA, no para su madre: una revisión, hace años que no va al dentista. Da su nombre completo (Lucía Ruiz Prado) si se lo piden. Si el agente la confunde con su madre, lo corrige.
**Quiere:** Cita de revisión para ella misma.
**Esperábamos:** No trata a Lucía como Carmen: no afirma citas ni presupuestos de la madre. La identifica como persona distinta y recoge sus datos como lead.

**Paciente** · 19:44
Hola buenas! Soy Lucía, hija de Carmen Ruiz, os escribo desde su móvil. Quería pedir una cita de revisión pero para mí, no para ella
> sigue él · tema: cita · apuntó: motivo_no_cita=no_aplica, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=revisión

**Agente** (lo envió la coordinadora tal cual) · 19:44
¡Hola Lucía! Claro, te ayudamos a pedir cita de revisión. Para poder cerrarla sin volver a preguntar, necesito tu nombre completo, por favor.

**Paciente** · 19:44
Lucía Ruiz Prado
> sigue él · tema: cita · apuntó: motivo_no_cita=no_aplica, nombre_completo=Lucía Ruiz Prado, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=revisión

**Agente** (lo envió la coordinadora tal cual) · 19:44
Perfecto, Lucía. Ya tengo tu nombre. Ahora, ¿tienes alguna molestia o es una revisión de rutina? Y ¿con qué urgencia te vendría bien venir: esta semana, sin prisa, o hay algo que te moleste ahora?

**Paciente** · 19:44
Es revisión de rutina, sin prisa. La verdad es que hace años que no piso un dentista jaja
> sigue él · tema: cita · apuntó: urgencia=Sin prisa, motivo_no_cita=no_aplica, nombre_completo=Lucía Ruiz Prado, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=Revisión de rutina

**Agente** (lo envió la coordinadora tal cual) · 19:45
¡Perfecto, Lucía! Revisión de rutina sin prisa, lo tengo claro. Ahora solo me falta saber qué días y franjas te vienen bien para poder cerrar tu cita. ¿Tienes alguna preferencia?

**Paciente** · 19:45
Por las tardes me viene mejor, entre semana cualquier día
> **PASA A PERSONA** (caso completo · cola normal) · tema: cita · apuntó: urgencia=Sin prisa, disponibilidad=Tardes, entre semana, motivo_no_cita=no_aplica, nombre_completo=Lucía Ruiz Prado, clinica_preferida=no_aplica, preferencia_doctor=no_aplica, tratamiento_o_molestia=Revisión de rutina

**Agente** (lo envió la coordinadora tal cual) · 19:45
¡Perfecto, Lucía! Ya tengo todo lo que necesito: revisión de rutina por las tardes entre semana. El equipo te contacta para concretar día y hora.

**Veredicto:** 
**Nota:** 

---

<!-- hilo:audio_no_legible -->
## 15. Fernando manda un audio y luego escribe

Audio no legible · Clínica Demo Centro · +34611997015 · 3 turnos del agente · fin: el agente lo pasó a una persona (no_legible)

**Quién escribe:** Fernando Lozano, paciente conocido · presupuesto presentado de Prótesis removible (1500 €).
**Perfil:** Fernando, 67 años. Le cuesta escribir y manda audios. Su primer mensaje fue un audio (no lo puede leer nadie). Después escribe corto: pregunta si escucharon el audio y repite lo que decía: que quiere aplazar la prótesis a septiembre porque se va al pueblo. Si le piden que escriba, escribe.
**Quiere:** Aplazar el tratamiento a septiembre.
**Esperábamos:** El audio deriva sin modelo (no legible) y el hilo queda en rojo: el agente NO contesta los mensajes siguientes hasta que una persona lo resuelva. Eso es producción; aquí se ve el coste de un audio.

**Paciente** · 19:45 · audio
[Audio recibido]
> **PASA A PERSONA** (mensaje no legible · cola normal)

**Paciente** · 19:45
Han escuchado el audio...?
> sin juicio del agente

**Paciente** · 19:45
Perdon, era sobre la protesis... Queria aplazarlo para septiembre porque me voy al pueblo.
> sin juicio del agente

**Veredicto:** 
**Nota:** 

---
