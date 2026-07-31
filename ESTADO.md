# ESTADO.md

Dónde está Fyllio hoy, en una pantalla. Se lee al abrir sesión y se regenera al cerrarla.

> **Esto es derivado, nunca fuente.** Todo lo de aquí vive con su detalle en otro archivo y se
> resume enlazando. **Si algo solo existe en ESTADO.md, está en el sitio equivocado** — muévelo
> a su documento y déjalo aquí como una línea.
>
> Se genera leyendo [`MEJORAS-PENDIENTES.md`](MEJORAS-PENDIENTES.md) ·
> [`MERCADO.md`](MERCADO.md) · [`DECISIONES.md`](DECISIONES.md) ·
> [`REUNION-RB-DENTAL.md`](REUNION-RB-DENTAL.md) ·
> [`guion-demo-fyllio.md`](guion-demo-fyllio.md).

**Regenerado:** 31 de julio de 2026.

---

## Ahora mismo

**Cerrados los dos bloqueantes de la revisión externa de producción** (recorrido completo con
Claude for Chrome, sección por sección). Detalle en [`DECISIONES.md`](DECISIONES.md), 31 jul:

| Qué | Estado |
|---|---|
| El crash de Automatizaciones → Operativo | ✅ arreglado, y con él la causa de fondo: **no había ni una frontera de error** en toda la app |
| El dinero de `/red` cambiaba entre dos F5 | ✅ el umbral de reactivación pasa de ventana rodante a **días de calendario de la clínica** |
| "Una tarjeta que desaparece" en `/red` | ✅ no era una avería: el filtro de clínica persiste y retira "Tus clínicas". Ahora se **declara en pantalla** |
| El seed escribía valores fuera del union | ✅ invariante D en `demo:reset` — la que evita la cuarta vez |

**Sigue abierta la pasada visual pantalla por pantalla.** Método: diagnóstico primero, reportar,
esperar aprobación, después ejecutar.

| Pantalla | Estado |
|---|---|
| `/presupuestos` · `/kpis` · `/red` · `/cobros` · `/pacientes` · `/leads` | ✅ hechas |
| `/llamadas` | ⬅ **siguiente** (sube de última a primera: es la que peor imagen da) |
| `/automatizaciones` + `/ajustes` · `/alertas` · `/seguimiento` | pendientes, en ese orden |

Los tres bloques de trabajo que quedan del plan de esta sesión, sin empezar:

- **Bloque 2 — `/llamadas`**: fuera del contenedor estándar, "Coste mes" cortado, columna Paciente
  sin nombres, fechas a las 02:00 (familia de [MEJORAS 52](MEJORAS-PENDIENTES.md)) y coste en
  dólares. *(La columna "Tipo" vacía ya está cerrada: era el mismo bug que el crash.)*
- **Bloque 3 — `/automatizaciones` + `/ajustes` juntos**: hay **dos centros de ajustes**
  ([MEJORAS 13](MEJORAS-PENDIENTES.md)). Es arquitectura de información: se tocan juntos o es
  trabajo doble. Proponer la fusión antes de ejecutar.
- **Bloque 4 — `/alertas`** y **Bloque 5 — reconciliación de cifras** (Tablero 28 vs Tabla 44,
  67 % vs 86 %, 6 aceptados vs 14…): censar qué es definición legítima y qué es bug, como se hizo
  con la tasa de aceptación.

Aparte y ya aprobada, en su propia tanda: **`/informes` como pantalla propia**
([MEJORAS 81](MEJORAS-PENDIENTES.md)).

---

## Bloqueado

| Qué | Por qué | Lo desbloquea |
|---|---|---|
| `npm run verificar:produccion` | Falta `FYLLIO_COOKIE`. `FYLLIO_URL` y `FYLLIO_BYPASS` ya están | Simon |
| El cierre de la demo de RB | El tenant de RB tiene que estar montado con sus diez clínicas y sus dos marcas. Sin él, el último acto del guion —"esto es lo suyo"— no existe | Montarlo antes del 3 de agosto |
| Piloto con datos reales de RB | Sin art. 28 y NDA firmados no se toca un dato de paciente | Firma de ambas partes |

