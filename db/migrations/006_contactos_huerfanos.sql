-- Contactos huérfanos legacy (PresupuestoId con id de negocio, no recId)
-- existen en datos reales y alimentan la estadística de tonos aunque no
-- crucen. presupuesto_id pasa a NULLABLE para poder copiarlos.
alter table contactos_presupuesto alter column presupuesto_id drop not null;
