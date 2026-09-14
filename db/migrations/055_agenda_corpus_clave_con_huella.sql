-- 055_agenda_corpus_clave_con_huella.sql
--
-- LA CLAVE DEL CORPUS DE AGENDA LLEVA AHORA EL TEXTO DENTRO (2026-09-14,
-- MEJORAS 239, encargo de Simon: «una vara que se corrompe sola al rejugar no
-- es una vara»).
--
-- EL AGUJERO, y lo que lo hacía grave: `agenda_corpus.clave` era
-- `<mensaje_id>|<fuente>` — el turno y de dónde salió, NADA del mensaje—, y las
-- dos tablas de las que se leen los candidatos se REEMPLAZAN al rejugar
-- (`agente_sombra_hilos` hace upsert por (cliente, guion_id, decisor); la
-- sombra, por variante y turno). Un `npm run hilos:tres` normal dejaba las 91
-- etiquetas de Simon —32 de ellas en la vara del juicio de agenda— pegadas a
-- mensajes que él no ha leído. El número habría cambiado sin que nadie tocara
-- el juez: un fallo silencioso en la única cosa que existe para medir.
--
-- EL ARREGLO: `<mensaje_id>|<fuente>|<huella>`, donde la huella son los 12
-- primeros hex de sha256 del `texto` TAL CUAL se guardó. Rejugar deja de
-- heredar: produce candidatos con clave nueva, sin etiqueta y visibles como
-- pendientes, y la fila vieja se queda sin candidato — contada en
-- `resumen.huerfanas` y enseñada en las dos pantallas. Se prefiere perder una
-- etiqueta EN ALTO a heredarla en falso.
--
-- POR QUÉ SE PUEDE MIGRAR SIN MIRAR LAS TABLAS DE ORIGEN: `agenda_corpus.texto`
-- ya guarda el mensaje que Simon tenía delante al etiquetar. La huella se
-- calcula de ESE texto, no del que haya hoy en `agente_sombra_hilos`. Si algún
-- hilo ya se rejugó, la fila migrada apunta al texto viejo, no casa con ningún
-- candidato y sale como huérfana — que es exactamente lo que debe pasar y lo
-- que hoy no se veía.
--
-- SIN NORMALIZAR el texto antes de hashear, igual que `huellaTexto` en
-- `app/lib/agente/version.ts`: dos normalizaciones en dos lenguajes es la forma
-- de que un día dejen de coincidir sin que nadie lo note.
--
-- IDEMPOTENTE por la condición del WHERE: solo toca las filas que están en la
-- forma vieja EXACTA (`clave = mensaje_id || '|' || fuente`), y después de
-- correr ya no lo están. Correrla dos veces no hace nada la segunda.

update agenda_corpus
   set clave = clave || '|' || substring(encode(sha256(convert_to(texto, 'UTF8')), 'hex') for 12)
 where clave = mensaje_id || '|' || fuente;

-- El índice único sigue siendo (cliente, clave) y no cambia: lo que cambia es
-- el contenido de la clave, no su forma de identificar una fila.
