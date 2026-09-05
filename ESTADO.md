# ESTADO.md

Dónde está Fyllio hoy, en una pantalla. Se lee al abrir sesión y se regenera al cerrarla.

> **Esto es derivado, nunca fuente.** Todo lo de aquí vive con su detalle en otro archivo y se
> resume enlazando. **Si algo solo existe en ESTADO.md, está en el sitio equivocado** — muévelo
> a su documento y déjalo aquí como una línea.
>
> Se genera leyendo [`MEJORAS-PENDIENTES.md`](MEJORAS-PENDIENTES.md) ·
> [`MERCADO.md`](MERCADO.md) · [`DECISIONES.md`](DECISIONES.md) ·
> [`REUNION-RB-DENTAL.md`](REUNION-RB-DENTAL.md) · [`PLAN-AGENTE.md`](PLAN-AGENTE.md) ·
> [`CONSULTA-LEGAL-AGENTE.md`](CONSULTA-LEGAL-AGENTE.md).

**Regenerado:** 5 de septiembre de 2026.

---

## Ahora mismo

**Hoy (5 sep): auditoría profunda del agente y su resolución en el mismo día.** Detalle en las
tres entradas del 2026-09-05 de [`DECISIONES.md`](DECISIONES.md); cada hallazgo, en
[MEJORAS 117-155](MEJORAS-PENDIENTES.md) con severidad y esfuerzo.

| Qué se cerró | Dónde |
|---|---|
| **Nada se pierde en la entrada**: lote entero de Meta, todos los tipos (audio, foto, documento, botón), dedup en base y KV marcado después de persistir, `maxDuration` en el webhook | 034 · `webhooks/whatsapp` · MEJORAS 117-118, 129 |
| **Un solo borrador**: composer y chat embebido enseñan el del evaluador; el de entrada solo en el relevo; veto determinista en los dos; la coincidencia se mide contra ese texto | `lib/agente/borrador-agente` · MEJORAS 119 |
| **Estados que se pudrían**: coletilla del cobro una vez, botón «Respondido», insistencia desde el último resuelto, espera fuera de tope visible | MEJORAS 120, 121, 123, 124 |
| **Fallos que nadie veía**: avisos en la campana + filtro y banda «Sin evaluar» | `lib/agente/avisos` · MEJORAS 128 |
| **Opt-out con una fuente** y detección conversacional | `lib/contacto/optout` · MEJORAS 135 |
| Idioma, rangos de config, inyección delimitada + tanda I del eval, caso 35 a código, señales del hilo, panel de descartes del juez | MEJORAS 136-138, 149-151 |

**Lección nueva en el skill de ingeniería (§21):** se verifica lo que el usuario VE, no lo que el
pipeline produce. Dos veces se midió un artefacto que no era el producto.

**QA en verde:** parseo · conocimiento · tipos · bandeja · ficha · turno · tanda I 4/4 ·
casos 16/6 10/10 en cinco corridas. Gasto de modelo de la sesión: $0,08 (`evals/pasadas/GASTO.md`).

### Decisiones abiertas que esperan a Simon (recomendación escrita en DECISIONES 2026-09-05)

1. **Hilo por clínica en redes** (MEJORAS 122) — recomendado: hilo único por persona, mensajes
   etiquetados por clínica.
2. **Rojo eterno por queja/insistencia** (125) — recomendado: cierre por dos hechos + edad visible.
3. **Teléfono compartido** (139) — recomendado: guarda de ambigüedad, nunca `limit 1`.
4. **Caso 49 del eval** (152) — recomendado: mantener A y retirar el R de la vara.

### Lo que no se toca sin el abogado

[`CONSULTA-LEGAL-AGENTE.md`](CONSULTA-LEGAL-AGENTE.md): lo que viaja a Anthropic (anonimización
que no anonimiza), retención y borrado, transparencia de IA (MEJORAS 108), consentimiento y
menores. Una página, con lo que costaría cada respuesta.

### Pendiente de comprobar a mano

- **Fluid Compute en Vercel**: el token del CLI local está caducado y no se pudo leer la
  configuración del proyecto. `maxDuration = 60` en el webhook cubre cualquier plan; confirmar en
  Settings → Functions.
- **Transcripción de audio** (MEJORAS 153): decisión aparte, con coste por minuto y otro proveedor
  de salud hablada.

---

## Bloqueado (sin cambio conocido desde el 12 de agosto)

| Qué | Por qué | Lo desbloquea |
|---|---|---|
| Piloto con datos reales de RB | Sin art. 28 y NDA firmados no se toca un dato de paciente | Firma de ambas partes |
| Consulta legal · Reglamento de IA + los cuatro puntos de la auditoría | La fórmula de transparencia condiciona el catálogo de Meta; la retención condiciona el borrado | Simon: asesoría jurídica |
| Enviar las 11 plantillas a Meta | Cuenta de Meta Business con NIF → alta fiscal | Alta fiscal + consulta legal |
| Piloto real por WhatsApp (fase 0 de [`PLAN-AGENTE.md`](PLAN-AGENTE.md)) | Sin registro fiscal no hay verificación de empresa ni número real | Alta fiscal + email de dominio propio |

---

## Próximos tres hitos

1. **Las cuatro decisiones de arriba** — cada una tiene recomendación y coste; ninguna pasa de un día.
2. **Consulta legal** con [`CONSULTA-LEGAL-AGENTE.md`](CONSULTA-LEGAL-AGENTE.md) — bloquea el
   catálogo de Meta y el borrado.
3. **Arranque del piloto** — condición: RB, art. 28, NDA, alta fiscal.

---

## Hipótesis abiertas esperando validación

Once, en [`MERCADO.md` §4](MERCADO.md). Las de la reunión de RB (H2, H3, H4, H5, H7, H8, H10, H11)
y las del piloto (H1, H6, H9). H9 sigue condicionando el texto de las plantillas y ahora también la
fórmula de transparencia: hay que medirlas por separado.

---

## Pendientes que no son código

De [`REUNION-RB-DENTAL.md` §9](REUNION-RB-DENTAL.md): contrato art. 28, NDA, alta fiscal, dominio
propio, carga de pacientes y doctores de RB, censo de teléfonos (`npm run qa:telefonos`) antes de
cualquier envío, plantillas de cobranza de RB, teléfonos del seed al rango reservado.

---

## Salud del repo

| | |
|---|---|
| Rama | `main`, limpia y al día |
| Migraciones | hasta la **034** aplicadas; `qa:tipos` al día (21 tablas declaradas) |
| Tipos | `tsc` en verde |
| QA determinista | `qa:parseo` · `qa:conocimiento` en verde |
| QA con base | `qa:bandeja` · `qa:ficha` · `qa:turno` en verde; `qa:entrante` 4/4 en el orquestador (sus 2 rojos: el interruptor del seed está encendido en DEMO y el QA espera apagado) |
| Eval del evaluador | 95 % estable en la última pasada completa (22-08); hoy medido solo lo tocado (tanda I 4/4, 16/6 10/10). Una pasada completa cuesta ~$0,35 |
| MEJORAS | 155 entradas · las 117-155 de la auditoría: 17 hechas 🟢 · 2 parciales · 20 abiertas 🔵 |
| Lint | limpio en los archivos nuevos; los `any` que quedan en `webhooks/whatsapp` y `mensajeria.ts` son anteriores |
