# Sprint B — Aislamiento multi-cliente (dos bases) · PLAN (Fase 1)

**Este documento es solo el plan. No he escrito ni una línea de código.** Léelo, y cuando me des el OK (y me respondas las decisiones del final) paso a la Fase 2/3.

---

## ⚠️ Antes de nada: el Sprint A todavía NO está en `main`

Verifiqué el repositorio: **`main` no tiene los cambios del Sprint A** (su última entrega sigue siendo la de Sprint 17). Los 10 commits del blindaje viven solo en la rama `sprint-A-blindaje-datos`. Dijiste "con el Sprint A ya mergeado a main", pero el merge no llegó a hacerse (probablemente lo revisaste en GitHub Desktop pero no pulsaste "merge").

**Por qué importa:** si creo la rama del Sprint B desde `main` ahora, **no llevaría los arreglos de seguridad del Sprint A** — estaría construyendo el aislamiento sobre el código sin blindar. Necesito que resuelvas esto primero (es la **Decisión 0** del final). Por eso **todavía no he creado el tag `pre-sprint-B` ni la rama** — espero tu respuesta para hacerlos desde la base correcta.

El plan de abajo es válido igual, independientemente de eso.

---

## 1. Inventario: qué es "de negocio" (va por cliente) y qué es "identidad" (queda central)

La base actual tiene ~40 tablas. Las clasifico en dos grupos:

### 🔵 Datos de negocio → van a la base de cada cliente (una copia en Base A, otra en Base B)
Todo lo que pertenece a una clínica concreta y que un cliente jamás debe ver del otro:

`Pacientes`, `Presupuestos`, `Leads`, `Citas`, `Tratamientos`, `Staff`, `Sillones`, `Doctores_Presupuestos`, `Contactos_Presupuesto`, `Objetivos_Mensuales`, `Mensajes_WhatsApp`, `Cola_Envios`, `Plantillas_Mensaje`, `Plantillas_Lead`, `Configuracion_Recordatorios`, `Configuracion_WABA`, `Historial_Acciones`, `Acciones_Lead`, `Pagos_Paciente`, `Acciones_Pago`, `Inconsistencias_Pagos`, `Notificaciones`, `Alertas_Enviadas`, `Configuraciones_Clinica`, `Conversaciones_Copilot` (contienen datos de pacientes), `Reglas_Automatizacion`, `Acciones_Automatizacion`, `Secuencias_Automaticas`, `Configuracion_Automatizaciones`, `Eventos_Sistema`, `Informes_Guardados`, `Llamadas_Vapi`, `Push_Subscriptions`, `Lista_de_espera`, y **`Clínicas`** (las clínicas de ese cliente).

### 🟢 Identidad → queda central (una sola copia, compartida)
Lo que decide **quién** eres y a **qué cliente** perteneces:

`Usuarios` (credenciales/PIN + rol + a qué cliente perteneces).

> **`Usuarios_Presupuestos`** es legacy y ya lo desactivamos en el Sprint A — no se copia a ningún sitio.

### El detalle clave: ¿dónde va `Clínicas` y el mapa usuario→clínica?
Este es el punto fino. Recomiendo el modelo más limpio (lo llamo **Modelo Y**):

- **Central = solo `Usuarios`.** Cada usuario tiene un campo nuevo `Cliente` (por ejemplo `"RB"` o `"INDEP"`). Ahí es donde el login "sabe a qué cliente perteneces".
- **`Clínicas` y el mapa usuario→clínica viven en la base de cada cliente**, junto al resto de datos de negocio. Así, dentro de la base de un cliente, todas las relaciones (paciente→clínica, presupuesto→clínica, etc.) siguen intactas.
- El único ajuste técnico: el mapa usuario→clínica guardará el ID del usuario como **texto** (porque el usuario vive en otra base). Eso lo resuelvo en código; **tú no tienes que retocar campos en Airtable a mano** (ver instrucciones de Fase 2).

**Ventaja de este modelo:** el "a qué cliente perteneces" se decide **a nivel de usuario** (un solo dato), y de ahí sale la base. Simple de razonar y de auditar.

---

