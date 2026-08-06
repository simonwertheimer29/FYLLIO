-- 015 · La intención en el momento del envío — para la tasa de coincidencia
--
-- POR QUÉ UNA COLUMNA Y NO UN JOIN. La tasa de coincidencia agente-humano se
-- desglosa POR INTENCIÓN, porque es lo que decide la matriz de autonomía de la
-- fase 4: una media del 70 % puede esconder un 95 % en recordatorios y un 30 %
-- en cualquier cosa que roce el precio, y son decisiones opuestas.
--
-- La intención se podría leer de `presupuestos.intencion_detectada` al agregar,
-- pero sería LA DE HOY, no la del momento del envío: el paciente responde otra
-- vez, el clasificador la reescribe, y el histórico entero cambia de significado
-- retroactivamente. Un evento es un hecho fechado; su contexto viaja con él.
--
-- Es la misma razón por la que `alertas_enviadas` guarda el nombre de la
-- coordinadora en vez de resolverlo después.
--
-- Se añade ahora que la tabla está VACÍA: cero filas que rellenar.

alter table eventos_automatizacion
  add column if not exists intencion text;

comment on column eventos_automatizacion.intencion is
  'Intención clasificada del paciente EN EL MOMENTO del envío (no la de hoy). Solo en eventos mensaje_enviado y solo en presupuestos — el clasificador no corre para leads. NULL = no había clasificación, y esos envíos se agrupan aparte en la tasa en vez de contarse como una intención inventada.';

-- El desglose por intención es la lectura principal de la pantalla.
create index if not exists eventos_automatizacion_coincidencia
  on eventos_automatizacion (cliente, intencion, created_at desc)
  where evento = 'mensaje_enviado' and distancia_edicion is not null;
