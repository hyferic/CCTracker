import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorState, SkeletonRows } from '../components/AsyncState';
import { Icon } from '../components/Icon';
import { StatusBadge } from '../components/StatusBadge';
import { formatDate } from '../domain/dates';
import { formatQuantity } from '../domain/money';
import { useBusinessDate } from '../features/profile/ProfileContext';
import { useAsync } from '../hooks/useAsync';
import {
  deleteRedemption,
  editRedemption,
  getInstance,
  listRedemptions,
  markBenefitEnrolled,
  markUncappedComplete,
  overrideInstance,
  recordRedemption,
} from '../services/api';
import type { Redemption } from '../types';
import { recurrenceLabel, useI18n } from '../features/i18n/I18nContext';

interface RedemptionForm {
  quantity: number | null;
  used_on: string;
  merchant: string;
  transaction_description: string;
  notes: string;
}

export function InstancePage() {
  const { instanceId = '' } = useParams();
  const navigate = useNavigate();
  const { today } = useBusinessDate();
  const { language, t, localize } = useI18n();
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const result = useAsync(async () => {
    const [instance, redemptions] = await Promise.all([
      getInstance(instanceId),
      listRedemptions(instanceId),
    ]);
    return { instance, redemptions };
  }, [instanceId]);
  const [redemptionOpen, setRedemptionOpen] = useState(false);
  const [editingRedemption, setEditingRedemption] = useState<Redemption | null>(null);
  const [form, setForm] = useState<RedemptionForm>({
    quantity: null,
    used_on: today,
    merchant: '',
    transaction_description: '',
    notes: '',
  });
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideForm, setOverrideForm] = useState({
    available_quantity: '',
    period_start: '',
    period_end: '',
    reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const instance = result.data?.instance;

  function openRedemption(redemption?: Redemption, useRemainder = false) {
    setEditingRedemption(redemption ?? null);
    setForm(
      redemption
        ? {
            quantity: redemption.quantity,
            used_on: redemption.used_on,
            merchant: redemption.merchant ?? '',
            transaction_description: redemption.transaction_description ?? '',
            notes: redemption.notes ?? '',
          }
        : {
            quantity: useRemainder ? (instance?.remaining_quantity ?? null) : null,
            used_on: today,
            merchant: '',
            transaction_description: '',
            notes: '',
          },
    );
    setError(null);
    setRedemptionOpen(true);
  }

  async function saveRedemption(event: FormEvent) {
    event.preventDefault();
    if (!form.quantity || form.quantity <= 0) {
      setError(t('dashboard.invalidAmount'));
      return;
    }
    setBusy(true);
    setError(null);
    const input = {
      quantity: form.quantity,
      used_on: form.used_on,
      merchant: form.merchant || null,
      transaction_description: form.transaction_description || null,
      notes: form.notes || null,
    };
    try {
      if (editingRedemption) await editRedemption(editingRedemption.id, input);
      else await recordRedemption(instanceId, input);
      setRedemptionOpen(false);
      setMessage(editingRedemption ? t('instance.usageUpdated') : t('instance.usageRecorded'));
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('instance.saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function removeRedemption(redemption: Redemption) {
    if (!window.confirm(t('instance.deleteUsageConfirm'))) return;
    try {
      await deleteRedemption(redemption.id);
      setMessage(t('instance.deleteUsage'));
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('instance.deleteError'));
    }
  }

  async function markComplete() {
    if (!window.confirm(t('instance.completeConfirm'))) return;
    try {
      await markUncappedComplete(instanceId, 'Marked complete from period detail.');
      setMessage(t('instance.complete'));
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('instance.completeError'));
    }
  }

  async function markEnrolled() {
    if (!instance) return;
    if (!window.confirm(t('instance.enrollConfirm'))) return;
    try {
      await markBenefitEnrolled(instance.definition_id, today);
      setMessage(t('instance.enrolled'));
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('instance.enrollError'));
    }
  }

  function openOverride() {
    if (!instance) return;
    setOverrideForm({
      available_quantity: instance.available_quantity?.toString() ?? '',
      period_start: instance.period_start,
      period_end: instance.period_end,
      reason: '',
    });
    setError(null);
    setOverrideOpen(true);
  }

  async function saveOverride(event: FormEvent) {
    event.preventDefault();
    if (!overrideForm.reason.trim()) {
      setError(t('common.required'));
      return;
    }
    setBusy(true);
    try {
      const response = await overrideInstance(instanceId, {
        available_quantity: overrideForm.available_quantity
          ? Number(overrideForm.available_quantity)
          : null,
        period_start: overrideForm.period_start,
        period_end: overrideForm.period_end,
        reason: overrideForm.reason,
      });
      setOverrideOpen(false);
      void navigate(`/instances/${response.instance_id}`, { replace: true });
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.save'));
    } finally {
      setBusy(false);
    }
  }

  if (result.error) return <ErrorState error={result.error} onRetry={result.refresh} />;
  if (result.loading || !instance) return <SkeletonRows count={5} />;
  const quantityOptions = {
    valueKind: instance.value_kind,
    currency: instance.currency,
    unitLabel: instance.unit_label,
    locale,
  } as const;
  const finite = instance.available_quantity !== null;

  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label={t('instance.breadcrumb')}>
        <Link to="/benefits">{t('instance.benefits')}</Link>
        <span aria-hidden="true">/</span>
        <span>{instance.benefit_name}</span>
      </nav>
      {message && (
        <div className="alert alert--success" role="status">
          {message}
        </div>
      )}
      {error && !redemptionOpen && !overrideOpen && (
        <div className="alert alert--danger" role="alert">
          {error}
        </div>
      )}
      {instance.is_audit_version && (
        <div className="alert alert--warning" role="status">
          <strong>{t('instance.auditVersion')}</strong> {t('instance.readOnly')}
          {instance.void_reason ? ` ${localize('Reason:', '原因：')} ${instance.void_reason}` : ''}
        </div>
      )}
      <section className="detail-hero">
        <div className="detail-hero-main">
          <p className="eyebrow">
            {instance.account_display_name ?? instance.issuer ?? localize('Unassigned', '未分配')} ·{' '}
            {instance.category}
          </p>
          <h2>{instance.benefit_name}</h2>
          <div className="detail-status">
            <StatusBadge instance={instance} />
            <span>{instance.period_label}</span>
          </div>
          {instance.description && <p>{instance.description}</p>}
        </div>
        <div className="detail-balance">
          <p>
            {instance.value_kind === 'percentage_cashback' && finite
              ? localize('Potential remaining cashback', '预计剩余返现')
              : t('dashboard.remaining')}
          </p>
          <strong>{formatQuantity(instance.remaining_quantity, quantityOptions)}</strong>
          <span>
            {finite
              ? `${formatQuantity(instance.redeemed_quantity, quantityOptions)} ${t('status.used').toLowerCase()} ${t('dashboard.of')} ${formatQuantity(instance.available_quantity, quantityOptions)}`
              : `${formatQuantity(instance.earned_to_date, { ...quantityOptions, valueKind: 'money' })} ${localize('earned to date', '累计获得')}`}
          </span>
        </div>
      </section>
      <div className="detail-actions">
        {instance.lifecycle_status === 'active' && instance.usage_status !== 'used' && (
          <button className="button button--primary" onClick={() => openRedemption()}>
            {t('instance.recordUsage')}
          </button>
        )}
        {finite && instance.lifecycle_status === 'active' && instance.usage_status !== 'used' && (
          <button
            className="button button--secondary"
            onClick={() => openRedemption(undefined, true)}
          >
            {t('instance.useRemainder')}
          </button>
        )}
        {!finite && instance.lifecycle_status === 'active' && instance.usage_status !== 'used' && (
          <button className="button button--secondary" onClick={() => void markComplete()}>
            {t('dashboard.markComplete')}
          </button>
        )}
        {instance.enrollment_required && !instance.enrolled_at && (
          <button className="button button--secondary" onClick={() => void markEnrolled()}>
            {localize('Mark enrollment complete', '标记注册完成')}
          </button>
        )}
        <Link className="button button--secondary" to={`/benefits/${instance.definition_id}/edit`}>
          {t('benefits.editRules')}
        </Link>
        <button className="text-button" onClick={openOverride}>
          {localize('Override this period', '仅覆盖此周期')}
        </button>
      </div>
      <div className="detail-grid">
        <section className="panel detail-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">{t('instance.currentPeriod')}</p>
              <h2>{t('instance.datesReset')}</h2>
            </div>
          </div>
          <dl className="data-list">
            <div>
              <dt>{t('instance.availableFrom')}</dt>
              <dd>{formatDate(instance.period_start, locale)}</dd>
            </div>
            <div>
              <dt>{t('instance.expires')}</dt>
              <dd>{formatDate(instance.period_end, locale)}</dd>
            </div>
            <div>
              <dt>{t('instance.daysRemaining')}</dt>
              <dd>
                {instance.days_remaining >= 0 ? instance.days_remaining : t('status.expired')}
              </dd>
            </div>
            {instance.display_reset_date && (
              <div>
                <dt>{t('instance.displayReset')}</dt>
                <dd>{formatDate(instance.display_reset_date, locale)}</dd>
              </div>
            )}
            <div>
              <dt>{t('instance.recurrence')}</dt>
              <dd>
                {instance.recurrence_enabled
                  ? recurrenceLabel(instance.recurrence_type, instance.recurrence_basis, localize)
                  : localize('One-time', '一次性')}
              </dd>
            </div>
            <div>
              <dt>{t('instance.occurrence')}</dt>
              <dd>
                <code>{instance.occurrence_key}</code> · {localize('version', '版本')}{' '}
                {instance.instance_version}
              </dd>
            </div>
          </dl>
        </section>
        <section className="panel detail-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">{t('instance.eligibility')}</p>
              <h2>{t('instance.whereApplies')}</h2>
            </div>
          </div>
          <dl className="data-list">
            <div>
              <dt>{t('instance.merchant')}</dt>
              <dd>{instance.merchant ?? t('instance.anyEligible')}</dd>
            </div>
            <div>
              <dt>{t('instance.merchantCategory')}</dt>
              <dd>{instance.merchant_category ?? t('instance.notSpecified')}</dd>
            </div>
            {instance.value_kind === 'percentage_cashback' &&
              instance.cashback_percentage !== null && (
                <div>
                  <dt>{t('instance.cashbackRate')}</dt>
                  <dd>{instance.cashback_percentage}%</dd>
                </div>
              )}
            {instance.minimum_spend !== null && (
              <div>
                <dt>{t('instance.minimumSpend')}</dt>
                <dd>
                  {formatQuantity(instance.minimum_spend, {
                    valueKind: 'money',
                    currency: instance.currency,
                    locale,
                  })}
                </dd>
              </div>
            )}
            {instance.website && (
              <div>
                <dt>{t('instance.website')}</dt>
                <dd>
                  <a href={instance.website} target="_blank" rel="noreferrer">
                    {t('instance.openWebsite')}
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt>{t('instance.enrollment')}</dt>
              <dd>
                {instance.enrollment_required
                  ? instance.enrolled_at
                    ? `${localize('Completed', '已完成')} ${formatDate(instance.enrolled_at, locale)}`
                    : instance.enrollment_deadline
                      ? `${localize('Required by', '截止于')} ${formatDate(instance.enrollment_deadline, locale)}`
                      : t('instance.required')
                  : t('instance.notRequired')}
              </dd>
            </div>
          </dl>
          {instance.eligibility_notes && (
            <div className="note-box">
              <strong>{t('instance.finePrint')}</strong>
              <p>{instance.eligibility_notes}</p>
            </div>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">{t('instance.redemptionHistory')}</p>
            <h2>
              {result.data?.redemptions.length ?? 0} {localize('usage entries', '条使用记录')}
            </h2>
          </div>
          {instance.lifecycle_status === 'active' && (
            <button
              className="button button--secondary button--small"
              onClick={() => openRedemption()}
            >
              {t('instance.recordUsage')}
            </button>
          )}
        </div>
        {!result.data?.redemptions.length ? (
          <div className="inline-empty">
            <span aria-hidden="true">
              <Icon name="inbox" />
            </span>
            <p>{t('instance.noUsage')}</p>
          </div>
        ) : (
          <div className="redemption-list">
            {result.data.redemptions.map((redemption) => (
              <article key={redemption.id}>
                <div className="redemption-amount">
                  <strong>{formatQuantity(redemption.quantity, quantityOptions)}</strong>
                  <span>{formatDate(redemption.used_on, locale)}</span>
                </div>
                <div className="redemption-copy">
                  <strong>{redemption.merchant ?? localize('Usage', '使用记录')}</strong>
                  <span>
                    {redemption.transaction_description ??
                      localize('No transaction description', '暂无交易说明')}
                  </span>
                  {redemption.notes && <small>{redemption.notes}</small>}
                </div>
                <div className="redemption-actions">
                  <button className="text-button" onClick={() => openRedemption(redemption)}>
                    {t('common.edit')}
                  </button>
                  <button
                    className="text-button text-button--danger"
                    onClick={() => void removeRedemption(redemption)}
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {instance.notes && (
        <section className="panel detail-section">
          <p className="eyebrow">{t('instance.privateNotes')}</p>
          <p className="preserve-lines">{instance.notes}</p>
        </section>
      )}

      {redemptionOpen && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="redemption-title"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">{instance.period_label}</p>
                <h2 id="redemption-title">
                  {editingRedemption ? t('instance.editUsage') : t('instance.recordUsage')}
                </h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setRedemptionOpen(false)}
                aria-label={t('common.close')}
              >
                <Icon name="close" />
              </button>
            </div>
            <form className="form-stack" onSubmit={(event) => void saveRedemption(event)}>
              <div className="form-grid">
                <label className="field">
                  <span>{t('instance.amountUsed')}</span>
                  <input
                    autoFocus
                    required
                    type="number"
                    min="0.01"
                    step={instance.value_kind === 'points' ? '1' : '0.01'}
                    value={form.quantity ?? ''}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        quantity: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>{t('instance.dateUsed')}</span>
                  <input
                    required
                    type="date"
                    value={form.used_on}
                    onChange={(event) => setForm({ ...form, used_on: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>{t('instance.merchant')}</span>
                  <input
                    value={form.merchant}
                    onChange={(event) => setForm({ ...form, merchant: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>{t('instance.transaction')}</span>
                  <input
                    value={form.transaction_description}
                    onChange={(event) =>
                      setForm({ ...form, transaction_description: event.target.value })
                    }
                  />
                </label>
                <label className="field field--wide">
                  <span>{t('instance.privateNotes')}</span>
                  <textarea
                    rows={3}
                    value={form.notes}
                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  />
                </label>
              </div>
              {!finite && <div className="info-box">{t('instance.uncappedHelp')}</div>}
              {error && (
                <div className="alert alert--danger" role="alert">
                  {error}
                </div>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setRedemptionOpen(false)}
                >
                  {t('common.cancel')}
                </button>
                <button type="submit" className="button button--primary" disabled={busy}>
                  {busy ? t('dashboard.saving') : t('instance.saveUsage')}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {overrideOpen && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="override-title"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">{localize('History-safe exception', '保留历史的例外')}</p>
                <h2 id="override-title">{localize('Override this period only', '仅覆盖此周期')}</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setOverrideOpen(false)}
                aria-label={t('common.close')}
              >
                <Icon name="close" />
              </button>
            </div>
            <form className="form-stack" onSubmit={(event) => void saveOverride(event)}>
              <div className="alert alert--warning">
                {localize(
                  'This voids the current version for audit and creates a replacement. Other periods and the master rules are unchanged.',
                  '这会为审计作废当前版本并创建替代周期。其他周期和主规则不会改变。',
                )}
              </div>
              <div className="form-grid">
                {finite ? (
                  <label className="field">
                    <span>{localize('Available quantity', '可用数量')}</span>
                    <input
                      required
                      type="number"
                      min="0.01"
                      step={instance.value_kind === 'points' ? '1' : '0.01'}
                      value={overrideForm.available_quantity}
                      onChange={(event) =>
                        setOverrideForm({
                          ...overrideForm,
                          available_quantity: event.target.value,
                        })
                      }
                    />
                  </label>
                ) : (
                  <div className="info-box">
                    {localize(
                      'This period is uncapped. A period override cannot convert its value model to a finite cap.',
                      '此周期不限额度。周期覆盖不能将其价值模型转换为有限上限。',
                    )}
                  </div>
                )}
                <span />
                <label className="field">
                  <span>{localize('Period starts', '周期开始')}</span>
                  <input
                    required
                    type="date"
                    value={overrideForm.period_start}
                    onChange={(event) =>
                      setOverrideForm({ ...overrideForm, period_start: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>{localize('Period ends', '周期结束')}</span>
                  <input
                    required
                    type="date"
                    value={overrideForm.period_end}
                    onChange={(event) =>
                      setOverrideForm({ ...overrideForm, period_end: event.target.value })
                    }
                  />
                </label>
                <label className="field field--wide">
                  <span>{localize('Audit reason', '审计原因')}</span>
                  <textarea
                    required
                    rows={3}
                    value={overrideForm.reason}
                    onChange={(event) =>
                      setOverrideForm({ ...overrideForm, reason: event.target.value })
                    }
                    placeholder={localize(
                      'Why this period differs from the recurring definition',
                      '说明此周期为何不同于周期定义',
                    )}
                  />
                </label>
              </div>
              {error && (
                <div className="alert alert--danger" role="alert">
                  {error}
                </div>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => setOverrideOpen(false)}
                >
                  {t('common.cancel')}
                </button>
                <button type="submit" className="button button--primary" disabled={busy}>
                  {busy
                    ? localize('Creating audit version…', '正在创建审计版本…')
                    : localize('Override period', '覆盖周期')}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
