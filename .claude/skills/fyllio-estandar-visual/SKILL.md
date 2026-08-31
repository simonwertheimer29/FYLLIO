---
name: fyllio-estandar-visual
description: Estándar visual y de UX de Fyllio (CRM dental). Úsalo SIEMPRE que crees, rediseñes, pulas o toques cualquier pantalla, componente o interfaz de Fyllio — aunque el usuario no pida "diseño" explícitamente. Cubre color, tipografía, iconos, estados, tono del texto y las reglas de "nunca". Aplícalo en cualquier tarea que produzca UI: nuevas vistas, rediseños, arreglos visuales, componentes, o cambios de estilo.
---

# Estándar visual de Fyllio

Fyllio es un CRM vertical para clínicas dentales. Lo usan coordinadoras (no técnicas)
durante horas al día, muchas veces en el móvil entre paciente y paciente. El objetivo de
diseño es que parezca software con años en el sector: limpio, tranquilo, coherente,
rápido y que transmita confianza (maneja datos de pacientes).

Estética de referencia: **Linear** — minimal, alta señal / poco ruido, bordes sutiles en
vez de sombras pesadas, mucho aire, un solo acento nítido, cero decoración que no aporte.

Regla mental antes de tocar nada: ¿esto se ve como una herramienta profesional que una
clínica pagaría, o se ve como un prototipo? Todo lo que "delata prototipo" (ver reglas de
"nunca") se elimina.

## 1. Color

**Acento único: azul clínico.** Un solo azul en toda la app. Sereno, algo desaturado —
confianza médica, no SaaS ruidoso.

- **Claro**: `#3D6FB2` (acento) · `#EDF3FA` (fondos suaves de acento: hovers, badges, pestaña activa)
- **Oscuro**: `#7CA9DC` (el mismo azul aclarado para leerse sobre fondo oscuro)

**REGLA DE ORO — nunca escribas el hex a mano.** Todo color referencia el token
`var(--color-accent)` (y los demás tokens de `globals.css`), que cambia solo entre claro y
oscuro. Escribir un hex directo en un componente rompe el modo oscuro y la consistencia.

**Un solo acento.** No reintroduzcas otros azules (sky, cyan) ni el violeta antiguo. El
violeta del Copilot desapareció como color; la IA se identifica con el azul + el icono de
chispas (ver §3).

**Colores semánticos** (mismos en ambos temas, ajustando tono vía tokens):

- Éxito = esmeralda (`#059669`). **Solo para decir que algo salió bien**, nunca para una acción.
  El verde de WhatsApp se retiró de los botones de enviar el 2026-08-11: venía del color de MARCA
  del canal, no de una decisión de diseño, y se leía como «éxito» cuando **enviar no es un éxito,
  es una acción** — y las acciones van con el acento. Queda el verde como icono de canal (el
  logotipo de WhatsApp en una lista), que sí es identidad y no acción.
- Aviso = ámbar (`#D97706`)
- Error = rosa intenso (`#E11D48`)

No uses el vocabulario viejo (green/red genéricos); usa siempre los semánticos vía token.

**Contraste (obligatorio):** cumple WCAG AA en ambos temas (texto normal ≥ 4.5:1). El azul
clínico da ~5:1 sobre blanco y el claro ~7:1 sobre oscuro.

## 2. Tipografía

Fuentes ya en el stack: **Geist** (títulos y números), **Inter** (todo lo demás). Úsalas con
intención — mismos tamaños y pesos en todas partes, no improvisar por pantalla.

| Uso | Fuente | Tamaño | Peso |
|---|---|---|---|
| Número KPI | Geist | 36px, cifras tabulares | Bold |
| Título de página (H1) | Geist | 20px | Semibold |
| Título de sección/tarjeta | Geist | 16px | Semibold |
| Cuerpo / tablas / botones | Inter | 14px | Regular (Medium para énfasis) |
| Secundario | Inter | 13px | Regular |
| Etiquetas (labels KPI, cabeceras de tabla) | Inter | 11px MAYÚSCULAS, tracking amplio | Medium |

