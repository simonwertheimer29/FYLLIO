-- 059 · CAUSA «hueco_rechazado» (17-09, paso 3b de la ficha).
--
-- La coordinadora reservó un hueco desde la ficha y se le confirmó al
-- paciente por WhatsApp. Si contesta que NO le viene bien, o contrapropone
-- otra hora («¿y el viernes?»), el caso pasa a una persona con esta causa:
-- es la ventana en la que el paciente llama a otra clínica, así que va a la
-- cola prioritaria y a la bandeja como «necesita respuesta» con el SLA de
-- respuesta (2 h de clínica abierta). El hueco NO se libera solo (decisión de
-- Simon): lo suelta la coordinadora al mover o anular la cita, y ese hecho
-- es el que cierra el derivado.
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_causa_derivacion_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_causa_derivacion_check
  check (causa_derivacion is null or causa_derivacion in
    ('peticion_queja', 'insistencia', 'urgencia', 'caso_completo', 'antecedente_medico',
     'no_legible', 'sin_respuesta_valida', 'hueco_rechazado'));
comment on constraint eventos_automatizacion_causa_derivacion_check on eventos_automatizacion is
  'Vocabulario de causas de derivación (059). hueco_rechazado = la persona rechaza o contrapropone la hora que se le confirmó desde la ficha; el hueco lo libera la coordinadora.';
