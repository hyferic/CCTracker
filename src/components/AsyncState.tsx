import type { ReactNode } from 'react';
import { Icon } from './Icon';

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <section className="state-card" role="alert">
      <div className="state-icon state-icon--error" aria-hidden="true">
        <Icon name="alert" />
      </div>
      <h2>We could not load this information</h2>
      <p>{error.message}</p>
      {onRetry && (
        <button className="button button--secondary" onClick={onRetry}>
          Try again
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
  return (
    <div className="skeleton-list" aria-label="Loading" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-row" key={index} />
      ))}
    </div>
  );
}
