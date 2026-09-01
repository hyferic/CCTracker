import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState, EmptyState, SkeletonRows } from '../components/AsyncState';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { formatDate } from '../domain/dates';
import { formatQuantity } from '../domain/money';
import { groupOutstanding, isOutstanding, type UrgencyGroup } from '../domain/dashboard';
import { useBusinessDate } from '../features/profile/ProfileContext';
import { useI18n, type MessageKey } from '../features/i18n/I18nContext';
import { useAsync } from '../hooks/useAsync';
import {
  confirmBenefitPeriodUsed,
  listAccounts,
  listInstances,
  markUncappedComplete,
  recordRedemption,
  reopenUncappedComplete,
  schedulerHealth,
} from '../services/api';
import type { Account, BenefitInstance } from '../types';

const groupLabels: Record<
  UrgencyGroup,
  | 'dashboard.dueSoon'
  | 'dashboard.thisMonth'
  | 'dashboard.thisQuarter'
  | 'dashboard.thisYear'
  | 'dashboard.noDeadline'
> = {
  soon: 'dashboard.dueSoon',
  month: 'dashboard.thisMonth',
  quarter: 'dashboard.thisQuarter',
  year: 'dashboard.thisYear',
  none: 'dashboard.noDeadline',
};

function simplifyCardName(issuer: string | null | undefined, product: string | null | undefined) {
  const rawIssuer = issuer?.trim() ?? '';
  let rawProduct = product?.trim() ?? '';
  if (rawIssuer && rawProduct.toLowerCase().startsWith(rawIssuer.toLowerCase()))
    rawProduct = rawProduct.slice(rawIssuer.length).trim();
  rawProduct = rawProduct
    .replace(/\bcard\b/gi, '')
    .replace(/\s*[—-]\s*(personal|business)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return [rawIssuer.replace(/\bAmerican Express\b/gi, 'Amex').trim(), rawProduct]
    .filter(Boolean)
    .join(' ');
}

function cardLabel(
  account: Account | undefined,
  instance: BenefitInstance,
  localize: (english: string, simplifiedChinese: string) => string,
) {
  const nickname = account?.nickname?.trim();
  if (nickname) return nickname;
  return (
    simplifyCardName(
      account?.issuer ?? instance.issuer,
      account?.card_service_name ?? instance.account_display_name,
    ) ||
    instance.account_display_name ||
    instance.issuer ||
    localize('Unassigned', '未分配')
  );
}

function hasMerchantGuidance(instance: BenefitInstance) {
  return Boolean(
    !instance.merchant &&
      (instance.merchant_category || instance.eligibility_notes || instance.website),
  );
}

function conditionSummary(
  instance: BenefitInstance,
  t: (key: MessageKey) => string,
  locale: string,
) {
  return (
    [
      instance.merchant ? instance.merchant : instance.merchant_category,
      instance.eligibility_notes,
      instance.cashback_percentage !== null
        ? `${instance.cashback_percentage}% ${t('dashboard.cashback')}`
        : null,
      instance.minimum_spend !== null
        ? `${t('dashboard.minimumSpend')} ${formatQuantity(instance.minimum_spend, { valueKind: 'money', currency: instance.currency, locale })}`
        : null,
      instance.enrollment_required ? t('dashboard.enrollmentRequired') : null,
    ]
      .filter(Boolean)
      .join(' · ') || t('dashboard.conditionUnknown')
  );
}

function relativeDeadline(
  instance: BenefitInstance,
  t: (key: MessageKey) => string,
  locale: string,
) {
  if (instance.recurrence_type !== 'one_time' && instance.display_reset_date)
    return `${t('dashboard.resets')} ${formatDate(instance.display_reset_date, locale)}`;
  return `${t('dashboard.ends')} ${formatDate(instance.period_end, locale)}`;
}

export function DashboardPage() {
  const { today } = useBusinessDate();
  const { language, t, localize } = useI18n();
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const [selected, setSelected] = useState<BenefitInstance | null>(null);
  const [merchantInstanceId, setMerchantInstanceId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [usedOn, setUsedOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedInstance, setCompletedInstance] = useState<BenefitInstance | null>(null);
  const modalRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const result = useAsync(async () => {
    const [instances, accounts, health] = await Promise.all([
      listInstances({ includeAuditVersions: false }),
      listAccounts(),
      schedulerHealth(),
    ]);
    return { instances, accounts, health };
  });
  const accountById = useMemo(
    () => new Map((result.data?.accounts ?? []).map((account) => [account.id, account])),
    [result.data?.accounts],
  );
  const outstanding = useMemo(
    () => (result.data?.instances ?? []).filter(isOutstanding),
    [result.data?.instances],
  );
  const sections = useMemo(() => groupOutstanding(outstanding, today), [outstanding, today]);

  useEffect(() => {
    if (!selected) return;
    const modal = modalRef.current;
    if (!modal) return;
    const focusable = () =>
      Array.from(modal.querySelectorAll<HTMLElement>('button, input, [href]')).filter(
        (element) => !element.hasAttribute('disabled'),
      );
    focusable()[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelected(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  useEffect(() => {
    if (selected) return;
    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
  }, [selected]);

  function openUsage(instance: BenefitInstance) {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(instance);
    setAmount(instance.remaining_quantity);
    setUsedOn(today);
    setError(null);
  }

  async function markComplete(instance: BenefitInstance) {
    if (busy) return;
    if (!window.confirm(t('dashboard.completeConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      await markUncappedComplete(instance.instance_id, 'Marked complete from dashboard.');
      setMessage(t('dashboard.recorded'));
      setCompletedInstance(instance);
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('dashboard.completeError'));
    } finally {
      setBusy(false);
    }
  }

  async function reopenCompleted() {
    if (!completedInstance) return;
    setBusy(true);
    setError(null);
    try {
      await reopenUncappedComplete(completedInstance.instance_id);
      setCompletedInstance(null);
      setMessage(t('dashboard.reopened'));
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('dashboard.completeError'));
    } finally {
      setBusy(false);
    }
  }

  async function saveUsage(event: FormEvent) {
    event.preventDefault();
    if (!selected || amount === null || amount <= 0) {
      setError(t('dashboard.invalidAmount'));
      return;
    }
    if (
      !window.confirm(
        `${t('dashboard.confirmUsage')}: ${formatQuantity(amount, { valueKind: selected.value_kind, currency: selected.currency, unitLabel: selected.unit_label, locale })}`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      if (selected.remaining_quantity !== null && amount >= selected.remaining_quantity) {
        await confirmBenefitPeriodUsed(selected.instance_id, usedOn, 'Recorded from dashboard.');
      } else {
        await recordRedemption(selected.instance_id, {
          quantity: amount,
          used_on: usedOn,
          merchant: selected.merchant,
          transaction_description: null,
          notes: 'Recorded from dashboard.',
        });
      }
      setSelected(null);
      setMessage(t('dashboard.recorded'));
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('dashboard.saveError'));
    } finally {
      setBusy(false);
    }
  }

  if (result.error) return <ErrorState error={result.error} onRetry={result.refresh} />;

  return (
    <div className="page-stack dashboard-page">
      {result.data?.health.is_stale && (
        <div className="health-warning" role="alert">
          <strong>{t('dashboard.staleTitle')}</strong>
          <span>{t('dashboard.staleBody')}</span>
          <Link to="/settings">{t('dashboard.recovery')}</Link>
        </div>
      )}
      {message && (
        <div className="alert alert--success" role="status">
          <strong>{message}</strong>
          <span>{t('dashboard.recordedBody')}</span>
        </div>
      )}
      {completedInstance && (
        <div className="alert alert--success" role="status">
          <span>{t('dashboard.completeBody')}</span>
          <button
            className="text-link"
            type="button"
            disabled={busy}
            onClick={() => void reopenCompleted()}
          >
            {t('dashboard.undo')}
          </button>
        </div>
      )}
      {error && !selected && (
        <div className="alert alert--danger" role="alert">
          {error}
        </div>
      )}
      <PageHeader
        eyebrow={t('dashboard.eyebrow')}
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        action={
          <Link className="button button--primary" to="/benefits/new">
            <Icon name="plus" />
            {t('common.addBenefit')}
          </Link>
        }
      />
      {result.loading ? (
        <SkeletonRows count={4} />
      ) : outstanding.length === 0 ? (
        <EmptyState
          title={t('dashboard.emptyTitle')}
          action={
            <Link className="button button--primary" to="/benefits/new">
              {t('dashboard.emptyAction')}
            </Link>
          }
        >
          {t('dashboard.emptyBody')}
        </EmptyState>
      ) : (
        <section className="dashboard-outstanding" aria-labelledby="outstanding-heading">
          <div className="section-head">
            <div>
              <p className="eyebrow">{t('dashboard.outstanding')}</p>
              <h2 id="outstanding-heading">{outstanding.length}</h2>
            </div>
          </div>
          {sections.map(({ group, instances }) => (
            <section
              className={`dashboard-group dashboard-group--${group}`}
              key={group}
              aria-labelledby={`group-${group}`}
            >
              <h3 id={`group-${group}`}>{t(groupLabels[group])}</h3>
              <div className="dashboard-benefit-list">
                {instances.map((instance) => {
                  const account = instance.account_id
                    ? accountById.get(instance.account_id)
                    : undefined;
                  const quantityOptions = {
                    valueKind: instance.value_kind,
                    currency: instance.currency,
                    unitLabel: instance.unit_label,
                    locale,
                  } as const;
                  return (
                    <article
                      className={`dashboard-benefit dashboard-benefit--${group}`}
                      key={instance.instance_id}
                    >
                      <div className="dashboard-benefit-main">
                        <Link
                          className="dashboard-benefit-name"
                          to={`/instances/${instance.instance_id}`}
                        >
                          {instance.benefit_name}
                        </Link>
                        <span className="dashboard-benefit-card">
                          {cardLabel(account, instance, localize)}
                          {account?.last_four ? ` · •••• ${account.last_four}` : ''}
                        </span>
                        <span className="dashboard-benefit-condition">
                          {conditionSummary(instance, t, locale)}
                        </span>
                      </div>
                      <div className="dashboard-benefit-value">
                        <strong>
                          {formatQuantity(instance.remaining_quantity, quantityOptions)}
                        </strong>
                        <span>
                          {t('dashboard.remaining')} {t('dashboard.of')}{' '}
                          {formatQuantity(instance.available_quantity, quantityOptions)}
                        </span>
                      </div>
                      <div className="dashboard-benefit-deadline">
                        <strong>{relativeDeadline(instance, t, locale)}</strong>
                        <span>
                          {instance.usage_status === 'partial'
                            ? t('dashboard.partial')
                            : t('dashboard.available')}
                        </span>
                      </div>
                      {hasMerchantGuidance(instance) && (
                        <div className="merchant-popover-wrap">
                          <button
                            className="merchant-button"
                            type="button"
                            aria-expanded={merchantInstanceId === instance.instance_id}
                            aria-controls={`merchant-details-${instance.instance_id}`}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') setMerchantInstanceId(null);
                            }}
                            onClick={() =>
                              setMerchantInstanceId((current) =>
                                current === instance.instance_id ? null : instance.instance_id,
                              )
                            }
                          >
                            {instance.merchant_category || t('dashboard.condition')}
                          </button>
                          {merchantInstanceId === instance.instance_id && (
                            <div
                              id={`merchant-details-${instance.instance_id}`}
                              className="merchant-popover"
                              role="dialog"
                              aria-label={t('dashboard.condition')}
                            >
                              <strong>{t('dashboard.condition')}</strong>
                              {instance.merchant_category && (
                                <span>{instance.merchant_category}</span>
                              )}
                              {instance.eligibility_notes && (
                                <span>{instance.eligibility_notes}</span>
                              )}
                              {instance.website && (
                                <a href={instance.website} target="_blank" rel="noreferrer">
                                  {instance.website}
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {instance.remaining_quantity === null ? (
                        <>
                          <button
                            className="button button--secondary button--small"
                            type="button"
                            onClick={() => openUsage(instance)}
                          >
                            {t('dashboard.recordUsage')}
                          </button>
                          <button
                            className="button button--secondary button--small"
                            type="button"
                            disabled={busy}
                            onClick={() => void markComplete(instance)}
                          >
                            {t('dashboard.markComplete')}
                          </button>
                        </>
                      ) : (
                        <button
                          className="button button--secondary button--small"
                          type="button"
                          onClick={() => openUsage(instance)}
                        >
                          {t('dashboard.recordUsage')}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </section>
      )}
      {selected && (
        <div className="modal-backdrop">
          <section
            ref={modalRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-usage-title"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">{selected.benefit_name}</p>
                <h2 id="quick-usage-title">{t('dashboard.confirmUsage')}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label={t('common.close')}
                onClick={() => setSelected(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            <p className="muted">{t('dashboard.confirmBody')}</p>
            <form className="form-stack" onSubmit={(event) => void saveUsage(event)}>
              <label className="field">
                <span>{t('dashboard.amountUsed')}</span>
                <input
                  required
                  type="number"
                  min="0.01"
                  step={selected.value_kind === 'points' ? '1' : '0.01'}
                  max={selected.remaining_quantity ?? undefined}
                  value={amount ?? ''}
                  onChange={(event) =>
                    setAmount(event.target.value ? Number(event.target.value) : null)
                  }
                />
              </label>
              <label className="field">
                <span>{t('dashboard.dateUsed')}</span>
                <input
                  required
                  type="date"
                  value={usedOn}
                  onChange={(event) => setUsedOn(event.target.value)}
                />
              </label>
              {error && (
                <div className="alert alert--danger" role="alert">
                  {error}
                </div>
              )}
              <div className="modal-actions">
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => setSelected(null)}
                >
                  {t('common.cancel')}
                </button>
                <button className="button button--primary" type="submit" disabled={busy}>
                  {busy ? t('dashboard.saving') : t('dashboard.saveUsage')}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
