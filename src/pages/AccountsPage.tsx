import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '../components/AsyncState';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { formatDate } from '../domain/dates';
import { formatQuantity } from '../domain/money';
import { accountInputSchema } from '../domain/validation';
import { useAsync } from '../hooks/useAsync';
import {
  createAccount,
  createAccountWithTemplates,
  deleteAccount,
  listAccounts,
  listCardCatalog,
  updateAccount,
  type AccountWrite,
} from '../services/api';
import type { Account, CardCatalogProduct, RecurrenceType, TemplateSelection } from '../types';
import { useI18n, type MessageKey } from '../features/i18n/I18nContext';

type T = (key: MessageKey) => string;

function catalogTypeLabel(type: CardCatalogProduct['card_type'], t: T) {
  switch (type) {
    case 'business':
      return t('accounts.cardType.business');
    case 'student':
      return t('accounts.cardType.student');
    case 'secured':
      return t('accounts.cardType.secured');
    case 'co_branded':
      return t('accounts.cardType.coBranded');
    case 'charge':
      return t('accounts.cardType.charge');
    case 'other':
      return t('accounts.cardType.other');
    default:
      return t('accounts.cardType.consumer');
  }
}

function catalogVerificationLabel(state: CardCatalogProduct['verification_state'], t: T) {
  switch (state) {
    case 'verified':
      return t('accounts.verification.verified');
    case 'limited':
      return t('accounts.verification.limited');
    case 'contingent':
      return t('accounts.verification.contingent');
    default:
      return t('accounts.verification.pending');
  }
}

function dateStrategyLabel(
  strategy: CardCatalogProduct['templates'][number]['date_strategy'],
  t: T,
) {
  switch (strategy) {
    case 'account_anniversary':
      return t('accounts.dateStrategy.accountAnniversary');
    case 'qualification_cycle':
      return t('accounts.dateStrategy.qualificationCycle');
    case 'fixed':
      return t('accounts.dateStrategy.fixed');
    default:
      return t('accounts.dateStrategy.calendar');
  }
}

function periodPreview(
  template: CardCatalogProduct['templates'][number],
  anniversary: string | null,
  firstQualifyingMonth: string | undefined,
  formatRecurrenceType: (type: RecurrenceType) => string,
  locale: string,
  t: T,
) {
  if (template.fixed_start && template.fixed_end)
    return `${formatDate(template.fixed_start, locale)} – ${formatDate(template.fixed_end, locale)}`;
  if (template.date_strategy === 'account_anniversary')
    return anniversary
      ? `${t('accounts.periodPreview.annualAnchored')} ${formatDate(anniversary, locale)}`
      : t('accounts.periodPreview.anniversaryRequired');
  if (template.date_strategy === 'qualification_cycle') {
    if (!firstQualifyingMonth) return t('accounts.periodPreview.firstQualifyingMonthRequired');
    const [year, month] = firstQualifyingMonth.split('-').map(Number);
    if (!year || !month) return t('accounts.periodPreview.firstQualifyingMonthRequired');
    const expectedIndex = year * 12 + month - 1 + 11;
    const expectedDate = `${Math.floor(expectedIndex / 12)}-${String((expectedIndex % 12) + 1).padStart(2, '0')}-01`;
    return `${t('accounts.periodPreview.expectedQualificationBegins')} ${formatDate(expectedDate, locale)}`;
  }
  const rawCadence = template.payload.recurrence_type;
  const cadence =
    typeof rawCadence === 'string' &&
    ['one_time', 'monthly', 'quarterly', 'semiannual', 'annual', 'custom'].includes(rawCadence)
      ? (rawCadence as RecurrenceType)
      : null;
  return cadence
    ? `${t('accounts.periodPreview.current')} ${formatRecurrenceType(cadence)} ${t('accounts.periodPreview.calendarPeriod')}`
    : t('accounts.periodPreview.currentCalendarPeriod');
}

