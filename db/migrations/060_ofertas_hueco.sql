-- 060 · OFERTAS DE HUECO (17-09, cambio de flujo del paso 3 dictado por Simon).
--
-- Antes: la coordinadora reservaba un hueco y se le confirmaba al paciente;
-- si no le iba, quedaba un hueco muerto y una coordinadora escribiendo. Ahora
-- se OFRECEN hasta cuatro alternativas pre-escritas, el paciente ELIGE, el
-- sistema comprueba que sigue libre y la coordinadora reserva de un clic.
-- Nada queda reservado hasta que el paciente acepta.
--
-- Una fila por oferta ENVIADA. Es la memoria del bucle: qué se le propuso
-- (para que el agente solo pueda desambiguar entre eso), cuándo caduca (una
-- lista de horas de ayer no es una oferta), qué eligió y si llegó tarde.
--
-- Estados:
--   abierta     enviada, esperando que el paciente elija
--   elegida     el paciente contestó (eleccion = índice 0..n-1, o NULL si no
--               se entendió cuál / hilo asumido sin interpretar) y falta el
--               clic de la coordinadora
--   reservada   la coordinadora reservó y se confirmó al paciente
--   caducada    venció sin elección (se persiste al tocarla: el vencimiento se
--               calcula AL LEER, sin cron). Una elección tardía se guarda
--               igual con eleccion_tardia = true: el código NO reserva de una
--               lista muerta, la coordinadora ve la comprobación y decide
--   reemplazada una oferta nueva la sustituyó («se ocupó, te quedan estas»)
--
-- El ACUSE (decisión de Simon, 17-09): a toda elección se le contesta algo
-- inmediato («lo compruebo y te confirmamos…») para no dejar al paciente en
-- silencio toda la noche; pero solo si en unos minutos nadie ha reservado
-- NI SE LE HA ESCRITO NADA sobre esa elección (dos mensajes que se
-- contradicen es peor que el silencio). acuse_enviado_en lo deja constar.

create table if not exists ofertas_hueco (
  id uuid primary key default gen_random_uuid(),
  cliente cliente_t not null,
  telefono text not null,
  lead_id text not null,
  clinica_id text,
  tratamiento_id text,
  -- [{fecha, hora, fin, doctorId, doctorNombre, clinicaId, clinicaNombre}] en
  -- el ORDEN en que se numeraron en el mensaje (1), 2), 3)…).
  alternativas jsonb not null,
  texto text not null,
  mensaje_id text,
  enviada_en timestamptz not null default now(),
  caduca_en timestamptz not null,
  estado text not null default 'abierta'
    check (estado in ('abierta', 'elegida', 'reservada', 'caducada', 'reemplazada')),
  eleccion int,
  eleccion_en timestamptz,
  eleccion_tardia boolean not null default false,
  eleccion_mensaje_id text,
  -- Veces que el agente ha pedido aclarar cuál («¿la del jueves a las 10 o
  -- la del viernes?»). A la segunda sin aclarar, deriva.
  desambiguaciones int not null default 0,
  acuse_enviado_en timestamptz,
  acuse_mensaje_id text,
  cita_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ofertas_hueco_telefono_idx on ofertas_hueco (cliente, telefono, created_at desc);
create index if not exists ofertas_hueco_lead_idx on ofertas_hueco (cliente, lead_id);

comment on table ofertas_hueco is
  '060: cada oferta de horas enviada al paciente desde la ficha (bucle ofrecer → elegir → comprobar → reservar). '
  'Vencimiento calculado al leer (estado abierta y now() > caduca_en); se persiste al tocarla.';

alter table ofertas_hueco enable row level security;
alter table ofertas_hueco force row level security;
drop policy if exists p_cliente on ofertas_hueco;
create policy p_cliente on ofertas_hueco for all to fyllio_app
  using (cliente = current_setting('app.cliente', true))
  with check (cliente = current_setting('app.cliente', true));
grant select, insert, update, delete on ofertas_hueco to fyllio_app;

-- Dos causas nuevas de entrega a una persona:
--   oferta_elegida  el paciente contestó a la oferta: la coordinadora reserva
--                   de un clic (o elige ella cuál si no se entendió). Cola
--                   prioritaria: es la ventana en la que llama a otra clínica.
--   sin_huecos      se ocuparon todas las alternativas y no hay otras en los
--                   próximos días: se le dijo que el equipo revisa la agenda y
--                   le escribe «en cuanto abra la clínica». El plazo es ese.
alter table eventos_automatizacion
  drop constraint if exists eventos_automatizacion_causa_derivacion_check;
alter table eventos_automatizacion
  add constraint eventos_automatizacion_causa_derivacion_check
  check (causa_derivacion is null or causa_derivacion in
    ('peticion_queja', 'insistencia', 'urgencia', 'caso_completo', 'antecedente_medico',
     'no_legible', 'sin_respuesta_valida', 'hueco_rechazado', 'oferta_elegida', 'sin_huecos'));
comment on constraint eventos_automatizacion_causa_derivacion_check on eventos_automatizacion is
  'Vocabulario de causas de derivación (060). oferta_elegida = la persona contestó a una oferta de horas; sin_huecos = se ocuparon todas y no hay otras.';
