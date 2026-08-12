# Línea base — tiempo y toques hasta el cierre (DEMO)

**Medida el 2026-08-13**, antes de construir nada del modelo ofensivo
([PLAN-AGENTE-OFENSIVO.md](PLAN-AGENTE-OFENSIVO.md) §10: «cuánto tarda un caso listo en
cerrarse tiene que bajar»). Para volver a calcularla igual:

```
npm run medir:linea-base        # = npx tsx scripts/medir-linea-base.mts
```

La consulta y todas las definiciones viven en
[scripts/medir-linea-base.mts](scripts/medir-linea-base.mts) — el script ES la definición.
En resumen: primera respuesta = primer mensaje `Entrante` del hilo del presupuesto; cierre =
`fecha_aceptado` (ACEPTADO) o el `cambio_estado→PERDIDO` de `historial_acciones` (PERDIDO no
tiene columna de fecha propia); días en calendario de la clínica; toques = mensajes
`Saliente` entre la primera respuesta y el fin del día de cierre; percentiles por rango más
cercano.

## Aviso primero: esto es el seed, no el mercado

Los datos son de DEMO, sembrados por `demo:reset`. La regla de higiene de
[MERCADO.md](MERCADO.md) aplica entera: **ningún número de aquí es evidencia de nada hacia
fuera**. Sirve exclusivamente para comparar el antes y el después del modelo nuevo sobre los
mismos datos.

Y hay un segundo aviso, más importante: **la línea base salió degenerada por construcción
del seed.** Cada hilo cerrado del seed tiene exactamente un mensaje del paciente —el de la
propia decisión— y una confirmación nuestra detrás. Verificado hilo a hilo: 95 hilos
cerrados, media de 1,0 entrantes y 2,0 salientes por hilo. Por eso todo da 0 días y 1 toque:
en el seed, responder y cerrar son el mismo día siempre.

**Consecuencia:** sobre este seed, «tiene que bajar» no se puede demostrar — 0 días y 1
toque son el suelo. Para que la comparación antes/después signifique algo hará falta una de
estas dos cosas: hilos sembrados con negociación real (varias respuestas del paciente antes
del cierre), o datos reales del piloto cuando los haya. Hasta entonces esta línea base
documenta el método de medición y la forma del seed, no el rendimiento del proceso.

## Los números congelados (2026-08-13)

Denominador: **95 presupuestos cerrados** (68 aceptados, 27 perdidos).
Entran en la cuenta **94**; fuera **1** (perdido «sin respuesta tras 3 contactos»: el
paciente nunca respondió, no existe t0). Ninguno sin fecha de cierre, ninguno con cierre
anterior a la respuesta.

**Días de la primera respuesta al cierre** (calendario de la clínica):

| | n | min | p25 | mediana | p75 | p90 | max | media |
|---|---|---|---|---|---|---|---|---|
| todos | 94 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| aceptados | 68 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| perdidos | 26 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**Toques** (salientes entre la primera respuesta y el cierre):

| | n | min | p25 | mediana | p75 | p90 | max | media |
|---|---|---|---|---|---|---|---|---|
| todos | 94 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| aceptados | 68 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| perdidos | 26 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |

El detalle caso a caso lo imprime el script (id · estado · días · toques).

Ojo al comparar tras un `demo:reset`: el seed siembra fechas **relativas a hoy**, así que
los ids cambian y el denominador puede moverse un poco. Lo comparable es la distribución,
no los ids.
