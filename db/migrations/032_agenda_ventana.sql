-- 032_agenda_ventana.sql
--
-- AGENDA G2 (28-08) — dos columnas que pide la ventana /agenda:
--
--   1 · `lead_id`: la cita que nace al agendar un lead queda ENLAZADA al
--       lead, no atribuida a posteriori por ventana de tiempo (leads/cita.ts
--       existe solo para adivinar esta relación; para lo nuevo deja de hacer
--       falta adivinar). Única por lead: re-agendar ACTUALIZA la misma cita,
--       no crea otra — la idempotencia del botón (§2).
--
--   2 · `trasladada_en`: en nivel 1 la agenda de Fyllio no es la agenda real
--       de la clínica — una cita cerrada aquí hay que pasarla al software
--       clínico, y olvidarse es un problema que existe HOY. La ventana enseña
--       las de origen fyllio pendientes de pasar; este timestamp es la marca
--       manual de «ya está en mi software» (quién y cuándo se ve; nada se
--       borra de la lista en silencio).

begin;

alter table citas add column lead_id text;
alter table citas add constraint fk_citas_lead_id
  foreign key (cliente, lead_id) references leads (cliente, id);
create unique index if not exists idx_citas_lead
  on citas (cliente, lead_id) where lead_id is not null;

alter table citas add column trasladada_en timestamptz;

comment on column citas.lead_id is
  'G2: lead del que nació la cita (agendado en Fyllio). Única por lead — '
  're-agendar actualiza. NULL = no vino de un lead.';
comment on column citas.trasladada_en is
  'G2 (nivel 1): cuándo se marcó como pasada al software clínico. NULL = '
  'pendiente de pasar (si origen_sistema=fyllio).';

commit;
