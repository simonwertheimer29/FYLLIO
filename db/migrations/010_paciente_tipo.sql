-- 010_paciente_tipo.sql
--
-- Tipo de paciente (privado / aseguradora) como propiedad de LA PERSONA
-- (spec 2026-07-29).
--
-- Hasta ahora el tipo vivía en el presupuesto, y con un enum en código
-- (`TipoPaciente = "Adeslas" | "Privado"`) hardcodeado además en los KPIs, en
-- la vista de Tarifas, en el importador CSV y en el portal del paciente: dar
-- de alta una aseguradora exigía tocar cuatro capas y desplegar.
--
-- El tipo NO es del presupuesto: una persona no cambia de mutua entre dos
-- presupuestos del mismo mes. `presupuestos.tipo_paciente` se conserva porque
-- lo consumen KPIs históricos, pero deja de ser FUENTE: hereda del paciente al
-- crear. Mismo movimiento que `pacientes.aceptado` (MEJORAS 28), que era una
-- copia que divergía.
--
-- NULLABLE A PROPÓSITO: "sin tipo" es un estado real y visible, no un hueco
-- que haya que rellenar con un default.
--
-- SIN BACKFILL. El dato actual no es recuperable: los 123 presupuestos de DEMO
-- tienen `tipo_paciente = 'Nuevo'`, un valor que ni pertenece al catálogo y que
-- confunde "tipo de paciente" con "paciente nuevo". Derivarlo sería inventar.
-- Se rellena con el uso.

alter table pacientes add column if not exists tipo_paciente text;

comment on column pacientes.tipo_paciente is
  'Privado o el nombre de su aseguradora. El catálogo vive en configuraciones_clinica (Tipos_Paciente / Tipos_Paciente_Aseguradora), nunca en un enum de código. Null = sin tipo, estado válido.';

-- El "Nuevo" de los presupuestos no es un tipo de paciente: es basura de un
-- seed que confundió el campo. Se limpia en DEMO; en las bases piloto no hay
-- presupuestos todavía, así que no toca nada.
update presupuestos set tipo_paciente = null where tipo_paciente = 'Nuevo';
