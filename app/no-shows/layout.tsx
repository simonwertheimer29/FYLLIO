// app/no-shows/layout.tsx
// Oculta el navbar raíz de Fyllio — el módulo no-shows tiene su propio header.

export default function NoShowsLayout({
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
