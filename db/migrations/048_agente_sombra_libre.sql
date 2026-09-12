-- 048_agente_sombra_libre.sql
--
-- FASE 1 EN SOMBRA, segunda variante (2026-09-11, noche — hallazgo de Simon
-- leyendo la primera): la sombra recibía la MISMA entrada que producción, y
-- esa entrada lleva los objetivos abiertos con su propósito y su lista de
-- campos — el encargo de avanzar. Aunque el prompt de la sombra no tenga
-- reglas de flujo, el modelo escribía con la presión del código encima y sus
-- mensajes se parecían a los del código.
--
-- La variante LIBRE ve el hilo, lo publicado y los datos de la persona, pero
-- NO los objetivos ni los campos: información y límites, no instrucciones
-- de qué pedir. Así se comparan tres columnas: el código, el modelo con el
-- contexto de producción y el modelo libre.
--
--   variante  · 'produccion' (la de siempre) | 'libre'
--   conviene  · «qué le conviene a esta persona ahora», en palabras del modelo (libre)
--   veredicto · admite 'libre' (tenía razón el modelo libre)
-- La clave única pasa a incluir la variante.

alter table agente_sombra add column if not exists variante text not null default 'produccion';
alter table agente_sombra drop constraint if exists agente_sombra_variante_check;
alter table agente_sombra add constraint agente_sombra_variante_check check (variante in ('produccion', 'libre'));
alter table agente_sombra add column if not exists conviene text;

alter table agente_sombra drop constraint if exists agente_sombra_veredicto_check;
alter table agente_sombra add constraint agente_sombra_veredicto_check
  check (veredicto in ('modelo', 'libre', 'codigo', 'los_dos', 'ninguno'));

drop index if exists agente_sombra_turno_version;
create unique index if not exists agente_sombra_turno_version_variante
  on agente_sombra (cliente, mensaje_id, version_sombra, variante);
