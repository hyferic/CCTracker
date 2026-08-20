export function LoadingScreen({ label = 'Loading your benefits…' }: { label?: string }) {
  return (
    <main className="loading-screen" aria-busy="true" aria-live="polite">
      <div className="brand-mark">P</div>
      <div className="loading-line" aria-hidden="true" />
      <p>{label}</p>
    </main>
  );
}
