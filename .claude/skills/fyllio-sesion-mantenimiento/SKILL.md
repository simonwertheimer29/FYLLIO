---
name: fyllio-sesion-mantenimiento
description: Rutina de revisión y mantenimiento preventivo de Fyllio bajo demanda. Úsalo cuando Simon pida una "sesión de mantenimiento", "revisa X zona", "qué está flojo aquí", "pasa revisión", "limpieza" o cualquier petición de auditoría técnica de una zona del producto sin una tarea concreta que hacer. Detecta problemas pequeños antes de que se vuelvan críticos y los deja ordenados por severidad — nunca los arregla sin aprobación.
---

# Sesión de mantenimiento

Rutina para cazar lo pequeño antes de que se vuelva caro. **No es una auditoría completa**
(esa ya existe) ni un sprint de arreglos: es una pasada acotada por una zona del producto que
termina en una **lista priorizada**, no en código.

**Regla que no se rompe:** detectar y proponer siempre; **arreglar solo lo que Simon apruebe
en el momento**. Es el mismo protocolo del skill `fyllio-esencia-producto` §6. Una sesión de
mantenimiento que acaba con 40 archivos tocados sin permiso es un fallo, no un éxito.

## 1. Antes de empezar: acotar

Pregunta (o infiere de la petición) **qué zona** se revisa: un módulo (Leads, Presupuestos,
Copilot, Automatizaciones), una capa (rutas de API, componentes), o "lo que se tocó
últimamente". **Nunca "todo el repo"** — una sesión sin límite produce ruido, no valor.

Si la zona no está clara, pregunta antes de recorrer nada.

## 2. Qué buscar

Recorre la zona con estas lentes, en este orden de importancia:

1. **Fiabilidad** (lo más caro si explota): fallos silenciosos (catch vacío, create que falla
   sin avisar), estados que no persisten, condiciones de carrera, cosas que confirman éxito
   antes de guardar. Cruza con el skill `fyllio-lecciones-ingenieria` — si algo viola una
   lección ya pagada, es prioritario.
2. **Coherencia**: patrones paralelos nacientes (una segunda forma de hacer algo que ya está
   resuelto), duplicación que empieza, componentes casi-iguales. Cruza con el catálogo de
   "olores" del skill `fyllio-esencia-producto` §6.
3. **Producto**: incumplimientos de los principios (promesas que no se cumplen, acciones sin
   feedback, jerga en superficie de coordinadora, pasos de más).
4. **Visual**: incumplimientos del skill `fyllio-estandar-visual` (hex a mano, emojis como
   iconos, errores disfrazados de éxito, roto en oscuro o en móvil).
5. **Higiene técnica**: tipos flojos (`any` evitables), imports muertos, código inalcanzable,
   TODOs viejos, dependencias sin usar.

**Verifica antes de reportar.** No reportes de oídas ni por patrón: abre el código, confirma
el problema, y cita `archivo:línea`. Un hallazgo sin evidencia no se reporta. (Lección
propia: el `sleep` del cron parecía un bug y era correcto.)

## 3. Qué entregar

Una lista **ordenada por severidad**, no un ensayo. Por hallazgo:

- **Qué es** (una frase) + `archivo:línea`.
- **Severidad**: 🔴 crítico (pierde datos, rompe algo vivo, riesgo de seguridad) · 🟠 alto
  (incumple un principio en zona del piloto) · 🟡 medio · ⚪ higiene.
- **Qué propones** (accionable, una frase).
- **Esfuerzo estimado** (minutos / horas / días).

Después de la lista, **una recomendación explícita**: cuáles arreglarías ahora y por qué.
Simon decide.

## 4. Qué hacer con lo no aprobado

Todo lo que no se apruebe en el momento se anota en **`MEJORAS-PENDIENTES.md`** (mismo
archivo y formato que la lente de auditoría: zona · qué · severidad · propuesta · esfuerzo ·
fecha · estado 🔵). No dupliques entradas ya existentes; si un hallazgo ya está, actualiza su
severidad si ha empeorado.

## 5. Límites

- **Cero arreglos sin aprobación**, ni siquiera "los triviales de paso". El diff de una sesión
  de mantenimiento sin aprobación es **cero líneas**.
- **No refactorices** para dejarlo bonito. Proponer, no ejecutar.
- **No inventes trabajo.** Si la zona está bien, dilo en dos líneas y termina. "No encontré
  nada relevante" es un resultado válido y valioso.
- Si algo requiere decisión de producto (cómo debería comportarse un flujo), **no lo decidas**:
  se pregunta a Simon.
- Reporta conciso, en lenguaje llano (Simon no es técnico de formación). El detalle técnico
  va en el `archivo:línea`, no en la explicación.
