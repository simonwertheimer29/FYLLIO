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
