-- 057 · El evento `reactivado` (2026-09-15, encargo de Simon).
--
-- QUÉ ES: el paciente vuelve a escribir en un caso que el agente YA entregó y
-- que sigue esperando a que alguien lo coja. El agente le contesta —no le
-- quita el caso a nadie— y deja constancia aquí para que el caso SUBA de
-- prioridad y suene una campana.
--
-- POR QUÉ UN EVENTO NUEVO Y NO OTRO `derivado`: la edad de la entrega es la
-- presión del sistema («nada expira solo, pero envejece a la vista de todos»).
-- Re-derivar reiniciaría esa edad y el censo enseñaría como recién entregado
-- un caso que lleva un día esperando — escondiendo justo los que más urgen.
-- `reactivado` anota lo que pasó SIN tocar la fecha de entrega.
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_evento_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_evento_check
  check (evento in (
    'quiebre_reconocido',
    'asumido',
    'asumido_manual',
    'mensaje_enviado',
    'aplazado',
    'aplazado_resuelto',
    'derivado',
    'evaluacion',
    'reactivado',
    'resuelto_manual',
    'soltado',
    'espera_fijada',
    'espera_levantada',
    'opt_out',
    'opt_in'
  ));

comment on constraint eventos_automatizacion_evento_check on eventos_automatizacion is
  'Lista blanca de eventos. 057 añade reactivado: el paciente insiste en un '
  'caso ya entregado; sube prioridad SIN reiniciar la edad de la entrega.';
