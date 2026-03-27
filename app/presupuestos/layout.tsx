// app/presupuestos/layout.tsx
// Oculta el navbar raíz de Fyllio — el módulo presupuestos tiene su propio header.

export default function PresupuestosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`body > header { display: none !important; }`}</style>
      {children}
    </>
  );
}
