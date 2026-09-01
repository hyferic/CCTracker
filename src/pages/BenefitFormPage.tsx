import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorState, SkeletonRows } from '../components/AsyncState';
import { PageHeader } from '../components/PageHeader';
import { benefitInputSchema } from '../domain/validation';
import { useBusinessDate } from '../features/profile/ProfileContext';
import { useAsync } from '../hooks/useAsync';
import { createBenefit, editBenefit, listAccounts, listDefinitions } from '../services/api';
import { useI18n } from '../features/i18n/I18nContext';
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

function emptyBenefit(today: string, timezone: string): BenefitInput {
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
    terms_timezone: timezone,
    period_value_rules: [],
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
    terms_timezone: definition.terms_timezone,
    period_value_rules: definition.period_value_rules,
  };
}

function numeric(value: string) {
  return value === '' ? null : Number(value);
}

export function BenefitFormPage() {
  const { definitionId } = useParams();
  const navigate = useNavigate();
  const { today, timezone } = useBusinessDate();
  const { language, t } = useI18n();
  const data = useAsync(async () => {
    const [accounts, definitions] = await Promise.all([listAccounts(false), listDefinitions()]);
    return { accounts, definition: definitions.find((item) => item.id === definitionId) ?? null };
  }, [definitionId]);
  const [form, setForm] = useState<BenefitInput>(() => emptyBenefit(today, timezone));
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
      setError(t('benefitForm.confirmBackfillError'));
      return;
    }
    setBusy(true);
    try {
      if (definitionId) {
        await editBenefit(definitionId, parsed.data, editScope, effectiveBoundary);
        void navigate('/benefits', {
          state: {
            message: t('benefitForm.revisionSaved'),
          },
        });
      } else {
        const created = await createBenefit(parsed.data, backfillMonths);
        void navigate(
          created.current_instance_id ? `/instances/${created.current_instance_id}` : '/benefits',
          {
            state: created.current_instance_id
              ? undefined
              : {
                  message: t('benefitForm.createdUpcoming'),
                },
          },
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('benefitForm.saveError'));
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
    return <ErrorState error={new Error(t('benefitForm.notFound'))} />;

  return (
    <form className="benefit-form page-stack" onSubmit={(event) => void submit(event)}>
      <PageHeader
        eyebrow={definitionId ? t('benefitForm.revisionAwareEdit') : t('benefitForm.newBenefit')}
        title={
          definitionId
            ? `${t('common.edit')} ${data.data?.definition?.name}`
            : t('benefitForm.whatTracking')
        }
        description={t('benefitForm.description')}
        action={
          <Link className="button button--secondary" to={definitionId ? '/benefits' : '/dashboard'}>
            {t('benefitForm.cancel')}
          </Link>
        }
      />

      {definitionId && (
        <section className="panel form-section">
          <div className="form-section-title">
            <span>1</span>
            <div>
              <h2>{t('benefitForm.applyChange')}</h2>
              <p>{t('benefitForm.historicalPeriods')}</p>
            </div>
          </div>
          {data.data?.definition?.origin_template_version_id && (
            <div className="info-box">
              <strong>{t('benefitForm.catalogCreated')}</strong>
              <p>
                {t('benefitForm.template')} {data.data.definition.origin_template_stable_key}{' '}
                {t('common.version')} {data.data.definition.origin_template_version} ·{' '}
                {t('benefitForm.verifiedOn')}{' '}
                {data.data.definition.origin_verified_on ?? t('benefitForm.dateUnavailable')}.
                {data.data.definition.customized_at
                  ? ` ${t('benefitForm.catalogCustomized')}`
                  : ` ${t('benefitForm.catalogRevisionHelp')}`}
              </p>
            </div>
          )}
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
                <strong>{t('benefitForm.futurePeriods')}</strong>
                <small>{t('benefitForm.futurePeriodsHelp')}</small>
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
                <strong>{t('benefitForm.currentAndFuture')}</strong>
                <small>{t('benefitForm.currentAndFutureHelp')}</small>
              </span>
            </label>
          </div>
          <label className="field compact-field">
            <span>
              {t('benefitForm.revisionBoundary')} <small>{t('common.optional')}</small>
            </span>
            <input
              type="date"
              value={effectiveBoundary}
              onChange={(event) => setEffectiveBoundary(event.target.value)}
            />
          </label>
          <p className="field-help">{t('benefitForm.revisionBoundaryHelp')}</p>
        </section>
      )}

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '2' : '1'}</span>
          <div>
            <h2>{t('benefitForm.basics')}</h2>
            <p>{t('benefitForm.basicsHelp')}</p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field field--wide">
            <span>{t('benefitForm.benefitName')}</span>
            <input
              required
              maxLength={160}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder={t('benefitForm.benefitNamePlaceholder')}
            />
          </label>
          <label className="field">
            <span>{t('benefitForm.cardAccountProvider')}</span>
            <select
              value={form.account_id ?? ''}
              onChange={(event) => setForm({ ...form, account_id: event.target.value || null })}
            >
              <option value="">{t('common.unassigned')}</option>
              {data.data?.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name}
                </option>
              ))}
            </select>
            <small>
              <Link to="/accounts">{t('benefitForm.manageAccounts')}</Link>
            </small>
          </label>
          <label className="field">
            <span>{t('benefitForm.category')}</span>
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
            <span>{t('benefitForm.descriptionLabel')}</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder={t('benefitForm.descriptionPlaceholder')}
            />
          </label>
          <label className="field field--wide">
            <span>{t('benefitForm.privateNotes')}</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder={t('benefitForm.privateNotesPlaceholder')}
            />
          </label>
        </div>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '3' : '2'}</span>
          <div>
            <h2>{t('benefitForm.value')}</h2>
            <p>{t('benefitForm.valueHelp')}</p>
          </div>
        </div>
        <div className="segmented" aria-label={t('benefitForm.valueType')}>
          {(
            [
              ['money', t('benefitForm.fixedCredit')],
              ['percentage_cashback', t('benefitForm.cashbackPercent')],
              ['points', t('benefitForm.points')],
              ['membership', t('benefitForm.membership')],
              ['other', t('benefitForm.other')],
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
              <span>
                {form.value_kind === 'money' ? t('benefitForm.amount') : t('benefitForm.quantity')}
              </span>
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
                <span>{t('benefitForm.cashbackPercentage')}</span>
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
                  {t('benefitForm.cashbackCap')} <small>{t('benefitForm.blankUncapped')}</small>
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
              <span>{t('accounts.currency')}</span>
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
              <span>{t('benefitForm.unitLabel')}</span>
              <input
                required
                value={form.unit_label ?? ''}
                onChange={(event) => setForm({ ...form, unit_label: event.target.value || null })}
                placeholder={
                  form.value_kind === 'points'
                    ? t('benefitForm.unitPointsPlaceholder')
                    : t('benefitForm.unitUsesPlaceholder')
                }
              />
            </label>
          )}
          {['money', 'percentage_cashback'].includes(form.value_kind) && (
            <label className="field">
              <span>
                {t('dashboard.minimumSpend')} <small>{t('common.optional')}</small>
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
        <p className="field-help">{t('benefitForm.valueRulesHelp')}</p>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '4' : '3'}</span>
          <div>
            <h2>{t('benefitForm.eligibility')}</h2>
            <p>{t('benefitForm.eligibilityHelp')}</p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>{t('instance.merchant')}</span>
            <input
              value={form.merchant ?? ''}
              onChange={(event) => setForm({ ...form, merchant: event.target.value || null })}
              placeholder={t('benefitForm.merchantPlaceholder')}
            />
          </label>
          <label className="field">
            <span>{t('instance.merchantCategory')}</span>
            <input
              value={form.merchant_category ?? ''}
              onChange={(event) =>
                setForm({ ...form, merchant_category: event.target.value || null })
              }
              placeholder={t('benefitForm.merchantCategoryPlaceholder')}
            />
          </label>
          <label className="field field--wide">
            <span>{t('benefitForm.eligibleWebsite')}</span>
            <input
              type="url"
              value={form.website ?? ''}
              onChange={(event) => setForm({ ...form, website: event.target.value || null })}
              placeholder="https://example.com"
            />
          </label>
          <label className="field field--wide">
            <span>{t('benefitForm.tags')}</span>
            <div className="tag-input">
              {form.tags.map((tag) => (
                <button
                  type="button"
                  key={tag}
                  onClick={() =>
                    setForm({ ...form, tags: form.tags.filter((value) => value !== tag) })
                  }
                  aria-label={`${t('benefitForm.remove')} ${tag}`}
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
                placeholder={t('benefitForm.tagPlaceholder')}
              />
            </div>
          </label>
          <label className="field field--wide">
            <span>{t('benefitForm.eligibilityNotes')}</span>
            <textarea
              rows={4}
              value={form.eligibility_notes}
              onChange={(event) => setForm({ ...form, eligibility_notes: event.target.value })}
              placeholder={t('benefitForm.eligibilityNotesPlaceholder')}
            />
          </label>
        </div>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '5' : '4'}</span>
          <div>
            <h2>{t('benefitForm.datesRecurrence')}</h2>
            <p>{t('benefitForm.datesHelp')}</p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>{t('benefitForm.effectiveDate')}</span>
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
              {form.recurrence_type === 'one_time'
                ? t('benefitForm.expirationDate')
                : t('benefitForm.finalEndDate')}{' '}
              <small>
                {form.recurrence_type === 'one_time' ? t('common.required') : t('common.optional')}
              </small>
            </span>
            <input
              required={form.recurrence_type === 'one_time'}
              type="date"
              value={form.end_date ?? ''}
              onChange={(event) => setForm({ ...form, end_date: event.target.value || null })}
            />
          </label>
          <label className="field">
            <span>{t('benefitForm.recurrence')}</span>
            <select
              value={form.recurrence_type}
              onChange={(event) => updateRecurrence(event.target.value as RecurrenceType)}
            >
              <option value="one_time">{t('benefits.oneTime')}</option>
              <option value="monthly">{t('benefitForm.monthly')}</option>
              <option value="quarterly">{t('benefitForm.quarterly')}</option>
              <option value="semiannual">{t('benefitForm.semiannual')}</option>
              <option value="annual">{t('benefitForm.annual')}</option>
              <option value="custom">{t('benefitForm.customMonthInterval')}</option>
            </select>
          </label>
          {form.recurrence_enabled && (
            <label className="field">
              <span>
                {t('instance.displayReset')} <small>{t('common.optional')}</small>
              </span>
              <input
                type="date"
                value={form.display_reset_date ?? ''}
                onChange={(event) =>
                  setForm({ ...form, display_reset_date: event.target.value || null })
                }
              />
              <small>{t('benefitForm.displayResetHelp')}</small>
            </label>
          )}
          {form.recurrence_enabled && form.recurrence_type !== 'custom' && (
            <label className="field">
              <span>{t('benefitForm.periodBasis')}</span>
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
                <option value="calendar">{t('benefitForm.calendarPeriods')}</option>
                <option value="anniversary">{t('benefitForm.anchoredDate')}</option>
              </select>
            </label>
          )}
          {form.recurrence_enabled &&
            (form.recurrence_basis === 'anniversary' || form.recurrence_type === 'custom') && (
              <label className="field">
                <span>{t('benefitForm.originalAnchorDate')}</span>
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
              <span>{t('benefitForm.repeatEvery')}</span>
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
                <span>{t('benefitForm.months')}</span>
              </div>
            </label>
          )}
        </div>
        {form.recurrence_enabled && (
          <div className="info-box">{t('benefitForm.anchorDriftHelp')}</div>
        )}
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '6' : '5'}</span>
          <div>
            <h2>{t('benefitForm.enrollmentReminders')}</h2>
            <p>{t('benefitForm.remindersHelp')}</p>
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
              <strong>{t('benefitForm.enrollmentRequired')}</strong>
              <small>{t('benefitForm.enrollmentRequiredHelp')}</small>
            </span>
          </label>
          {form.enrollment_required && (
            <>
              <label className="field">
                <span>{t('benefitForm.enrollmentDeadline')}</span>
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
                  {t('benefitForm.enrolledOn')} <small>{t('common.optional')}</small>
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
              <strong>{t('benefitForm.expirationReminder')}</strong>
              <small>{t('benefitForm.expirationReminderHelp')}</small>
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
              <strong>{t('benefitForm.availableAgainEmail')}</strong>
              <small>{t('benefitForm.reactivationReminderHelp')}</small>
            </span>
          </label>
          <label className="field field--wide">
            <span>{t('benefitForm.termsTimezone')}</span>
            <input
              required
              value={form.terms_timezone}
              onChange={(event) => setForm({ ...form, terms_timezone: event.target.value })}
              placeholder={t('benefitForm.termsTimezonePlaceholder')}
            />
            <small>{t('benefitForm.termsTimezoneHelp')}</small>
          </label>
        </div>
      </section>

      <details className="panel form-section" open={form.period_value_rules.length > 0}>
        <summary>{t('benefitForm.advancedValues')}</summary>
        <p className="muted">{t('benefitForm.advancedValuesHelp')}</p>
        <div className="form-stack">
          {form.period_value_rules.map((rule, index) => (
            <div className="form-grid" key={`${rule.calendar_month}-${index}`}>
              <label className="field">
                <span>{t('benefitForm.calendarMonth')}</span>
                <select
                  value={rule.calendar_month}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      period_value_rules: form.period_value_rules.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, calendar_month: Number(event.target.value) }
                          : item,
                      ),
                    })
                  }
                >
                  {Array.from({ length: 12 }, (_, month) => (
                    <option value={month + 1} key={month + 1}>
                      {new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', {
                        month: 'long',
                        timeZone: 'UTC',
                      }).format(new Date(Date.UTC(2024, month, 1)))}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('benefitForm.availableValue')}</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={rule.available_quantity}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      period_value_rules: form.period_value_rules.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, available_quantity: Number(event.target.value) }
                          : item,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="text-button text-button--danger"
                onClick={() =>
                  setForm({
                    ...form,
                    period_value_rules: form.period_value_rules.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
              >
                {t('benefitForm.removeOverride')}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={form.period_value_rules.length >= 12}
            onClick={() => {
              const used = new Set(form.period_value_rules.map((rule) => rule.calendar_month));
              const month = Array.from({ length: 12 }, (_, index) => index + 1).find(
                (candidate) => !used.has(candidate),
              );
              if (month)
                setForm({
                  ...form,
                  period_value_rules: [
                    ...form.period_value_rules,
                    { calendar_month: month, available_quantity: form.amount ?? 1 },
                  ],
                });
            }}
          >
            {t('benefitForm.addMonthOverride')}
          </button>
        </div>
      </details>

      {!definitionId && (
        <details className="panel form-section">
          <summary>{t('benefitForm.historicalBackfill')}</summary>
          <p className="muted">{t('benefitForm.historicalBackfillHelp')}</p>
          <label className="field compact-field">
            <span>{t('benefitForm.monthsToBackfill')}</span>
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
                <strong>{t('benefitForm.backfillAcknowledgement')}</strong>
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
          {t('benefitForm.cancel')}
        </Link>
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy
            ? t('benefitForm.saving')
            : definitionId
              ? t('benefitForm.saveRevision')
              : t('benefitForm.create')}
        </button>
      </div>
    </form>
  );
}
