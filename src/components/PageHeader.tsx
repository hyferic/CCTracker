import { useId, type ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className = '',
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const id = useId().replaceAll(':', '');
  const titleId = `page-title-${id}`;
  const descriptionId = description ? `page-description-${id}` : undefined;

  return (
    <section
      className={`page-header ${className}`.trim()}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="page-header-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={titleId}>{title}</h2>
        {description && (
          <p id={descriptionId} className="muted">
            {description}
          </p>
        )}
      </div>
      {action && <div className="page-header-actions">{action}</div>}
    </section>
  );
}
