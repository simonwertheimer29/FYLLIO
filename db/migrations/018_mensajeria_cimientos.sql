-- 018_mensajeria_cimientos.sql
--
-- Los tres cimientos del módulo de Mensajería, ANTES de construir la bandeja.
-- Van primero porque la lista y su pestaña principal dependen de ellos, y
-- construir encima sin esto daría una pestaña vacía y hilos partidos.
--
-- ─── 1 · autor: quién escribió el mensaje ───────────────────────────────────
--
-- Hoy no se puede saber. `fuente` tiene UN solo valor en los 1.114 mensajes
-- ('Modo_A_manual') y `eventos_automatizacion` está vacía. O sea: la pestaña
-- «Ha respondido el agente» —que es la razón de ser de la pantalla— no se puede
-- derivar de nada de lo que hay.
--
-- Se guardan DOS cosas, porque son dos preguntas distintas:
--   · `autor`            — quién pulsó enviar. En modo A siempre es 'persona'.
--   · `sugerido_por_ia`  — si el TEXTO lo escribió el agente.
--
-- La combinación es lo que hace que la pestaña funcione hoy y siga funcionando
-- en modo B: hoy «lo que ha dicho el agente» son los mensajes que él redactó y
-- una persona mandó tal cual (`sugerido_por_ia`); el día que envíe solo, serán
-- los suyos (`autor='agente'`). Un solo campo no distingue los dos mundos.
--
-- No duplica `eventos_automatizacion`: allí se guarda CUÁNTO se editó
-- (`distancia_edicion`, la medida); aquí, DE DÓNDE salió el texto. Son cosas
-- distintas y la segunda no se deduce de la primera.
--
-- ─── 2 · nombre_perfil: el nombre que WhatsApp ya nos manda ────────────────
--
-- El webhook recibe `contacts[0].profile.name` —el nombre de perfil de
-- WhatsApp—, lo tiene declarado en su tipo, y lo tira. Guardarlo cierra la
-- cadena de resolución de nombre: paciente → lead → perfil → teléfono. Sin él,
-- una conversación de alguien que no está en ningún pipeline es una línea que
-- solo dice un número, y una lista de números no se puede navegar.
--
-- ─── 3 · el índice del hilo ────────────────────────────────────────────────
--
-- No había ninguno por teléfono: agrupar conversaciones era un seq scan. Con
-- 1.114 filas da 0,8 ms y no se nota; crece lineal.

begin;

alter table mensajes_whatsapp
  add column if not exists autor text,
  add column if not exists sugerido_por_ia boolean,
  add column if not exists nombre_perfil text;

alter table mensajes_whatsapp
  drop constraint if exists mensajes_whatsapp_autor_check;
alter table mensajes_whatsapp
  add constraint mensajes_whatsapp_autor_check
  check (autor is null or autor in ('persona', 'agente', 'cadencia'));

comment on column mensajes_whatsapp.autor is
  'Quién pulsó enviar en un saliente: persona (un humano), agente (el sistema, '
  'modo B) o cadencia (un envío programado sin nadie delante). NULL en entrantes '
  'y en las filas anteriores a esta migración, que no se pueden reconstruir.';

comment on column mensajes_whatsapp.sugerido_por_ia is
  'Si el TEXTO lo redactó el agente, lo mandara quien lo mandara. En modo A esto '
  'es lo que responde «qué ha estado diciendo el agente», porque el agente '
  'escribe y la persona envía.';

comment on column mensajes_whatsapp.nombre_perfil is
  'Nombre de perfil de WhatsApp del contacto (contacts[].profile.name del '
  'webhook). Último recurso para poner nombre a un hilo antes de caer al número.';

-- Las filas que ya existen son todas del seed y todas salientes de modo A: las
-- escribió una persona. Se marcan como tal en vez de dejarlas en NULL, que en
-- una pantalla se leería como «no se sabe» sobre datos que sí sabemos.
update mensajes_whatsapp
   set autor = 'persona', sugerido_por_ia = false
 where direccion = 'Saliente' and autor is null;

-- El hilo se lee por (cliente, teléfono) y ordenado por tiempo: es exactamente
-- este índice. Cubre tanto la lista de conversaciones como la apertura de una.
create index if not exists mensajes_whatsapp_hilo
  on mensajes_whatsapp (cliente, telefono, "timestamp" desc);

commit;
