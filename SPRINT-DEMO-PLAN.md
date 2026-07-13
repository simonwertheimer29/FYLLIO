# Plan — Login: autosubmit del PIN + tenant DEMO aislado

Rama: `sprint-login-rediseno`. **Nada implementado aún** — esto es para tu OK.

---

## 1. PIN — volver al autosubmit (sin botón)

**Cómo era antes:** cada pantalla conocía la longitud del PIN (clínica = 4 dígitos, admin = 6), así que el envío automático al completar el último dígito era trivial.

**El matiz nuevo:** en el login por email, cuando tecleas el PIN **aún no sabemos si eres coordinación (4) o admin (6)** — eso se decide al validar. Y no podemos "mirar" la longitud antes de teclear, porque eso revelaría qué emails son de administrador (fuga de información que el diseño de error genérico evita a propósito).

**Solución propuesta (recomendada):**
- **Usuario recordado en el dispositivo** (el caso de cada día): ya guardamos su longitud de PIN del último acceso → autosubmit instantáneo al llegar a esa longitud. Cero fricción.
- **Primera vez en un dispositivo** (una vez por aparato): autosubmit a los **4 dígitos**, y si sigues tecleando hasta 6 (admin), autosubmit a los 6. Se implementa con una pausa mínima: si tras el 4º dígito llega un 5º enseguida, se espera al 6º; si te paras, envía a los 4. Un admin tecleando del tirón nunca dispara el intento a 4.
- Se **elimina el botón "Entrar"**. El rate-limit que añadí se mantiene igual.

Efecto: teclado numérico idéntico al de antes, y el PIN se envía solo al completar el último dígito, como pediste — funcionando tanto para 4 como para 6 sin delatar el rol.

---

## 2. Tenant DEMO — aislamiento

**Confirmado: el aislamiento del Sprint B aplica igual a DEMO, por el mismo mecanismo fail-closed.**

- `DEMO` ya está enrutado a la base antigua (`AIRTABLE_BASE_ID`) en el código (`airtable.ts`). Ni RB ni INDEP.
- El acceso a datos de negocio (`base()`) resuelve la base **estrictamente por el cliente de la sesión** y **lanza** si no hay cliente en contexto. No existe ningún camino por el que una sesión `DEMO` toque la base de RB o de INDEP: es el mismo candado que aísla RB de INDEP. Un usuario DEMO ⇒ solo base DEMO. Un usuario RB/INDEP ⇒ nunca ve datos DEMO.
- **Único cambio de código necesario** (aditivo, no debilita nada): hoy el lector de usuarios acepta `Cliente = RB | INDEP` y convierte cualquier otro valor (incluido `DEMO`) en "sin cliente" → un usuario DEMO no podría ni entrar (fail-closed). Hay que **añadir `DEMO`** a ese lector. Nada más. Los candados fail-closed siguen intactos.

Las cuentas DEMO entran por **el mismo login seguro** (email + PIN + rate-limit). No hay bypass ni puerta trasera: son usuarios normales cuyo `Cliente` es `DEMO`.

---

## 3. Datos ficticios — cómo los cuadro

**Hallazgo decisivo:** un **admin ve TODA la base**, no solo las clínicas registradas de su cliente. Es decir, `demo@fyllio.com` (admin) vería, bajo la vista "Todas", **también los datos demo antiguos** que arrastra esa base — que apuntan a clínicas del modelo viejo y quedarían como registros huérfanos/incoherentes. Por eso **no vale con añadir datos nuevos y dejar los viejos**: hay que hacer re-seed limpio.

Es seguro hacerlo: esa base antigua ya **solo** es alcanzable por el tenant DEMO nuevo; las rutas legacy que la usaban (`/api/db`, `/api/dashboard`, la demo vieja) están fail-closed y bloqueadas en producción — borrar datos ahí **no rompe ninguna ruta viva**.

**Plan de datos (re-seed limpio, idempotente, todo etiquetado `[SEED_DEMO]`):**
1. **Clínicas DEMO** en el registro central con nombres propios que no chocan con los viejos: `Clínica Demo Centro`, `Clínica Demo Norte`, `Clínica Demo Sur`, `Clínica Demo Este` (Cliente=DEMO).
2. **Espejo de esos nombres** en la tabla local de clínicas de la base DEMO (necesario para que los enlaces por nombre funcionen).
3. **Limpieza de lo viejo** en la base DEMO: se vacían los datos de negocio antiguos (pacientes/presupuestos/leads/pagos) para que la vista "Todas" del admin quede coherente. Solo datos ficticios de una base demo/dev; rutas muertas.
4. **Siembra coherente** enlazada a las 4 clínicas DEMO, para que ninguna pantalla salga vacía:
   - **Pacientes** (enlazados a su clínica DEMO por nombre).
   - **Presupuestos** en varios estados (Presentado/Interesado/En negociación/Aceptado/Perdido) con importe y paciente → llena Presupuestos, Actuar hoy y KPIs de presupuestos.
   - **Leads** en varios estados → llena Leads y Actuar hoy.
   - **Acciones_Lead** y **Pagos_Paciente** → para que los KPIs de Leads y de Cobros no salgan en cero.
5. **Reparto entre cuentas** (para probar autorizaciones):
   - `demo@fyllio.com` (admin) → ve las 4 clínicas DEMO y todos sus datos.
   - `demo-coord4@fyllio.com` (coordinación) → junction a las 4 clínicas DEMO.
   - `demo-coord1@fyllio.com` (coordinación) → junction a 1 clínica (p. ej. Clínica Demo Centro). Sirve para ver que **solo** ve la suya.

**Resultado:** cada registro enlaza a una clínica DEMO real; cero datos colgando; las tres cuentas muestran exactamente lo que su rol/clínicas permiten.

---

## 4. PINs — hasheados, no hardcodeados

- Los PIN de las 3 cuentas se guardan **bcrypt-hasheados** en la tabla de usuarios (igual que el resto del sistema).
- **No van literales en el repo.** El script de seed lee el PIN de una **variable de entorno** al ejecutarse (p. ej. `DEMO_ADMIN_PIN`, `DEMO_COORD_PIN`) y guarda solo el hash. Tú eliges un PIN simple al sembrar; nunca queda escrito en el código ni en git.

---

## 5. Qué se toca (resumen técnico)

- **1 cambio de producto** (aditivo): aceptar `Cliente=DEMO` en el lector de usuarios.
- **PIN autosubmit**: cambio en la pantalla de login (rama actual), sin tocar backend ni rate-limit.
- **1 script de seed nuevo** (`app/scripts/demo-seed.ts`), idempotente, con `--dry` (simular), `--wipe` (limpiar lo viejo) y `--clean` (borrar solo `[SEED_DEMO]`). Los scripts no corren en producción; los ejecuto yo contra la base DEMO con tu OK.
- **Verificación**: tras sembrar, compruebo que una sesión DEMO solo lee la base DEMO y que un coord DEMO de 1 clínica no ve las otras.

---

## Reversibilidad
El re-seed es sobre datos ficticios de una base demo. `--clean` borra solo lo etiquetado `[SEED_DEMO]`. El cambio de código (aceptar DEMO) y el del PIN son reversibles por git. Producción (RB/INDEP) no se toca en ningún momento.
