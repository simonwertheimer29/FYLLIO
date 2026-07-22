# FASE D acotada — Preview de Vercel sobre Supabase (Production intacta)

**Objetivo:** que el entorno **Preview** de Vercel corra sobre Postgres/Supabase (para
demos), dejando **Production 100% en Airtable, sin tocar**. El flag `DATA_BACKEND` vive
en variables de entorno; Vercel no lee tu `.env.local`, así que hay que ponerlas en
Vercel **con scope Preview**.

Regla de oro: **todas las variables de abajo se ponen SOLO en el entorno _Preview_**
(en el dashboard de Vercel: Settings → Environment Variables → marcar únicamente
"Preview", NO "Production"). Production no cambia y sigue en Airtable.

---

## 1. Variables a AÑADIR en Vercel (scope: solo Preview)

| Variable | Valor | Notas |
|---|---|---|
| `SUPABASE_DB_URL_APP` | *(el mismo valor que tienes en tu `.env.local`)* | Pooler transaction-mode (puerto **6543**), rol `fyllio_app`. Es la conexión de runtime de la app a Postgres. |
| `DATA_BACKEND_PG_DOMINIOS` | `agenda,alertas,automatizaciones,cola-envios,configuraciones,identidad,informes,leads,mensajes,notificaciones,pacientes,pagos,plantillas-mensaje,presupuestos,push,vapi` | Los **15 dominios de negocio + `identidad`**. Sacado del código (todos los `usaPostgres("…")` + el flag de identidad). Si falta uno, ese dominio se queda en Airtable en el preview. |
| `DATA_BACKEND_PG_CLIENTES` | `RB,INDEP,DEMO` | Los 3 clientes. (En local corrimos exactamente esto.) |

Con estas 3, el Preview enruta **toda** la superficie a Postgres.

## 2. Variables que YA deben existir en Preview (verificar, no cambiar)

El Preview siempre ha funcionado sobre Airtable, así que estas probablemente ya están
en "All Environments". **Verifica que estén disponibles en Preview** (si están marcadas
solo como "Production", añádelas también a Preview):

- **Airtable** (se siguen usando como fallback de cualquier acceso no volteado y para
  que `base()` no falle): `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_BASE_CENTRAL`
  (+ las base-ids de RB/INDEP si son variables aparte).
- **Sesión/login**: el secreto de firma de sesión (JWT) — sin él, el login no arranca.
- **Supabase analítica (Sprint 18)**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  (predictor de no-shows). Intactas.
- **Opcionales**: KV del rate-limit (si falta, el limiter degrada a memoria — el login
  sigue), `VAPID_*` (push).

## 3. Variables que NO se ponen en Vercel (ni Preview ni Production)

- `SUPABASE_DB_URL_ADMIN` — conexión admin (bypassa RLS). **Solo migraciones/seed en tu
  máquina.** El guard de CI la prohíbe fuera de scripts; nunca en runtime.
- `FYLLIO_APP_DB_PASSWORD` — solo para que el migrador fije el password del rol. No runtime.

---

## 4. Requisitos del deploy

- **La rama del Preview debe tener el código del volteo** (rama `migracion-postgres`).
  Empuja esa rama → Vercel construye un Preview → con las vars de arriba → corre sobre
  Supabase. (Al hacer merge a `main` en el futuro, Production tendrá el código pero **sin
  el flag** → sigue en Airtable. El código volteado es inerte sin el flag.)
- **El proyecto Supabase ya está sembrado** (esquema + RLS + DEMO negocio + identidad de
  los 3 clientes). El Preview corre contra ese estado.

## 5. Refrescar los datos de demo (antes de cada demo)

El estado de demo se regenera con (en tu máquina, contra el mismo Supabase):
```
npm run demo:reset            # Airtable DEMO (fuente)
node scripts/db-seed-demo.mjs # copia DEMO negocio → Postgres
node scripts/db-seed-identidad.mjs  # identidad (usuarios/clínicas/junction) → Postgres
```

## 6. Verificar que el Preview corre sobre Supabase

1. Entra al Preview y haz login (email+PIN) con una cuenta demo → debe entrar leyendo de
   Postgres (identidad). PINs: RB admin `111111`, INDEP admin `222222`, coords `0000`;
   DEMO según `DEMO_ADMIN_PIN`/`DEMO_COORD_PIN`.
2. Abre Presupuestos / Agenda → los datos son los del seed de Postgres.
3. (Opcional) confirma que Production sigue en Airtable: entra a producción, nada cambió.

## 7. Cuello de botella conocido: pooler

En local, con muchas conexiones concurrentes, el pooler transaction-mode saturó (se vio
en los harnesses). Para **demos** (pocos usuarios) el plan Free probablemente basta. Si
notas timeouts de conexión en el Preview bajo uso, ahí entra el **plan Pro** (sube el
límite del pooler). Para el corte de Production, Pro sigue siendo prerequisito.

---

**Qué necesito de ti:** poner las 3 variables de §1 en Vercel con scope **Preview**, y
verificar §2. No hace falta nada más de código — el volteo ya está en la rama. Avísame si
quieres que prepare un preview deploy concreto o que verifique algo tras ponerlas.
