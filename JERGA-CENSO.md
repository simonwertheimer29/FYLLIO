# Censo de jerga interna en el texto visible del producto

Fecha: 2026-09-11. Pedido por Simon: «el producto habla con jerga nuestra». Regla que se
propone para el estándar visual: **el producto no usa vocabulario interno. Si una palabra
necesita que alguien la explique, no vale.** Se queda el vocabulario del sector dental
(presupuesto, primera visita, no-show, señal, liquidación, lead) y el español normal.

Método: se leyeron los mapas código→texto (`etiquetas-agente.tsx`, `ETIQUETA_*` de
estado, aplazamientos, semáforo, métricas, cohortes, candidatos) y después todos los
títulos, etiquetas, filtros, tooltips, placeholders y mensajes de `app/(authed)` y
`app/components` (unos 560 textos únicos). Aquí solo lo que un usuario nuevo no
entendería. Nada está cambiado todavía: los nombres se deciden con Simon.

Leyenda de la propuesta: la primera es la recomendada; entre corchetes, alternativas.

---

## 1. Del módulo compartido (`app/components/agente/etiquetas-agente.tsx` y mapas hermanos)

Estos textos salen a la vez en «ver por qué» (Mensajería y Seguimiento), en el banco de
pruebas y en Inicio. Cambiarlos aquí cambia todas las pantallas.

| Término visible | Dónde | Por qué no se entiende | Propuesta |
|---|---|---|---|
| «caso completo — lo entrega listo» · «caso completo entregado» · «Derivaciones con el caso completo» · «Te libera (caso listo)» | ver por qué, Inicio, Confianza, métricas | «caso completo» es nuestro: significa que el agente ya tiene todos los datos y lo pasa al equipo | «Con todos los datos: listo para el equipo» [«Listo para que lo atienda el equipo»] |
| «insistió sobre algo aplazado» · «Aplazados» · «Preguntas que aplazó» · «aplazó precio o descuento» | ver por qué, Inicio, métricas, Configuración | «aplazar» aquí es nuestro: el agente deja una pregunta para que la clínica la conteste | «Insistió en una pregunta pendiente de la clínica» · «Preguntas pendientes para la clínica» [«Dejó para la clínica»] |
| «El control de seguridad» · «El control de seguridad actuó» · «Lo paró el control» · «Borradores parados por el control» · «Versión del control» | ver por qué, banco, Confianza | «control» a secas no dice qué es; y en métricas aparece como «juez» | «Revisión de seguridad» · «La revisión de seguridad descartó el mensaje» · «Mensajes descartados por la revisión de seguridad» |
| «Borradores descartados por el juez» · «descartes del juez» | métricas (KPIs, Inicio) | «juez» es el nombre interno del control | igual que arriba: «Mensajes descartados por la revisión de seguridad» |
| «el control no respondió (se descartó por seguridad)» | ver por qué | idem | «La revisión de seguridad no contestó: se descartó por precaución» |
| «Derivaciones a persona» · «derivó» · «Asunto derivado sin resolver» · «Escalado» | métricas, Inicio, ficha, presupuestos | «derivar/escalar» se entiende a medias; no es jerga dura pero es de sistema | «Casos pasados a una persona» · «Pasó el caso a una persona» · «Pendiente de una persona» [dejar «derivar» si lo prefieres: es español] |
| «Turnos evaluados por el agente» · «turno» · «Sin turnos tarifados» · «De este turno no quedó juicio guardado» | métricas, Inicio, ver por qué | «turno» y «juicio» son nuestros: un turno es un mensaje del paciente que el agente atiende | «Mensajes atendidos por el agente» · «De este mensaje no quedó registro de la decisión» |
| «Sin evaluar» · «El agente debía evaluar el último mensaje y no lo hizo» | filtro de Mensajería, alarma | «evaluar» es el verbo del código | «Sin atender por el agente» · «El agente tenía que atender el último mensaje y no lo hizo» |
| «Qué persigue ahora» | ver por qué, ficha | «objetivo activo» disfrazado | «Qué está gestionando ahora» |
| «Qué lleva recogido» · «Qué recogió en este mensaje» · «recogida» (fallo del candidato: «Apuntó mal un dato») | ver por qué, ficha, formulario de error | «recoger» se entiende, pero es de sistema | «Datos que ya tiene» · «Datos nuevos de este mensaje» [dejar «recogido»] |
| «Espera pactada» · «En espera pactada» · «Levantar la espera» · «Espera levantada — se puede volver a escribir» · «En espera (sin contacto hasta fecha)» | ficha, Seguimiento, Mensajería, ver por qué | «pactada» y «levantar» son nuestros | «En pausa hasta el [fecha], lo pidió el paciente» · «Reanudar el contacto» · «Contacto reanudado» |
| «Hilo asumido por una persona» · «Soltar el hilo» · «hilo» | ficha, Mensajería, semáforo | «hilo» es nuestro; la coordinadora dice «conversación» | «Conversación que lleva una persona» · «Devolver la conversación al agente» |
| «sembrado: este turno no lo juzgó el agente» | ver por qué (solo demo) | «sembrado» es del seed | «Ejemplo de la demo: esta decisión no la tomó el agente» |
| «Versión del evaluador» · «Detalles técnicos» · «Modelo» · «Tardó» · «Costó» | ver por qué, plegado | «evaluador» es el nombre del código | «Versión del agente» · «Versión de la revisión de seguridad»; el resto está bien plegado bajo «Detalles técnicos» |

