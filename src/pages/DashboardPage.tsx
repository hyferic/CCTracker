import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BenefitTable } from '../components/BenefitTable';
import { EmptyState, ErrorState, SkeletonRows } from '../components/AsyncState';
import { formatDate } from '../domain/dates';
import { formatQuantity } from '../domain/money';
import { useBusinessDate } from '../features/profile/ProfileContext';
import { useAsync } from '../hooks/useAsync';
import {
  listAccounts,
  listInstances,
  confirmBenefitPeriodUsed,
  schedulerHealth,
} from '../services/api';
import type { BenefitInstance, DashboardFilters } from '../types';

const initialFilters: DashboardFilters = {
  query: '',
  account: '',
  provider: '',
  category: '',
  lifecycle: '',
  usage: '',
  recurrence: '',
  expiration: '',
  enrollment: '',
  merchant: '',
  active: 'active',
  audit: 'live',
  sort: 'attention',
};

function filterInstances(instances: BenefitInstance[], filters: DashboardFilters) {
  const query = filters.query.trim().toLowerCase();
  const rows = instances.filter((instance) => {
    const searchable =
      instance.search_text ||
      [
        instance.benefit_name,
        instance.account_display_name,
        instance.issuer,
        instance.category,
        instance.merchant,
        instance.notes,
      ]
        .filter(Boolean)
        .join(' ');
    return (
      (!query || searchable.toLowerCase().includes(query)) &&
      (!filters.account || instance.account_id === filters.account) &&
      (!filters.provider || instance.issuer === filters.provider) &&
      (!filters.category || instance.category === filters.category) &&
      (!filters.lifecycle || instance.lifecycle_status === filters.lifecycle) &&
      (!filters.usage || instance.usage_status === filters.usage) &&
      (!filters.recurrence ||
        (filters.recurrence === 'recurring'
          ? instance.recurrence_enabled
          : !instance.recurrence_enabled)) &&
      (!filters.expiration ||
        (filters.expiration === '7'
          ? instance.days_remaining >= 0 && instance.days_remaining <= 7
          : filters.expiration === '30'
            ? instance.days_remaining >= 0 && instance.days_remaining <= 30
            : instance.days_remaining > 30)) &&
      (!filters.enrollment ||
        (filters.enrollment === 'required'
          ? instance.enrollment_required && !instance.enrolled_at
          : Boolean(instance.enrolled_at))) &&
      (!filters.merchant ||
        instance.merchant?.toLowerCase().includes(filters.merchant.toLowerCase())) &&
      (!filters.active ||
        (filters.active === 'active' ? instance.definition_active : !instance.definition_active)) &&
      (filters.audit === 'all' ||
        (filters.audit === 'void' ? instance.is_audit_version : instance.is_live))
    );
  });
  return rows.sort((a, b) => {
    if (filters.sort === 'name') return a.benefit_name.localeCompare(b.benefit_name);
    if (filters.sort === 'remaining')
      return (b.remaining_quantity ?? -1) - (a.remaining_quantity ?? -1);
    if (filters.sort === 'expiration') return a.period_end.localeCompare(b.period_end);
    return attentionScore(b) - attentionScore(a) || a.period_end.localeCompare(b.period_end);
  });
}

type ExpirationBucket = '7' | '30' | 'month';

const expirationBucketLabels: Record<ExpirationBucket, string> = {
  '7': 'Expiring in 7 days',
  '30': 'Expiring in 30 days',
  month: 'Expiring this month',
};

