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
  deleteRedemption,
  listAccounts,
  listInstances,
  markUncappedComplete,
  recordRedemption,
  reopenConfirmedBenefitPeriod,
  reopenUncappedComplete,
  schedulerHealth,
} from '../services/api';
import type { Account, BenefitInstance } from '../types';

type RecordedAction =
  | { kind: 'confirmed'; instanceId: string; redemptionId: string }
  | { kind: 'confirmed-manual'; instanceId: string }
  | { kind: 'redemption'; instanceId: string; redemptionId: string };

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
  t: (key: MessageKey) => string,
) {
  const nickname = account?.nickname?.trim();
  if (nickname) return nickname;
  return (
    simplifyCardName(
      account?.issuer ?? instance.issuer,
      account?.card_service_name || account?.display_name || instance.account_display_name,
    ) ||
    instance.account_display_name ||
    instance.issuer ||
    t('common.unassigned')
  );
}

function isUncappedBenefit(instance: Pick<BenefitInstance, 'available_quantity'>) {
  return instance.available_quantity === null;
}

function usageProgressPercent(total: number | null, remaining: number | null) {
  if (
    total === null ||
    remaining === null ||
    !Number.isFinite(total) ||
    !Number.isFinite(remaining) ||
    total <= 0
  ) {
    return 0;
  }
  const used = total - remaining;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

function isBroadMerchantLabel(merchant: string | null | undefined) {
  const label = merchant?.trim().replace(/\s+/g, ' ');
  if (!label) return false;
  const broadCategory =
    /^(?:(?:eligible|participating|select|any|all|multiple|various|qualifying|qualified)\s+)?(?:merchants?|restaurants?|dining|airlines?|hotels?|retailers?|stores?|providers?|transit|rideshares?|travel portals?|purchases?)(?:\s+(?:bookings?|purchases?|stays?))?$/i.test(
      label,
    );
  const merchantList = label.split(/\s*(?:,|\/|\band\b|\bor\b)\s*/i);
  return broadCategory || merchantList.length > 1;
}

function hasMerchantGuidance(instance: BenefitInstance) {
  return Boolean(
    (!instance.merchant || isBroadMerchantLabel(instance.merchant)) &&
      (instance.merchant_category || instance.eligibility_notes || instance.website),
  );
}

function merchantGuidanceLabel(instance: BenefitInstance, t: (key: MessageKey) => string) {
  return instance.merchant?.trim() && isBroadMerchantLabel(instance.merchant)
    ? instance.merchant
    : instance.merchant_category || t('dashboard.condition');
}

export function DashboardPage() {
  const { today } = useBusinessDate();
  const { language, t } = useI18n();
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const [selected, setSelected] = useState<BenefitInstance | null>(null);
  const [merchantInstanceId, setMerchantInstanceId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [usedOn, setUsedOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completedInstance, setCompletedInstance] = useState<BenefitInstance | null>(null);
  const [recordedInstance, setRecordedInstance] = useState<BenefitInstance | null>(null);
  const [recordedAction, setRecordedAction] = useState<RecordedAction | null>(null);
  const [hiddenInstanceIds, setHiddenInstanceIds] = useState<Set<string>>(() => new Set());
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
    () =>
      (result.data?.instances ?? []).filter(
        (instance) => !hiddenInstanceIds.has(instance.instance_id) && isOutstanding(instance),
      ),
    [hiddenInstanceIds, result.data?.instances],
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
    setAmount(isUncappedBenefit(instance) ? null : instance.remaining_quantity);
    setUsedOn(today);
    setError(null);
  }

  async function markComplete(instance: BenefitInstance) {
    if (busy || !isUncappedBenefit(instance)) return;
    if (!window.confirm(t('dashboard.completeConfirm'))) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setRecordedInstance(null);
    setRecordedAction(null);
    try {
      await markUncappedComplete(instance.instance_id, 'Marked complete from dashboard.');
      setCompletedInstance(instance);
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('dashboard.completeError'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmUsed(instance: BenefitInstance) {
    if (busy || isUncappedBenefit(instance)) return;
    if (!window.confirm(t('dashboard.confirmUsedConfirm'))) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setRecordedInstance(null);
    setRecordedAction(null);
    setCompletedInstance(null);
    try {
      const confirmation = await confirmBenefitPeriodUsed(
        instance.instance_id,
        today,
        'Confirmed used from dashboard.',
      );
      setHiddenInstanceIds((current) => new Set(current).add(instance.instance_id));
      setNotice({ title: t('dashboard.recorded'), body: t('dashboard.recordedBody') });
      setRecordedInstance(instance);
      setRecordedAction(
        confirmation.archived
          ? confirmation.confirmation_redemption_id
            ? {
                kind: 'confirmed',
                instanceId: instance.instance_id,
                redemptionId: confirmation.confirmation_redemption_id,
              }
            : { kind: 'confirmed-manual', instanceId: instance.instance_id }
          : confirmation.confirmation_redemption_id
            ? {
                kind: 'redemption',
                instanceId: instance.instance_id,
                redemptionId: confirmation.confirmation_redemption_id,
              }
            : null,
      );
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('dashboard.saveError'));
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
      setNotice({ title: t('dashboard.reopened'), body: t('dashboard.reopenedBody') });
      setRecordedInstance(null);
      setRecordedAction(null);
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('dashboard.completeError'));
    } finally {
      setBusy(false);
    }
  }

  async function saveUsage(event: FormEvent) {
    event.preventDefault();
    if (!selected || amount === null || !Number.isFinite(amount) || amount <= 0) {
      setError(t('dashboard.invalidAmount'));
      return;
    }
    const isUncapped = isUncappedBenefit(selected);
    const remainingQuantity = selected.remaining_quantity ?? 0;
    if (!isUncapped && amount > remainingQuantity) {
      setError(t('dashboard.amountExceedsRemaining'));
      return;
    }
    if (selected.value_kind === 'points' && !Number.isInteger(amount)) {
      setError(t('dashboard.wholePoints'));
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
      let action: RecordedAction | null;
      if (!isUncapped && amount >= remainingQuantity) {
        const confirmation = await confirmBenefitPeriodUsed(
          selected.instance_id,
          usedOn,
          'Recorded from dashboard.',
        );
        action = confirmation.archived
          ? confirmation.confirmation_redemption_id
            ? {
                kind: 'confirmed',
                instanceId: selected.instance_id,
                redemptionId: confirmation.confirmation_redemption_id,
              }
            : { kind: 'confirmed-manual', instanceId: selected.instance_id }
          : confirmation.confirmation_redemption_id
            ? {
                kind: 'redemption',
                instanceId: selected.instance_id,
                redemptionId: confirmation.confirmation_redemption_id,
              }
            : null;
      } else {
        const redemption = await recordRedemption(selected.instance_id, {
          quantity: amount,
          used_on: usedOn,
          merchant: selected.merchant,
          transaction_description: null,
          notes: 'Recorded from dashboard.',
        });
        action = redemption?.id
          ? { kind: 'redemption', instanceId: selected.instance_id, redemptionId: redemption.id }
          : null;
      }
      setSelected(null);
      if (!isUncapped && amount >= remainingQuantity) {
        setHiddenInstanceIds((current) => new Set(current).add(selected.instance_id));
      }
      setNotice({ title: t('dashboard.recorded'), body: t('dashboard.recordedBody') });
      setRecordedInstance(selected);
      setRecordedAction(action);
      setCompletedInstance(null);
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('dashboard.saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function undoRecordedUsage() {
    if (!recordedAction || busy) return;
    if (!window.confirm(t('dashboard.undoUsageConfirm'))) return;
    setBusy(true);
    setError(null);
    try {
      if (recordedAction.kind === 'confirmed') {
        await reopenConfirmedBenefitPeriod(recordedAction.instanceId, recordedAction.redemptionId);
      } else if (recordedAction.kind === 'confirmed-manual') {
        await reopenConfirmedBenefitPeriod(recordedAction.instanceId);
      } else {
        await deleteRedemption(recordedAction.redemptionId);
      }
      setHiddenInstanceIds((current) => {
        const next = new Set(current);
        next.delete(recordedAction.instanceId);
        return next;
      });
      setRecordedAction(null);
      setRecordedInstance(null);
      setNotice({ title: t('dashboard.reopened'), body: t('dashboard.reopenedUsageBody') });
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('dashboard.undoUsageError'));
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
      {notice && (
        <div className="alert alert--success" role="status">
          <strong>{notice.title}</strong>
          <span>{notice.body}</span>
          {recordedInstance && (
            <>
              <Link className="text-link" to={`/instances/${recordedInstance.instance_id}`}>
                {t('dashboard.openDetails')}
              </Link>
              {recordedAction && (
                <button
                  className="text-link"
                  type="button"
                  disabled={busy}
                  onClick={() => void undoRecordedUsage()}
                >
                  {t('dashboard.undoUsage')}
                </button>
              )}
            </>
          )}
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
          <Link className="button button--secondary" to="/benefits/new">
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
              <div className="dashboard-group-heading">
                <h3 id={`group-${group}`}>{t(groupLabels[group])}</h3>
                <span aria-label={`${instances.length} ${t('dashboard.groupCount')}`}>
                  {instances.length}
                </span>
              </div>
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
                  const isUncapped = isUncappedBenefit(instance);
                  const progressPercent = usageProgressPercent(
                    instance.available_quantity,
                    instance.remaining_quantity,
                  );
                  return (
                    <article
                      className={`dashboard-benefit dashboard-benefit--${group}`}
                      key={instance.instance_id}
                    >
                      <div className="dashboard-benefit-header">
                        <div className="dashboard-benefit-main">
                          <Link
                            className="dashboard-benefit-name"
                            to={`/instances/${instance.instance_id}`}
                          >
                            {instance.benefit_name}
                          </Link>
                          <span className="dashboard-benefit-card">
                            {cardLabel(account, instance, t)}
                            {account?.last_four ? ` · •••• ${account.last_four}` : ''}
                          </span>
                        </div>
                        <div className="dashboard-benefit-deadline">
                          <time dateTime={instance.period_end}>
                            {formatDate(instance.period_end, locale, {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </time>
                        </div>
                      </div>
                      <div className="dashboard-benefit-value">
                        {isUncapped ? (
                          <strong>{t('dashboard.uncapped')}</strong>
                        ) : (
                          <div className="dashboard-benefit-progress">
                            <progress
                              className="dashboard-benefit-progress-bar"
                              value={progressPercent}
                              max={100}
                              aria-label={`${instance.benefit_name} ${t('dashboard.usageProgress')}`}
                            />
                            <span className="dashboard-benefit-ratio">
                              {formatQuantity(instance.remaining_quantity, quantityOptions)}/
                              {formatQuantity(instance.available_quantity, quantityOptions)}
                            </span>
                          </div>
                        )}
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
                            {merchantGuidanceLabel(instance, t)}
                          </button>
                          {merchantInstanceId === instance.instance_id && (
                            <div
                              id={`merchant-details-${instance.instance_id}`}
                              className="merchant-popover"
                              role="dialog"
                              aria-label={t('dashboard.condition')}
                            >
                              <strong>{t('dashboard.condition')}</strong>
                              {instance.merchant && isBroadMerchantLabel(instance.merchant) && (
                                <span>{instance.merchant}</span>
                              )}
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
                      {isUncappedBenefit(instance) ? (
                        <div className="dashboard-benefit-actions">
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
                        </div>
                      ) : (
                        <div className="dashboard-benefit-actions">
                          <button
                            className="button button--primary button--small"
                            type="button"
                            disabled={busy}
                            onClick={() => void confirmUsed(instance)}
                          >
                            {t('common.confirmUsed')}
                          </button>
                          <button
                            className="button button--secondary button--small"
                            type="button"
                            disabled={busy}
                            onClick={() => openUsage(instance)}
                          >
                            {t('dashboard.recordUsage')}
                          </button>
                        </div>
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
                  max={
                    isUncappedBenefit(selected)
                      ? undefined
                      : (selected.remaining_quantity ?? undefined)
                  }
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