## 2. Diseño del enrutado por cliente (ESTO es lo que quiero revisar contigo)

### El problema en una frase
Hoy todo el código habla con **una sola base fija**. Hay **~87 sitios** que llaman a Airtable directamente (`base(TABLES.x)`). Necesitamos que cada uno hable con la base **del cliente correcto**, sin reescribir los 87.

### La solución: un único "portero" de base + contexto por petición
La idea es que **casi ninguno de los 87 sitios cambie**. En lugar de pasar el cliente a mano en cada llamada, establecemos el cliente **una sola vez al principio de cada petición**, y el "portero" `base()` lo lee automáticamente.

Cómo funciona, en simple:
1. **Al hacer login**, la sesión guarda tu `cliente` (leído de tu ficha en `Usuarios`).
2. **Al empezar cada petición del producto vivo**, un único envoltorio (`withAuth`, que ya existe) coge el `cliente` de tu sesión y lo mete en un "contexto de petición".
3. **`base()` lee ese contexto** y elige la base A o B según el cliente. Los ~87 sitios siguen escribiendo `base(TABLES.pacientes)` sin cambiar; por debajo, va a la base correcta.
4. **Freno de seguridad (lo más importante):** si por lo que sea `base()` se llama **sin** contexto de cliente establecido, **lanza un error y no devuelve nada** — nunca cae a una base "por defecto". Es decir: es **imposible** leer datos sin haber declarado el cliente. Fallo cerrado.

Esto cumple tus dos requisitos a la vez: **mínimo cambio** (los 87 sitios casi no se tocan) y **garantía** (sin cliente → error, no fuga).

> **Honestidad sobre el "100%":** puedo **garantizar al 100%** que ninguna petición lea datos *sin* cliente (el freno lanza error). Lo que depende de que esté bien es la **única función** que traduce sesión→cliente→base: es pequeña, la pruebo a fondo, y es el único sitio que hay que revisar con lupa. Concentrar toda la decisión en un punto es precisamente lo que la hace auditable. La alternativa (pasar el cliente a mano en los 87 sitios) reparte esa decisión en 87 lugares — más superficie para equivocarse, no menos. Por eso recomiendo el contexto central con freno.

### La parte difícil y de más riesgo: los puntos SIN login
No todo entra con una sesión de usuario. Estos puntos reciben datos "desde fuera" y **no saben de qué cliente son** por sí solos. Cada uno necesita su forma de resolver la base, y **son el mayor riesgo del sprint**:

| Punto de entrada | Cómo sabrá a qué cliente/base pertenece |
|---|---|
| **Webhook de WhatsApp entrante** (`/api/webhooks/whatsapp`) | Por el **número de WhatsApp que recibe** el mensaje. Cada cliente tiene su propio número (WABA), así que el número → cliente → base. **Requisito previo:** que cada cliente tenga su WABA propio configurado (ya era el plan, decisión Q3 del Sprint A). Sin eso, habría que buscar en las dos bases (más frágil). |
| **Webhook de Vapi** (llamadas) | La llamada se creó desde la base de un cliente; guardaremos el cliente junto al registro de la llamada para que el resultado vuelva a la base correcta. |
| **Crons** (`daily`, `automatizaciones-evaluar`) | Se ejecutan **una vez por cada cliente** (un bucle sobre las bases), estableciendo el contexto de cliente en cada vuelta. |
| **Portal público de presupuesto** (`/api/portal/[token]`) | El enlace ya lleva un token único; guardaremos a qué cliente pertenece ese token para resolver la base. |

Estos cuatro son donde pondré más cuidado y más pruebas en la Fase 5.

### Resumen del "seam" (la costura única)
- `base(tableName)` → deja de usar una base fija; usa el cliente del **contexto de petición**; si no hay, **lanza error**.
- Un acceso aparte y explícito para la identidad central (`Usuarios`): `baseCentral(...)`, que siempre usa la base central. Así identidad y negocio nunca se confunden.
- Una única función `resolverClienteDeSesion(sesión)` — el único sitio que decide el cliente.

---

## 3. Instrucciones exactas para ti (Fase 2 — la haces tú en Airtable)

