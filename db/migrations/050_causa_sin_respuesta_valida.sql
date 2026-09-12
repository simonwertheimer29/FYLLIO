-- 050_causa_sin_respuesta_valida.sql
--
-- DOS DESCARTES SEGUIDOS SON UN CALLEJÓN (MEJORAS 233, 12-09). En las tres
-- conversaciones de Nuria el juez tumbó los CINCO borradores del código y la
-- paciente recibió cinco plantillas genéricas seguidas. Cuando el agente no
-- puede decir nada sin infringir, el descarte cae siempre a la misma plantilla
-- y nada corta el bucle: una paciente con miedo se va tras la segunda.
--
-- Causa nueva `sin_respuesta_valida`: el SEGUNDO descarte consecutivo en el
-- mismo hilo entrega el caso a una persona (cola normal) con una plantilla
-- distinta. Con la poda del mismo día el segundo descarte seguido se vuelve
-- raro, así que esto es el freno de emergencia, no la salida habitual.

alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_causa_derivacion_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_causa_derivacion_check
  check (causa_derivacion is null or causa_derivacion in
    ('peticion_queja', 'insistencia', 'urgencia', 'caso_completo', 'antecedente_medico',
     'no_legible', 'sin_respuesta_valida'));

comment on constraint eventos_automatizacion_causa_derivacion_check on eventos_automatizacion is
  'Vocabulario de causas de derivación (050). sin_respuesta_valida = dos descartes seguidos del juez: el agente no puede contestar sin infringir y el caso pasa a una persona.';
