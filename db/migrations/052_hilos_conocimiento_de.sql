-- 052_hilos_conocimiento_de.sql
--
-- CON QUÉ MUNDO SE JUGÓ, persistido (2026-09-13, lo cazó Simon leyendo).
--
-- `HiloTres.conocimientoDe` («fixture» = clínicas vacías | «db» = lo publicado
-- ahora) existe desde el 12-09 y el visor lo enseña — pero nunca fue columna:
-- `guardarHiloTres` no lo insertaba, así que al leer volvía `undefined` y la
-- pantalla decía «Clínica vacía» SIEMPRE. Las cuatro conversaciones del pase
-- C vs D se jugaron con la clínica publicada (19 y 17 líneas en el log) y la
-- pantalla afirmaba lo contrario.
--
-- Es el peor tipo de fallo de una pantalla de medición: no falta un dato, es
-- que afirma el valor equivocado de la variable que MÁS cambia lo que dice el
-- modelo (12-09: vacía 4/4 entregados vs publicada 2/4). Por eso la columna
-- NO tiene default: lo jugado antes de hoy queda en NULL = «no consta con qué
-- mundo se jugó», que es la verdad. Inventarle «fixture» sería repetir la
-- mentira con otra cara (§4).

alter table agente_sombra_hilos add column if not exists conocimiento_de text
  check (conocimiento_de in ('fixture', 'db'));
