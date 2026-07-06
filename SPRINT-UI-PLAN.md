# Sprint UI — Plan de pulido visual

**Rama:** `sprint-ui-pulido` · **Punto de retorno:** tag `pre-sprint-ui` (así se ve hoy, recuperable siempre) · **Producción no cambia hasta tu OK.**

Objetivo: pasar de "se ve bien" a "parece que llevan años en el sector". No es un rediseño: es una pasada de consistencia y pulido sobre el sistema que ya existe.

---

## A. Paleta propuesta

Un solo azul de acento en toda la app (hoy conviven 3 azules distintos + violeta). Azul clínico sereno, algo desaturado — confianza médica, no SaaS ruidoso.

### Tema claro

| Nombre | Hex | Para qué |
|---|---|---|
| Papel | `#FAFBFC` | Fondo general (el actual, se mantiene) |
| Tinta | `#101623` | Texto principal |
| Tinta suave | `#5A6478` | Texto secundario (el actual) |
| Trazo | `#E5E8EE` | Bordes y divisores (el actual) |
| **Azul clínico** | `#3D6FB2` | **El acento único**: botones, enlaces, tabs activos, foco |
| Azul bruma | `#EDF3FA` | Fondos suaves de acento (badges, hovers, selección) |

### Tema oscuro

| Nombre | Hex | Para qué |
|---|---|---|
| Noche | `#0E1116` | Fondo general |
| Superficie | `#161A21` | Tarjetas y paneles |
| Tinta clara | `#E8EBF0` | Texto principal |
| Tinta suave | `#9AA3B2` | Texto secundario |
| Trazo oscuro | `#262C36` | Bordes y divisores |
| **Azul clínico claro** | `#7CA9DC` | El mismo acento, aclarado para leerse sobre oscuro |

**Semánticos (iguales en ambos temas, ajustando tono):** éxito = esmeralda (`#059669`, el verde WhatsApp ya formalizado), aviso = ámbar (`#D97706`), error = rosa intenso (`#E11D48`). Hoy conviven dos vocabularios (green/red viejo vs emerald/rose nuevo); se unifica al nuevo.

**Contraste:** el azul clínico da ~5:1 sobre blanco y el claro ~7:1 sobre noche — ambos cumplen WCAG AA para texto normal.

### El violeta del Copilot

El violeta desaparece como segunda marca (hoy hay 400+ usos, muchos decorativos). Propuesta para la señal "IA":

- **Identidad = icono**, no color: el icono lucide `Sparkles` (✦) siempre que algo es IA — botón, badge, FAB.
- **Tratamiento**: degradado sutil dentro del azul (`#3D6FB2 → #5B8BC9`) solo en el FAB del Copilot y botones primarios de IA; badges "IA" en azul bruma con el icono. Es un "brillo" del mismo azul, no un color aparte.

## B. Escala tipográfica

Las fuentes ya están (Geist para títulos/números, Inter para el resto). Lo que falta es usarlas con intención — hoy los KPIs van de 20px a 48px según la pantalla.

| Uso | Fuente | Tamaño | Peso |
|---|---|---|---|
| Número KPI | Geist | 36px, cifras tabulares | Bold |
| Título de página (H1) | Geist | 20px | Semibold |
| Título de sección/tarjeta | Geist | 16px | Semibold |
| Cuerpo / tablas / botones | Inter | 14px | Regular (Medium para énfasis) |
| Secundario | Inter | 13px | Regular |
| Etiquetas (labels KPI, cabeceras tabla) | Inter | 11px MAYÚSCULAS, tracking amplio | Medium |

Interletrado ligeramente negativo en títulos y KPIs (ya activado en `.font-display`). Nada de font-black ni extrabold sueltos: dos pesos por familia, usados igual en todas partes.

## C. Inventario de pantallas a tocar

Orden de trabajo: primero la fundación (1), luego lo que multiplica (2), luego pantalla a pantalla (3). Cada pantalla verificada en claro y oscuro.

### 1. Fundación (afecta a todo)
- `globals.css` — tokens completos claro+oscuro (colores, radios, sombras, tipografía); toggle de tema con preferencia recordada; foco visible; `prefers-reduced-motion`.
- `layout.tsx` — quitar colores hardcodeados del `<body>`.

### 2. Transversal (los multiplicadores)
- **KpiCard único**: hoy hay **8 implementaciones distintas** (no 6) — se consolidan todas en `ui/KpiCard`.
- **Iconos lucide en toda la app**: sustituir ~40 archivos con emojis-como-UI (📞 💬 ✓ 🔴 ⚠️ 🎉…) — la mayor fuente de "sensación prototipo".
- **Modal + toast propios**: eliminar los 14 `alert()`/`confirm()` nativos (Ajustes, cancelar cita, "¿Enviar WhatsApp a…?").
- **Errores honestos**: ~10 vistas donde un fallo de red parece "todo bien" (el peor: Cobros muestra 🎉 "Sin pendientes" cuando falla la carga). Patrón: mensaje claro + botón reintentar.
- **Banners de demo/infra**: ~12 banners que mencionan Vercel/variables de entorno, reescritos sin jerga técnica.
- **Copy**: tildes ("pestanas"→"pestañas", "apareceran aqui"→"aparecerán aquí"…), enums crudos visibles ("confirmacion cita"), casing consistente.

### 3. Pantalla a pantalla
| Pantalla | Qué se hace |
|---|---|
| **Llamadas** | Es la referencia; retoques: columna Paciente con nombre (hoy muestra trozo de ID), tipos de llamada legibles, quitar mención a "Sprint 17" |
| **Presupuestos** (kanban + tabs) | Unificar visualmente el kanban; quitar el campo "ID Presupuesto (rec...)" → selector normal; arrastre táctil en móvil |
| **Leads** (kanban) | Arrastre táctil; completar KPIs visualmente (incluye arreglar un gradiente roto en el embudo) |
| **Copilot** | Del violeta al sistema azul + identidad `Sparkles` |
| **Login** (selector + PIN) | Reestilizado solo apariencia — lógica PIN intacta |
| **Actuar hoy / KPIs / Pacientes / Alertas / Automatizaciones / Red** | Pasada de consistencia: tokens, KpiCard único, iconos, estados |
| **No-shows** (8 tabs) | Migrar su paleta propia (cyan/green/red) al sistema; ocultar tabs "(legacy)" de admin |
| **Portal público del paciente** | Misma pasada (lo ve el paciente final — importa) |
| **PWA** | Manifest real + iconos propios desde el isotipo (los actuales son de 1×1 píxel) — instalable en el móvil de la coordinadora |

**Fuera de esta pasada** (sin rediseño, solo que no se rompan): landing `/`, `/early-access`, `/demo` y `/dashboard` demo — son marketing/demo, no el producto que usan las clínicas. Si quieres que entren, dímelo.

## Cómo verás el resultado

- Todo en la rama `sprint-ui-pulido` → Vercel te da una URL de preview automática por rama para comparar contra producción.
- Un commit por cambio coherente, con una frase en cristiano de qué cambió; capturas antes/después por área cuando aporte.
- `tsc --noEmit` + `next build` limpios antes de cada commit. Cero cambios de lógica: solo apariencia.
