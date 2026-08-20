import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorState, SkeletonRows } from '../components/AsyncState';
import { benefitInputSchema } from '../domain/validation';
import { useBusinessDate } from '../features/profile/ProfileContext';
import { useAsync } from '../hooks/useAsync';
import { createBenefit, editBenefit, listAccounts, listDefinitions } from '../services/api';
import type {
  BenefitDefinition,
  BenefitInput,
  EditScope,
  RecurrenceType,
  ValueKind,
} from '../types';

const categories = [
  'Travel',
  'Dining',
  'Grocery',
  'Entertainment',
  'Subscription',
  'Transportation',
  'Hotel',
  'Airline',
  'Shopping portal',
  'Membership',
  'Other',
];

function emptyBenefit(today: string): BenefitInput {
  return {
    account_id: null,
    name: '',
    category: 'Travel',
    description: '',
    notes: '',
    value_kind: 'money',
    amount: null,
    currency: 'USD',
    unit_label: null,
    minimum_spend: null,
    cashback_percentage: null,
    cashback_cap: null,
    merchant: null,
    merchant_category: null,
    website: null,
    tags: [],
    eligibility_notes: '',
    enrollment_required: false,
    enrollment_deadline: null,
    enrolled_at: null,
    effective_date: today,
    end_date: null,
    display_reset_date: null,
    recurrence_enabled: false,
    recurrence_type: 'one_time',
    recurrence_basis: 'calendar',
    anchor_date: null,
    interval_months: null,
    expiration_email_enabled: true,
    reactivation_email_enabled: true,
  };
}

function fromDefinition(definition: BenefitDefinition): BenefitInput {
  return {
    account_id: definition.account_id,
    name: definition.name,
    category: definition.category,
    description: definition.description,
    notes: definition.notes,
    value_kind: definition.value_kind,
    amount: definition.amount,
    currency: definition.currency,
    unit_label: definition.unit_label,
    minimum_spend: definition.minimum_spend,
    cashback_percentage: definition.cashback_percentage,
    cashback_cap: definition.cashback_cap,
    merchant: definition.merchant,
    merchant_category: definition.merchant_category,
    website: definition.website,
    tags: [...definition.tags],
    eligibility_notes: definition.eligibility_notes,
    enrollment_required: definition.enrollment_required,
    enrollment_deadline: definition.enrollment_deadline,
    enrolled_at: definition.enrolled_at,
    effective_date: definition.effective_date,
    end_date: definition.end_date,
    display_reset_date: definition.display_reset_date,
    recurrence_enabled: definition.recurrence_enabled,
    recurrence_type: definition.recurrence_type,
    recurrence_basis: definition.recurrence_basis,
    anchor_date: definition.anchor_date,
    interval_months: definition.interval_months,
    expiration_email_enabled: definition.expiration_email_enabled,
    reactivation_email_enabled: definition.reactivation_email_enabled,
  };
}

function numeric(value: string) {
  return value === '' ? null : Number(value);
}

