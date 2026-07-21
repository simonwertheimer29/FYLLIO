-- D4 en acción: el seed real trae valores de TipoContacto fuera del conjunto
-- "cerrado por TS" → el conjunto no estaba cerrado. Columna abierta.
alter table contactos_presupuesto drop constraint if exists contactos_presupuesto_tipo_contacto_check;
