# Gasto de modelo por sesión

Regla (22-08): cada pasada con modelo se apunta AQUÍ antes o justo después de correrla —
fecha · script · coste (medido si el script lo imprime, estimado si no) · motivo · acumulado.
El acumulado de la sesión aparece en cada informe a Simon.

## Sesión 2026-08-22 (post-recarga) — CERRADA en ~$4,50
Reconstruida a posteriori (el fallo que motivó esta regla): 5,6 pasadas del evaluador ($3,05
medido), 7 del juez (~$0,28 est.), 8 repros (~$0,30 est.), aguante ×2 (~$0,60 est.),
medir-coste ($0,06), sondas caché ($0,02). Detalle en el informe del 22-08 y en los ficheros
de esta carpeta. Pendiente al reabrir crédito: vara del evaluador post-equilibrio (~$0,55).

## Sesión 2026-08-23
- qa:evals-evaluador (post-reequilibrio) · **$0,36 medido** · cierre del punto de ayer, aprobada · ac. $0,36
- qa:evals-evaluador con CAPTURA_JUEZ (corpus 69 entradas) · **$0,35 medido** · la medición del criterio nuevo · ac. $0,71
- qa:juez-vivo A/B (prompt actual vs candidato V2) · **$0,33 medido** · ¿cuántos quedarían? · ac. $1,04
- corpus con V3 (actual sin regla 4) · **$0,15 medido** · la opción quirúrgica, la elegida · ac. $1,19
- qa:juez frases · **$0,12 medido** · ⚠ DESPERDICIADA — un edit falló y la pasada corrió sin el cambio · ac. $1,31
- qa:juez frases (50/50) · **$0,12 medido** · verificación del retiro de la 4 + exención invitación · ac. $1,43
- qa:evals-evaluador (dato_cita + red) · **$0,31 medido** · cierre del punto B · ac. $1,74
- repro escenario paciente-al-día · **~$0,03** · verificación dictada · ac. $1,77
  (anunciado $0,90 + $0,40 del punto B = $1,30; el exceso: $0,15 del V3 no previsto, $0,12
  desperdiciados, y varas más caras de lo estimado)
- qa:juez frases (52/52, +AG8 eco-horario +AG9 apertura-bien-dicha) · **$0,13 medido** ·
  verificación del cierre de raíz de agenda (veto determinista + matiz regla 5) · ac. **$1,90**
  (anunciado $0,15 con el repro; el repro con modelo NO se corrió — el veto es código y
  qa:conocimiento prueba la frase LITERAL de la captura sin gastar)

## Sesión 2026-09-05 (resolución de la auditoría del agente)
- qa:evals-evaluador --solo I (tanda de inyección, 4 turnos) · **$0,02 medido** · MEJORAS 138: el texto delimitado y el juez frente a órdenes en el mensaje → 4/4, el juez cazó I3 (económica) · ac. $0,02
- qa:evals-evaluador --casos 16,6 × 5 corridas (10 turnos) · **$0,05 medido** ($0,0105 × 5) · fijar la banda de los «moneda al aire» con el prompt nuevo → 10/10, cero alternancia en cinco corridas · ac. $0,07
- qa:entrante (2 llamadas) · **~$0,01** · orquestador de punta a punta con tipo/señales/opt-out → 4/4 en la parte del orquestador (los 2 «fallos» son el interruptor del seed, que está encendido en DEMO y el QA espera apagado; no es del cambio) · ac. **$0,08**
  (anunciado $0,12; el 16/6 salió más barato de lo estimado)
- qa:evals-evaluador COMPLETA (73 turnos) · **$0,35 medido** ($0,3461) · dictada por Simon: el system cambió y medir solo lo tocado es lo que mordió antes → **66/67 (99 %)**, ¿Listo? 21/21, descartes del juez 7/73 (10 %); único fallo el 35 (R→S, la vara pide A). Salida en `2026-09-05-evaluador-post-auditoria.txt` · ac. **$0,43**
- qa:entrante (2 llamadas) · **~/bin/bash,01** · regresión tras la guarda de idempotencia y los resultados tipados del evaluador (MEJORAS 164) → 8/8, la reentrega se salta sin gastar modelo (6-sep)

## Sesión 2026-09-09 (plan maestro 2.4 — confianza del agente)
- **Sin gasto de modelo.** La vara que enseña el producto (`ultima-pasada.json`) se transcribió de la pasada del 5-sep (66/67) en vez de volver a pasarla (~$0,35): el texto de los dos prompts no cambió desde 2fbafc3 (comprobado con `git diff`), así que el hash de hoy ES el medido. `qa:confianza` y `qa:metricas` no llaman al modelo.

## Sesión 2026-09-10 (hilos jugados — el seed conversacional) — TOPE DECLARADO $5
Anunciado antes de correr: jugar 15 hilos (paciente sonnet ≈ $0,01/turno + agente haiku
≈ $0,009/turno, ≤ 7 turnos) ≈ **$2**; un replay de muestra para verificar la mecánica ≈ $0,15;
margen para rejugar un par de hilos si un perfil sale dócil. Tope **$5**.
- hilos:jugar --solo lead_precio (humo, 1 turno) · **$0,01 medido** · la mecánica de punta a punta · ac. $0,01
- hilos:jugar (15 hilos, 33 turnos) · **$0,27 medido** ($0,17 agente + $0,09 paciente) · la jugada que puebla el
  fixture. Mucho menos de lo anunciado ($2): el agente ENTREGA en el primer turno en 13 de 15 hilos, así que
  los hilos son de 1-5 turnos — eso es el hallazgo, no un ahorro · ac. $0,28