- Interletrado ligeramente negativo en títulos y KPIs (`.font-display`).
- Dos pesos por familia como máximo. Nada de font-black / extrabold sueltos.
- Los números que se comparan (KPIs, tablas, importes) van en cifras tabulares.

## 2 bis. Escala de radios (decisión A/B del 2026-08-31, ganó B en todo)

**El criterio: el radio BAJA según sube la densidad del elemento.** Un bloque de 30 minutos
es bajo; con esquinas muy redondas pierde altura útil y se lee como pastilla en vez de como
franja de tiempo. La jerarquía por forma es **intencional, no decorativa**: la silueta dice
qué es cada cosa antes de leerla — dato casi recto, contenedor suave, píldora redonda. Un
solo radio para todo borra esa información.

| Tipo de elemento | Radio | Tailwind |
|---|---|---|
| **Dato denso**: bloques de cita, huecos, bloqueos, chips de dato en listas | 4 px | `rounded` |
| **Controles y campos**: botones, inputs, selects, tabs (contenedor), filas desplegables | 8 px | `rounded-lg` (interior de tabs: `rounded-md`) |
| **Contenedores**: tarjetas, paneles, modales, popovers, lienzos de rejilla | 12 px | `rounded-xl` |
| **Píldoras**: badges, chips de estado, leyendas, avatares | redondo | `rounded-full` |

Sin puntos intermedios (decisión explícita: controles a 8, no a 10). Al tocar una pantalla,
sus radios se ajustan a esta escala; `rounded-2xl`/`rounded-3xl` quedan fuera del vocabulario
salvo decisión nueva del fundador.

**La referencia de acabado es la agenda** (`/agenda`, iteración G2.x): densidad de dato,
contraste real entre estructura (líneas y ejes al 30–70 % de opacidad, etiquetas pequeñas en
mayúsculas con tracking) y contenido (bloques sólidos con texto claro encima, cifras
tabulares), controles a altura común con sombra sutil, y jerarquía tipográfica donde el
dato pesa y la estructura acompaña. La aplicación al resto del producto se hace por
diagnóstico y OK previos, no en silencio.

**Altura de controles — el matiz táctil (2026-08-31):** `h-9` (36 px) SOLO en toolbars densas
de escritorio (filtros, tabs, buscadores de pantallas tipo agenda/tablas). En las pantallas
que se usan con el pulgar (kanban, mensajería, seguimiento en móvil), los **controles
primarios** van a `h-10`/`h-11`: 36 px queda por debajo del objetivo táctil cómodo del §6 y
la densidad nunca justifica fallar un toque.

## 3. Iconos e identidad de IA

- **Un solo set: lucide.** Nunca emojis como UI (📞 💬 ✓ 🔴 ⚠️ 🎉…). Cada concepto, su
  icono lucide, igual en toda la app (un solo icono para teléfono, uno para WhatsApp, etc.).
- **Copilot / IA:** identidad = icono lucide `Sparkles` (chispas) + un "brillo" del azul
  (degradado sutil dentro del acento), nunca un color de marca aparte. Todo lo que sea IA
  (FAB, botón, badge "IA") lleva ese icono y ese tratamiento azul.

## 4. Estados: carga, vacío, error (honestidad)

- **Nunca un error disfrazado de éxito.** Un fallo de red o de servidor jamás debe parecer un
  estado vacío feliz (p. ej. "🎉 Sin pendientes" cuando en realidad la carga falló). Un error
  dice qué pasó y ofrece **Reintentar**.
- **Carga:** skeletons, no spinners a pantalla completa. La pantalla mantiene su forma
  mientras carga.
