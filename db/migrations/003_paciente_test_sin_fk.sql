-- Paciente_Test_Id es un PUNTERO DE PRUEBA que por diseño puede apuntar a un
-- id inexistente (demo-reset lo siembra así para que el modo test nunca actúe
-- sobre un paciente real). No es una relación → sin FK. (Excepción D8.)
alter table reglas_automatizacion drop constraint if exists fk_reglas_automatizacion_paciente_test_id;