- hilos:replay --solo cadencia_en_medio,insistencia_precio (8 turnos) · **$0,05 medido** · verificación de la
  mecánica del replay: 8/8 iguales (misma versión f3a180899dc9/d79cf567c2db: mide estabilidad); el control
  descartó dos borradores con horquillas de precio inventadas · ac. **$0,33** (tope $5)
- Dos jugadas fallidas antes (temperature rechazada por sonnet 5; estado PENDIENTE no existe en presupuestos):
  **$0,00** — murieron antes de llamar al modelo.
- repro banco vs runner (3 guiones × 3 llamadas) · **$0,05 medido** · pregunta de Simon: ¿deciden igual los dos
  caminos? NO en `lead_precio` (el nombre de perfil cierra el caso; MEJORAS 225), SÍ en urgencia y
  presupuesto · ac. **$0,38** (tope $5)
- Anunciado tras el arreglo de la 225 (pista de perfil + constructor único): vara completa (~$0,35),
  hilos:replay de los 15 (~$0,30) y volver a jugar los 15 (~$0,30) → ~$1 más, dentro del tope.
- qa:evals-evaluador COMPLETA tras la 225 (73 turnos) · **$0,35 medido** ($0,3485) → 66/67 (99 %), ¿Listo? 21/21,
  descartes del control 11/73 (antes 7/73). Escribe `ultima-pasada.json` con el hash nuevo (df3978f4e98d).
  Salida en `2026-09-10-225-vara-y-replay.txt` · ac. $0,73
- hilos:replay (31 turnos, fixture pre-225) · **$0,17 medido** · 13 iguales · 18 distintos; 3 cambian de DECISIÓN
  (lead_precio y caso_completo dejan de entregarse al primer turno; queja_economica pasa a entregar) · ac. $0,90
- hilos:jugar de nuevo, 15 hilos con el arreglo (35 turnos) · **$0,28 medido** ($0,18 agente + $0,09 paciente) · el
  fixture que queda es este; los desconocidos ya no se entregan al primer mensaje (lead_precio y caso_completo
  entregan en el 2.º, cuando dan el nombre) · ac. **$1,18** (tope $5)

## Sesión 2026-09-11
- hilos:replay --solo caso_completo (2 turnos) · **$0,02 medido** · pregunta de Simon: ¿el banco haría lo mismo con
  Daniela? Misma entrada por construcción (qa:banco-vs-runner extendido a todos los turnos) y misma decisión:
  entrega con nombre + necesidad porque a un desconocido solo se le abre «identificar», nunca «cita» · ac. $1,20
- qa:banco (un turno real, cero escritura) tras la sesión del banco · **$0,01** · ac. $1,21
- Anunciado: volver a jugar los 15 hilos con la sesión y «cita» abierta al desconocido (~$0,30), hilos:replay
  (~$0,17) y la vara completa (~$0,35) tras el commit de jerga — ~$0,8 más, dentro del tope.
- hilos:jugar, 15 hilos con la sesión del banco y «cita» abierta al desconocido (37 turnos) · **$0,31 medido**
  ($0,20 agente + $0,10 paciente) · qa:banco-vs-runner pasa de 5 divergencias (todas el objetivo «cita» del
  desconocido, el fixture era anterior) a 31 turnos iguales · ac. **$1,52** (tope $5)
- hilos:replay, 36 turnos del fixture nuevo · **$0,20 medido** · misma versión (df3978f4e98d/d79cf567c2db): mide
  ESTABILIDAD, no un cambio de prompt · 32 iguales · 4 distintos (queja_economica t2, opt_out t1, caso_completo t2,
  insistencia_precio t4) · ac. **$1,72** (tope $5)
- qa:evals-evaluador COMPLETA · **ABORTADA sin cifra fiable**: el crédito de la API de Anthropic se agotó a mitad de la
  pasada («credit balance is too low»), 15/73 evaluaciones en fallback → el script corta con salida 2 y NO escribe
  `ultima-pasada.json` (la última válida sigue siendo la del 10-09, misma versión df3978f4e98d). Gasto estimado de lo que
  sí corrió: ~$0,25 · ac. **~$1,97** (tope $5). PENDIENTE: recargar crédito y volver a pasarla (~$0,35). OJO: con el
  crédito a cero el agente de producción también está en fallback (casos «Sin respuesta del agente» + campana).
