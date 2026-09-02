import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '../components/AsyncState';
import { PageHeader } from '../components/PageHeader';
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
import { recurrenceLabel, useI18n } from '../features/i18n/I18nContext';

export function BenefitsPage() {
  const { language, t } = useI18n();
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
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
    if (!active && !window.confirm(t('benefits.deactivateConfirm'))) return;
    try {
      setActionError(null);
      await setBenefitActive(definitionId, active);
      result.refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t('benefits.updateError'));
    }
  }

  async function toggleRecurrence(definitionId: string, enabled: boolean) {
    if (!enabled && !window.confirm(t('benefits.recurrenceConfirm'))) return;
    try {
      setActionError(null);
      await setRecurrenceEnabled(definitionId, enabled);
      result.refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t('benefits.recurrenceError'));
    }
  }

  async function removeDraft(definitionId: string) {
    if (!window.confirm(t('benefits.deleteConfirm'))) return;
    try {
      setActionError(null);
      await deleteBenefitDraft(definitionId);
      result.refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : t('benefits.deleteError'));
    }
  }

  if (result.error) return <ErrorState error={result.error} onRetry={result.refresh} />;
  if (result.loading) return <SkeletonRows count={5} />;
  const definitions = result.data?.definitions ?? [];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={t('benefits.eyebrow')}
        title={t('benefits.title')}
        description={t('benefits.description')}
        action={
          <Link className="button button--primary" to="/benefits/new">
            {t('common.addBenefit')}
          </Link>
        }
      />
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
          title={t('benefits.emptyTitle')}
          action={
            <Link className="button button--primary" to="/benefits/new">
              {t('benefits.addFirst')}
            </Link>
          }
        >
          {t('benefits.emptyBody')}
        </EmptyState>
      ) : (
        <section className="definition-list" aria-label={t('benefits.definitions')}>
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
                        {definition.active ? t('benefits.active') : t('benefits.inactive')}
                      </span>
                    </div>
                    <p className="muted">
                      {definition.category} ·{' '}
                      {definition.recurrence_enabled
                        ? recurrenceLabel(
                            definition.recurrence_type,
                            definition.recurrence_basis,
                            t,
                          )
                        : t('benefits.oneTime')}{' '}
                      · {t('benefits.revision')} {definition.current_revision_no}
                    </p>
                    {definition.origin_template_version_id && (
                      <p className="muted">
                        {t('benefits.standardCatalogTemplate')} v
                        {definition.origin_template_version}
                        {definition.customized_at
                          ? t('benefits.customized')
                          : t('benefits.unchanged')}{' '}
                        · {t('benefits.termsZone')} {definition.terms_timezone}
                      </p>
                    )}
                    {definition.description && <p>{definition.description}</p>}
                  </div>
                </div>
                <dl className="definition-stats">
                  <div>
                    <dt>{t('benefits.currentValue')}</dt>
                    <dd>
                      {current
                        ? formatQuantity(current.available_quantity, {
                            valueKind: current.value_kind,
                            currency: current.currency,
                            unitLabel: current.unit_label,
                            locale,
                          })
                        : t('benefits.noPeriod')}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('benefits.currentPeriod')}</dt>
                    <dd>
                      {current
                        ? `${formatDate(current.period_start, locale)} – ${formatDate(current.period_end, locale)}`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>{t('benefits.history')}</dt>
                    <dd>
                      {livePeriods.length}{' '}
                      {t(livePeriods.length === 1 ? 'benefits.livePeriod' : 'benefits.livePeriods')}
                      {auditVersions.length
                        ? ` · ${auditVersions.length} ${t(
                            auditVersions.length === 1
                              ? 'benefits.auditVersionCount'
                              : 'benefits.auditVersions',
                          )}`
                        : ''}
                    </dd>
                  </div>
                </dl>
                <div className="definition-actions">
                  {current && (
                    <Link className="text-link" to={`/instances/${current.instance_id}`}>
                      {t('benefits.viewPeriod')}
                    </Link>
                  )}
                  <Link
                    className="button button--secondary button--small"
                    to={`/benefits/${definition.id}/edit`}
                  >
                    {t('benefits.editRules')}
                  </Link>
                  {definition.recurrence_enabled && (
                    <button
                      className="text-button"
                      onClick={() => void toggleRecurrence(definition.id, false)}
                    >
                      {t('benefits.disableRecurrence')}
                    </button>
                  )}
                  {!definition.recurrence_enabled && definition.recurrence_type !== 'one_time' && (
                    <button
                      className="text-button"
                      onClick={() => void toggleRecurrence(definition.id, true)}
                    >
                      {t('benefits.enableRecurrence')}
                    </button>
                  )}
                  <button
                    className={`text-button ${definition.active ? 'text-button--danger' : ''}`}
                    onClick={() => void toggleActive(definition.id, !definition.active)}
                  >
                    {definition.active ? t('benefits.deactivate') : t('benefits.reactivate')}
                  </button>
                  <button
                    className="text-button text-button--danger"
                    onClick={() => void removeDraft(definition.id)}
                  >
                    {t('benefits.deleteDraft')}
                  </button>
                </div>
                {periods.length > 0 && (
                  <details className="period-history">
                    <summary>{t('benefits.periodHistory')}</summary>
                    <div className="period-history-list">
                      {periods
                        .sort(
                          (a, b) =>
                            b.period_start.localeCompare(a.period_start) ||
                            b.instance_version - a.instance_version,
                        )
                        .map((instance: BenefitInstance) => {
                          const versionLabel = instance.is_audit_version
                            ? `${t('benefits.voidAuditVersion')} ${instance.instance_version}`
                            : instance.supersedes_instance_id
                              ? `${t('benefits.liveVersionSupersedes')} ${instance.instance_version} · ${t('benefits.supersedesPrior')}`
                              : t(
                                  instance.usage_status === 'used'
                                    ? 'status.used'
                                    : instance.usage_status === 'partial'
                                      ? 'status.partial'
                                      : 'status.unused',
                                );
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
                                  ? t('benefits.supersededReplacement')
                                  : ''}
                              </span>
                              <span>
                                {formatQuantity(instance.remaining_quantity, {
                                  valueKind: instance.value_kind,
                                  currency: instance.currency,
                                  unitLabel: instance.unit_label,
                                  locale,
                                })}{' '}
                                {t('common.remaining')}
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
