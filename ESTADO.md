# ESTADO.md

Dónde está Fyllio hoy, en una pantalla. Se lee al abrir sesión y se regenera al cerrarla.

> **Esto es derivado, nunca fuente.** Todo lo de aquí vive con su detalle en otro archivo y se
> resume enlazando. **Si algo solo existe en ESTADO.md, está en el sitio equivocado** — muévelo
> a su documento y déjalo aquí como una línea.
>
> Se genera leyendo [`MEJORAS-PENDIENTES.md`](MEJORAS-PENDIENTES.md) ·
> [`MERCADO.md`](MERCADO.md) · [`DECISIONES.md`](DECISIONES.md) ·
> [`REUNION-RB-DENTAL.md`](REUNION-RB-DENTAL.md).

**Regenerado:** 31 de julio de 2026.

---

## Ahora mismo

**Pasada visual pantalla por pantalla**, aplicando el estándar visual y limpiando la deuda de
`?? []` de cada zona por el camino. Método: diagnóstico primero, reportar, esperar aprobación,
después ejecutar. Lo que se descubre de paso va a MEJORAS, nunca al diff.

| Pantalla | Estado |
|---|---|
| `/presupuestos` · `/kpis` | ✅ hechas |
| `/alertas` | ⬅ **siguiente**, diagnóstico primero |
| `/automatizaciones` · `/ajustes` · `/llamadas` · `/seguimiento` | pendientes, en ese orden |

Aparte y ya aprobada, en su propia tanda: **`/informes` como pantalla propia**
([MEJORAS 81](MEJORAS-PENDIENTES.md)) — hoy es una pantalla entera metida en un cajón de `/kpis`.

---

## Bloqueado

| Qué | Por qué | Lo desbloquea |
|---|---|---|
| `npm run verificar:produccion` | Falta `FYLLIO_COOKIE`. `FYLLIO_URL` y `FYLLIO_BYPASS` ya están | Simon |
| Guion de demo para la reunión de RB | `guion-demo-fyllio.md` no está en el repo y la reunión es la semana del 3 de agosto | Simon (aportarlo o decidir que se improvisa) |
| Fusionar `cuestiones-previas-piloto.md` en el guion de reunión | El archivo no está en el repo ni es accesible desde aquí | Simon (aportarlo) |
| Piloto con datos reales de RB | Sin art. 28 y NDA firmados no se toca un dato de paciente | Firma de ambas partes |

---

## Próximos tres hitos

1. **Reunión con RB Dental** — semana del **3 de agosto de 2026**. Es la fecha que manda: ocho
   de las once hipótesis abiertas se tocan ahí. Guion y checklist previo en
   [`REUNION-RB-DENTAL.md`](REUNION-RB-DENTAL.md).
2. **Cerrar la pasada visual** — condición: las cinco pantallas que quedan, en el orden de
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
| Deuda de `?? []` | **16**, y el trinquete solo deja bajar (`npm run qa:sin-fallbacks`) |
| QA de /kpis | 18/18 (`npm run qa:kpis`, necesita el server en :3100) |
| MEJORAS | 83 entradas · **62 abiertas** 🔵 · 27 hechas 🟢 · 19 cerradas ✅ · 4 descartadas ⚪ |
| Sin verificar en producción | Ver Bloqueado |