- 2026-09-11 (tarde) · hilos:replay, 36 turnos del fixture con la REGLA DEL ESTADO DE LA PERSONA (1+5+6), urgencia en la lista (4), segunda vez del «depende» (2) y teléfono compartido barato (3) · **$0,22 medido** · 7 iguales · 29 distintos (casi todos redacción/campos; cambios de decisión: ver evals/pasadas/2026-09-11-estado-persona-replay.txt) · ac. **~$2,19** (tope $5)
- 2026-09-11 (tarde) · qa:evals-evaluador COMPLETA con la regla del estado de la persona (versión 5cab7cbc26c8/d79cf567c2db) · **$0,35 medido** · DECISIÓN 66/67 (99 %; el mismo fallo de siempre, caso 35 A→S, pre-existente) · ¿LISTO? 21/21 · descartes del control 8/73 (11 %, antes 15 %) · ac. **~$2,54** (tope $5)
- 2026-09-11 (tarde) · hilos:replay --solo aplazamiento_dato ×2 (Nuria, 5 turnos) tras el veto de servicio (229) · **$0,08 medido** ($0,04 + $0,04) · ac. **~$2,62** (tope $5)
- 2026-09-11 (noche) · FASE 1 EN SOMBRA: `sombra:hilos` (replay de 36 turnos $0,2252 + sombra haiku $0,1160, versión 91215ba0eadc) · **$0,34 medido** · 35 sombras · 20 desacuerdos (57 %) · log en `2026-09-11-sombra-hilos.txt` · más `qa:entrante` de punta a punta con la sombra viva (~$0,02) · ac. **~$2,98** (tope $5)
- 2026-09-12 · TRES CONVERSACIONES POR GUION, Carmen + Dani + Carlos (`hilos:tres --solo telefono_compartido,caso_completo,insistencia_precio`) · **$0,31 medido** (estimado típico $0,65, peor $1,36) · los cuatro guiones: **$0,45 de los $3** del tope acordado · logs en `2026-09-12-tres-*.txt` · ac. **~$3,61**
- 2026-09-12 · TRES CONVERSACIONES POR GUION (049), solo Nuria (`hilos:tres --solo aplazamiento_dato`, paciente sonnet): código 5 turnos $0,053 · contexto 5 turnos $0,066 · libre 2 turnos $0,022 · **$0,14 medido** (estimado típico $0,22, peor $0,36) · ac. **~$3,30** · alcance acordado con Simon: 4 guiones (Carmen, Nuria, Dani, Carlos) con tope propio de $3 (peor caso $1,73)
- 2026-09-11 (noche, 2) · SOMBRA LIBRE (048): `sombra:libre` en tres pases (dos murieron a medias: API lenta + pooler; el tercero completo $0,1040, versión libre) · **~$0,18 medido** · 33 guardadas · 18 distintas del código · 20 distintas de la sombra con contexto · log en `2026-09-11-sombra-libre.txt` · ac. **~$3,16** (tope $5)
- 2026-09-12 · EL JUEZ SOBRE EL MODELO LIBRE (diagnóstico previo a fase 2): los 9 mensajes del decisor libre de los 4 guiones por el juez de producción, 3 pasadas cada uno (27 llamadas haiku) · **$0,08 medido** (anunciado $0,05-0,10) · tumba 1/9 (Nuria t2, «anotamos que alguien te llame para hablar de sedación consciente» → clinica, 3/3: falso positivo de REMITIR, el de MEJORAS 232) · 0 inestables · log en `2026-09-12-juez-sobre-libre.txt` · ac. **~$3,69** (los cuatro guiones + este: $0,53 de los $3 del tope propio)
- 2026-09-12 · **PASO 1 DEL ORDEN DE SIMON — los 4 guiones con CLÍNICA CONFIGURADA, solo el modelo libre**
  (`hilos:tres --decisores libre --conocimiento db`, tras `demo:conocimiento`) · **$0,16 medido** (anunciado: típico $0,30,
  tope $0,60) · log en `2026-09-12-tres-libre-clinica-configurada.txt` · el libre usa lo publicado: parking real, implante
  «desde 1.100 €», enlace de reserva, horario · ac. **~$3,90**
- 2026-09-12 · El juez sobre esos 12 mensajes, 2 pasadas · **$0,17 medido** ($0,086 × 2: se ejecutó dos veces por un fallo
  mío al guardar el log, no por diseño; anunciado $0,10) · **tumba 6/12 (50 %) frente a 1/9 (11 %) con las clínicas
  vacías** — 4 aciertos (huecos afirmados, «20 minutos» inventado ×2, sedación no publicada) y 2 falsos positivos
  (la invitación «¿te agendamos?» y remitir con los días que pidió ella) · 0 inestables · log en
  `2026-09-12-juez-libre-clinica-configurada.txt` · ac. **~$4,07** ($0,91 de los $3 del tope propio)
- 2026-09-12 · **PASO 2 — diagnóstico de la regresión de la sedación**: turno 1 de Nuria × 5 variantes de lo publicado × 3
  repeticiones · **$0,10 medido** ($0,052 con la entrada montada a mano, que NO reprodujo la frase y se descartó, + $0,052
  con la construcción del runner, que la reprodujo 3/3) · hacen falta LAS DOS cosas juntas: el nombre de doctora publicado
  y una nota «se valora en consulta» · log en `2026-09-12-diagnostico-sedacion.txt` · ac. **~$4,17**
- 2026-09-12 · Verificación de los falsos positivos con el juez VIVO tras el perdón (6 casos × 2 pasadas) · **$0,03 medido** ·
  los 4 falsos positivos pasan, los 2 aciertos siguen cayendo · ac. **~$4,20** ($1,04 de los $3 del tope propio)
- 2026-09-12 · Censo de vetos sobre 79 mensajes reales (determinista, **$0** ) · antes 2/79 y cero sobre el modelo libre;
  después 6/79, todas aciertos · log en `2026-09-12-censo-vetos.txt`
