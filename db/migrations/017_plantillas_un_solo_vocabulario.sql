-- 017_plantillas_un_solo_vocabulario.sql
--
-- Un solo vocabulario para `plantillas_mensaje` (MEJORAS 13, paso de datos).
--
-- ─── Qué había ────────────────────────────────────────────────────────────
--
-- DOS editores escribiendo en ESTA MISMA TABLA, cada uno con su idioma, y el
-- corte entre los dos era exacto — 5 filas de uno, 3 del otro:
--
--   · Editor de /automatizaciones: clasificaba por `tipo` ('Seguimiento',
--     'Financiacion'…) y escribía UNA llave: {nombre}, {tratamiento}, {doctor}.
--     Sus 5 filas tenían `categoria` a NULL.
--   · Editor de /ajustes: clasificaba por `categoria` (3 valores) y escribía
--     DOS llaves: {{nombre}}, {{nombre_doctor}}, {{pendiente}}.
--
-- El renderizador que se usa de verdad (`aplicarVariables`, en
-- lib/plantillas/plantillas.ts) **solo sustituye {{…}}**. Así que las 5 filas de
-- una llave llegarían al paciente con las llaves puestas: «Hola {nombre}». Es
-- MEJORAS 74, que ya avisó de esto y se quedó en un aviso dentro de un textarea.
--
-- Y `categoria` a NULL no daba error: el lector la convertía en
-- 'lead_seguimiento' por defecto, así que «Financiación» y «Confirmación de
-- aceptación» aparecían archivadas como seguimiento de leads sin que nadie lo
-- hubiera decidido.
--
-- ─── Por qué AHORA ────────────────────────────────────────────────────────
--
-- Porque hoy son 8 filas y todas de DEMO: RB e INDEP están a cero. Esta misma
-- migración después del onboarding sería mover plantillas escritas por una
-- clínica, con su texto y su criterio. El momento barato es este.
--
-- ─── Qué hace ─────────────────────────────────────────────────────────────
--
-- 1. Traduce el contenido de una llave a dos, mapeando además los nombres que
--    cambiaban ({doctor} → {{nombre_doctor}}, {clinica} → {{nombre_clinica}}).
-- 2. Rellena `categoria` desde `tipo`.
-- 3. Recalcula `variables_detectadas`.
-- 4. Cierra la puerta: `categoria` pasa a NOT NULL con CHECK. El default mudo
--    del lector se retira en el mismo cambio; a partir de aquí, una plantilla
--    sin categoría no se puede crear en vez de crearse mal.

begin;

-- 1 · Sintaxis. Solo toca las filas que NO tienen ninguna llave doble, que son
--     exactamente las del editor viejo. Así no puede convertir dos veces y
--     dejar {{{nombre}}}, y volver a ejecutarla no hace nada.
update plantillas_mensaje
   set contenido = regexp_replace(
         regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(contenido, '\{nombre\}',      '{{nombre}}',        'g'),
                                         '\{tratamiento\}', '{{tratamiento}}',   'g'),
                                         '\{importe\}',     '{{importe}}',       'g'),
                                         '\{doctor\}',      '{{nombre_doctor}}', 'g'),
                                         '\{clinica\}',     '{{nombre_clinica}}','g')
 where contenido !~ '\{\{';

-- 2 · Categoría, desde el tipo que ya tenían. La correspondencia se escribe
--     aquí y no se deduce: son tres cajones y cinco tipos, así que alguien
--     tiene que decidir, y queda escrito quién y cuándo.
--       Seguimiento  · Reactivacion                    → seguimiento de leads
--       Detalles de pago · Financiacion · Confirmacion → cobranza
--     («Confirmación de aceptación» va a cobranza porque lo que anuncia es el
--      siguiente paso de pago, no una cita.)
update plantillas_mensaje
   set categoria = case tipo
         when 'Seguimiento'      then 'lead_seguimiento'
         when 'Reactivacion'     then 'lead_seguimiento'
         when 'Detalles de pago' then 'cobranza'
         when 'Financiacion'     then 'cobranza'
         when 'Confirmacion'     then 'cobranza'
         when 'Cobranza'         then 'cobranza'
         else 'lead_seguimiento'
       end
 where categoria is null;

-- 3 · Las variables que se anuncian en la ficha, recalculadas sobre el texto ya
--     traducido. Antes de esto, las 5 filas viejas no tenían ninguna.
update plantillas_mensaje
   set variables_detectadas = coalesce(
         (select string_agg(distinct m[1], ', ' order by m[1])
            from regexp_matches(contenido, '\{\{([a-zA-Z_]+)\}\}', 'g') as m),
         '');

-- 4 · La puerta. Sin esto, el próximo editor que olvide la categoría vuelve a
--     crear filas que el lector archiva donde le parece.
alter table plantillas_mensaje
  alter column categoria set not null;

alter table plantillas_mensaje
  drop constraint if exists plantillas_mensaje_categoria_check;
alter table plantillas_mensaje
  add constraint plantillas_mensaje_categoria_check
  check (categoria in ('cobranza', 'lead_seguimiento', 'cita_recordatorio'));

comment on column plantillas_mensaje.categoria is
  'Cajón funcional de la plantilla. Es lo que consultan cobros y el copiloto '
  '(getPlantillasActivas). NOT NULL desde la 017: antes admitía NULL y el lector '
  'lo convertía en lead_seguimiento sin decirlo.';

comment on column plantillas_mensaje.tipo is
  'Etiqueta del editor viejo de /automatizaciones (Primer contacto, Recordatorio…). '
  'Se conserva porque la lee el generador de cola de envíos, que hoy no lo llama '
  'nadie y vive detrás de WA_ENGINE_OPERATIVO=false. La clasificación buena es '
  'categoria; si el generador revive, se migra a categoria y esta columna se va.';

commit;
