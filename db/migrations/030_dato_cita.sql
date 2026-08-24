-- 030_dato_cita.sql
--
-- Clave de aplazamiento `dato_cita` (23-08, tras el escenario «paciente al
-- día» del banco): la persona pregunta un dato de SU cita ya programada
-- («¿cuándo era mi cita?», «¿a qué hora?») y el agente en nivel 1 no lo ve.
-- Es `dato_ausente` puro — el mismo patrón que dato_presupuesto: se anota,
-- jamás se inventa, y cuando la agenda se conecte (MEJORAS 97) el dato
-- constará y se contestará solo. Distinta de `agenda_disponibilidad`
-- (huecos LIBRES futuros): esta es la cita que YA existe.
--
-- Y la doctrina que la acompaña (dictada 23-08, va en código en la RED del
-- evaluador, no aquí): si el agente no puede contestar lo preguntado y no
-- hay nada más que recoger, DERIVA — la clave sirve para contarlo, la
-- derivación para que alguien lo resuelva.

begin;

alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_clave_aplazado_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_clave_aplazado_check
  check (clave_aplazado is null or clave_aplazado in (
    'precio_descuento',
    'plan_pago',
    'cobertura_seguro',
    'cambio_tratamiento',
    'garantia_condiciones',
    'dato_presupuesto',
    'agenda_disponibilidad',
    'dato_cita',             -- dato de SU cita programada que el sistema no ve (030)
    'duda_clinica',
    'otro'
  ));

commit;