- 2026-09-12 · EL JUEZ SOBRE EL DECISOR CON CONTEXTO (mismo diagnóstico, para comparar y auditar guardas): 17 mensajes, 1 pasada · **$0,05 medido** (anunciado ≈ $0,05) · tumba 7/17 (41 %) · SE LE ESCAPA «un implante puede rondar desde 800 hasta 2500 euros» (regla 2) · «te agendamos para el martes» lo caza el juez pero NO el veto de reserva (solo 1ª persona singular) · «abrimos sábados» solo cae por «podemos cerrar tu cita» · log en `2026-09-12-juez-sobre-contexto.txt` · ac. **~$3,74** ($0,58 de los $3 del tope propio)
- 2026-09-12 · **PASO 3 — qa:juez con la categoría `dato_inventado` (MEJORAS 232)**: 57 casos, 1 pasada ·
  **$0,2153 medido** (anunciado ≈ $0,10-0,12 — la vara tiene 5 casos más que la última vez que se estimó) ·
  **56/57 · FN=0 · FP=1** · los 5 casos nuevos salen los 5 como se esperaba (remitir nombrando el servicio PASA;
  afirmar que la doctora lo valora INFRINGE; horario y parking inventados caen como `dato_inventado`; los MISMOS
  datos publicados PASAN) y la categoría no se equivoca en ninguno (0/2) · el único FP **no es regresión: L8
  estaba caducado** — se escribió en agosto, cuando confirmar una cita no se juzgaba, y la doctrina cambió ayer
  con el caso de Nuria; se pasa al lado correcto y se le añade su pareja L8b, verificadas con el juez vivo por
  $0,01 sin repetir la pasada · log en `2026-09-12-juez-232-dato-inventado.txt` · ac. **~$4,43**
- 2026-09-13 · **EL CONTROL NUEVO SOBRE CONVERSACIONES** (encargo: «mide sobre conversaciones») · **$0,53 medido**
  (anunciado ≈ $0,56 típico / $1,13 tope): rejugar los 4 guiones con `codigo` y `libre` y clínica configurada
  **$0,33**, + `control:hilos` sobre libre (13 msj) **$0,064**, sobre codigo (13 msj) **$0,056**, y sobre los
  MISMOS 12 mensajes del 12-09 **$0,038 ×2** (la 1ª encontró el bug del troceo por «Dra.»; la 2ª, con el arreglo) ·
  **LA CIFRA: de 6/12 tumbados a 0/12 muertos** · log en `2026-09-13-control-sobre-conversaciones.txt` ·
  ac. **~$4,96** ($1,57 de los $3 del tope propio)
- 2026-09-13 · **LA MÉTRICA DE ENTREGA TARDÍA: rejugar los 4 guiones para llenarla** (encargo de Simon,
  «0,86 típico es barato para la cifra que decide la fase 2») · **$0,64 medido** (anunciado ≈ $0,86
  típico / $1,73 tope): `hilos:tres` con los tres decisores y `--conocimiento db` · **LA CIFRA: el
  modelo libre NO entrega tarde — no entrega nunca con el caso listo (0/4 con el objetivo cubierto)**;
  el de contexto cubre 3/4 y entrega 1 mensaje tarde en dos de ellos; el código, 2/2 a tiempo y 2
  entregados por un hecho sin cubrir · log en `2026-09-13-entrega-tardia.txt` · ac. **~$5,60**
  ($2,21 de los $3 del tope propio)
- 2026-09-13 · **EL LIBRE CON LA CLÍNICA VACÍA** (hipótesis de Simon: publicar datos le quita las ganas
  de derivar) · **$0,21 medido** ($0,04 de un pase de 1 turno para probar el arreglo + $0,17 del pase;
  anunciado ≈ $0,30 típico / $0,60 tope) · **LA CIFRA: vacía 4/4 entregados y 2/4 con el objetivo
  cubierto; publicada 2/4 entregados y 0/4 cubierto.** Mismo código, mismos guiones, mismo día: lo
  único que cambia es el mundo · log en `2026-09-13-libre-clinica-vacia.txt` · ac. **~$5,81**
  ($2,42 de los $3 del tope propio)


- **13-09 · C (libre) vs D (alcance declarado), clínica publicada, control puesto en los dos** —
  los mismos 4 guiones del 13-09 con el decisor nuevo, para responder si declararle su papel le
  devuelve las ganas de derivar · **$0,59 medido** (anunciado ≈ $0,72 típico / $1,44 tope) + una
  pasada previa que murió a los dos minutos por un corte de red (juez abortado y `ETIMEDOUT` de
  Postgres, $0,00) · **LA CIFRA: libre 0/4 con el objetivo cubierto y 2/4 entregados; alcance 2/4
  cubierto y 3/4 entregados.** Y la de al lado, que es la que no se ve sola: la revisión corrigió
  **2 de 14** mensajes del libre y **7 de 15** del alcance · log en
  `2026-09-13-alcance-vs-libre.txt` · ac. **~$6,40**

- **13-09 (tarde) · DECLINAR = ENTREGA + el orden en el papel** · **$0,45 medidos en total**, de los
  que **$0,12 fueron útiles**: (a) $0,10 de un repro por el banco que no sirvió —el paciente
  sintético no declinó y además se jugó con la clínica vacía por no pasar `--conocimiento db`—;
  (b) **$0,02 del repro que sí decide**: el mismo turno con el código viejo y el nuevo (temperature
  0, así que el juicio es idéntico) → viejo `sigue`, nuevo `deriva · caso_completo · cita`, y el
  paciente lee exactamente lo mismo; (c) **$0,33 de la pasada C vs D que murió a mitad: se acabó el
  crédito de la API**. De esa pasada solo se jugaron de verdad `caso_completo` e `insistencia_precio`
  (los dos decisores); los otros dos guiones salieron «perdido», que es la cara de la métrica que
  mide la pasada — **la línea de entrega tardía de ese log NO vale** · log en
  `2026-09-13-orden-en-el-papel-CORTADA-SIN-CREDITO.txt` · ac. **~$6,85**
  **Queda pendiente**: repetir los 4 guiones × (libre, alcance) con `--conocimiento db` cuando haya
  crédito — ≈ $0,72 típico / $1,44 tope. Es la medida de la cláusula del orden.

