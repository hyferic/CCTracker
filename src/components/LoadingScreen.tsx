import { useOptionalI18n } from '../features/i18n/I18nContext';

export function LoadingScreen({ label }: { label?: string }) {
  const i18n = useOptionalI18n();
  return (
    <main className="loading-screen" aria-busy="true" aria-live="polite">
      <div className="brand-mark">P</div>
      <div className="loading-line" aria-hidden="true" />
      <p>{label ?? `${i18n?.t('common.loading') ?? 'Loading'}…`}</p>
    </main>
  );
}
