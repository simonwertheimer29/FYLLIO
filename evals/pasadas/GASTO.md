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
