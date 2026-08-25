import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '../components/AsyncState';
import { formatDate } from '../domain/dates';
import { formatQuantity } from '../domain/money';
import { useAsync } from '../hooks/useAsync';
import {
  deleteBenefitDraft,
  listDefinitions,
  listInstances,
  setBenefitActive,
  setRecurrenceEnabled,
} from '../services/api';
import type { BenefitInstance } from '../types';

export function BenefitsPage() {
  const location = useLocation();
  const result = useAsync(async () => {
    const [definitions, instances] = await Promise.all([
      listDefinitions(),
      listInstances({ includeAuditVersions: true }),
    ]);
    return { definitions, instances };
  });
  const flash = (location.state as { message?: string } | null)?.message;
  const [actionError, setActionError] = useState<string | null>(null);

  async function toggleActive(definitionId: string, active: boolean) {
    if (
      !active &&
      !window.confirm(
        'Deactivate this benefit? History stays available, but reminders and dashboard actions are suppressed.',
      )
    )
      return;
    try {
      setActionError(null);
      await setBenefitActive(definitionId, active);
      result.refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Could not update this benefit.');
    }
  }

  async function toggleRecurrence(definitionId: string, enabled: boolean) {
    if (
      !enabled &&
      !window.confirm(
        'Disable recurrence? Current and historical periods stay, while unused future periods are voided.',
      )
    )
      return;
    try {
      setActionError(null);
      await setRecurrenceEnabled(definitionId, enabled);
      result.refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Could not update recurrence.');
    }
  }

  async function removeDraft(definitionId: string) {
    if (
      !window.confirm(
        'Permanently delete this unreferenced future draft? Anything with current/history activity must be deactivated instead.',
      )
    )
      return;
    try {
      setActionError(null);
      await deleteBenefitDraft(definitionId);
      result.refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Could not delete this draft.');
    }
  }

  if (result.error) return <ErrorState error={result.error} onRetry={result.refresh} />;
  if (result.loading) return <SkeletonRows count={5} />;
  const definitions = result.data?.definitions ?? [];

  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">Definitions & history</p>
          <h2>Manage benefit rules.</h2>
          <p className="muted">
            Definitions describe the rules. Every recurring period stays separate so edits never
            erase usage history.
          </p>
        </div>
        <Link className="button button--primary" to="/benefits/new">
          + Add benefit
        </Link>
      </section>
      {flash && (
        <div className="alert alert--success" role="status">
          {flash}
        </div>
      )}
      {actionError && (
        <div className="alert alert--danger" role="alert">
          {actionError}
        </div>
      )}
      {!definitions.length ? (
        <EmptyState
          title="No benefit definitions yet"
          action={
            <Link className="button button--primary" to="/benefits/new">
              Add your first benefit
            </Link>
          }
        >
          Add a fixed credit, cashback offer, points benefit, membership, or custom value.
        </EmptyState>
      ) : (
        <section className="definition-list" aria-label="Benefit definitions">
          {definitions.map((definition) => {
            const periods = (result.data?.instances ?? []).filter(
              (instance) => instance.definition_id === definition.id,
            );
            const livePeriods = periods.filter((instance) => instance.is_live);
            const auditVersions = periods.filter((instance) => instance.is_audit_version);
            const current =
              livePeriods.find((instance) => instance.lifecycle_status === 'active') ??
              livePeriods.find((instance) => instance.lifecycle_status === 'upcoming') ??
              livePeriods[0];
            return (
              <article
                className={`definition-card ${!definition.active ? 'definition-card--inactive' : ''}`}
                key={definition.id}
              >
                <div className="definition-main">
                  <div className="definition-icon" aria-hidden="true">
                    {definition.category.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div className="definition-title-row">
                      <h2>{definition.name}</h2>
                      <span
                        className={`status ${definition.active ? 'status--success' : 'status--neutral'}`}
                      >
                        {definition.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="muted">
                      {definition.category} ·{' '}
                      {definition.recurrence_enabled
                        ? `${definition.recurrence_type} · ${definition.recurrence_basis}`
                        : 'One-time'}{' '}
                      · revision {definition.current_revision_no}
                    </p>
                    {definition.origin_template_version_id && (
                      <p className="muted">
                        Standard catalog template v{definition.origin_template_version}
                        {definition.customized_at ? ' · customized' : ' · unchanged'} · terms zone{' '}
                        {definition.terms_timezone}
                      </p>
                    )}
                    {definition.description && <p>{definition.description}</p>}
                  </div>
                </div>
                <dl className="definition-stats">
                  <div>
                    <dt>Current value</dt>
                    <dd>
                      {current
                        ? formatQuantity(current.available_quantity, {
                            valueKind: current.value_kind,
                            currency: current.currency,
                            unitLabel: current.unit_label,
                          })
                        : 'No period'}
                    </dd>
                  </div>
                  <div>
                    <dt>Current period</dt>
                    <dd>
                      {current
                        ? `${formatDate(current.period_start)} – ${formatDate(current.period_end)}`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>History</dt>
                    <dd>
                      {livePeriods.length} live period{livePeriods.length === 1 ? '' : 's'}
                      {auditVersions.length
                        ? ` · ${auditVersions.length} audit version${auditVersions.length === 1 ? '' : 's'}`
                        : ''}
                    </dd>
                  </div>
                </dl>
                <div className="definition-actions">
                  {current && (
                    <Link className="text-link" to={`/instances/${current.instance_id}`}>
                      View current period
                    </Link>
                  )}
                  <Link
                    className="button button--secondary button--small"
                    to={`/benefits/${definition.id}/edit`}
                  >
                    Edit rules
                  </Link>
                  {definition.recurrence_enabled && (
                    <button
                      className="text-button"
                      onClick={() => void toggleRecurrence(definition.id, false)}
                    >
                      Disable recurrence
                    </button>
                  )}
                  {!definition.recurrence_enabled && definition.recurrence_type !== 'one_time' && (
                    <button
                      className="text-button"
                      onClick={() => void toggleRecurrence(definition.id, true)}
                    >
                      Re-enable recurrence
                    </button>
                  )}
                  <button
                    className={`text-button ${definition.active ? 'text-button--danger' : ''}`}
                    onClick={() => void toggleActive(definition.id, !definition.active)}
                  >
                    {definition.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                  <button
                    className="text-button text-button--danger"
                    onClick={() => void removeDraft(definition.id)}
                  >
                    Delete draft
                  </button>
                </div>
                {periods.length > 0 && (
                  <details className="period-history">
                    <summary>Period history</summary>
                    <div className="period-history-list">
                      {periods
                        .sort(
                          (a, b) =>
                            b.period_start.localeCompare(a.period_start) ||
                            b.instance_version - a.instance_version,
                        )
                        .map((instance: BenefitInstance) => {
                          const versionLabel = instance.is_audit_version
                            ? `Void audit · version ${instance.instance_version}`
                            : instance.supersedes_instance_id
                              ? `Live · version ${instance.instance_version} · supersedes prior`
                              : instance.usage_status;
                          const versionTone = instance.is_audit_version
                            ? 'danger'
                            : instance.supersedes_instance_id
                              ? 'partial'
                              : instance.usage_status;
                          return (
                            <Link
                              key={instance.instance_id}
                              to={`/instances/${instance.instance_id}`}
                              title={instance.void_reason ?? undefined}
                            >
                              <span>
                                {instance.period_label}
                                {instance.superseded_by_instance_id
                                  ? ' · superseded by replacement'
                                  : ''}
                              </span>
                              <span>
                                {formatQuantity(instance.remaining_quantity, {
                                  valueKind: instance.value_kind,
                                  currency: instance.currency,
                                  unitLabel: instance.unit_label,
                                })}{' '}
                                remaining
                              </span>
                              <span className={`mini-status mini-status--${versionTone}`}>
                                {versionLabel}
                              </span>
                            </Link>
                          );
                        })}
                    </div>
                  </details>
                )}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
