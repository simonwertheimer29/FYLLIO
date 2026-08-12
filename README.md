# Fyllio

CRM vertical para clínicas dentales. Ordena el flujo del paciente antes de ser paciente
(lead → presupuesto → conversión) y evita que se pierda lo que ya está en marcha.

## Por dónde empezar

**[`ESTADO.md`](ESTADO.md)** — dónde está el proyecto hoy en una pantalla: qué se está
haciendo, qué está bloqueado, los próximos hitos, y qué falta que no es código. Es **derivado**:
resume y enlaza los documentos de abajo, nunca guarda nada en exclusiva. Se regenera al cerrar
cada sesión de trabajo.

## Documentos vivos

Se mantienen a mano y hay que leerlos antes de tocar su terreno:

| Documento | Qué guarda | Cuándo se escribe |
|---|---|---|
| [`MERCADO.md`](MERCADO.md) | **Por qué** el producto tiene sentido: fundamentos, evidencia de conversaciones reales, interpretaciones, hipótesis con su estado y preguntas abiertas | Después de cada conversación con una clínica |
| [`DECISIONES.md`](DECISIONES.md) | **Qué** se decidió y qué se arregló: bugs importantes, decisiones de arquitectura, hallazgos cerrados | En el mismo cambio que cierra el asunto |
| [`MEJORAS-PENDIENTES.md`](MEJORAS-PENDIENTES.md) | Lo detectado y **no** aprobado todavía. Nada de aquí se ejecuta sin el visto bueno del fundador | Al detectar algo fuera del alcance de la tarea |
| [`PLANTILLAS-WHATSAPP.md`](PLANTILLAS-WHATSAPP.md) | Las **once plantillas** que Fyllio envía por WhatsApp, con su texto, sus variables, la cadencia que las usa y qué conversación abre cada una. Ninguna nombra tratamiento ni importe (art. 9 RGPD) y todas tutean, que es decisión de producto y no un ajuste. **Escritas, revisadas y sin enviar a aprobación**: enviarlas exige la cuenta de Meta verificada, que depende del alta fiscal | Cuando cambie una cadencia o Meta rechace una |
| [`PLAN-AGENTE.md`](PLAN-AGENTE.md) | **Qué se construiría** en la capa de automatización si se decide: cinco fases con qué se espera ver y cómo se pone a prueba, más el anexo de WhatsApp Business API. **Plan de producto, no hoja de ruta comprometida** — cada fase requiere aprobación; hoy solo la 0 y la 1 están decididas | Cuando cambie el plan o se apruebe una fase |
| [`PLAN-AGENTE-OFENSIVO.md`](PLAN-AGENTE-OFENSIVO.md) | **Cómo se comporta** el agente: de reactivo (sabe callarse) a orientado a objetivo (sabe qué persigue), y lo que arrastra en mensajería, seguimiento y configuración. **Plan de producto, no hoja de ruta comprometida.** Sus fases A-F corren en modo A, así que no esperan a Meta | Cuando cambie el modelo del agente |
| [`REUNION-RB-DENTAL.md`](REUNION-RB-DENTAL.md) | El guion de la reunión con el cliente piloto: qué preguntar, en qué orden, qué hipótesis cierra cada pregunta, y los pendientes de onboarding | Antes de cada reunión, y el mismo día después |
| [`guion-demo-fyllio.md`](guion-demo-fyllio.md) | Cómo se enseña el producto: el hilo narrativo, qué pantalla en qué orden, qué NO se enseña y qué responder a las preguntas que van a hacer | Cuando cambie el producto que se demuestra |
| [`AUDITORIA_FABLE.md`](AUDITORIA_FABLE.md) | La auditoría técnica de julio de 2026 y su tabla de fiabilidad (S1-S12) | Congelado; es referencia histórica |

Y las **investigaciones externas**, que son fotos fechadas y **no se editan** — cuando haya
investigación nueva se añade otro archivo y el anterior se queda como está:

| Archivo | Qué es |
|---|---|
| [`INVESTIGACION-MERCADO-2026-07.md`](INVESTIGACION-MERCADO-2026-07.md) | Investigación de mercado de julio de 2026: Gesden y su integración, competencia, WhatsApp y RGPD, canal de entrada. Mezcla datos verificados, afirmaciones comerciales de terceros y recomendaciones **no aprobadas** — lo que de ahí pasó a ser conocimiento nuestro está volcado en `MERCADO.md` separando evidencia de interpretación |

Y los **documentos visuales de discusión**, que se abren en el navegador. **No son specs, no forman
parte de la aplicación y no se compilan**: viven en [`docs/`](docs/), fuera de `app/` y de `public/`,
así que Next ni los sirve ni los mete en el bundle. Nada de ellos se implementa sin decisión
explícita en `DECISIONES.md`:

| Archivo | Qué es |
|---|---|
| [`docs/arquitectura-agente-quiebre.html`](docs/arquitectura-agente-quiebre.html) | Dónde trabaja el agente y dónde entra la persona, etapa por etapa del embudo: qué hace solo, qué dispara el quiebre y los seis disparadores universales |
| [`docs/arquitectura-app-automatizacion.html`](docs/arquitectura-app-automatizacion.html) | La reorganización de la app por función (Pipeline · Tablas · Seguimiento · Pacientes) y la máquina de estados de automatización de un caso |

`MERCADO.md` **no gobierna cómo se construye** — para eso están los skills de
[`.claude/skills/`](.claude/skills/). Documenta por qué lo que se construye tiene sentido.
Tiene una **regla de higiene que no se salta**: todo lleva fuente y fecha, y los datos del
seed de DEMO **nunca** cuentan como evidencia de mercado (son inventados). Ya se cometió ese
error una vez y por eso existe la regla.

---

Proyecto [Next.js](https://nextjs.org) creado con [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