**Objetivo:** crear tres bases nuevas y vacías, y darme sus IDs. No hay que migrar datos (todo lo actual es demo).

### Paso 1 — Duplicar la estructura (sin registros) tres veces
En Airtable, sobre tu base actual: botón derecho → **"Duplicar base"**, y **DESMARCA la casilla "Duplicate records"** (queremos la estructura vacía, sin datos). Hazlo **tres veces** y nómbralas exactamente así:

1. **`Fyllio · RB Dental`** — base de negocio del cliente RB (sus 10 clínicas).
2. **`Fyllio · Clínica Independiente`** — base de negocio del cliente independiente.
3. **`Fyllio · Identidad`** — base central de usuarios/login.

*(No hace falta que borres ninguna tabla de ninguna base. El código usa solo las tablas que le tocan a cada una; las tablas de más quedan vacías y no molestan. Así evitamos que tengas que retocar nada a mano.)*

### Paso 2 — Sacar los IDs de las tres bases
Abre cada base y copia su **Base ID** (empieza por `app...`). Está en la URL (`airtable.com/appXXXXXXXX/...`) o en Help → API documentation.

### Paso 3 — Comprobar el permiso de la API key
La `AIRTABLE_API_KEY` actual (un Personal Access Token) debe tener **acceso a las tres bases nuevas**. En Airtable → Developer hub → tu token → añade las tres bases a su lista de bases con permiso de lectura/escritura. (Si no, las escrituras fallarán con un 403 de Airtable.)

### Paso 4 — Variables de entorno en Vercel (nombres exactos)
Añade en Vercel (producción) estas variables con los IDs del Paso 2:

```
AIRTABLE_BASE_RB        = app...   (Fyllio · RB Dental)
AIRTABLE_BASE_INDEP     = app...   (Fyllio · Clínica Independiente)
AIRTABLE_BASE_CENTRAL   = app...   (Fyllio · Identidad)
```

**No borres** `AIRTABLE_BASE_ID` — lo dejamos apuntando a la base actual, que pasa a ser **demo/dev** (la usa la página `/demo` en local; en producción esa superficie ya está cerrada desde el Sprint A).

### Paso 5 — Avísame
Cuando tengas las tres bases creadas, los IDs puestos en Vercel y el token con permiso, me lo confirmas y arranco la Fase 3 (código).

---

## 4. Qué haré en las Fases 3 y 4 (código, tras tu OK y tus bases)

**Fase 3 — Enrutado por cliente:**
- Añadir `cliente` a la sesión (se lee de `Usuarios.Cliente` al hacer login por PIN).
- Convertir `base()` en consciente del cliente vía el contexto de petición, con freno fail-closed.
- Establecer el contexto en: el envoltorio `withAuth` (todo el producto vivo), y explícitamente en los 4 puntos sin sesión (webhooks, crons, portal).
- Verificar módulo a módulo (Leads, Pacientes, Presupuestos, no-shows, Copilot, automatizaciones, llamadas) que leen/escriben en la base correcta.

**Fase 4 — Filtro por clínica dentro de la base (el bug raíz):**
- `legacy-cookies`: emitir la **clínica real** del usuario, no `null`.
- Aplicar `canAccessClinica()` / `listClinicaIdsForUser()` en TODAS las rutas legacy (Presupuestos, no-shows, llamadas, automatizaciones) — hoy `canAccessClinica()` tiene cero usos.
- Copilot: arreglar las 3 fugas de lectura (`consultar_llamadas_recientes` sin filtro; `get_facturado_periodo` global con ≥2 clínicas; `mensajes_recientes` sin comprobar propiedad).
- IDOR de Presupuestos: `/mensajes`, `/historial`, `/contactos` comprueban que el `presupuestoId` pertenece a una clínica del usuario antes de devolver nada.
- Escapar el email en las consultas de login (`filterByFormula`).

**Fase 5 — QA adversarial:** intentar romper el aislamiento a propósito y entregarte el informe con cada prueba (los 5 escenarios que definiste).

---

## 5. Esfuerzo estimado y riesgos honestos