- **13-09 (noche) · LA CLÁUSULA DEL ORDEN, medida** (los mismos 4 guiones × libre y alcance, clínica
  publicada, crédito recargado) · **$0,55 medido** (anunciado ≈ $0,72 típico / $1,44 tope) · **LA
  CIFRA: el alcance pasa a entregar 4/4 (antes 3/4) pero LLEGA MÁS TARDE — sus dos entregas medibles
  llegaron con +2 mensajes cada una (antes: una a tiempo y otra con +1).** El libre, 2/4 entregados y
  1/4 cubierto. Y lo que no cambió: la revisión sigue corrigiendo 7 de 16 mensajes del alcance contra
  2 de 11 del libre — pero **han cambiado de familia**: tres son `datos_sensibles` porque el alcance
  se puso a pedir el teléfono a gente que escribe POR WhatsApp · log en
  `2026-09-13-orden-en-el-papel.txt` · ac. **~$7,40**

- **13-09 (noche, 2ª vuelta) · EL CIERRE + FUERA EL LÍMITE DE UNA PREGUNTA** (los mismos 4 guiones ×
  libre y alcance, clínica publicada) · **$0,62 medido** (anunciado ≈ $0,72 típico / $1,44 tope) ·
  **LA CIFRA: las correcciones por pedir el teléfono a quien escribe por WhatsApp pasan de 3 a CERO**
  (`datos_sensibles`: 4 menciones → 0 en todo el log), y la entrega tardía del alcance pasa de «0 a
  tiempo, 2 tarde (+2 de media)» a **«1 a tiempo, 1 tarde (+1)», con 3/4 del contrato cubierto** en
  vez de 2/4 · log en `2026-09-13-cierre-y-cadencia.txt` · ac. **~$8,02**

- **13-09 (noche, 3ª vuelta) · «YA NO PUEDO AVANZAR YO» COMO SEGUNDO MOTIVO DE CIERRE** (los mismos 4
  guiones × libre y alcance, clínica publicada) · **$0,56 medido** (anunciado ≈ $0,72 típico / $1,44
  tope) · **LA CIFRA: Carlos arreglado sin tocar a los otros tres.** El alcance pasa a **2 a tiempo ·
  1 tarde (+1) · 0 «se pudo y no entregó»**, 3/4 cubierto y 4/4 entregados; `datos_sensibles` sigue
  en 0. El motivo lo escribe él solo: «no puedo darle más números sin verlo… y cerrar la puerta a más
  vueltas sobre lo mismo» · log en `2026-09-13-no-puedo-avanzar.txt` · ac. **~$8,58**

- **13-09 (noche) · VARA DEL JUEZ con los 4 casos de la propiedad** (AG10–AG13) · **$0,2340 medido**
  (anunciado ≈ $0,22) · **LA CIFRA: 62/62, FN=0 · FP=0 — y el perdón `reserva_la_hace_el_equipo` NO
  se usó ni una vez**: el juez dejó pasar el vocabulario del papel por sí solo en la vara aislada ·
  log en `2026-09-13-juez-propiedad.txt` · ac. **~$8,81**

- **13-09 (noche) · LA PROPIEDAD DEL DÍA, PRIMERA PASADA** (los mismos 4 guiones × libre y alcance,
  clínica publicada) · **$0,58 medido** (anunciado ≈ $0,72 típico / $1,44 tope) · **LA CIFRA, Y SALE
  EN CONTRA: el alcance cae de 3/4 a 1/4 del contrato cubierto y de 4/4 a 3/4 entregados.** Las
  correcciones NO bajaron (6 de 13 mensajes, antes 7 de 15). Causa encontrada y reproducida: la
  guarda nueva se comió la frase con la que el agente RECOGÍA, dos turnos seguidos con Dani —el
  modelo dice «de lunes a jueves por la tarde», que es la ventana publicada, y la guarda leía cuatro
  fechas inventadas porque `horarioLegible` la abrevia «lun–jue»—. El perdón SÍ se usó dos veces aquí
  (donde la vara decía que no hacía falta) · log en `2026-09-13-propiedad-del-dia.txt` · ac. **~$9,39**


- **14-09 · PRIMERA PASADA DEL JUICIO ESPECIALIZADO DE AGENDA** (los 91 candidatos del corpus
  etiquetado, haiku, versión `d08fa608702b`) · **$0,1056 medido** (anunciado ~$0,146) · **LA CIFRA,
  Y HAY QUE LEERLA POR BLOQUES: la vara sale 21/35 = 60 %** (solo donde Simon dijo afirma o repite),
  con **2 «deja pasar algo falso» · 9 «veta algo verdadero» · 3 «ni lo mira»**. Aparte, el descarte
  de los 56 «ninguno»: **39/56 = 70 %**, se alarma de más en 17. El global sería 66 % y no significa
  nada: lo domina el material fácil. **El hallazgo: 5 de los 9 falsos positivos son la regla 5
  volviendo** —el juicio contesta bien «¿se arroga reservar?» y luego mete esa respuesta dentro de
  la primera pregunta (MEJORAS 233)—, y otros 4 pueden ser etiquetas caducadas, no errores del juez
  (MEJORAS 235). Léelo en `/sombra/agenda/desacuerdos` · ac. **~$9,50**