---

## Próximos tres hitos

1. **Reunión con RB Dental** — semana del **3 de agosto de 2026**. Es la fecha que manda: ocho
   de las once hipótesis abiertas se tocan ahí. Preguntas y checklist previo en
   [`REUNION-RB-DENTAL.md`](REUNION-RB-DENTAL.md); cómo se enseña el producto, en
   [`guion-demo-fyllio.md`](guion-demo-fyllio.md).
2. **Cerrar la pasada visual** — condición: las cuatro pantallas que quedan, en el orden de
   arriba. Sin fecha; va por tandas aprobadas una a una.
3. **Arranque del piloto** — condición: que RB diga que sí, más los seis pendientes de
   onboarding de abajo. Fecha a fijar en la propia reunión.

---

## Hipótesis abiertas esperando validación

Once, todas en [`MERCADO.md` §4](MERCADO.md). Lo que las cierra:

| Se cierran en la reunión de RB | Necesitan datos del piloto |
|---|---|
| **H2** motor universal · **H3** tratamiento en pausa · **H4** captación vs cartera · **H5** estándar/premium · **H7** convivir con el PMS · **H8** el panel es el foso, no ser capa · **H10** precio 89-149 €/mes · **H11** decide gerencia, mata la coordinadora | **H1** dinero recuperado vs pago único · **H6** el tratamiento predice el no-show · **H9** el mensaje neutro convierte igual |

Refutadas y por qué, en la misma sección: **R1** (el 52% salía del seed de DEMO) y **R2** (los
9.000 de Madrid eran dentistas colegiados, no clínicas).

---

## Pendientes que no son código

De [`REUNION-RB-DENTAL.md` §9](REUNION-RB-DENTAL.md), que es la lista viva:

- [ ] **Contrato art. 28 RGPD** firmado — bloqueante, antes de tocar un dato real.
- [ ] **NDA con RB** — bloqueante.
- [ ] **Alta de los doctores de RB** en Postgres: `staff` está vacía en las bases piloto y el
      selector de doctor saldría vacío.
- [ ] **Plantillas de cobranza de RB** actualizadas a `{{pendiente}}`.
- [ ] **Teléfonos del seed de DEMO** al rango reservado +34 600 000 xxx.
- [ ] **Dominio propio** (`app.fyllio.com` o similar): una URL de Vercel con hash no se enseña
      a un cliente.

Y uno que salió de la investigación de mercado y sí es de producto, pero decide Simon:
[MEJORAS 83](MEJORAS-PENDIENTES.md) — nuestras plantillas de ejemplo nombran tratamiento e
importe en el mismo WhatsApp, que es dato de salud del art. 9.

---

## Salud del repo

| | |
|---|---|
| Rama | `main`, limpia y al día con `origin` |
| Fronteras de error | **15** (13 secciones + grupo + global) — antes: cero |
| Deuda de `?? []` | **16**, y el trinquete solo deja bajar (`npm run qa:sin-fallbacks`) |
| QA verde | `qa:fechas` 39/39 en 4 husos · `qa:cohortes` · `qa:estado-conversacion` · `qa-dashboard-red` (paridad) · `qa:sin-fallbacks` · `demo:reset` con 4 invariantes |
| QA de /kpis | 18/18 (`npm run qa:kpis`, necesita el server en :3100) |
| MEJORAS | 87 entradas · **66 abiertas** 🔵 · 27 hechas 🟢 · 19 cerradas ✅ · 4 descartadas ⚪ |
| Sin verificar en producción | Ver Bloqueado. Lo de hoy sí se verificó en navegador real contra el build de producción |
