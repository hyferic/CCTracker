import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, SkeletonRows } from '../components/AsyncState';
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
import type { Account, CardCatalogProduct, TemplateSelection } from '../types';

function periodPreview(
  template: CardCatalogProduct['templates'][number],
  anniversary: string | null,
  firstQualifyingMonth: string | undefined,
) {
  if (template.fixed_start && template.fixed_end)
    return `${template.fixed_start} – ${template.fixed_end}`;
  if (template.date_strategy === 'account_anniversary')
    return anniversary ? `Annual period anchored ${anniversary}` : 'Anniversary date required';
  if (template.date_strategy === 'qualification_cycle') {
    if (!firstQualifyingMonth) return 'First qualifying month required';
    const [year, month] = firstQualifyingMonth.split('-').map(Number);
    if (!year || !month) return 'First qualifying month required';
    const expectedIndex = year * 12 + month - 1 + 11;
    return `Expected qualification begins ${Math.floor(expectedIndex / 12)}-${String((expectedIndex % 12) + 1).padStart(2, '0')}-01`;
  }
  const cadence =
    typeof template.payload.recurrence_type === 'string'
      ? template.payload.recurrence_type
      : 'calendar';
  return `Current ${cadence} calendar period`;
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

  const products = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (catalog.data ?? []).filter((item) =>
      [item.issuer, item.product_name, ...item.aliases].some((value) =>
        value.toLowerCase().includes(search),
      ),
    );
  }, [catalog.data, query]);

  function open(account: Account | 'new') {
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
          throw new Error(
            'Enter an annual-fee renewal date or a separate benefit anniversary/reset date for the selected anniversary benefit.',
          );
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
          `Account created with ${created.benefits_created} ${created.benefits_created === 1 ? 'benefit' : 'benefits'}${created.benefit_anniversary_inferred ? '. Benefit anniversary was inferred from the renewal date; verify the issuer boundary.' : '.'}`,
        );
      } else if (editing === 'new') {
        await createAccount(parsed);
        setMessage('Custom account created. Add any standard or side benefit manually.');
      } else if (editing) {
        await updateAccount(editing.id, parsed);
        setMessage('Account saved. Existing benefit history was not changed.');
      }
      setEditing(null);
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the account.');
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
    if (
      !window.confirm(
        `Delete ${account.display_name}? Referenced accounts must be deactivated instead.`,
      )
    )
      return;
    try {
      await deleteAccount(account.id);
      setMessage('Account deleted.');
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the account.');
    }
  }

  if (result.error) return <ErrorState error={result.error} onRetry={result.refresh} />;
  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">Cards, services & portals</p>
          <h2>Keep providers organized.</h2>
          <p className="muted">
            Choose an exact U.S. consumer card to preview standard benefits, or create a custom
            account. Never store a full card number, CVV, password, or banking credential.
          </p>
        </div>
        <div className="card-actions">
          <Link className="button button--secondary" to="/benefits/new">
            + Add custom benefit
          </Link>
          <button className="button button--primary" onClick={() => open('new')}>
            + Add account
          </button>
        </div>
      </section>
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
          title="No cards or providers yet"
          action={
            <button className="button button--primary" onClick={() => open('new')}>
              Add an account
            </button>
          }
        >
          Choose a catalog card or create a custom provider, then add or edit benefits at any time.
        </EmptyState>
      ) : (
        <section className="account-grid" aria-label="Cards and accounts">
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
                  {account.is_active ? 'Active' : 'Inactive'}
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
                  <dt>Annual fee</dt>
                  <dd>
                    {account.annual_fee === null
                      ? 'Not set'
                      : formatQuantity(account.annual_fee, {
                          valueKind: 'money',
                          currency: account.annual_fee_currency,
                        })}
                  </dd>
                </div>
                <div>
                  <dt>Fee renewal</dt>
                  <dd>{account.renewal_date ? formatDate(account.renewal_date) : 'Not set'}</dd>
                </div>
                <div>
                  <dt>Benefit anniversary</dt>
                  <dd>
                    {account.benefit_anniversary_date
                      ? formatDate(account.benefit_anniversary_date)
                      : 'Not set'}
                  </dd>
                </div>
              </dl>
              {account.notes && <p className="account-notes">{account.notes}</p>}
              <div className="card-actions">
                <button className="button button--secondary" onClick={() => open(account)}>
                  Edit
                </button>
                <button
                  className="text-button text-button--danger"
                  onClick={() => void remove(account)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {editing && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-dialog-title"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">
                  {editing === 'new' ? `Step ${step} of 3` : 'Account details'}
                </p>
                <h2 id="account-dialog-title">
                  {editing === 'new' ? 'Add an account' : 'Edit account'}
                </h2>
              </div>
              <button className="icon-button" onClick={() => setEditing(null)} aria-label="Close">
                ×
              </button>
            </div>

            {editing === 'new' && step === 1 && (
              <div className="form-stack">
                <div>
                  <h3>Choose the exact card product</h3>
                  <p className="muted">
                    This non-exhaustive catalog covers selected U.S. consumer cards. Issuer terms
                    control; this is not financial advice. Authorized-user cards can duplicate
                    benefits.
                  </p>
                </div>
                {catalog.error && (
                  <div className="alert alert--warning" role="status">
                    The catalog is unavailable. Custom account and manual benefit entry remain
                    available.
                  </div>
                )}
                {!catalog.error && (
                  <label className="field">
                    <span>Search issuer or card</span>
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Chase Sapphire, Amex, Capital One…"
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
                            {item.templates.length} tracked benefit
                            {item.templates.length === 1 ? '' : 's'} · verified {item.verified_on}
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
                        <strong>Custom card, service, or portal</strong>
                        <small>Enter details yourself and add benefits manually.</small>
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
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={!product && !customChosen}
                    onClick={() => setStep(2)}
                  >
                    Continue to details
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
                    <span>Display name</span>
                    <input
                      required
                      maxLength={120}
                      value={form.display_name}
                      onChange={(event) => setForm({ ...form, display_name: event.target.value })}
                      placeholder="Amex Platinum — Personal"
                    />
                  </label>
                  <label className="field">
                    <span>Issuer/provider</span>
                    <input
                      required
                      value={form.issuer}
                      onChange={(event) => setForm({ ...form, issuer: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Card/service name</span>
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
                      Nickname <small>optional</small>
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
                      Last four <small>optional</small>
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
                    <span>Annual fee</span>
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
                    <span>Currency</span>
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
                    <span>Annual-fee renewal date</span>
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
                    <small>Fee or membership renewal only—not a benefit reset.</small>
                  </label>
                  <label className="field">
                    <span>Benefit anniversary/reset date</span>
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
                        ? 'Auto-filled from the annual-fee renewal date. Verify the issuer benefit boundary; you can override it here.'
                        : 'Used for selected anniversary benefits. Calendar-year benefits do not use this date.'}
                    </small>
                  </label>
                  <label className="field field--wide">
                    <span>Notes</span>
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
                    <strong>Active account</strong>
                    <small>Inactive accounts stay in history.</small>
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
                      Back
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button--secondary"
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="button button--primary" disabled={busy}>
                    {editing === 'new' && product
                      ? 'Preview benefits'
                      : busy
                        ? 'Saving…'
                        : 'Save account'}
                  </button>
                </div>
              </form>
            )}

            {editing === 'new' && step === 3 && product && (
              <form onSubmit={(event) => void save(event)} className="form-stack">
                <div>
                  <h3>Choose benefits to create</h3>
                  <p className="muted">
                    These become ordinary editable benefits. Catalog changes never overwrite them,
                    and custom or side offers can be added later.
                  </p>
                </div>
                {product.age_days > 90 && (
                  <div className="alert alert--warning">
                    Catalog facts are {product.age_days} days old. Verify current issuer terms.
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
                        <span>{item.date_strategy.replaceAll('_', ' ')}</span>
                        <span>
                          Next:{' '}
                          {periodPreview(
                            item,
                            form.benefit_anniversary_date,
                            setupMonths[item.template_version_id],
                          )}
                        </span>
                        <span>
                          {item.payload.enrollment_required
                            ? 'Enrollment required'
                            : 'No enrollment marker'}
                        </span>
                        {item.fixed_end && <span>Ends {item.fixed_end}</span>}
                        <span>{item.confidence}</span>
                      </div>
                      {item.setup_field === 'first_qualifying_month' &&
                        selected.has(item.template_version_id) && (
                          <label className="field">
                            <span>First qualifying month</span>
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
                            <small>
                              Creates an Upcoming estimate after 11 qualifying months. Reminders
                              remain off.
                            </small>
                          </label>
                        )}
                      <p className="muted">
                        {typeof item.payload.eligibility_notes === 'string'
                          ? item.payload.eligibility_notes
                          : ''}
                      </p>
                      <a href={item.official_url} target="_blank" rel="noopener noreferrer">
                        Issuer source · verified {item.verified_on}
                      </a>
                    </article>
                  ))}
                </div>
                <p className="muted">
                  Benefits can depend on opening date, authorized-user status, targeting,
                  enrollment, and issuer changes. Confirm every term with the issuer.
                </p>
                {product.age_days > 180 && (
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={staleAcknowledged}
                      onChange={(event) => setStaleAcknowledged(event.target.checked)}
                    />
                    <span>
                      <strong>I reviewed current issuer terms</strong>
                      <small>Required because this catalog version is over 180 days old.</small>
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
                    Back
                  </button>
                  <button
                    type="submit"
                    className="button button--primary"
                    disabled={busy || (product.age_days > 180 && !staleAcknowledged)}
                  >
                    {busy
                      ? 'Creating…'
                      : `Create account and ${selected.size} benefit${selected.size === 1 ? '' : 's'}`}
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
