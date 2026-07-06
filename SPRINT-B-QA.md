# Sprint B — Plan de QA adversarial (preview de Vercel)

**Objetivo:** intentar *romper* el aislamiento entre los dos clientes (RB y la
clínica independiente) y entre clínicas dentro de un mismo cliente. Si algún
paso "consigue ver lo que no debe", es un fallo y hay que anotarlo.

**Cómo ejecutarlo:**
1. Haz merge de la rama `sprint-B-aislamiento` a un preview de Vercel (no a
   producción todavía).
2. Comprueba que en Vercel están las variables `AIRTABLE_BASE_RB`,
   `AIRTABLE_BASE_INDEP` y `AIRTABLE_BASE_CENTRAL` (las tres bases físicas).
3. **Mete datos de prueba en las bases de negocio** (si no, un preview vacío da
   falsos aprobados). Con `AIRTABLE_API_KEY` + `AIRTABLE_BASE_RB` +
   `AIRTABLE_BASE_INDEP` en el entorno:
   ```
   npx tsx app/scripts/sprint-B-seed-negocio-qa.ts --dry   # previsualiza
   npx tsx app/scripts/sprint-B-seed-negocio-qa.ts         # crea los datos [SEED_QA]
   ```
   Crea en RB pacientes/presupuestos reconocibles en Melilla y Madrid
   (`QA MELILLA · …`, `QA MADRID · …`) y en INDEP con nombre claramente distinto
   (`PACIENTE INDEP TEST …`). Es idempotente. Para quitarlos al terminar el QA:
   `npx tsx app/scripts/sprint-B-seed-negocio-qa.ts --clean`.
4. Entra al preview y sigue los escenarios de abajo. Cada uno dice **qué hacer**
   y **qué debe pasar**. Si pasa otra cosa, anótalo con captura.

**Dato clave para el Escenario 1:** estando en RB, busca por nombre
`PACIENTE INDEP TEST` — **no** debe aparecer nada (ese dato vive en la base de
INDEP). Estando en INDEP, esa búsqueda **sí** lo encuentra.

**Cómo entrar:** ve directo a **`/login`** (la raíz del preview es la landing, no
redirige). Ahí verás una tarjeta **Administrador** y un botón por cada clínica.

**Usuarios de prueba** (creados por el seed, PIN temporal):
- `Admin RB (piloto)` — tarjeta **Administrador** → PIN `111111` (6 dígitos)
- `Admin INDEP (piloto)` — tarjeta **Administrador** → PIN `222222` (6 dígitos)
- `Coord Melilla (piloto)` — botón de una clínica de **Melilla** → PIN `0000` (ve las 3 de Melilla)
- `Coord Madrid (piloto)` — botón **Barajas / Meco / Colmenar** → PIN `0000`
- `Coord INDEP (piloto)` — botón **Clínica Independiente – Piloto** → PIN `0000`

> Los dos admin tienen PIN distinto **a propósito**: el login de admin no pide
> clínica y matchea al primer admin cuyo PIN coincide, así que con el mismo PIN
> no podrías entrar como el otro. Cambia todos estos PIN antes de cualquier uso real.

---

## Escenario 1 — Separación TOTAL entre los dos clientes (lo más crítico)

**Qué hacer:**
1. Entra como `Admin RB (piloto)`. Mira el selector de clínicas (arriba) y las
   pantallas de Presupuestos, Pacientes, Ajustes → Equipo.
2. Cierra sesión. Entra como `Admin INDEP (piloto)`. Mira lo mismo.

**Qué debe pasar:**
- El admin de RB ve **solo las 10 clínicas de RB** y **ningún** dato (paciente,
  presupuesto, usuario) de la clínica independiente.
- El admin de INDEP ve **solo su clínica** y **nada** de RB.
- En ningún sitio aparece mezclado un nombre/dato del otro cliente.

**Por qué:** cada cliente vive en una base de Airtable **física distinta**; una
sesión nunca resuelve la base del otro. Este es el aislamiento que no puede
fallar.

---

## Escenario 2 — Una coordinadora no ve otras clínicas de su MISMO cliente

**Qué hacer:**
1. Entra como `Coord Melilla (piloto)`.
2. En Presupuestos (Kanban, Intervención, Máxima, KPIs, Doctores) mira qué
   clínicas aparecen.
3. En la URL del navegador, en una de esas pantallas, añade a mano
   `?clinica=Barajas` (o el nombre de una clínica de Madrid) y recarga.