export function BenefitFormPage() {
  const { definitionId } = useParams();
  const navigate = useNavigate();
  const { today } = useBusinessDate();
  const data = useAsync(async () => {
    const [accounts, definitions] = await Promise.all([listAccounts(false), listDefinitions()]);
    return { accounts, definition: definitions.find((item) => item.id === definitionId) ?? null };
  }, [definitionId]);
  const [form, setForm] = useState<BenefitInput>(() => emptyBenefit(today));
  const [hydratedDefinitionId, setHydratedDefinitionId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [editScope, setEditScope] = useState<Exclude<EditScope, 'this_period'>>('future');
  const [effectiveBoundary, setEffectiveBoundary] = useState('');
  const [backfillMonths, setBackfillMonths] = useState(0);
  const [confirmedBackfill, setConfirmedBackfill] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (definitionId && data.data?.definition) {
      setForm(fromDefinition(data.data.definition));
      setHydratedDefinitionId(definitionId);
    }
  }, [data.data?.definition, definitionId]);

  function updateValueKind(valueKind: ValueKind) {
    setForm({
      ...form,
      value_kind: valueKind,
      amount: valueKind === 'percentage_cashback' ? null : form.amount,
      cashback_percentage: valueKind === 'percentage_cashback' ? form.cashback_percentage : null,
      cashback_cap: valueKind === 'percentage_cashback' ? form.cashback_cap : null,
      minimum_spend: ['money', 'percentage_cashback'].includes(valueKind)
        ? form.minimum_spend
        : null,
      currency: ['money', 'percentage_cashback'].includes(valueKind)
        ? (form.currency ?? 'USD')
        : null,
      unit_label: ['points', 'membership', 'other'].includes(valueKind) ? form.unit_label : null,
    });
  }

  function updateRecurrence(recurrenceType: RecurrenceType) {
    const recurring = recurrenceType !== 'one_time';
    const anniversary = recurrenceType === 'custom' ? 'anniversary' : form.recurrence_basis;
    setForm({
      ...form,
      recurrence_enabled: recurring,
      recurrence_type: recurrenceType,
      recurrence_basis: recurring ? anniversary : 'calendar',
      display_reset_date: recurring ? form.display_reset_date : null,
      anchor_date:
        recurring && anniversary === 'anniversary'
          ? (form.anchor_date ?? form.effective_date)
          : null,
      interval_months: recurrenceType === 'custom' ? (form.interval_months ?? 1) : null,
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const normalized: BenefitInput = {
      ...form,
      tags: [...new Set(form.tags.map((tag) => tag.trim()).filter(Boolean))],
      anchor_date:
        form.recurrence_enabled &&
        (form.recurrence_basis === 'anniversary' || form.recurrence_type === 'custom')
          ? (form.anchor_date ?? form.effective_date)
          : null,
    };
    const parsed = benefitInputSchema.safeParse(normalized);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
      );
      document.querySelector<HTMLElement>('[role="alert"]')?.focus();
      return;
    }
    if (!definitionId && backfillMonths > 0 && !confirmedBackfill) {
      setError(
        'Confirm that you want to create historical periods. Backfill never sends reactivation emails.',
      );
      return;
    }
    setBusy(true);
    try {
      if (definitionId) {
        await editBenefit(definitionId, parsed.data, editScope, effectiveBoundary);
        void navigate('/benefits', {
          state: { message: 'Benefit revision saved. Historical periods were preserved.' },
        });
      } else {
        const created = await createBenefit(parsed.data, backfillMonths);
        void navigate(
          created.current_instance_id ? `/instances/${created.current_instance_id}` : '/benefits',
          {
            state: created.current_instance_id
              ? undefined
              : { message: 'Benefit created. Its first period is upcoming.' },
          },
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the benefit.');
    } finally {
      setBusy(false);
    }
  }

  if (data.error) return <ErrorState error={data.error} onRetry={data.refresh} />;
  if (
    data.loading ||
    (definitionId && data.data?.definition && hydratedDefinitionId !== definitionId)
  )
    return <SkeletonRows count={5} />;
  if (definitionId && !data.data?.definition)
    return (
      <ErrorState error={new Error('This benefit was not found or you no longer have access.')} />
    );

  return (
    <form className="benefit-form page-stack" onSubmit={(event) => void submit(event)}>
      <section className="welcome-row">
        <div>
          <p className="eyebrow">{definitionId ? 'Revision-aware edit' : 'New benefit'}</p>
          <h2>
            {definitionId
              ? `Edit ${data.data?.definition?.name}`
              : 'What benefit are you tracking?'}
          </h2>
          <p className="muted">
            Use date-only periods. PerkLedger applies your selected IANA timezone instead of the
            browser timezone.
          </p>
        </div>
        <Link className="button button--secondary" to={definitionId ? '/benefits' : '/dashboard'}>
          Cancel
        </Link>
      </section>

      {definitionId && (
        <section className="panel form-section">
          <div className="form-section-title">
            <span>1</span>
            <div>
              <h2>Apply this change</h2>
              <p>Historical periods are never rewritten.</p>
            </div>
          </div>
          <div className="scope-options">
            <label
              className={`choice-card ${editScope === 'future' ? 'choice-card--selected' : ''}`}
            >
              <input
                type="radio"
                name="scope"
                checked={editScope === 'future'}
                onChange={() => setEditScope('future')}
              />
              <span>
                <strong>Future periods</strong>
                <small>Recommended. Current and historical usage stay unchanged.</small>
              </span>
            </label>
            <label
              className={`choice-card ${editScope === 'current_and_future' ? 'choice-card--selected' : ''}`}
            >
              <input
                type="radio"
                name="scope"
                checked={editScope === 'current_and_future'}
                onChange={() => setEditScope('current_and_future')}
              />
              <span>
                <strong>Current and future</strong>
                <small>
                  Protected value/date changes are rejected if this period has usage or an email
                  attempt.
                </small>
              </span>
            </label>
          </div>
          <label className="field compact-field">
            <span>
              Revision boundary <small>optional</small>
            </span>
            <input
              type="date"
              value={effectiveBoundary}
              onChange={(event) => setEffectiveBoundary(event.target.value)}
            />
          </label>
          <p className="field-help">
            Leave blank to use the next period boundary (or the current period start for
            current-and-future). A custom date must exactly match an existing occurrence boundary.
            For one period, use “Override this period.”
          </p>
        </section>
      )}

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '2' : '1'}</span>
          <div>
            <h2>Basics</h2>
            <p>Name the benefit and attach it to a reusable account.</p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field field--wide">
            <span>Benefit name</span>
            <input
              required
              maxLength={160}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="$15 monthly rideshare credit"
            />
          </label>
          <label className="field">
            <span>Card, account, or provider</span>
            <select
              value={form.account_id ?? ''}
              onChange={(event) => setForm({ ...form, account_id: event.target.value || null })}
            >
              <option value="">Unassigned</option>
              {data.data?.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name}
                </option>
              ))}
            </select>
            <small>
              <Link to="/accounts">Manage accounts</Link>
            </small>
          </label>
          <label className="field">
            <span>Category</span>
            <input
              required
              list="benefit-categories"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
            />
            <datalist id="benefit-categories">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </label>
          <label className="field field--wide">
            <span>Description</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="A concise summary of what this benefit provides."
            />
          </label>
          <label className="field field--wide">
            <span>Private notes</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Enrollment steps, exclusions, or a confirmation number—never credentials."
            />
          </label>
        </div>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '3' : '2'}</span>
          <div>
            <h2>Value</h2>
            <p>Track what you receive, not a gross card transaction.</p>
          </div>
        </div>
        <div className="segmented" aria-label="Benefit value type">
          {(
            [
              ['money', 'Fixed credit'],
              ['percentage_cashback', 'Cashback %'],
              ['points', 'Points'],
              ['membership', 'Membership'],
              ['other', 'Other'],
            ] as Array<[ValueKind, string]>
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={form.value_kind === value ? 'segmented--active' : ''}
              onClick={() => updateValueKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="form-grid form-grid--compact">
          {form.value_kind !== 'percentage_cashback' && (
            <label className="field">
              <span>{form.value_kind === 'money' ? 'Benefit amount' : 'Quantity'}</span>
              <input
                required
                type="number"
                min={form.value_kind === 'points' ? '1' : '0.01'}
                step={form.value_kind === 'points' ? '1' : '0.01'}
                value={form.amount ?? ''}
                onChange={(event) => setForm({ ...form, amount: numeric(event.target.value) })}
              />
            </label>
          )}
          {form.value_kind === 'percentage_cashback' && (
            <>
              <label className="field">
                <span>Cashback percentage</span>
                <div className="input-suffix">
                  <input
                    required
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={form.cashback_percentage ?? ''}
                    onChange={(event) =>
                      setForm({ ...form, cashback_percentage: numeric(event.target.value) })
                    }
                  />
                  <span>%</span>
                </div>
              </label>
              <label className="field">
                <span>
                  Cashback cap <small>blank = uncapped</small>
                </span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.cashback_cap ?? ''}
                  onChange={(event) =>
                    setForm({ ...form, cashback_cap: numeric(event.target.value) })
                  }
                />
              </label>
            </>
          )}
          {['money', 'percentage_cashback'].includes(form.value_kind) && (
            <label className="field">
              <span>Currency</span>
              <input
                required
                maxLength={3}
                value={form.currency ?? ''}
                onChange={(event) =>
                  setForm({ ...form, currency: event.target.value.toUpperCase() || null })
                }
              />
            </label>
          )}
          {['points', 'membership', 'other'].includes(form.value_kind) && (
            <label className="field">
              <span>Unit label</span>
              <input
                required
                value={form.unit_label ?? ''}
                onChange={(event) => setForm({ ...form, unit_label: event.target.value || null })}
                placeholder={form.value_kind === 'points' ? 'points' : 'uses'}
              />
            </label>
          )}
          {['money', 'percentage_cashback'].includes(form.value_kind) && (
            <label className="field">
              <span>
                Minimum spend <small>optional</small>
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.minimum_spend ?? ''}
                onChange={(event) =>
                  setForm({ ...form, minimum_spend: numeric(event.target.value) })
                }
              />
            </label>
          )}
        </div>
        <p className="field-help">
          Fiat inputs support two decimals. Uncapped cashback stays “Uncapped”; usage records
          cashback earned, not purchase spend.
        </p>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '4' : '3'}</span>
          <div>
            <h2>Eligibility</h2>
            <p>Capture both searchable details and the full fine print.</p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Merchant</span>
            <input
              value={form.merchant ?? ''}
              onChange={(event) => setForm({ ...form, merchant: event.target.value || null })}
              placeholder="Saks Fifth Avenue"
            />
          </label>
          <label className="field">
            <span>Merchant category</span>
            <input
              value={form.merchant_category ?? ''}
              onChange={(event) =>
                setForm({ ...form, merchant_category: event.target.value || null })
              }
              placeholder="Department store"
            />
          </label>
          <label className="field field--wide">
            <span>Eligible website</span>
            <input
              type="url"
              value={form.website ?? ''}
              onChange={(event) => setForm({ ...form, website: event.target.value || null })}
              placeholder="https://example.com"
            />
          </label>
          <label className="field field--wide">
            <span>Tags</span>
            <div className="tag-input">
              {form.tags.map((tag) => (
                <button
                  type="button"
                  key={tag}
                  onClick={() =>
                    setForm({ ...form, tags: form.tags.filter((value) => value !== tag) })
                  }
                  aria-label={`Remove ${tag}`}
                >
                  {tag} ×
                </button>
              ))}
              <input
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.key === 'Enter' || event.key === ',') && tagInput.trim()) {
                    event.preventDefault();
                    setForm({ ...form, tags: [...form.tags, tagInput.trim()] });
                    setTagInput('');
                  }
                }}
                placeholder="Type a tag and press Enter"
              />
            </div>
          </label>
          <label className="field field--wide">
            <span>Eligibility notes</span>
            <textarea
              rows={4}
              value={form.eligibility_notes}
              onChange={(event) => setForm({ ...form, eligibility_notes: event.target.value })}
              placeholder="Valid only for prepaid reservations booked through the provider portal…"
            />
          </label>
        </div>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '5' : '4'}</span>
          <div>
            <h2>Dates & recurrence</h2>
            <p>Calendar periods use real month boundaries—not a fixed number of days.</p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Effective date</span>
            <input
              required
              type="date"
              value={form.effective_date}
              onChange={(event) =>
                setForm({
                  ...form,
                  effective_date: event.target.value,
                  anchor_date:
                    form.anchor_date === form.effective_date
                      ? event.target.value
                      : form.anchor_date,
                })
              }
            />
          </label>
          <label className="field">
            <span>
              {form.recurrence_type === 'one_time' ? 'Expiration/end date' : 'Final end date'}{' '}
              <small>{form.recurrence_type === 'one_time' ? 'required' : 'optional'}</small>
            </span>
            <input
              required={form.recurrence_type === 'one_time'}
              type="date"
              value={form.end_date ?? ''}
              onChange={(event) => setForm({ ...form, end_date: event.target.value || null })}
            />
          </label>
          <label className="field">
            <span>Recurrence</span>
            <select
              value={form.recurrence_type}
              onChange={(event) => updateRecurrence(event.target.value as RecurrenceType)}
            >
              <option value="one_time">One-time</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="semiannual">Semiannual</option>
              <option value="annual">Annual</option>
              <option value="custom">Custom month interval</option>
            </select>
          </label>
          {form.recurrence_enabled && (
            <label className="field">
              <span>
                Display reset date <small>optional</small>
              </span>
              <input
                type="date"
                value={form.display_reset_date ?? ''}
                onChange={(event) =>
                  setForm({ ...form, display_reset_date: event.target.value || null })
                }
              />
              <small>
                Informational only. Period boundaries use the recurrence basis and anchor date.
              </small>
            </label>
          )}
          {form.recurrence_enabled && form.recurrence_type !== 'custom' && (
            <label className="field">
              <span>Period basis</span>
              <select
                value={form.recurrence_basis}
                onChange={(event) => {
                  const basis = event.target.value as BenefitInput['recurrence_basis'];
                  setForm({
                    ...form,
                    recurrence_basis: basis,
                    anchor_date:
                      basis === 'anniversary' ? (form.anchor_date ?? form.effective_date) : null,
                  });
                }}
              >
                <option value="calendar">Calendar periods</option>
                <option value="anniversary">Anchored to a date</option>
              </select>
            </label>
          )}
          {form.recurrence_enabled &&
            (form.recurrence_basis === 'anniversary' || form.recurrence_type === 'custom') && (
              <label className="field">
                <span>Original anchor date</span>
                <input
                  required
                  type="date"
                  value={form.anchor_date ?? form.effective_date}
                  onChange={(event) => setForm({ ...form, anchor_date: event.target.value })}
                />
              </label>
            )}
          {form.recurrence_type === 'custom' && (
            <label className="field">
              <span>Repeat every</span>
              <div className="input-suffix">
                <input
                  required
                  type="number"
                  min="1"
                  max="120"
                  step="1"
                  value={form.interval_months ?? 1}
                  onChange={(event) =>
                    setForm({ ...form, interval_months: numeric(event.target.value) })
                  }
                />
                <span>months</span>
              </div>
            </label>
          )}
        </div>
        {form.recurrence_enabled && (
          <div className="info-box">
            End-of-month anchors use the last valid day without drift. A Feb 29 annual benefit uses
            Feb 28 in non-leap years and returns to Feb 29 in leap years.
          </div>
        )}
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '6' : '5'}</span>
          <div>
            <h2>Enrollment & reminders</h2>
            <p>
              Reminder email is processed securely on the server, even while this page is closed.
            </p>
          </div>
        </div>
        <div className="form-grid">
          <label className="check-field field--wide">
            <input
              type="checkbox"
              checked={form.enrollment_required}
              onChange={(event) =>
                setForm({
                  ...form,
                  enrollment_required: event.target.checked,
                  enrollment_deadline: event.target.checked ? form.enrollment_deadline : null,
                })
              }
            />
            <span>
              <strong>Enrollment is required</strong>
              <small>Show an attention item until enrollment is recorded.</small>
            </span>
          </label>
          {form.enrollment_required && (
            <>
              <label className="field">
                <span>Enrollment deadline</span>
                <input
                  type="date"
                  value={form.enrollment_deadline ?? ''}
                  onChange={(event) =>
                    setForm({ ...form, enrollment_deadline: event.target.value || null })
                  }
                />
              </label>
              <label className="field">
                <span>
                  Enrolled on <small>optional</small>
                </span>
                <input
                  type="date"
                  value={form.enrolled_at ?? ''}
                  onChange={(event) =>
                    setForm({ ...form, enrolled_at: event.target.value || null })
                  }
                />
              </label>
            </>
          )}
          <label className="check-field">
            <input
              type="checkbox"
              checked={form.expiration_email_enabled}
              onChange={(event) =>
                setForm({ ...form, expiration_email_enabled: event.target.checked })
              }
            />
            <span>
              <strong>Expiration reminder</strong>
              <small>Email 7 days before expiration, with catch-up while still active.</small>
            </span>
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              disabled={!form.recurrence_enabled}
              checked={form.recurrence_enabled && form.reactivation_email_enabled}
              onChange={(event) =>
                setForm({ ...form, reactivation_email_enabled: event.target.checked })
              }
            />
            <span>
              <strong>Available-again email</strong>
              <small>Sent on the local start date of a genuinely new recurring period.</small>
            </span>
          </label>
        </div>
      </section>

      {!definitionId && (
        <details className="panel form-section">
          <summary>Optional historical backfill</summary>
          <p className="muted">
            Normal creation starts with the current period. Generate up to 24 months only when you
            intentionally want older empty history.
          </p>
          <label className="field compact-field">
            <span>Months to backfill</span>
            <input
              type="number"
              min="0"
              max="24"
              value={backfillMonths}
              onChange={(event) => {
                setBackfillMonths(Number(event.target.value));
                setConfirmedBackfill(false);
              }}
            />
          </label>
          {backfillMonths > 0 && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={confirmedBackfill}
                onChange={(event) => setConfirmedBackfill(event.target.checked)}
              />
              <span>
                <strong>I understand these periods will not send reactivation email.</strong>
              </span>
            </label>
          )}
        </details>
      )}

      {error && (
        <div className="alert alert--danger preserve-lines" role="alert" tabIndex={-1}>
          {error}
        </div>
      )}
      <div className="sticky-actions">
        <Link className="button button--secondary" to={definitionId ? '/benefits' : '/dashboard'}>
          Cancel
        </Link>
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? 'Saving safely…' : definitionId ? 'Save new revision' : 'Create benefit'}
        </button>
      </div>
    </form>
  );
}
