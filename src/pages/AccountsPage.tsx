import { useState, type FormEvent } from 'react';
import { EmptyState, ErrorState, SkeletonRows } from '../components/AsyncState';
import { formatDate } from '../domain/dates';
import { formatQuantity } from '../domain/money';
import { accountInputSchema } from '../domain/validation';
import { useAsync } from '../hooks/useAsync';
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
  type AccountWrite,
} from '../services/api';
import type { Account } from '../types';

const emptyAccount: AccountWrite = {
  display_name: '',
  issuer: '',
  card_service_name: '',
  nickname: null,
  last_four: null,
  annual_fee: null,
  annual_fee_currency: null,
  renewal_date: null,
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
    notes: account.notes,
    is_active: account.is_active,
  };
}

export function AccountsPage() {
  const result = useAsync(listAccounts);
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const [form, setForm] = useState<AccountWrite>(emptyAccount);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function open(account: Account | 'new') {
    setEditing(account);
    setForm(account === 'new' ? emptyAccount : fromAccount(account));
    setError(null);
    setMessage(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = accountInputSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(' '));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editing === 'new') await createAccount(parsed.data);
      else if (editing) await updateAccount(editing.id, parsed.data);
      setEditing(null);
      setMessage('Account saved.');
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the account.');
    } finally {
      setBusy(false);
    }
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
            Only optional last four digits are supported—never store a full card number, CVV,
            password, or banking credential.
          </p>
        </div>
        <button className="button button--primary" onClick={() => open('new')}>
          + Add account
        </button>
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
          Create a reusable account once, then attach benefits to it.
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
                  <dt>Renewal</dt>
                  <dd>{account.renewal_date ? formatDate(account.renewal_date) : 'Not set'}</dd>
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
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-dialog-title"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">Account details</p>
                <h2 id="account-dialog-title">
                  {editing === 'new' ? 'Add an account' : 'Edit account'}
                </h2>
              </div>
              <button className="icon-button" onClick={() => setEditing(null)} aria-label="Close">
                ×
              </button>
            </div>
            <form onSubmit={(event) => void save(event)} className="form-stack">
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
                    placeholder="American Express"
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
                    placeholder="Platinum Card"
                  />
                </label>
                <label className="field">
                  <span>
                    Nickname <small>optional</small>
                  </span>
                  <input
                    value={form.nickname ?? ''}
                    onChange={(event) => setForm({ ...form, nickname: event.target.value || null })}
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
                    placeholder="1234"
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
                  <span>Renewal date</span>
                  <input
                    type="date"
                    value={form.renewal_date ?? ''}
                    onChange={(event) =>
                      setForm({ ...form, renewal_date: event.target.value || null })
                    }
                  />
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
                  <small>
                    Inactive accounts stay in history but are hidden from new-benefit suggestions.
                  </small>
                </span>
              </label>
              {error && (
                <div className="alert alert--danger" role="alert">
                  {error}
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
                <button type="submit" className="button button--primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save account'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
