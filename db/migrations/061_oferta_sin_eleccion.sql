-- 061 · CONTESTÓ A LA PROPUESTA SIN ELEGIR (23-09, Simon).
--
-- Con una propuesta de horas abierta, el agente ya no recoge datos: todo lo
-- que no sea elegir una de las horas pasa a la coordinadora, en silencio, con
-- la causa nueva `oferta_sin_eleccion` (cola prioritaria, como `oferta_elegida`:
-- es la misma ventana en la que llama a otra clínica).
--
-- Lo que dijo se guarda EN LA OFERTA, para que al volver a proponer el
-- selector lo enseñe arriba («Después dijo: …») sin que ella lea el hilo. Si
-- trae una preferencia nueva («ninguna me va, mejor el lunes»), la preferencia
-- estructurada ya la guarda el juicio del turno; esto es el texto literal.
-- La oferta sigue ABIERTA: si luego elige una, vale.
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_causa_derivacion_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_causa_derivacion_check
  check (causa_derivacion is null or causa_derivacion in
    ('peticion_queja', 'insistencia', 'urgencia', 'caso_completo', 'antecedente_medico',
     'no_legible', 'sin_respuesta_valida', 'hueco_rechazado', 'oferta_elegida', 'sin_huecos',
     'oferta_sin_eleccion'));
comment on constraint eventos_automatizacion_causa_derivacion_check on eventos_automatizacion is
  'Vocabulario de causas de derivación (061). oferta_sin_eleccion = contestó a la propuesta de horas sin elegir ninguna.';

alter table ofertas_hueco
  add column if not exists respuesta_sin_eleccion text,
  add column if not exists respuesta_sin_eleccion_en timestamptz;
comment on column ofertas_hueco.respuesta_sin_eleccion is
  'Lo último que contestó a esta propuesta SIN elegir hora, literal (061). El selector lo enseña al reofertar.';
