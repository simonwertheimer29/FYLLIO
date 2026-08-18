-- 027_cola_envios_tipos.sql
--
-- B6.1 (fase B, 18-08): la cola de envíos deja de ser solo de presupuestos y
-- pasa a ser LA cola única de todo mensaje propuesto, con filtro por tipo
-- (decisión dictada: "no una pantalla por tipo"). Tres cambios:
--
--   1. `origen` — de qué generador salió la fila. Es el filtro de la pantalla
--      y el vocabulario es cerrado: los no-shows entrarán aquí como un origen
--      más cuando se reactiven (MEJORAS 98), no con pantalla propia.
--   2. `cita_id` / `lead_id` — la referencia de la entidad para los orígenes
--      que no son un presupuesto (`presupuesto_ref` ya existía). Una fila
--      lleva UNA referencia: la de su origen.
--   3. `estado` admite 'Caducado' — la cola es DEL DÍA: un mensaje generado el
--      lunes y no enviado no puede salir el jueves como si fuera de hoy. El
--      cron marcará Caducado lo pendiente de días anteriores antes de generar
--      (distinto de 'Cancelado', que es una decisión de una persona: uno mide
--      al equipo, el otro no).
--
-- Backfill: todo lo existente salió del generador de presupuestos — la única
-- excepción es el tipo 'Reactivacion', que ya era reactivación.

begin;

alter table cola_envios add column if not exists origen text;
alter table cola_envios add column if not exists cita_id text;
alter table cola_envios add column if not exists lead_id text;

update cola_envios
   set origen = case when tipo = 'Reactivacion' then 'reactivacion' else 'seguimiento_presupuesto' end
 where origen is null;

alter table cola_envios alter column origen set not null;
alter table cola_envios drop constraint if exists cola_envios_origen_check;
alter table cola_envios add constraint cola_envios_origen_check
  check (origen in ('seguimiento_presupuesto', 'recordatorio_cita', 'reactivacion'));

alter table cola_envios drop constraint if exists cola_envios_estado_check;
alter table cola_envios add constraint cola_envios_estado_check
  check (estado in ('Pendiente', 'Enviado', 'Fallido', 'Cancelado', 'Caducado'));

comment on column cola_envios.origen is
  'De qué generador salió la fila: seguimiento_presupuesto | recordatorio_cita | '
  'reactivacion. Es el filtro por tipo de la pantalla de la cola (B6). Los '
  'no-shows entrarán como origen nuevo cuando se reactiven (MEJORAS 98).';
comment on column cola_envios.cita_id is
  'Cita a la que recuerda la fila (solo origen recordatorio_cita). También es la '
  'clave del dedupe: una cita, un recordatorio por día.';

commit;