**Esfuerzo:** Fase 3 (enrutado) ≈ 3-5 días; Fase 4 (filtro por clínica + fugas) ≈ 3-4 días; Fase 5 (QA adversarial) ≈ 1-2 días. Total realista: **~2 semanas** de un ingeniero, con este sprint como bloqueante del piloto.

**Riesgos que veo (y dónde no puedo prometer 100% sin tu input):**
1. **Los 4 puntos sin sesión** (webhooks/crons/portal) son el riesgo real. El del WhatsApp entrante depende de que cada cliente tenga su número WABA propio; si al arrancar comparten número, el enrutado por número no funciona y hay que buscar en ambas bases (más frágil). **Necesito confirmar cómo estarán los números WABA en el piloto** (Decisión 3).
2. **El "dueño de la red RB" ve sus 10 clínicas** — sale gratis con este diseño (su cliente = RB → base A → sus 10 clínicas). Pero **tú, como operador que gestiona los dos clientes**, quedas atado a un cliente por sesión; para ver el otro tendrías que cambiar de cliente. Eso es cosa tuya, no del piloto, pero lo dejo señalado (Decisión 4).
3. **La base central de identidad** es un tercer punto de fallo: si se cae, nadie entra. Es aceptable (Airtable es fiable), pero conviene saberlo.

---

## ✅ Decisiones confirmadas por el fundador (respuestas recibidas)

- **D0 — Merge del Sprint A:** hecho. Sprint A ya está en `main` (Sprint 17 + 18 + A). La rama B saldrá de `main` limpio **cuando el fundador dé la luz verde explícita** (freno respetado; ver chat).
- **D1 — Tres bases:** confirmado. `RB`, `Independiente`, `Identidad`.
- **D2 — Modelo Y:** confirmado. Cliente a nivel de usuario; `Clínicas` + negocio por cliente; central solo `Usuarios`.
- **D3 — WABA por cliente desde el día 1:** RB arranca con su número; el independiente entra después con el suyo. **Implicación buena:** el webhook entrante enruta por número WABA → cliente → base de forma limpia; **se elimina el riesgo de "buscar en ambas bases"** que señalé como el punto más frágil.
- **D4 — Sin rol super-operador por ahora:** cada cliente se gestiona por separado (admin de cada uno). Simplifica la sesión; se deja para más adelante.

*El detalle de cada pregunta queda abajo como referencia.*

---

## 6. Decisiones que necesito de ti antes de codear

**Decisión 0 (bloqueante) — el merge del Sprint A.** ¿Mergeas el Sprint A a `main` en GitHub Desktop primero (y entonces creo la rama B desde `main` limpio), o prefieres que cree la rama B **encima de `sprint-A-blindaje-datos`**? Recomiendo lo primero (merge A → main, luego B desde main). Hasta que no me digas, no creo el tag ni la rama.

**Decisión 1 — ¿tres bases o dos?** Tú dijiste "dos bases nuevas" (una por cliente). Mi diseño necesita **una tercera base central** para la identidad (usuarios/login), porque los usuarios no pueden vivir dentro de la base de un cliente concreto. ¿Confirmas las **tres bases** (RB, Independiente, Identidad)? Si prefieres otra cosa (p. ej. identidad en un sitio distinto), dímelo.

**Decisión 2 — ¿el modelo de datos que propongo (Modelo Y) te encaja?** Cliente a nivel de usuario; `Clínicas` y todo lo de negocio por cliente; central solo `Usuarios`. Es el más limpio; solo lo confirmo.

**Decisión 3 — números de WhatsApp en el piloto.** ¿Cada cliente entrará con su **propio número WABA** desde el día 1 (ideal para el enrutado del webhook), o RB arranca con un número y el independiente entra después? Esto define cómo resuelvo el webhook entrante.

**Decisión 4 — tu acceso de operador.** ¿Necesitas un rol "super-operador" que pueda ver/gestionar **ambos** clientes cambiando entre ellos, o de momento gestionas cada cliente por separado (entrando como admin de cada uno)? No es bloqueante para el piloto, pero afecta al diseño de sesión.

---

*Fin de la Fase 1. Me paro aquí como acordamos. Respóndeme la Decisión 0 (y a poder ser 1-3) y sigo. No toco código hasta tu OK.*