**Qué debe pasar:**
- Solo aparecen presupuestos/datos de las **clínicas de Melilla**.
- Forzar `?clinica=Barajas` **no** muestra datos de Barajas: la lista sale
  vacía o sin esa clínica. La coordinadora no puede "colarse" a otra clínica.

**Por qué:** el filtro por clínica ahora se decide por los IDs de clínica de la
sesión (`clinicasAccesibles`), no por un campo que estaba vacío. Antes una
coordinadora veía toda su red.

---

## Escenario 3 — No se puede abrir un presupuesto de otra clínica por su ID (IDOR)

**Qué hacer:**
1. Entra como `Coord Madrid (piloto)`. Abre un presupuesto de Barajas y fíjate
   en su enlace/identificador (o usa la ficha del paciente).
2. Pídele a alguien con acceso a Melilla (o al `Admin RB`) el identificador de
   un presupuesto de **Melilla**.
3. Como `Coord Madrid`, intenta abrir ese presupuesto de Melilla: su
   conversación (mensajes), su historial, sus contactos, y "generar portal".
   Puedes probarlo pegando el ID en las llamadas de la app.

**Qué debe pasar:**
- Con un presupuesto **de Madrid**: todo funciona.
- Con un presupuesto **de Melilla**: responde "no encontrado" (404) o vacío. No
  se ve su conversación, ni su historial, ni se genera un enlace de portal, ni
  se puede cambiar su estado.

**Por qué:** cada ruta que recibe un ID de presupuesto ahora comprueba que ese
presupuesto sea de una clínica del usuario antes de devolver o modificar nada.

---

## Escenario 4 — Un admin no gestiona usuarios/clínicas del otro cliente

**Qué hacer:**
1. Entra como `Admin RB (piloto)` → Ajustes → Clínica y equipo.
2. Revisa la lista de usuarios y de clínicas.
3. Intenta crear una coordinadora y asignarla a una clínica que **no** sea de
   RB (si el desplegable lo permitiera, o forzando el ID).
4. Intenta editar o "regenerar PIN" de un usuario de INDEP (por su ID).

**Qué debe pasar:**
- La lista muestra **solo** usuarios y clínicas de RB.
- Crear/asignar a una clínica ajena → error "no pertenece a tu organización".
- Editar o regenerar el PIN de un usuario de INDEP → "no encontrado" (404). Un
  admin de RB **no** puede obtener un PIN válido de un usuario del otro cliente.

**Por qué:** la base de Identidad (usuarios/clínicas) es compartida, así que
estas rutas comprueban el cliente en cada operación.

---

## Escenario 5 — El Copiloto no filtra datos de otras clínicas

**Qué hacer:**
1. Entra como `Coord Melilla (piloto)`. Abre el Copiloto.
2. Pregúntale: "¿cuánto se ha facturado este mes?", "enséñame las llamadas
   recientes", y "mensajes recientes del presupuesto X" (usando un ID de otra
   clínica si lo tienes).

**Qué debe pasar:**
- El facturado y las llamadas salen **solo de las clínicas de Melilla**, no de
  toda la red RB.
- Los mensajes de un presupuesto de otra clínica → vacío.

**Por qué:** se cerraron tres herramientas del Copiloto que devolvían datos de
todas las clínicas (facturado global, llamadas sin filtro, mensajes sin
comprobar propiedad).

---

## Chequeo de regresión (que lo bueno siga funcionando)

Como `Admin RB` y como `Coord Melilla`, dentro de Presupuestos:
- El **panel de notificaciones** carga sin error (antes daba error de servidor).
- La pestaña de **Automatizaciones** (configuración, secuencias) carga sin error.
- Activar **notificaciones push** no da error de servidor.
- Crear/editar/mover presupuestos, registrar contactos y clasificar respuestas
  siguen funcionando **para las clínicas propias**.

> Nota: el módulo **No-Shows** está intencionadamente en pausa en este sprint
> (devuelve error controlado, sin fuga de datos). No forma parte de este QA.

---

## Resultado

- [ ] Escenario 1 (cliente vs cliente) — OK / fallo: ____
- [ ] Escenario 2 (clínica vs clínica) — OK / fallo: ____
- [ ] Escenario 3 (IDOR por ID) — OK / fallo: ____
- [ ] Escenario 4 (gestión de usuarios) — OK / fallo: ____
- [ ] Escenario 5 (Copiloto) — OK / fallo: ____
- [ ] Regresión (features vivas) — OK / fallo: ____

Si los 6 salen OK en el preview, la rama está lista para merge a producción.