export function DashboardPage() {
  const [filters, setFilters] = useState(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [view, setView] = useState<'all' | 'month'>('all');
  const [expirationBucket, setExpirationBucket] = useState<ExpirationBucket>('7');
  const [merchantInstanceId, setMerchantInstanceId] = useState<string | null>(null);
  const [confirmingInstanceId, setConfirmingInstanceId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { today } = useBusinessDate();
  const includeAuditVersions = filters.audit !== 'live';
  const result = useAsync(async () => {
    const [instances, accounts, health] = await Promise.all([
      listInstances({ includeAuditVersions }),
      listAccounts(),
      schedulerHealth(),
    ]);
    return { instances, accounts, health };
  }, [includeAuditVersions]);

  const instances = useMemo(() => result.data?.instances ?? [], [result.data?.instances]);
  const monthBounds = useMemo(() => {
    const parts = today.split('-').map(Number);
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      start: `${today.slice(0, 8)}01`,
      end: `${today.slice(0, 8)}${String(lastDay).padStart(2, '0')}`,
    };
  }, [today]);
  const filtered = useMemo(() => {
    const base = filterInstances(instances, filters);
    if (view === 'all') return base;
    return base.filter(
      (item) =>
        item.is_live &&
        item.lifecycle_status === 'active' &&
        item.period_end >= monthBounds.start &&
        item.period_end <= monthBounds.end,
    );
  }, [instances, filters, monthBounds, view]);
  const active = instances.filter(
    (item) => item.is_live && item.lifecycle_status === 'active' && item.definition_active,
  );
  const accountById = useMemo(
    () => new Map((result.data?.accounts ?? []).map((account) => [account.id, account])),
    [result.data?.accounts],
  );
  const expirationDetails = useMemo(() => {
    return active
      .filter((item) => item.usage_status !== 'used')
      .filter((item) => {
        if (expirationBucket === '7') return item.days_remaining >= 0 && item.days_remaining <= 7;
        if (expirationBucket === '30') return item.days_remaining >= 0 && item.days_remaining <= 30;
        return item.period_end >= monthBounds.start && item.period_end <= monthBounds.end;
      })
      .sort(
        (a, b) =>
          a.period_end.localeCompare(b.period_end) || a.benefit_name.localeCompare(b.benefit_name),
      );
  }, [active, expirationBucket, monthBounds]);
  const categories = [...new Set(instances.map((item) => item.category))].sort();
  const providers = [
    ...new Set(instances.map((item) => item.issuer).filter(Boolean)),
  ].sort() as string[];
  const activeFilterCount = Object.entries(filters).filter(
    ([key, value]) =>
      !['query', 'sort'].includes(key) &&
      value &&
      !(key === 'active' && value === 'active') &&
      !(key === 'audit' && value === 'live'),
  ).length;

  async function confirmUsed(instance: BenefitInstance) {
    const amount = formatQuantity(instance.remaining_quantity, {
      valueKind: instance.value_kind,
      currency: instance.currency,
      unitLabel: instance.unit_label,
    });
    if (
      !window.confirm(
        `Confirm that you used the remaining ${amount} of “${instance.benefit_name}”?`,
      )
    )
      return;
    setConfirmingInstanceId(instance.instance_id);
    setActionMessage(null);
    setActionError(null);
    try {
      await confirmBenefitPeriodUsed(instance.instance_id, today, 'Confirmed used from dashboard.');
      setActionMessage(
        instance.recurrence_type === 'one_time'
          ? 'Usage confirmed and the one-time benefit was archived.'
          : 'Usage confirmed. The next benefit period is ready when available.',
      );
      result.refresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Could not confirm usage.');
    } finally {
      setConfirmingInstanceId(null);
    }
  }

  if (result.error) return <ErrorState error={result.error} onRetry={result.refresh} />;

  return (
    <div className="page-stack">
      {result.data?.health.is_stale && (
        <div className="health-warning" role="alert">
          <strong>Reminder processing needs attention.</strong>
          <span>No successful scheduler run has been recorded in more than 36 hours.</span>
          <Link to="/settings">View recovery steps</Link>
        </div>
      )}
      {(actionMessage || actionError) && (
        <div className={`alert ${actionError ? 'alert--danger' : 'alert--success'}`} role="status">
          {actionMessage ?? actionError}
        </div>
      )}
      <section className="welcome-row">
        <div>
          <p className="eyebrow">At a glance</p>
          <h2>Make every benefit count.</h2>
          <p className="muted">Prioritized by what needs your attention today.</p>
        </div>
        <Link className="button button--primary desktop-only" to="/benefits/new">
          + Add benefit
        </Link>
      </section>
      {result.loading ? (
        <SkeletonRows count={3} />
      ) : instances.length === 0 ? (
        <EmptyState
          title="Add your first benefit"
          action={
            <Link className="button button--primary" to="/benefits/new">
              Add benefit
            </Link>
          }
        >
          Start with a monthly credit, an annual travel benefit, or a cashback offer.
        </EmptyState>
      ) : (
        <>
          <section className="summary-grid" aria-label="Benefit expiration highlights">
            {(['7', '30', 'month'] as ExpirationBucket[]).map((bucket) => {
              const count = active.filter((item) => {
                if (item.usage_status === 'used') return false;
                if (bucket === '7') return item.days_remaining >= 0 && item.days_remaining <= 7;
                if (bucket === '30') return item.days_remaining >= 0 && item.days_remaining <= 30;
                return item.period_end >= monthBounds.start && item.period_end <= monthBounds.end;
              }).length;
              return (
                <button
                  className={`summary-card ${expirationBucket === bucket ? 'summary-card--selected' : ''}`}
                  type="button"
                  key={bucket}
                  aria-pressed={expirationBucket === bucket}
                  onClick={() => {
                    setExpirationBucket(bucket);
                    setMerchantInstanceId(null);
                  }}
                >
                  <div className="summary-icon" aria-hidden="true">
                    {bucket === '7' ? '!' : bucket === '30' ? '◷' : '▦'}
                  </div>
                  <p>{expirationBucketLabels[bucket]}</p>
                  <strong>{count}</strong>
                  <span>{count ? 'Tap to review benefits' : 'Nothing due'}</span>
                </button>
              );
            })}
          </section>
          <section className="panel attention-panel" aria-labelledby="attention-heading">
            <div className="section-head">
              <div>
                <p className="eyebrow">Needs attention</p>
                <h2 id="attention-heading">{expirationBucketLabels[expirationBucket]}</h2>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={() =>
                  setFilters({
                    ...initialFilters,
                    expiration: expirationBucket === '7' ? '7' : '30',
                  })
                }
              >
                View in all benefits
              </button>
            </div>
            {expirationDetails.length === 0 ? (
              <div className="attention-empty">No unused benefits are due in this period.</div>
            ) : (
              <div className="attention-list">
                {expirationDetails.map((item) => {
                  const account = item.account_id ? accountById.get(item.account_id) : undefined;
                  const cardLabel =
                    account?.display_name ??
                    item.account_display_name ??
                    item.issuer ??
                    'Unassigned';
                  return (
                    <div className="attention-item" key={item.instance_id}>
                      <Link className="attention-copy" to={`/instances/${item.instance_id}`}>
                        <strong>
                          {cardLabel}
                          {account?.last_four ? ` · •••• ${account.last_four}` : ''}
                        </strong>
                        <small>
                          {item.benefit_name} · Ends {formatDate(item.period_end)}
                        </small>
                      </Link>
                      {item.merchant && (
                        <div className="merchant-popover-wrap">
                          <button
                            className="merchant-button"
                            type="button"
                            aria-expanded={merchantInstanceId === item.instance_id}
                            onClick={() =>
                              setMerchantInstanceId((current) =>
                                current === item.instance_id ? null : item.instance_id,
                              )
                            }
                          >
                            {item.merchant}
                          </button>
                          {merchantInstanceId === item.instance_id && (
                            <div
                              className="merchant-popover"
                              role="dialog"
                              aria-label={`${item.merchant} benefit details`}
                            >
                              <strong>{item.merchant}</strong>
                              {item.merchant_category && <span>{item.merchant_category}</span>}
                              {item.website && (
                                <a href={item.website} target="_blank" rel="noreferrer">
                                  Open website
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        className="text-link attention-confirm"
                        type="button"
                        onClick={() => void confirmUsed(item)}
                        disabled={confirmingInstanceId === item.instance_id}
                      >
                        {confirmingInstanceId === item.instance_id ? 'Saving…' : 'Mark period used'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          <section className="panel">
            <div className="section-head section-head--wrap">
              <div>
                <p className="eyebrow">Benefit views</p>
                <h2>{filtered.length} shown</h2>
              </div>
              <div className="toolbar">
                <button
                  className={`button button--secondary ${view === 'all' ? 'button--active' : ''}`}
                  type="button"
                  onClick={() => setView('all')}
                >
                  All periods
                </button>
                <button
                  className={`button button--secondary ${view === 'month' ? 'button--active' : ''}`}
                  type="button"
                  onClick={() => setView('month')}
                >
                  Due this month
                </button>
              </div>
              <div className="toolbar">
                <label className="search-field">
                  <span className="sr-only">Search benefits</span>
                  <span aria-hidden="true">⌕</span>
                  <input
                    value={filters.query}
                    onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                    placeholder="Search benefits, cards, merchants…"
                  />
                </label>
                <button
                  className={`button button--secondary ${filtersOpen ? 'button--active' : ''}`}
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  Filter{activeFilterCount ? ` (${activeFilterCount})` : ''}
                </button>
              </div>
            </div>
            {filtersOpen && (
              <div className="filters" aria-label="Benefit filters">
                <label>
                  <span>Card/account</span>
                  <select
                    value={filters.account}
                    onChange={(event) => setFilters({ ...filters, account: event.target.value })}
                  >
                    <option value="">All accounts</option>
                    {result.data?.accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Provider</span>
                  <select
                    value={filters.provider}
                    onChange={(event) => setFilters({ ...filters, provider: event.target.value })}
                  >
                    <option value="">All providers</option>
                    {providers.map((provider) => (
                      <option key={provider}>{provider}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Merchant</span>
                  <input
                    value={filters.merchant}
                    onChange={(event) => setFilters({ ...filters, merchant: event.target.value })}
                    placeholder="Filter by merchant"
                  />
                </label>
                <label>
                  <span>Category</span>
                  <select
                    value={filters.category}
                    onChange={(event) => setFilters({ ...filters, category: event.target.value })}
                  >
                    <option value="">All categories</option>
                    {categories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Lifecycle</span>
                  <select
                    value={filters.lifecycle}
                    onChange={(event) =>
                      setFilters({
                        ...filters,
                        lifecycle: event.target.value as DashboardFilters['lifecycle'],
                      })
                    }
                  >
                    <option value="">Any lifecycle</option>
                    <option value="upcoming">Upcoming</option>
                    <option value="active">Active</option>
                    <option value="expired">Expired</option>
                    <option value="void">Void</option>
                  </select>
                </label>
                <label>
                  <span>Usage</span>
                  <select
                    value={filters.usage}
                    onChange={(event) =>
                      setFilters({
                        ...filters,
                        usage: event.target.value as DashboardFilters['usage'],
                      })
                    }
                  >
                    <option value="">Any usage</option>
                    <option value="unused">Unused</option>
                    <option value="partial">Partially used</option>
                    <option value="used">Used</option>
                  </select>
                </label>
                <label>
                  <span>Recurrence</span>
                  <select
                    value={filters.recurrence}
                    onChange={(event) =>
                      setFilters({
                        ...filters,
                        recurrence: event.target.value as DashboardFilters['recurrence'],
                      })
                    }
                  >
                    <option value="">Any recurrence</option>
                    <option value="recurring">Recurring</option>
                    <option value="one_time">One-time</option>
                  </select>
                </label>
                <label>
                  <span>Expiration</span>
                  <select
                    value={filters.expiration}
                    onChange={(event) =>
                      setFilters({
                        ...filters,
                        expiration: event.target.value as DashboardFilters['expiration'],
                      })
                    }
                  >
                    <option value="">Any date</option>
                    <option value="7">Within 7 days</option>
                    <option value="30">Within 30 days</option>
                    <option value="later">More than 30 days</option>
                  </select>
                </label>
                <label>
                  <span>Enrollment</span>
                  <select
                    value={filters.enrollment}
                    onChange={(event) =>
                      setFilters({
                        ...filters,
                        enrollment: event.target.value as DashboardFilters['enrollment'],
                      })
                    }
                  >
                    <option value="">Any enrollment</option>
                    <option value="required">Enrollment needed</option>
                    <option value="complete">Enrollment complete</option>
                  </select>
                </label>
                <label>
                  <span>Definition status</span>
                  <select
                    value={filters.active}
                    onChange={(event) =>
                      setFilters({
                        ...filters,
                        active: event.target.value as DashboardFilters['active'],
                      })
                    }
                  >
                    <option value="">Active and inactive</option>
                    <option value="active">Active only</option>
                    <option value="inactive">Inactive only</option>
                  </select>
                </label>
                <label>
                  <span>Period versions</span>
                  <select
                    value={filters.audit}
                    onChange={(event) =>
                      setFilters({
                        ...filters,
                        audit: event.target.value as DashboardFilters['audit'],
                      })
                    }
                  >
                    <option value="live">Live periods only</option>
                    <option value="all">Live and audit versions</option>
                    <option value="void">Audit versions only</option>
                  </select>
                </label>
                <label>
                  <span>Sort</span>
                  <select
                    value={filters.sort}
                    onChange={(event) =>
                      setFilters({
                        ...filters,
                        sort: event.target.value as DashboardFilters['sort'],
                      })
                    }
                  >
                    <option value="attention">Needs attention</option>
                    <option value="expiration">Expiration</option>
                    <option value="remaining">Remaining value</option>
                    <option value="name">Name</option>
                  </select>
                </label>
                <button
                  className="text-button filter-reset"
                  onClick={() => setFilters(initialFilters)}
                >
                  Clear filters
                </button>
              </div>
            )}
            {filtered.length ? (
              <BenefitTable
                instances={filtered}
                onConfirmUsed={confirmUsed}
                confirmingInstanceId={confirmingInstanceId}
              />
            ) : (
              <EmptyState title="No benefits match these filters">
                <button className="text-button" onClick={() => setFilters(initialFilters)}>
                  Clear filters and show everything
                </button>
              </EmptyState>
            )}
          </section>
        </>
      )}
    </div>
  );
}
