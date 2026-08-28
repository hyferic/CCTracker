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
      setError('Enter a positive benefit amount used.');
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
      setMessage(
        editingRedemption ? 'Usage updated.' : 'Usage recorded. Remaining value was recalculated.',
      );
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save usage.');
    } finally {
      setBusy(false);
    }
  }

  async function removeRedemption(redemption: Redemption) {
    if (
      !window.confirm('Delete this usage entry? The remaining balance will increase automatically.')
    )
      return;
    try {
      await deleteRedemption(redemption.id);
      setMessage('Usage entry deleted and balance recalculated.');
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete usage.');
    }
  }

  async function markComplete() {
    if (
      !window.confirm(
        'Mark this uncapped offer complete? Earned cashback entries remain in history.',
      )
    )
      return;
    try {
      await markUncappedComplete(instanceId, 'Marked complete from period detail.');
      setMessage('Offer marked complete.');
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not mark the offer complete.');
    }
  }

  async function markEnrolled() {
    if (!instance) return;
    if (!window.confirm('Mark enrollment complete today for this benefit and its future periods?'))
      return;
    try {
      await markBenefitEnrolled(instance.definition_id, today);
      setMessage('Enrollment marked complete.');
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not mark enrollment complete.');
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
      setError('An audit reason is required.');
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
      setError(caught instanceof Error ? caught.message : 'Could not override this period.');
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
  } as const;
  const finite = instance.available_quantity !== null;

  return (
    <div className="page-stack">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link to="/benefits">Benefits</Link>
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
          <strong>Historical audit version.</strong> This period was superseded and is read-only.
          {instance.void_reason ? ` Reason: ${instance.void_reason}` : ''}
        </div>
      )}
      <section className="detail-hero">
        <div className="detail-hero-main">
          <p className="eyebrow">
            {instance.account_display_name ?? instance.issuer ?? 'Unassigned'} · {instance.category}
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
              ? 'Potential remaining cashback'
              : 'Remaining'}
          </p>
          <strong>{formatQuantity(instance.remaining_quantity, quantityOptions)}</strong>
          <span>
            {finite
              ? `${formatQuantity(instance.redeemed_quantity, quantityOptions)} used of ${formatQuantity(instance.available_quantity, quantityOptions)}`
              : `${formatQuantity(instance.earned_to_date, { ...quantityOptions, valueKind: 'money' })} earned to date`}
          </span>
        </div>
      </section>
      <div className="detail-actions">
        {instance.lifecycle_status === 'active' && instance.usage_status !== 'used' && (
          <button className="button button--primary" onClick={() => openRedemption()}>
            + Record usage
          </button>
        )}
        {finite && instance.lifecycle_status === 'active' && instance.usage_status !== 'used' && (
          <button
            className="button button--secondary"
            onClick={() => openRedemption(undefined, true)}
          >
            Confirm used
          </button>
        )}
        {!finite && instance.lifecycle_status === 'active' && instance.usage_status !== 'used' && (
          <button className="button button--secondary" onClick={() => void markComplete()}>
            Confirm used
          </button>
        )}
        {instance.enrollment_required && !instance.enrolled_at && (
          <button className="button button--secondary" onClick={() => void markEnrolled()}>
            Mark enrolled
          </button>
        )}
        <Link className="button button--secondary" to={`/benefits/${instance.definition_id}/edit`}>
          Edit rules
        </Link>
        <button className="text-button" onClick={openOverride}>
          Override this period
        </button>
      </div>
      <div className="detail-grid">
        <section className="panel detail-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">Current period</p>
              <h2>Dates & reset</h2>
            </div>
          </div>
          <dl className="data-list">
            <div>
              <dt>Available from</dt>
              <dd>{formatDate(instance.period_start)}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{formatDate(instance.period_end)}</dd>
            </div>
            <div>
              <dt>Days remaining</dt>
              <dd>{instance.days_remaining >= 0 ? instance.days_remaining : 'Expired'}</dd>
            </div>
            {instance.display_reset_date && (
              <div>
                <dt>Display reset date</dt>
                <dd>{formatDate(instance.display_reset_date)}</dd>
              </div>
            )}
            <div>
              <dt>Recurrence</dt>
              <dd>
                {instance.recurrence_enabled
                  ? `${instance.recurrence_type} · ${instance.recurrence_basis}`
                  : 'One-time'}
              </dd>
            </div>
            <div>
              <dt>Occurrence</dt>
              <dd>
                <code>{instance.occurrence_key}</code> · version {instance.instance_version}
              </dd>
            </div>
          </dl>
        </section>
        <section className="panel detail-section">
          <div className="section-head">
            <div>
              <p className="eyebrow">Eligibility</p>
              <h2>Where it applies</h2>
            </div>
          </div>
          <dl className="data-list">
            <div>
              <dt>Merchant</dt>
              <dd>{instance.merchant ?? 'Any eligible merchant'}</dd>
            </div>
            <div>
              <dt>Merchant category</dt>
              <dd>{instance.merchant_category ?? 'Not specified'}</dd>
            </div>
            {instance.value_kind === 'percentage_cashback' &&
              instance.cashback_percentage !== null && (
                <div>
                  <dt>Cashback rate</dt>
                  <dd>{instance.cashback_percentage}%</dd>
                </div>
              )}
            {instance.minimum_spend !== null && (
              <div>
                <dt>Minimum spend</dt>
                <dd>
                  {formatQuantity(instance.minimum_spend, {
                    valueKind: 'money',
                    currency: instance.currency,
                  })}
                </dd>
              </div>
            )}
            {instance.website && (
              <div>
                <dt>Website</dt>
                <dd>
                  <a href={instance.website} target="_blank" rel="noreferrer">
                    Open eligible website
                  </a>
                </dd>
              </div>
            )}
            <div>
              <dt>Enrollment</dt>
              <dd>
                {instance.enrollment_required
                  ? instance.enrolled_at
                    ? `Completed ${formatDate(instance.enrolled_at)}`
                    : instance.enrollment_deadline
                      ? `Required by ${formatDate(instance.enrollment_deadline)}`
                      : 'Required'
                  : 'Not required'}
              </dd>
            </div>
          </dl>
          {instance.eligibility_notes && (
            <div className="note-box">
              <strong>Fine print</strong>
              <p>{instance.eligibility_notes}</p>
            </div>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">Redemption history</p>
            <h2>
              {result.data?.redemptions.length ?? 0} usage entr
              {result.data?.redemptions.length === 1 ? 'y' : 'ies'}
            </h2>
          </div>
          {instance.lifecycle_status === 'active' && (
            <button
              className="button button--secondary button--small"
              onClick={() => openRedemption()}
            >
              Record usage
            </button>
          )}
        </div>
        {!result.data?.redemptions.length ? (
          <div className="inline-empty">
            <span aria-hidden="true">
              <Icon name="inbox" />
            </span>
            <p>No usage recorded for this period.</p>
          </div>
        ) : (
          <div className="redemption-list">
            {result.data.redemptions.map((redemption) => (
              <article key={redemption.id}>
                <div className="redemption-amount">
                  <strong>{formatQuantity(redemption.quantity, quantityOptions)}</strong>
                  <span>{formatDate(redemption.used_on)}</span>
                </div>
                <div className="redemption-copy">
                  <strong>{redemption.merchant ?? 'Usage'}</strong>
                  <span>{redemption.transaction_description ?? 'No transaction description'}</span>
                  {redemption.notes && <small>{redemption.notes}</small>}
                </div>
                <div className="redemption-actions">
                  <button className="text-button" onClick={() => openRedemption(redemption)}>
                    Edit
                  </button>
                  <button
                    className="text-button text-button--danger"
                    onClick={() => void removeRedemption(redemption)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      {instance.notes && (
        <section className="panel detail-section">
          <p className="eyebrow">Private notes</p>
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
                <h2 id="redemption-title">{editingRedemption ? 'Edit usage' : 'Record usage'}</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setRedemptionOpen(false)}
                aria-label="Close"
              >
                <Icon name="close" />
              </button>
            </div>
            <form className="form-stack" onSubmit={(event) => void saveRedemption(event)}>
              <div className="form-grid">
                <label className="field">
                  <span>Benefit amount used</span>
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
                  <span>Date used</span>
                  <input
                    required
                    type="date"
                    value={form.used_on}
                    onChange={(event) => setForm({ ...form, used_on: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Merchant</span>
                  <input
                    value={form.merchant}
                    onChange={(event) => setForm({ ...form, merchant: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Transaction description</span>
                  <input
                    value={form.transaction_description}
                    onChange={(event) =>
                      setForm({ ...form, transaction_description: event.target.value })
                    }
                  />
                </label>
                <label className="field field--wide">
                  <span>Notes</span>
                  <textarea
                    rows={3}
                    value={form.notes}
                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  />
                </label>
              </div>
              {!finite && (
                <div className="info-box">
                  Enter cashback or statement-credit value earned—not the gross purchase amount.
                </div>
              )}
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
                  Cancel
                </button>
                <button type="submit" className="button button--primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save usage'}
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
                <p className="eyebrow">History-safe exception</p>
                <h2 id="override-title">Override this period only</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setOverrideOpen(false)}
                aria-label="Close"
              >
                <Icon name="close" />
              </button>
            </div>
            <form className="form-stack" onSubmit={(event) => void saveOverride(event)}>
              <div className="alert alert--warning">
                This voids the current version for audit and creates a replacement. Other periods
                and the master rules are unchanged.
              </div>
              <div className="form-grid">
                {finite ? (
                  <label className="field">
                    <span>Available quantity</span>
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
                    This period is uncapped. A period override cannot convert its value model to a
                    finite cap.
                  </div>
                )}
                <span />
                <label className="field">
                  <span>Period starts</span>
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
                  <span>Period ends</span>
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
                  <span>Audit reason</span>
                  <textarea
                    required
                    rows={3}
                    value={overrideForm.reason}
                    onChange={(event) =>
                      setOverrideForm({ ...overrideForm, reason: event.target.value })
                    }
                    placeholder="Why this period differs from the recurring definition"
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
                  Cancel
                </button>
                <button type="submit" className="button button--primary" disabled={busy}>
                  {busy ? 'Creating audit version…' : 'Override period'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