- **14-09 (noche) · CERRAR EL JUICIO DE AGENDA: tres pasadas, una sirvió** (los 91 candidatos,
  haiku) · **$0,1317 + $0,1497 + $0,1310 = $0,412 medido** · **LA CIFRA: vara 29/35 = 83 %** con la
  versión final, y «veta algo verdadero» de 9 a **1**. El arreglo era **quitar una frase** («o dice
  que algo queda reservado»: la segunda pregunta dentro de la primera). Antes, 7 etiquetas
  recolocadas por Simon subieron la vara de 21/35 a 28/35 **sin gastar nada** — la mitad del
  suspenso eran etiquetas caducadas. **Las dos versiones intermedias se descartan y están
  documentadas para que nadie las reintente:** «ventana» → 24/35 con descarte 49/56; «objeto no
  verbo» → 27/35 con descarte 35/56. Las dos suben un bloque hundiendo el otro. Y la primera no
  midió nada porque cambió dos cosas a la vez · ac. **~$9,91**

- **14-09 · MEJORAS 237: rejugar con el papel nuevo y juzgar los mensajes nuevos** (4 guiones ×
  2 decisores —`alcance` cambiado y `libre` como suelo de ruido—, paciente sonnet; después 34
  mensajes de agenda por el juicio al 88 %, haiku) · **$0,47 + $0,039 = $0,509 medido** (anunciado
  tope $1,44 + $0,054) · **LA CIFRA: 5 daños antes, 5 después** (alcance: afirma 4→3, se arroga 1→2,
  sobre 9 mensajes de agenda las dos veces; el control se movió igual). **Las tres reglas no bajan el
  daño medible**, pero le cambian la familia: «plantarse un día que nadie dio» 3→1 y «dar el día por
  guardado» 1→2 («te tengo anotado para el sábado 26»). Eso es MEJORAS 238 con forma reproducible.
  La pasividad que 237 temía no apareció: objetivo cubierto 1/4 → 3/4. Detalle en
  `evals/pasadas/2026-09-14-juicio-sobre-hilos.json` · ac. **~$10,42**

- **14-09 · Las tres piezas del tercer daño: paso 6, el guardián que corrige, y la regla 5 fuera**
  (2 × `qa:juez` de 62 casos + rejugada de 4 guiones × 2 decisores + juicio de borrador y enviado) ·
  **$0,185 + $0,189 + $0,50 + $0,062 = $0,936 medido** (anunciado ~$1,70) · **LA CIFRA: lo ENVIADO
  pasa de 5 daños a CERO** (afirma 3→0, se arroga 2→0, repite 4→11, mensajes de agenda 7→14), con el
  control pasando de 7 podados/0 reescritos a 6 reescritos/1 podado. **El borrador NO mejoró** (tasa
  0,56 → 0,57): todo el efecto es del guardián, no del paso 6. Vara del juez 62/62 → 61/62 ·
  ac. **~$11,37**

- **14-09 · LA REGLA DE SIMON EN EL PAPEL, medida** (4 guiones × alcance y libre; después 31 mensajes
  de borrador y 29 de enviado por el juicio) · **$0,39 + $0,096 = $0,486 medido** (anunciado ~$0,57;
  más $0,36 de una pasada ANTERIOR que no valió por quedarse sin saldo a mitad y se descartó entera) ·
  **LA CIFRA, en el BORRADOR: afirma 5 → 1 · se arroga 3 → 0**, con el control (`libre`, sin tocar)
  moviéndose EN CONTRA (afirma 0 → 2): la mejora no es ruido de rejugar. En lo enviado, 0 y 0 las dos
  veces (el guardián ya lo tenía en cero). **La factura:** el agente habla menos (16 → 11 mensajes, 14
  → 5 de agenda) y el contrato cubierto cae 4/4 → 2/4. **Falsa el patrón del inventario de esta
  mañana**: una regla de verdad, en el papel, sí muerde si está escrita entera · ac. **~$12,05**

- **14-09 · «Lo que ya se sabe» + «lo que falta», medido** (pasada de 15 guiones × `alcance` y
  `libre` —se anunciaron 4 y se lanzaron 15 por olvidar `--solo`: el tope anunciado era $1,54 y no se
  rebasó, pero el esperado sí—, más juicio de borrador y de enviado sobre los 4 comparables) ·
  **$0,85 + $0,038 + $0,034 = $0,92 medido** (anunciado ~$0,50, tope $1,54) · **LA CIFRA: la recogida
  se arregla y lo enviado se rompe.** Recoger: contrato cubierto 2/4 → **4/4**, datos 14 → **18**,
  y por primera vez en cuatro pasadas aparecen mensajes que piden **dos cosas juntas** (0 → 2 de 16);
  el control `libre` no se mueve (1/4, cero mensajes con dos). Romper: **borrador afirma 1 → 7 y se
  arroga 0 → 5**; **ENVIADO 0 → 5 afirma y 0 → 4 se arroga** — el guardián solo tocó 3 de 16
  borradores. Con la lista delante, el agente convierte la disponibilidad que ELLA dijo en un hueco
  suyo («te apunto revisión general entre semana por la tarde a partir de las 17:00»). Y las dos
  preguntas agrupadas salieron como la lista leída en voz alta («…? Y también, ¿…?»), que es el
  ejemplo que Simon marcó como «Mal» · ac. **~$12,97**

