-- 051_decisor_alcance.sql
--
-- EL DECISOR «ALCANCE» (2026-09-13, dictado de Simon). Al modelo se le dan
-- tres cosas —la conversación, los datos en los que puede apoyarse, y SU
-- ALCANCE Y SU OBJETIVO— y de ahí deduce el límite solo. Es la variante libre
-- MÁS una frase de qué papel tiene (derivada de `agendaNivel` y del propósito
-- del caso abierto) y MENOS la prohibición de agenda, que esa frase ya cubre
-- dicha como papel en vez de como veto.
--
-- Aquí solo se abren los CHECK: un decisor nuevo no cabía en la lista de 049
-- y el insert habría fallado en mitad de la pasada, después de pagar el
-- modelo. La variante entra también en agente_sombra por si algún día se pide
-- en vivo; hoy no se pide (VARIANTES_EN_VIVO).

alter table agente_sombra_hilos drop constraint if exists agente_sombra_hilos_decisor_check;
alter table agente_sombra_hilos add constraint agente_sombra_hilos_decisor_check
  check (decisor in ('codigo', 'contexto', 'libre', 'alcance'));

alter table agente_sombra_guiones drop constraint if exists agente_sombra_guiones_preferido_check;
alter table agente_sombra_guiones add constraint agente_sombra_guiones_preferido_check
  check (preferido in ('codigo', 'contexto', 'libre', 'alcance', 'ninguno'));

alter table agente_sombra drop constraint if exists agente_sombra_variante_check;
alter table agente_sombra add constraint agente_sombra_variante_check
  check (variante in ('produccion', 'libre', 'alcance'));
