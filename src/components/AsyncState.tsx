import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { useOptionalI18n } from '../features/i18n/I18nContext';

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const i18n = useOptionalI18n();
  return (
    <section className="state-card" role="alert">
      <div className="state-icon state-icon--error" aria-hidden="true">
        <Icon name="alert" />
      </div>
      <h2>{i18n?.t('common.errorTitle') ?? 'We could not load this information'}</h2>
      <p>{error.message}</p>
      {onRetry && (
        <button className="button button--secondary" onClick={onRetry}>
          {i18n?.t('common.tryAgain') ?? 'Try again'}
        </button>
      )}
    </section>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="state-card">
      <div className="state-icon" aria-hidden="true">
        <Icon name="inbox" />
      </div>
      <h2>{title}</h2>
      <div className="muted">{children}</div>
      {action}
    </section>
  );
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  const i18n = useOptionalI18n();
  return (
    <div
      className="skeleton-list"
      aria-label={i18n?.t('common.loadingLabel') ?? 'Loading'}
      aria-busy="true"
    >
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-row" key={index} />
      ))}
    </div>
  );
}