## 2. Mensajería

| Término visible | Dónde | Por qué no se entiende | Propuesta |
|---|---|---|---|
| «Jugadas» · «Conversación jugada» · «Paciente simulado, agente real: cada turno lo decidió el agente y tiene traza» | filtro, chip, ficha | «jugar» y «traza» vienen de nuestras conversaciones | «Simuladas» [«Simuladas con el agente»] · «Conversación simulada: el paciente es simulado, las respuestas son del agente real» · «traza» → «cada decisión queda registrada» |
| «Sin ficha» | chip | ambiguo: ¿ficha de qué? | «Sin ficha de paciente» |
| «Las lleva el agente» · «Necesitan de mí» · «Mías sin respuesta» | filtros | se entienden; se quedan | — |
| «Lo redactó el agente» | icono en cada mensaje | se entiende; se queda | — |

## 3. Seguimiento e Inicio

| Término visible | Dónde | Por qué no se entiende | Propuesta |
|---|---|---|---|
| «Cola prioritaria» · «Cola normal» · «Respuesta de una persona a lo que entrega el agente · cola prioritaria» | Inicio, KPIs | «cola» es de sistema | «Atención inmediata» · «Atención normal» (la campana ya dice «Atención inmediata») |
| «Listos para cerrar — El agente terminó: revisa y cierra» · «Fuera de plazo — Le tocaba al equipo y se pasó el plazo» · «Necesita respuesta» | cohortes de Seguimiento e Inicio | se entienden; se quedan | — |
| «llegaron con la decisión ya recogida» · «con disponibilidad y motivo ya recogidos» | Inicio, «Qué hizo Fyllio por ti este mes» | «recogida» de sistema; «cocinado» NO aparece en pantalla, solo en el código | «llegaron con la decisión ya tomada por el paciente» · «con día, hora y motivo ya preguntados» |
| «Intervención» | pestaña de Presupuestos | jerga: significa «necesita a alguien» | «Necesitan a alguien» |
| «Sin ningún contacto y ya pasó el plazo del motor de seguimiento (48 h)» · «Motor No-shows» | leads, automatizaciones | «motor» es de sistema | «…y ya pasaron las 48 h del seguimiento automático» · «Seguimiento de no-shows» |
| «Toca llamar» · «El texto se agotó: llama por teléfono» | estados de seguimiento | «el texto se agotó» es nuestro | «Se acabaron los mensajes: llama» |

## 4. Agentes de IA › Conversacional

