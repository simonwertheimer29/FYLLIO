-- 012_alerta_destinatario.sql
--
-- /alertas (2026-08-01) — a QUIÉN se le avisó.
--
-- `alertas_enviadas` guarda `coordinadora_destino_id`, pero la pantalla necesita
-- decir "Enviada hace 2 h a Marta" y resolver el id contra `usuarios` en cada
-- carga es una consulta por clínica para pintar una línea.
--
-- Y hay una razón de modelado, no solo de coste: el nombre correcto es el de
-- QUIEN LO RECIBIÓ ENTONCES. Si mañana esa coordinadora deja la clínica o se
-- reasigna, resolver el id daría el nombre de otra persona — o ninguno — y el
-- registro pasaría a contar una historia falsa. Se guarda la foto, como
-- `n_al_enviar`.

alter table alertas_enviadas add column if not exists coordinadora_destino_nombre text;

comment on column alertas_enviadas.coordinadora_destino_nombre is
  'Nombre de quien recibió el aviso EN EL MOMENTO del envío. No se resuelve del id al leer: si la persona cambia de clínica, el histórico debe seguir diciendo a quién se avisó. Null = enviada antes de 2026-08-01.';