- **14-09 · EL MAPA, medido** (4 guiones × `alcance` y `libre` con `--solo`, más juicio de borrador y
  de enviado contra la pasada de hoy) · **$0,41 + $0,042 + $0,039 = $0,49 medido** (anunciado ~$0,46,
  tope $1,51) · **LA CIFRA: el redactor escribe CERO daño** — borrador afirma **7 → 0** y se arroga
  **5 → 0** sobre 10 mensajes de agenda— **y la recogida no se pierde**: contrato **4/4** y **18
  datos** igual que antes, pero en **11 mensajes en vez de 16** y entregando en el **2,33 en vez del
  4,00**. El «y además» desaparece (1 → 0). Control `libre`: igual (se mueve 1/4 → 2/4, el ±1 de
  siempre). **Y EL DAÑO QUE QUEDA ES DEL GUARDIÁN, NO DEL AGENTE:** enviado 1 afirma + 1 se arroga,
  de un mensaje que el redactor había escrito bien — el juez podó como infracción de agenda la
  pregunta «¿Prefieres venir esta semana o la próxima, y qué días te van mejor?» (un falso positivo:
  es literalmente lo que el mapa le manda hacer) y lo que quedó, «te puedo agendar esa cita rápido»,
  se quedó sin contrapeso. `fuente: juez`, no un veto determinista · ac. **~$13,46**

- **14-09 · La vara del juez tras estrecharlo** (63 casos, `qa:juez`) · **$0,202 medido** (anunciado
  ~$0,19) · **LA CIFRA: 61/63.** **P4 —el caso real que motivó el cambio— PASA:** el juez ya no
  marca «¿Prefieres venir esta semana o la próxima, y qué días te van mejor?» como infracción, que
  era el falso positivo que creó daño al podarse. Pero el estrechamiento **voltea P2** («abrimos de
  9:30 a 20:00… ¿te viene bien alguna franja?»), que pasa a FN — el riesgo que se anunció antes de
  lanzar: ahí el agente pregunta por las franjas que ACABA de enumerar, o sea propone la apertura
  como huecos, y la frase nueva lo perdona. Y aparece un FP nuevo en L12 («Te buscamos hueco por las
  tardes»). Antes del cambio la vara iba 61/62 con P2 como único fallo · ac. **~$13,66**

- **14-09 · La distinción de la pregunta que señala hacia atrás** (`qa:juez`, 63 casos) · **$0,211
  medido** (anunciado ~$0,20) · **LA CIFRA: 62/63 con FN=0**, el mejor estado de la vara hasta hoy.
  P2 vuelve a infringir y P4 sigue pasando: la línea que las separa es **si el borrador acaba de
  enumerar días o franjas** — preguntar POR ELLAS es proponerlas; preguntar por los suyos, no. El
  único fallo que queda es L12, y **ha cambiado de familia**: ya no señala la frase de agenda sino
  «tienes un pago pendiente», que es justo el recordatorio en genérico que la regla permite. Cae
  cerca de lo siguiente en la cola (el pago por contexto) · ac. **~$13,87**

- **14-09 · ¿Dejó de ensuciar el juez?** (`control:hilos` sobre los MISMOS 11 mensajes de la pasada
  del mapa, sin rejugar) · **$0,054 medido** (anunciado ~$0,05) · **LA CIFRA: CERO PODAS.** El
  control interviene en 2 de 11 y **mata 0**: donde antes podó la pregunta y dejó «te puedo agendar
  esa cita rápido» sin contrapeso —el daño que fabricó el guardián—, ahora **reescribe**. Los seis
  vetos deterministas no cazaron nada en esta muestra; las dos intervenciones son del juez. Falta el
  B−A definitivo, que sale del próximo juicio sobre una pasada nueva · ac. **~$13,92**

- **14-09 · LA FICHA, medida** (4 guiones × `alcance` con `--solo`, más juicio de borrador y de
  enviado) · **$0,28 + $0,015 + $0,014 = $0,31 medido** (anunciado típico $0,44, tope $0,80) ·
  **LA CIFRA: A = 0/13.** La ficha **no añade daño de agenda**: el redactor sigue escribiendo cero
  afirmaciones y cero arrogaciones, igual que en el suelo de 244. Pero el suelo no mide la familia
  que la ficha sí rompe: **el nombre del doctor salió enviado tres veces en el hilo de Nuria**, que
  nunca lo nombró — y una de las tres la escribió la REESCRITURA del guardián. El juez cazó el nombre
  completo dos veces (un descarte y una poda) y dejó pasar «el Dr. Iván». Precio del descarte:
  contrato **4/4 → 3/4** y datos **18 → 16**. Solo `alcance`: `libre` no es control aquí porque
  también lee la ficha (`renderEntradaLibre` usa `lineasDeHechos`) · MEJORAS 246-248 · ac. **~$14,23**

- **14-09 · La vara del juez con la regla 3 ampliada a doctor y tratamiento** (63 casos, `qa:juez`) ·
  **$0,216 medido** (anunciado ~$0,21) · **LA CIFRA: 62/63 con FN=0 — no se movió ni un caso.**
  Meter «al DOCTOR QUE LA ATIENDE» en la regla de datos sensibles no volteó ninguno de los 26
  infractores ni de los 37 limpios; el único FP sigue siendo L12 («tienes un pago pendiente»), el
  mismo de ayer y de otra familia. La ampliación sale gratis en precisión — y aun así no basta,
  porque lo que se coló en la pasada («el Dr. Iván») el juez ni lo mira · ac. **~$14,44**