- **Vacío real (sin datos):** mensaje claro que invita a actuar ("Aún no hay presupuestos —
  crea el primero"), no un hueco en blanco.
- **Feedback de acciones:** un solo patrón de toast (sonner) en cada mutación. Un botón que
  dice "Enviar" produce un toast "Enviado". La pantalla de referencia de madurez es
  `LlamadasView` (Card + Skeleton + toast + drawer).

## 4 bis. Dónde va cada cosa en una pantalla de conversación

Regla fijada el 2026-08-11 en `/mensajeria`, y vale para cualquier pantalla con hilo:

> **El centro es SOLO el hilo de mensajes y la caja de escribir. Todo contexto,
> recomendación y aviso va a la columna lateral, sin excepciones.**

El «sin excepciones» es la parte que importa. Cada recuadro que se mete en el centro parece
razonable por su cuenta —la situación del caso, el aviso de que necesita criterio, una fila de
botones— y entre los tres empujan la conversación fuera de la pantalla. La pantalla existe para leer
lo que ha dicho un paciente y contestarle; lo demás acompaña.

Dos corolarios:

- **Un botón que lleva a donde ya estás, no va.** «Escribir» tenía sentido en un panel donde abría
  el compositor; en una pantalla donde el compositor ya está abierto debajo, es ruido.
- **Las acciones sobre la PERSONA van en la cabecera** (llamar, abrir su ficha), no en el cuerpo.
  Las acciones sobre el MENSAJE van en el compositor. Si una acción no es ninguna de las dos, casi
  siempre es contexto disfrazado de botón.

Y el orden de la columna lateral es **el de lo que decide antes**: primero qué pasa y si hace falta
criterio, después los datos de ficha. Un aviso enterrado bajo tres datos no es un aviso.

## 5. Tono del texto (copy)

El usuario es una coordinadora, no un ingeniero. El texto habla su idioma:

- **Nunca jerga técnica ni de infraestructura en pantalla:** nada de "trigger", "modo test",
  "endpoint", nombres tipo `lead_inactivo_n_dias`, ni menciones a Vercel / Airtable / sprints.
  Nombra las cosas por lo que el usuario controla, no por cómo está construido el sistema.
- **Nunca IDs internos a la vista** (nada de `rec...` de Airtable). Muestra nombres, no IDs.
- **Voz activa, sentence case, frases cortas.** Tildes y ortografía correctas siempre
  ("pestañas", "aparecerán aquí"), sin enums crudos ("confirmacion cita").

## 6. Móvil

Se usa en el móvil de la coordinadora. Cada pantalla que toques:

- Objetivos táctiles cómodos; se llega a todo con el pulgar.
- Los kanban se arrastran con el dedo (sensor táctil, no solo puntero).
- Instalable como app (manifest + iconos reales).
- Verifica el layout en móvil, no solo en escritorio.

## 7. Reglas de "nunca" (checklist final antes de dar por hecha una pantalla)

- ❌ Nunca un hex escrito a mano → siempre `var(--color-*)`.
- ❌ Nunca un segundo azul ni el violeta viejo → un solo acento.
- ❌ Nunca un color de marca de un tercero como color de acción (el verde de WhatsApp en un botón
  de enviar) → el acento. Un color de marca ajeno identifica un canal, no una acción nuestra.
- ❌ Nunca emojis como iconos → lucide.
- ❌ Nunca `alert()` / `confirm()` nativos del navegador → modal + toast propios.
- ❌ Nunca un error disfrazado de éxito → error honesto + reintentar.
- ❌ Nunca IDs internos (`rec...`) ni jerga técnica a la vista → nombres y lenguaje de usuario.
- ✅ Siempre verificado en claro y oscuro.
- ✅ Siempre verificado en móvil.
- ✅ Siempre reutilizando los primitivos existentes (Card, StatePill, Skeleton,
  KpiCard) — no crear variantes nuevas de algo que ya existe.

## 8. Cómo trabajar cuando aplicas este estándar

- Construye sobre el sistema que ya existe; no inventes componentes paralelos.
- Un commit por cambio coherente; `tsc --noEmit` + build limpios antes de commitear.
- Si un cambio visual parece exigir tocar lógica de datos/auth/aislamiento, cambia solo la
  apariencia y pregunta antes de tocar la lógica.
- Ante una decisión de gusto no cubierta aquí (un tono nuevo, una densidad), pregunta al
  fundador en vez de decidir por tu cuenta.
