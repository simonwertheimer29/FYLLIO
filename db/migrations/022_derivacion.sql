-- 022_derivacion.sql
--
-- El modelo de derivación (sustituye al quiebre de tres tipos, decidido el
-- 2026-08-14): nada tapona por sí mismo — el agente anota y sigue, acompaña
-- sin empujar al cierre — y solo CUATRO cosas derivan el caso a una persona:
--
--   peticion_queja  · pide persona o se queja del trato/espera/servicio.
--                     PRIMER toque. Ojo: queja ≠ insatisfacción — «me parece
--                     caro» es una objeción y se trabaja.
--   insistencia     · vuelve sobre un tema que el agente no puede resolver.
--                     Umbral 2 toques, configurable con tope.
--   urgencia        · urgencia médica. Inmediata.
--   caso_completo   · el objetivo activo está cubierto (incluye el rechazo:
--                     la decisión está recogida).
--
-- LA DERIVACIÓN NO SE REVIERTE. Por eso: (1) el evento `devuelto_al_agente`
-- SE RETIRA del vocabulario — la tabla está vacía y nada lo emitió nunca, es
-- el momento más barato que va a existir; (2) «en manos humanas» se deriva
-- con un EXISTS (hay un `derivado`/`asumido`/`asumido_manual` posterior al
-- último cierre del caso), no con el último evento — un evento posterior no
-- puede taparlo.
--
-- LA COLA (prioritaria/normal) NO se persiste: se guarda el HECHO y la cola
-- se deriva — prioritaria ⇔ urgencia OR (peticion_queja AND malestar). El
-- hecho que no se puede rederivar es `malestar` (juicio del modelo sobre el
-- texto en ese momento, misma doctrina que requiere_persona en la 016 y que
-- distancia_edicion en la 014: se guarda la medida, no la categoría — si
-- mañana cambia la política de colas, el histórico no se pierde).

begin;

-- 1 · El evento `derivado` entra; `devuelto_al_agente` sale.
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_evento_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_evento_check
  check (evento in (
    'quiebre_reconocido',   -- legado fase 1: alguien vio el quiebre y lo abrió
    'asumido',              -- lo coge una persona
    'asumido_manual',       -- «sigo yo»: manual hasta el cierre
    'mensaje_enviado',      -- coincidencia agente-humano
    'aplazado',             -- el agente anotó algo que no puede resolver y SIGUE
    'aplazado_resuelto',    -- una persona resolvió lo aplazado
    'derivado'              -- el agente entregó el caso a una persona (022)
  ));

-- 2 · La causa de la derivación, obligatoria en `derivado` y solo ahí.
alter table eventos_automatizacion
  add column if not exists causa_derivacion text;
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_causa_derivacion_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_causa_derivacion_check
  check (causa_derivacion is null or causa_derivacion in
    ('peticion_queja', 'insistencia', 'urgencia', 'caso_completo'));
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_derivado_con_causa;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_derivado_con_causa
  check ((evento = 'derivado') = (causa_derivacion is not null));

-- 3 · El malestar, solo cuando la causa lo necesita para decidir cola.
alter table eventos_automatizacion
  add column if not exists malestar boolean;
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_peticion_con_malestar;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_peticion_con_malestar
  check (causa_derivacion is distinct from 'peticion_queja' or malestar is not null);

-- 4 · La clave `duda_clinica` entra al catálogo de aplazamientos: 9 de 69
--     casos anotados (R1+C1) son de esta familia — dejarla en «otro» cegaba
--     la taxonomía justo donde la regla de acompañar-sin-empujar se juega.
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_clave_aplazado_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_clave_aplazado_check
  check (clave_aplazado is null or clave_aplazado in (
    'precio_descuento',      -- SOLO con presupuesto emitido que quiere mover (C1-P1)
    'plan_pago',
    'cobertura_seguro',
    'cambio_tratamiento',
    'garantia_condiciones',
    'dato_presupuesto',
    'agenda_disponibilidad',
    'duda_clinica',          -- criterio del doctor; NINGUNA configuración la elimina
    'otro'
  ));

comment on column eventos_automatizacion.causa_derivacion is
  'Por qué el agente entregó el caso (solo en evento=derivado): peticion_queja '
  '(primer toque; queja ≠ insatisfacción), insistencia (2 toques, configurable), '
  'urgencia (médica, inmediata), caso_completo (incluye rechazo con motivo). '
  'La COLA se deriva: prioritaria ⇔ urgencia OR (peticion_queja AND malestar).';
comment on column eventos_automatizacion.malestar is
  'Juicio del modelo al derivar por peticion_queja: ¿hay malestar? Se guarda el '
  'HECHO y no la cola, para poder recalibrar la política de colas sin perder '
  'histórico (misma doctrina que distancia_edicion). NULL en el resto de causas.';

commit;
