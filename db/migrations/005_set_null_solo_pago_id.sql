-- Footgun de FK compuesta: ON DELETE SET NULL anulaba (cliente, pago_id) y
-- cliente es NOT NULL → violación. PG15+: SET NULL con lista de columnas.
alter table acciones_pago drop constraint if exists fk_acciones_pago_pago_id;
alter table acciones_pago add constraint fk_acciones_pago_pago_id
  foreign key (cliente, pago_id) references pagos_paciente (cliente, id)
  on delete set null (pago_id);
