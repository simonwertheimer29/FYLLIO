-- 062 · QUÉ DOCTOR HACE CADA TRATAMIENTO (MEJORAS 265, Simon 26-09).
--
-- Hasta aquí el catálogo no lo decía: «Proponer horas», la oferta y el
-- repuesto ofrecían los huecos de TODOS los dentistas con horario de la
-- clínica, y a una revisión le salía el hueco del ortodoncista.
--
-- Un tratamiento pertenece a UNA especialidad, y lo hacen los doctores de esa
-- especialidad (`staff_especialidades`, que ya es M:N: un doctor que hace
-- ortodoncia y también revisiones lleva las dos). Sin especialidad = lo puede
-- recibir cualquier doctor, como antes; Ajustes → Agenda lo avisa a la vista.
--
-- Clave compuesta con `cliente`, como el resto de la agenda: un tratamiento
-- no puede apuntar a la especialidad de otro cliente. Las especialidades no
-- se borran (se desactivan), así que no hace falta `on delete`.
alter table tratamientos
  add column if not exists especialidad_id text;

alter table tratamientos
  drop constraint if exists tratamientos_especialidad_fk;
alter table tratamientos
  add constraint tratamientos_especialidad_fk
  foreign key (cliente, especialidad_id) references especialidades (cliente, id);

comment on column tratamientos.especialidad_id is
  'Qué especialidad hace este tratamiento (062): solo sus doctores reciben huecos. Null = cualquier doctor.';
