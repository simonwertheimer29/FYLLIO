# Fyllio

CRM vertical para clínicas dentales. Ordena el flujo del paciente antes de ser paciente
(lead → presupuesto → conversión) y evita que se pierda lo que ya está en marcha.

## Documentos vivos

Los cuatro se mantienen a mano y hay que leerlos antes de tocar su terreno:

| Documento | Qué guarda | Cuándo se escribe |
|---|---|---|
| [`MERCADO.md`](MERCADO.md) | **Por qué** el producto tiene sentido: fundamentos, evidencia de conversaciones reales, interpretaciones, hipótesis con su estado y preguntas abiertas | Después de cada conversación con una clínica |
| [`DECISIONES.md`](DECISIONES.md) | **Qué** se decidió y qué se arregló: bugs importantes, decisiones de arquitectura, hallazgos cerrados | En el mismo cambio que cierra el asunto |
| [`MEJORAS-PENDIENTES.md`](MEJORAS-PENDIENTES.md) | Lo detectado y **no** aprobado todavía. Nada de aquí se ejecuta sin el visto bueno del fundador | Al detectar algo fuera del alcance de la tarea |
| [`AUDITORIA_FABLE.md`](AUDITORIA_FABLE.md) | La auditoría técnica de julio de 2026 y su tabla de fiabilidad (S1-S12) | Congelado; es referencia histórica |

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
