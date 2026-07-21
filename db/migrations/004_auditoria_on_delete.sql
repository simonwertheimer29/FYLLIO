-- La auditoría debe SOBREVIVIR al borrado de lo auditado (eliminarPago audita
-- y luego borra; con RESTRICT el borrado revienta). ON DELETE SET NULL: la
-- fila de auditoría queda con pago_id nulo y su texto/importes intactos.
alter table acciones_pago drop constraint if exists fk_acciones_pago_pago_id;
alter table acciones_pago add constraint fk_acciones_pago_pago_id
  foreign key (cliente, pago_id) references pagos_paciente (cliente, id) on delete set null;
