const capabilities = [
  ['Admin shell', 'Ready for Phase 2'],
  ['API contracts', 'Versioned at /api/v1'],
  ['Observability', 'Correlation IDs enabled'],
  ['Business modules', 'Intentionally not started'],
] as const;

export function FoundationPanel() {
  return (
    <section className="foundation-panel">
      <h2>Platform foundation</h2>
      <p>
        The administrative application is wired into the shared monorepo toolchain. Authentication
        and marketplace operations begin only after this foundation passes its acceptance suite.
      </p>
      <div className="status-grid">
        {capabilities.map(([title, status]) => (
          <div className="status-card" key={title}>
            <strong>{title}</strong>
            <span>{status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