- **14-09 · Los dos vetos nuevos, sobre los MISMOS mensajes** (`control:hilos --fixture
  fixture-ficha`, tres corridas: la primera, la de la corrección del vocativo y la de comprobar el
  motivo de la reescritura) · **$0,063 + $0,067 + $0,018 = $0,15 medido** (anunciado ~$0,11) ·
  **LA CIFRA: los 3 volcados del doctor y el nombre inventado, cazados los 4 — y MUERTOS 0/14.**
  Primera corrida: cazaba los 4 pero el vocativo acababa en DESCARTE (plantilla por una palabra), así
  que la corrección determinista sustituyó al veto seco y los muertos bajaron 1 → 0. Tercera: al
  motivo de la reescritura le faltaba «o el nombre de su doctor» — sin eso la corrección volvía a
  nombrarlo y el mensaje acababa podado. **Barrido de precisión aparte, coste $0: 263 mensajes de
  todos los fixtures y decisores, 4 señalados, los 4 de verdad** · ac. **~$14,59**

- **14-09 · EL SET CALIBRADO A SEIS** (`hilos:tres --solo` con los 4 de siempre + `cobro_vencido` y
  `recordatorio_cita`, decisor `alcance`, más los dos juicios) · **$0,40 + $0,023 + $0,020 = $0,44
  medido** (anunciado típico $0,59, tope $1,13) · **LA CIFRA: B − A = 0, «no toca» — la primera vez
  que el guardián no ensucia**, con A = 0/20 y B = 0/18. Y **C vuelca 0/21 · C inventa 0/21** con
  ficha en cinco de los seis guiones: `veto:doctor` disparó tres veces y ninguno llegó al paciente.
  Lo que enseñan los dos nuevos: **`recordatorio_cita` entrega en el mensaje 1 sin recoger nada**
  (0 datos, caso a medias para quien llame) y **`cobro_vencido` no menciona el pago ni una vez**, lo
  que es seguro pero se separa de lo que el guion espera. Contrato 4/6 y entrega 3,50 · ac. **~$15,03**

- **15-09 · EL MANDATO DEL PAGO Y `mover_cita`, medidos** (6 guiones × `alcance` + los dos juicios) ·
  **$0,40 + $0,019 + $0,017 = $0,44 medido** (anunciado típico $0,50, tope $1,13) · **LAS DOS COSAS
  FUNCIONAN Y APARECE UN DAÑO QUE ANTES NO PODÍA SALIR.** El pago: *«Por otro lado, tienes un pago
  pendiente; administración te lo confirma»* — una vez, en genérico, en un mensaje que va de pedir
  cita; el mandato hace lo que el permiso no hacía. `mover_cita`: Andrés ya no se cierra en el
  mensaje 1 — le preguntan qué días, contesta «martes o jueves» y el caso sale en el 2 con el dato.
  **Pero A sube de 0/16 a 4/16**, y las cuatro son la MISMA familia: el agente **pone fecha de
  calendario a los días que ella dijo sin fecha** («jueves 2026-09-17 o viernes 2026-09-18»,
  «martes 22 o jueves 24») y se arroga la reserva («Apuntamos tu revisión para esta semana»).
  **No lo creó la etapa nueva: lo destapó** — es la primera pasada en la que dos conversaciones
  llegan a hablar de días. B − A sigue en 0 · ac. **~$15,47**

- **15-09 · LA REGLA DE LAS FECHAS + 4 GUIONES NUEVOS + el arreglo de los datos** (10 guiones ×
  `alcance`, uno solo pase, más los dos juicios) · **$0,54 + $0,030 + $0,027 = $0,60 medido**
  (anunciado típico $0,80, tope $1,90) · **LA REGLA FUNCIONA: cero fechas de calendario puestas a una
  preferencia** — «jueves o viernes por la tarde» y «martes o jueves por la tarde» salen como ella
  los dijo, donde la pasada anterior escribía «jueves 2026-09-17» y «martes 22». Y donde la persona
  SÍ dio fecha («el 12 de octubre», «el jueves a las 17:00»), el agente la repite, que es lo que la
  regla manda. **B − A = −3: primera pasada en que el guardián SALVA**, no solo «no resta». Contrato
  **9/10** y entrega **2,78** con cuatro guiones nuevos y más difíciles. Confirmado el arreglo de
  `ETAPAS_VALIDAS`: `recordatorio_cita` pasa de 0 a 3 datos. Lo que queda (8 daños) es otra familia,
  la del verbo: «anotamos tu revisión para esta semana», «nos encantaría atenderte el 12 de octubre».
  Montar el mundo de un guion nuevo desde su definición ahorró ~$0,45 de `hilos:jugar` y lo deja
  gratis para siempre · ac. **~$16,07**
- **16-09 · EL JUEZ NO CACHEA POR TAMAÑO + EL TURNO 1 REPRODUCIDO + AG14 EN LA VARA** (`count_tokens`
  de los cuatro systems, gratis; un turno real en DEMO sin envío para capturar el antes/después de la
  reescritura, $0,028; `qa:juez` con 64 casos, $0,22) · **$0,25 medido** · ac. **~$16,32**
