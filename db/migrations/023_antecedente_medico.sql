-- 023_antecedente_medico.sql
--
-- El caso Sintrom (decidido el 2026-08-14): el paciente MENCIONA medicación,
-- condición médica o antecedente relevante Y tiene una cita próxima → el caso
-- deriva a persona, cola prioritaria. La regla es factual y el juicio mínimo:
-- el modelo solo detecta la MENCIÓN (booleano, sin valorar gravedad — el
-- modelo no juzga gravedad NUNCA, ni para derivar); la proximidad de la cita
-- la cuenta CÓDIGO, en días de calendario de la clínica (§13).
--
-- Entra como CAUSA PROPIA y no como variante de urgencia: son fenómenos
-- distintos operativamente (un dolor agudo hoy vs una contraindicación que
-- hay que revisar antes de la cita), la fase D los configura por separado
-- (qué es urgencia ≠ el umbral de cita próxima), y mezclarlos cegaría la
-- métrica. La cola sigue DERIVÁNDOSE en código (colaDeDerivacion): ambas son
-- prioritarias hoy; si mañana cambia, el histórico de causas no se pierde.
--
-- Sin cita registrada, la mención NO deriva: se anota `duda_clinica` y la
-- conversación sigue — el riesgo que la regla cubre es la inminencia, y sin
-- cita no la hay. El aplazado deja el antecedente en la ficha para que el
-- doctor lo vea antes de cualquier cita futura.

begin;

alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_causa_derivacion_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_causa_derivacion_check
  check (causa_derivacion is null or causa_derivacion in
    ('peticion_queja', 'insistencia', 'urgencia', 'caso_completo', 'antecedente_medico'));

comment on column eventos_automatizacion.causa_derivacion is
  'Por qué el agente entregó el caso (solo en evento=derivado): peticion_queja '
  '(primer toque; queja ≠ insatisfacción), insistencia (2 toques, '
  'configurable), urgencia (médica, inmediata), caso_completo (incluye el '
  'rechazo con motivo y el «no puedo pagar» con plan_pago anotado), y '
  'antecedente_medico (023: mención factual de medicación/condición + cita '
  'próxima contada por código). La COLA se deriva: prioritaria ⇔ urgencia ∨ '
  'antecedente_medico ∨ (peticion_queja ∧ malestar).';

commit;