function recurrenceTypeKey(type: RecurrenceType): MessageKey {
  return (
    {
      one_time: 'benefits.oneTime',
      monthly: 'benefitForm.monthly',
      quarterly: 'benefitForm.quarterly',
      semiannual: 'benefitForm.semiannual',
      annual: 'benefitForm.annual',
      custom: 'benefitForm.customMonthInterval',
    } satisfies Record<RecurrenceType, MessageKey>
  )[type];
}

const emptyAccount: AccountWrite = {
  display_name: '',
  issuer: '',
  card_service_name: '',
  nickname: null,
  last_four: null,
  annual_fee: null,
  annual_fee_currency: null,
  renewal_date: null,
  benefit_anniversary_date: null,
  notes: null,
  is_active: true,
};

function fromAccount(account: Account): AccountWrite {
  return {
    display_name: account.display_name,
    issuer: account.issuer,
    card_service_name: account.card_service_name,
    nickname: account.nickname,
    last_four: account.last_four,
    annual_fee: account.annual_fee,
    annual_fee_currency: account.annual_fee_currency,
    renewal_date: account.renewal_date,
    benefit_anniversary_date: account.benefit_anniversary_date,
    notes: account.notes,
    is_active: account.is_active,
  };
}

export function AccountsPage() {
  const { language, t } = useI18n();
  const formatRecurrenceType = (type: RecurrenceType) => t(recurrenceTypeKey(type));
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const result = useAsync(listAccounts);
  const catalog = useAsync(listCardCatalog);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [form, setForm] = useState<AccountWrite>(emptyAccount);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [query, setQuery] = useState('');
  const [product, setProduct] = useState<CardCatalogProduct | null>(null);
  const [customChosen, setCustomChosen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [setupMonths, setSetupMonths] = useState<Record<string, string>>({});
  const [staleAcknowledged, setStaleAcknowledged] = useState(false);
  const [anniversaryDateSource, setAnniversaryDateSource] = useState<
    'renewal_date' | 'manual' | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const products = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (catalog.data ?? []).filter((item) =>
      [item.issuer, item.product_name, ...item.aliases].some((value) =>
        value.toLowerCase().includes(search),
      ),
    );
  }, [catalog.data, query]);

  function open(account: Account | 'new') {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditing(account);
    setForm(account === 'new' ? emptyAccount : fromAccount(account));
    setStep(account === 'new' ? 1 : 2);
    setProduct(null);
    setCustomChosen(false);
    setSelected(new Set());
    setSetupMonths({});
    setStaleAcknowledged(false);
    setAnniversaryDateSource(
      account !== 'new' && account.benefit_anniversary_date ? 'manual' : null,
    );
    setError(null);
    setMessage(null);
  }

  useEffect(() => {
    if (!editing) {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
      return;
    }
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>('button, input, textarea, select, [href]'),
      ).filter((element) => !element.hasAttribute('disabled'));
    focusable()[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setEditing(null);
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
  }, [editing, step]);

  function chooseProduct(next: CardCatalogProduct) {
    setProduct(next);
    setCustomChosen(false);
    setSelected(
      new Set(
        next.templates
          .filter((item) => item.default_selected)
          .map((item) => item.template_version_id),
      ),
    );
    setForm({
      ...emptyAccount,
      display_name: `${next.issuer} ${next.product_name} — Personal`,
      issuer: next.issuer,
      card_service_name: next.product_name,
      annual_fee: next.annual_fee,
      annual_fee_currency: next.annual_fee_currency,
    });
    setAnniversaryDateSource(null);
  }

  function validateAccount() {
    const parsed = accountInputSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(' '));
      return null;
    }
    return parsed.data;
  }

  function hasAnniversaryTemplate() {
    return Boolean(product?.templates.some((item) => item.date_strategy === 'account_anniversary'));
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    const parsed = validateAccount();
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      if (editing === 'new' && product) {
        const templates = product.templates.filter((item) =>
          selected.has(item.template_version_id),
        );
        if (
          templates.some((item) => item.setup_field === 'benefit_anniversary_date') &&
          !parsed.benefit_anniversary_date &&
          !parsed.renewal_date
        )
          throw new Error(t('accounts.anniversaryTemplateRequired'));
        const selections: TemplateSelection[] = templates.map((item) => ({
          template_version_id: item.template_version_id,
          ...(item.setup_field === 'first_qualifying_month'
            ? { setup: { first_qualifying_month: setupMonths[item.template_version_id] } }
            : {}),
        }));
        const created = await createAccountWithTemplates({
          account: parsed,
          productVersionId: product.product_version_id,
          selections,
          staleCatalogAcknowledged: staleAcknowledged,
        });
        setMessage(
          `${t('accounts.createdWithCount')
            .replace('{count}', String(created.benefits_created))
            .replace(
              '{benefits}',
              created.benefits_created === 1 ? t('accounts.benefit') : t('accounts.benefits'),
            )}${created.benefit_anniversary_inferred ? ` ${t('accounts.createdAnniversaryInferred')}` : ''}`,
        );
      } else if (editing === 'new') {
        await createAccount(parsed);
        setMessage(t('accounts.customCreated'));
      } else if (editing) {
        await updateAccount(editing.id, parsed);
        setMessage(t('accounts.saved'));
      }
      setEditing(null);
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('accounts.saveError'));
    } finally {
      setBusy(false);
    }
  }

  function continueFromDetails() {
    if (!validateAccount()) return;
    if (editing === 'new' && product) setStep(3);
    else void save();
  }

  async function remove(account: Account) {
    if (!window.confirm(t('accounts.deletePrompt').replace('{account}', account.display_name)))
      return;
    try {
      await deleteAccount(account.id);
      setMessage(t('accounts.deleted'));
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('accounts.deleteError'));
    }
  }

  if (result.error) return <ErrorState error={result.error} onRetry={result.refresh} />;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={t('accounts.eyebrow')}
        title={t('accounts.pageTitle')}
        description={t('accounts.pageDescription')}
        action={
          <div className="card-actions">
            <Link className="button button--secondary" to="/benefits/new">
              {t('accounts.addCustomBenefit')}
            </Link>
            <button className="button button--primary" onClick={() => open('new')}>
              {t('accounts.addAccountPlus')}
            </button>
          </div>
        }
      />
      {message && (
        <div className="alert alert--success" role="status">
          {message}
        </div>
      )}
      {error && !editing && (
        <div className="alert alert--danger" role="alert">
          {error}
        </div>
      )}
      {result.loading ? (
        <SkeletonRows />
      ) : !result.data?.length ? (
        <EmptyState
          title={t('accounts.emptyTitle')}
          action={
            <button className="button button--primary" onClick={() => open('new')}>
              {t('accounts.add')}
            </button>
          }
        >
          {t('accounts.emptyBody')}
        </EmptyState>
      ) : (
        <section className="account-grid" aria-label={t('accounts.accounts')}>
          {result.data.map((account) => (
            <article
              className={`account-card ${!account.is_active ? 'account-card--inactive' : ''}`}
              key={account.id}
            >
              <div className="account-card-top">
                <span className="account-monogram" aria-hidden="true">
                  {account.issuer.slice(0, 1).toUpperCase()}
                </span>
                <span
                  className={`status ${account.is_active ? 'status--success' : 'status--neutral'}`}
                >
                  {account.is_active ? t('benefits.active') : t('benefits.inactive')}
                </span>
              </div>
              <p className="eyebrow">{account.issuer}</p>
              <h2>{account.display_name}</h2>
              <p className="muted">
                {account.card_service_name}
                {account.last_four ? ` · •••• ${account.last_four}` : ''}
              </p>
              <dl className="account-details">
                <div>
                  <dt>{t('accounts.annualFee')}</dt>
                  <dd>
                    {account.annual_fee === null
                      ? t('common.notSet')
                      : formatQuantity(account.annual_fee, {
                          valueKind: 'money',
                          currency: account.annual_fee_currency,
                          locale,
                        })}
                  </dd>
                </div>
                <div>
                  <dt>{t('accounts.renewal')}</dt>
                  <dd>{account.renewal_date ? formatDate(account.renewal_date, locale) : '—'}</dd>
                </div>
                <div>
                  <dt>{t('accounts.benefitAnniversary')}</dt>
                  <dd>
                    {account.benefit_anniversary_date
                      ? formatDate(account.benefit_anniversary_date, locale)
                      : '—'}
                  </dd>
                </div>
              </dl>
              {account.notes && <p className="account-notes">{account.notes}</p>}
              <div className="card-actions">
                <button className="button button--secondary" onClick={() => open(account)}>
                  {t('common.edit')}
                </button>
                <button
                  className="text-button text-button--danger"
                  onClick={() => void remove(account)}
                >
                  {t('common.delete')}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {editing && (
        <div className="modal-backdrop" role="presentation">
          <section
            ref={dialogRef}
            className="modal modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-dialog-title"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">
                  {editing === 'new'
                    ? t('common.stepOfThree').replace('{step}', String(step))
                    : t('accounts.edit')}
                </p>
                <h2 id="account-dialog-title">
                  {editing === 'new' ? t('accounts.add') : t('accounts.edit')}
                </h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setEditing(null)}
                aria-label={t('accounts.close')}
              >
                <Icon name="close" />
              </button>
            </div>

            {editing === 'new' && step === 1 && (
              <div className="form-stack">
                <div>
                  <h3>{t('accounts.chooseCard')}</h3>
                  <p className="muted">{t('accounts.catalogNotice')}</p>
                </div>
                {catalog.error && (
                  <div className="alert alert--warning" role="status">
                    {t('accounts.catalogUnavailable')}
                  </div>
                )}
                {!catalog.error && (
                  <label className="field">
                    <span>{t('accounts.searchIssuerCard')}</span>
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t('accounts.searchPlaceholder')}
                    />
                  </label>
                )}
                {catalog.loading ? (
                  <SkeletonRows count={3} />
                ) : (
                  <div className="catalog-grid">
                    {products.map((item) => (
                      <button
                        type="button"
                        key={item.product_version_id}
                        className={`choice-card catalog-choice ${product?.product_version_id === item.product_version_id ? 'choice-card--selected' : ''}`}
                        onClick={() => chooseProduct(item)}
                      >
                        <span>
                          <strong>
                            {item.issuer} {item.product_name}
                          </strong>
                          <small>
                            {item.templates.length} {t('accounts.trackedBenefits')} ·{' '}
                            {catalogTypeLabel(item.card_type, t)} ·{' '}
                            {catalogVerificationLabel(item.verification_state, t)} ·{' '}
                            {item.official_source_urls?.length ?? 1} {t('accounts.officialSources')}
                          </small>
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`choice-card catalog-choice ${customChosen ? 'choice-card--selected' : ''}`}
                      onClick={() => {
                        setProduct(null);
                        setCustomChosen(true);
                        setSelected(new Set());
                        setForm(emptyAccount);
                      }}
                    >
                      <span>
                        <strong>{t('accounts.customCard')}</strong>
                        <small>{t('accounts.customEntryHelp')}</small>
                      </span>
                    </button>
                  </div>
                )}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => setEditing(null)}
                  >
                    {t('accounts.cancel')}
                  </button>
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={!product && !customChosen}
                    onClick={() => setStep(2)}
                  >
                    {t('accounts.continue')}
                  </button>
                </div>
              </div>
            )}

            {(editing !== 'new' || step === 2) && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  continueFromDetails();
                }}
                className="form-stack"
              >
                <div className="form-grid">
                  <label className="field field--wide">
                    <span>{t('accounts.displayName')}</span>
                    <input
                      required
                      maxLength={120}
                      value={form.display_name}
                      onChange={(event) => setForm({ ...form, display_name: event.target.value })}
                      placeholder={t('accounts.displayNamePlaceholder')}
                    />
                  </label>
                  <label className="field">
                    <span>{t('accounts.issuer')}</span>
                    <input
                      required
                      value={form.issuer}
                      onChange={(event) => setForm({ ...form, issuer: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>{t('accounts.cardName')}</span>
                    <input
                      required
                      value={form.card_service_name}
                      onChange={(event) =>
                        setForm({ ...form, card_service_name: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>
                      {t('accounts.nickname')} <small>{t('common.optional')}</small>
                    </span>
                    <input
                      value={form.nickname ?? ''}
                      onChange={(event) =>
                        setForm({ ...form, nickname: event.target.value || null })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>
                      {t('accounts.lastFour')} <small>{t('common.optional')}</small>
                    </span>
                    <input
                      inputMode="numeric"
                      pattern="\d{4}"
                      maxLength={4}
                      value={form.last_four ?? ''}
                      onChange={(event) =>
                        setForm({ ...form, last_four: event.target.value || null })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t('accounts.annualFee')}</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.annual_fee ?? ''}
                      onChange={(event) => {
                        const annualFee = event.target.value ? Number(event.target.value) : null;
                        setForm({
                          ...form,
                          annual_fee: annualFee,
                          annual_fee_currency:
                            annualFee === null ? null : (form.annual_fee_currency ?? 'USD'),
                        });
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>{t('accounts.currency')}</span>
                    <input
                      maxLength={3}
                      value={form.annual_fee_currency ?? ''}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          annual_fee_currency: event.target.value.toUpperCase() || null,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>{t('accounts.renewal')}</span>
                    <input
                      type="date"
                      value={form.renewal_date ?? ''}
                      onChange={(event) => {
                        const renewalDate = event.target.value || null;
                        setForm((current) => ({
                          ...current,
                          renewal_date: renewalDate,
                          ...(hasAnniversaryTemplate() && anniversaryDateSource !== 'manual'
                            ? { benefit_anniversary_date: renewalDate }
                            : {}),
                        }));
                        if (hasAnniversaryTemplate() && anniversaryDateSource !== 'manual')
                          setAnniversaryDateSource(renewalDate ? 'renewal_date' : null);
                      }}
                    />
                    <small>{t('accounts.renewalHelp')}</small>
                  </label>
                  <label className="field">
                    <span>{t('accounts.benefitAnniversary')}</span>
                    <input
                      type="date"
                      value={form.benefit_anniversary_date ?? ''}
                      onChange={(event) => {
                        setForm({
                          ...form,
                          benefit_anniversary_date: event.target.value || null,
                        });
                        setAnniversaryDateSource(event.target.value ? 'manual' : null);
                      }}
                    />
                    <small>
                      {hasAnniversaryTemplate() && anniversaryDateSource === 'renewal_date'
                        ? t('accounts.anniversaryAutoHelp')
                        : t('accounts.anniversaryHelp')}
                    </small>
                  </label>
                  <label className="field field--wide">
                    <span>{t('accounts.notes')}</span>
                    <textarea
                      rows={3}
                      value={form.notes ?? ''}
                      onChange={(event) => setForm({ ...form, notes: event.target.value || null })}
                    />
                  </label>
                </div>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
                  />
                  <span>
                    <strong>{t('accounts.active')}</strong>
                    <small>{t('accounts.activeHelp')}</small>
                  </span>
                </label>
                {error && (
                  <div className="alert alert--danger" role="alert">
                    {error}
                  </div>
                )}
                <div className="modal-actions">
                  {editing === 'new' && (
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => setStep(1)}
                    >
                      {t('accounts.back')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => setEditing(null)}
                  >
                    {t('accounts.cancel')}
                  </button>
                  <button type="submit" className="button button--primary" disabled={busy}>
                    {editing === 'new' && product
                      ? t('accounts.previewBenefits')
                      : busy
                        ? t('accounts.saving')
                        : t('accounts.saveAccount')}
                  </button>
                </div>
              </form>
            )}

            {editing === 'new' && step === 3 && product && (
              <form onSubmit={(event) => void save(event)} className="form-stack">
                <div>
                  <h3>{t('accounts.chooseBenefits')}</h3>
                  <p className="muted">{t('accounts.chooseBenefitsHelp')}</p>
                </div>
                {product.age_days > 90 && (
                  <div className="alert alert--warning">
                    {t('accounts.catalogAgePrefix')} {product.age_days}{' '}
                    {t('accounts.catalogAgeSuffix')}
                  </div>
                )}
                <div className="template-list">
                  {product.templates.map((item) => (
                    <article className="template-row" key={item.template_version_id}>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={selected.has(item.template_version_id)}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(item.template_version_id);
                              else next.delete(item.template_version_id);
                              return next;
                            })
                          }
                        />
                        <span>
                          <strong>{item.template_name}</strong>
                          <small>{item.summary}</small>
                        </span>
                      </label>
                      <div className="template-meta">
                        <span>{dateStrategyLabel(item.date_strategy, t)}</span>
                        <span>
                          {t('accounts.next')}:{' '}
                          {periodPreview(
                            item,
                            form.benefit_anniversary_date,
                            setupMonths[item.template_version_id],
                            formatRecurrenceType,
                            locale,
                            t,
                          )}
                        </span>
                        <span>
                          {item.payload.enrollment_required
                            ? t('instance.required')
                            : t('accounts.noEnrollmentMarker')}
                        </span>
                        {item.fixed_end && (
                          <span>
                            {t('dashboard.ends')} {formatDate(item.fixed_end, locale)}
                          </span>
                        )}
                        <span>
                          {catalogVerificationLabel(item.verification_state, t)} ·{' '}
                          {item.official_source_urls?.length ?? 1} {t('accounts.sources')}
                        </span>
                      </div>
                      {item.setup_field === 'first_qualifying_month' &&
                        selected.has(item.template_version_id) && (
                          <label className="field">
                            <span>{t('accounts.firstQualifyingMonth')}</span>
                            <input
                              required
                              type="month"
                              value={setupMonths[item.template_version_id] ?? ''}
                              onChange={(event) =>
                                setSetupMonths({
                                  ...setupMonths,
                                  [item.template_version_id]: event.target.value,
                                })
                              }
                            />
                            <small>{t('accounts.firstQualifyingMonthHelp')}</small>
                          </label>
                        )}
                      <p className="muted">
                        {typeof item.payload.eligibility_notes === 'string'
                          ? item.payload.eligibility_notes
                          : ''}
                      </p>
                      <a
                        href={item.official_source_urls?.[0] ?? item.official_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {item.verification_state === 'verified'
                          ? t('accounts.issuerSourceVerified')
                          : t('accounts.issuerSourceReview')}{' '}
                        {catalogVerificationLabel(item.verification_state, t)} ·{' '}
                        {formatDate(item.verified_on, locale)}
                      </a>
                    </article>
                  ))}
                </div>
                <p className="muted">{t('accounts.termsReminder')}</p>
                {product.age_days > 180 && (
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={staleAcknowledged}
                      onChange={(event) => setStaleAcknowledged(event.target.checked)}
                    />
                    <span>
                      <strong>{t('accounts.reviewedTerms')}</strong>
                      <small>{t('accounts.staleCatalogHelp')}</small>
                    </span>
                  </label>
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
                    onClick={() => setStep(2)}
                  >
                    {t('accounts.back')}
                  </button>
                  <button
                    type="submit"
                    className="button button--primary"
                    disabled={busy || (product.age_days > 180 && !staleAcknowledged)}
                  >
                    {busy
                      ? t('accounts.saving')
                      : `${t('accounts.createAccountAnd')} ${selected.size} ${
                          selected.size === 1 ? t('accounts.benefit') : t('accounts.benefits')
                        }`}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