| Término visible | Dónde | Por qué no se entiende | Propuesta |
|---|---|---|---|
| «Confianza» (pestaña) · «Confianza media» | pestañas, llamadas | vago pero no interno; se puede quedar | [«Cómo lo hace»] |
| «La última pasada de la vara no se pudo leer» · «la vara está por volver a pasar» · «entra en revisión antes de sumarse a la vara» | Confianza | «la vara» y «pasada» son nuestras | «las pruebas de calidad del agente» · «La última vez que se pasaron las pruebas…» · «…antes de sumarse a las pruebas de calidad» |
| «Pruebas» (pestaña) · «El banco de pruebas no se pudo abrir» · «Escribe como el paciente…» | pestaña, banco | «banco de pruebas» es nuestro; «Pruebas» a secas es ambiguo | «Probar el agente» · «La prueba del agente no se pudo abrir» |
| «Conocimiento» · «ninguno publicado» · «lo publicado» · «Publicar» | Configuración, ver por qué | «conocimiento» y «publicar» son de sistema | «Lo que el agente sabe de la clínica» · «Guardar y activar» [«Poner en marcha»] |
| «Objetivos» (del agente) | Configuración | se confunde con «Objetivos del mes» de Ajustes | «Qué persigue el agente en cada caso» |
| «Cadencias y recordatorios» · «cadencia» · «Toques sin respuesta antes de dar la cadencia por agotada» | Ajustes › Automatizaciones, Configuración | «cadencia» y «toque» son nuestros | «Secuencias de seguimiento y recordatorios» · «Mensajes sin respuesta antes de parar la secuencia» |
| «Intención detectada en su última respuesta» | Automatizaciones | «intención» es del clasificador | «Qué quiere, según su última respuesta» |

## 5. Analíticas y métricas (KPIs, Inicio, Antes y después)

| Término visible | Propuesta |
|---|---|
| «Coste por turno» · «Coste del modelo ($)» | «Coste por mensaje atendido» · «Coste del asistente ($)» |
| «Latencia del modelo (mediana, ms)» | «Tiempo de respuesta del asistente» |
| «Errores del modelo» | «Fallos del asistente» |
| «Salientes redactados por el agente» | «Mensajes redactados por el agente» |
| «Borradores del agente enviados tal cual por el equipo» · «Enviado tal cual / Editado / Reescrito» | se entienden; se quedan |
| «Antes y después» · «Dónde se pierde» · «Qué dicen» · «KPIs» | se entienden; se quedan |

## 6. Ajustes (solo admin, pero también producto)

| Término visible | Propuesta |
|---|---|
| «Modo A» · «Modo B» (Integración WhatsApp) | «Envío manual: tú pulsas enviar» · «Envío automático» |
| «No se pudo encolar el turno (corrió en el webhook)» · «Reintentos agotados: el turno no se evaluó» · «El modelo no responde (el turno se derivó)» (Incidencias) | «No se pudo poner el mensaje en cola» · «Tras varios intentos, el agente no pudo atender el mensaje» · «El asistente no respondió: el mensaje pasó a una persona» |
| «Pipeline» (menú) | anglicismo habitual en CRM; borderline. [«Embudo»] o se queda |

## 7. Se queda (sector o español claro)

presupuesto · primera visita · no-show · señal · liquidación · lead · KPI · portal · doctor ·
tratamiento · «Lo redactó el agente» · «Necesitan de mí» · «Las lleva el agente» · «Estuvo bien» ·
«El agente se equivocó aquí» · «Qué entendió / Qué decidió / Qué le falta / Qué anotó para tu equipo».

## 8. Solo en código, no en pantalla (no hace falta tocar)

cocinado · vara (salvo Confianza) · quiebre · semáforo · cohorte · orquestador · evaluador (salvo
«Versión del evaluador») · veto · fixture · seed.

---

## Regla propuesta para `fyllio-estandar-visual`

**Vocabulario: el producto no habla con jerga nuestra.** Todo texto visible —etiquetas,
filtros, títulos, tooltips, mensajes de error, chips— se escribe para una coordinadora que abre
Fyllio por primera vez. Si una palabra necesita que alguien se la explique, no vale. Se queda el
vocabulario del sector dental (presupuesto, primera visita, no-show, señal) y el español normal
y profesional; no se usan los nombres del código ni los que nacieron entre nosotros (turno,
juez, control, vara, cadencia, toque, hilo, aplazado, caso completo, jugada, sembrado, modelo,
motor, cola, modo A). Los mapas código→texto (`etiquetas-agente.tsx` y los `ETIQUETA_*`) son
el único sitio donde se traduce: una etiqueta nueva pasa por ahí, no por un literal en la vista.
Prueba del algodón: leer la etiqueta en voz alta a alguien de recepción.
