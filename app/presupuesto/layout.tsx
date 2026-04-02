// app/presupuesto/layout.tsx
// Layout del portal público del paciente.
// Renderiza en fixed inset-0 z-[60] para tapar el header Fyllio (z-50) del root layout.
// El portal es completamente independiente del CRM — sin branding Fyllio.

export default function PresupuestoPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] bg-white overflow-auto">
      {children}
    </div>
  );
}
