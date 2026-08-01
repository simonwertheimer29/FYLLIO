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

**Regenerado:** 1 de agosto de 2026.

---

## Ahora mismo

**Sesión del 31 jul – 1 ago cerrada: pasada visual completa y reconciliación de cifras hecha.**
Nació de una revisión externa que recorrió producción sección por sección; el detalle de cada
cierre está en [`DECISIONES.md`](DECISIONES.md).

| Qué | Estado |
|---|---|
| El crash de Automatizaciones → Operativo | ✅ y con él la causa de fondo: **no había ni una frontera de error** en toda la app (ahora 15) |
| El dinero de `/red` cambiaba entre dos F5 | ✅ el umbral pasa de ventana rodante a **días de calendario de la clínica** |
| "Una tarjeta que desaparece" | ✅ no era avería: el filtro de clínica persiste. Ahora se **declara en las 8 pantallas** que lo siguen |
| La gráfica de 6 meses, plana el día 1 | ✅ [MEJORAS 88](MEJORAS-PENDIENTES.md) — pre-existente, cazado al cambiar de mes |
| Las 02:00 de `/llamadas` | ✅ el dato era correcto; fallaba el render. Cerrada la **última familia de MEJORAS 52** |
| `/alertas` no decía el dinero | ✅ y de paso murió su cálculo paralelo de cobros |
| Las "cuatro cifras que no cuadran" | ✅ censadas: **cero errores de cálculo**, tres definiciones legítimas |

**La pasada visual pantalla por pantalla está TERMINADA:** `/red` · `/kpis` · `/presupuestos` ·
`/cobros` · `/pacientes` · `/leads` · `/llamadas` · `/alertas` · `/seguimiento`.

### En cola, ya aprobado, para después de la reunión

- **Fusión de `/automatizaciones` + `/ajustes`** ([MEJORAS 13](MEJORAS-PENDIENTES.md)) — hay dos
  centros de ajustes. Propuesta escrita y aprobada; **1-2 días**. Su paso 1 es unificar los dos
  editores de plantillas, que es el único con riesgo de dato: censo hecho en
  [MEJORAS 74](MEJORAS-PENDIENTES.md). El layout ya está en tokens (era lo único urgente).
- **`/informes` como pantalla propia** ([MEJORAS 81](MEJORAS-PENDIENTES.md)).
- **El resto del informe externo**, que es flujo y no fallos: KPIs clicables, modo cola en el
  drawer, paginación de Pacientes ([MEJORAS 87](MEJORAS-PENDIENTES.md), sin priorizar).

---

## 🔴 Bloqueante de la demo — lo único que impide enseñarla

**El código no bloquea nada.** Lo que falta es de montaje, y la reunión es la semana del 3.

| Qué | Por qué bloquea | Quién |
|---|---|---|
| **El tenant de RB, montado** con sus diez clínicas y sus dos marcas | Es el **acto V del guion** ("esto es lo suyo"), y el guion dice que ese acto **no se recorta nunca**. Sin él la demo termina en datos inventados en vez de en una propuesta | Simon, antes del 3 de agosto |
| **`npm run demo:reset` el mismo día** | Ancla las fechas a "hoy". Sin él, la demo envejece y las comparativas del mes salen raras | Simon, el mismo día |
| **Los doctores de RB dados de alta** en Postgres | `staff` está vacía en las bases piloto: el selector de doctor sale vacío. El guion manda avisarlo antes de que lo vean, pero es mejor que no pase | Simon |

**No bloquean la demo, pero conviene saberlo antes de entrar:**

- **Sin dominio propio** — la URL es un `.vercel.app` con hash. Es lo primero que se ve.
- **`npm run verificar:produccion` sigue sin poder correr**: falta `FYLLIO_COOKIE`. Es la única
  comprobación que mira el entorno desplegado de verdad; todo lo verificado esta sesión ha sido
  contra el build de producción **en local**.
- **Los teléfonos del seed** no están en el rango reservado +34 600 000 xxx.
- **`/automatizaciones` y `/llamadas` no se enseñan** (guion §6). Llamadas ya lo dice en pantalla
  desde hoy; Automatizaciones no.

---

## Bloqueado (más allá de la demo)

| Qué | Por qué | Lo desbloquea |
|---|---|---|
| Piloto con datos reales de RB | Sin art. 28 y NDA firmados no se toca un dato de paciente | Firma de ambas partes |

---

## Próximos tres hitos

1. **Reunión con RB Dental** — semana del **3 de agosto de 2026**. Es la fecha que manda: ocho
   de las once hipótesis abiertas se tocan ahí. Preguntas y checklist previo en
   [`REUNION-RB-DENTAL.md`](REUNION-RB-DENTAL.md); cómo se enseña el producto, en
   [`guion-demo-fyllio.md`](guion-demo-fyllio.md).
2. **Fusión de ajustes + `/informes`** — condición: que pase la reunión. Ambas aprobadas y con
   propuesta escrita.
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
| Fronteras de error | **15** (13 secciones + grupo + global) |
| Aviso de filtro de clínica | en las **8** pantallas que siguen al selector |
| Deuda de `?? []` | **15**, y el trinquete solo deja bajar (`npm run qa:sin-fallbacks`) |
| QA verde | `qa:fechas` **52/52** en 4 husos · `qa:cohortes` · `qa:estado-conversacion` · `qa:sin-fallbacks` · **`qa-dashboard-red`** (paridad + días 1/2/15) · `demo:reset` con 4 invariantes |
| QA de /kpis | 18/18 (`npm run qa:kpis`, necesita el server en :3100) |
| MEJORAS | 88 entradas · **64 abiertas** 🔵 · 30 hechas 🟢 · 19 cerradas ✅ · 4 descartadas ⚪ |
| Migraciones | 011 · 012 · 013 (visto hoy) aplicadas |
| Sin verificar en producción | Ver Bloqueado. Lo de hoy sí se verificó en navegador real contra el build de producción |
