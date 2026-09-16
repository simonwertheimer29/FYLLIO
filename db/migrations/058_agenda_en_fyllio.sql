-- 058 · LA AGENDA VIVE EN FYLLIO (17-09, paso 3 de la ficha — decisión de Simon).
--
-- Hasta hoy los huecos que enseña Fyllio llevan un aviso fijo: «no son reales,
-- la agenda de verdad está en tu software». Es cierto mientras la clínica
-- lleve su agenda en otro sitio (Gesden, un cuaderno) y Fyllio solo tenga su
-- copia. El escalón IDEAL —el producto que se vende— es que la agenda esté
-- aquí: entonces un hueco calculado ES un hueco, y reservar ES reservar.
--
-- Eso no lo puede adivinar el código (una clínica con horarios configurados y
-- sin Google conectado puede llevar Gesden igual): lo declara el ADMIN de la
-- clínica, una vez, sabiendo lo que implica. De ahí que sea una fila con quién
-- y cuándo, no un booleano perdido en otra tabla. Sin fila = no vive aquí.
--
-- Y las citas nacidas aquí que se confirmaron al paciente por WhatsApp lo
-- dicen en la propia cita: `confirmada_en` + el id del mensaje. La ficha lee
-- eso, no adivina por un saliente cercano.

create table if not exists agenda_ajustes (
  cliente cliente_t primary key,
  agenda_en_fyllio boolean not null default false,
  -- Quién lo activó y cuándo: un ajuste que cambia lo que Fyllio afirma al
  -- paciente tiene que tener nombre.
  activado_por text,
  activado_en timestamptz,
  actualizado_en timestamptz not null default now()
);

comment on table agenda_ajustes is
  '058: ajustes de agenda por cliente. agenda_en_fyllio = la clínica declara '
  'que su agenda real vive aquí: los huecos son reales y reservar es reservar '
  '(frescura en_vivo). Sin fila o false: copia con fecha (si hay agenda externa) '
  'o sin agenda (el aviso de siempre).';

alter table agenda_ajustes enable row level security;
alter table agenda_ajustes force row level security;
drop policy if exists p_cliente on agenda_ajustes;
create policy p_cliente on agenda_ajustes for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on agenda_ajustes to fyllio_app;

alter table citas add column if not exists confirmada_en timestamptz;
alter table citas add column if not exists confirmacion_mensaje_id text;

comment on column citas.confirmada_en is
  '058: cuándo se le confirmó la cita al paciente por WhatsApp desde la ficha '
  '(plantilla de código, al clic de la coordinadora). NULL = no se confirmó '
  'desde Fyllio.';
