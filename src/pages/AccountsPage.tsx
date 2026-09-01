import { useMemo, useState, type FormEvent } from 'react';
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
import { recurrenceTypeLabel, useI18n } from '../features/i18n/I18nContext';

function catalogTypeLabel(
  type: CardCatalogProduct['card_type'],
  localize: (english: string, simplifiedChinese: string) => string,
) {
  switch (type) {
    case 'business':
      return localize('Business', '商业卡');
    case 'student':
      return localize('Student', '学生卡');
    case 'secured':
      return localize('Secured', '担保卡');
    case 'co_branded':
      return localize('Co-branded', '联名卡');
    case 'charge':
      return localize('Charge card', '签账卡');
    case 'other':
      return localize('Other', '其他');
    default:
      return localize('Consumer', '消费卡');
  }
}

function catalogVerificationLabel(
  state: CardCatalogProduct['verification_state'],
  localize: (english: string, simplifiedChinese: string) => string,
) {
  switch (state) {
    case 'verified':
      return localize('Verified', '已核验');
    case 'limited':
      return localize('Limited review', '有限核验');
    case 'contingent':
      return localize('Needs qualification review', '需核对资格');
    default:
      return localize('Pending review', '待核验');
  }
}

function dateStrategyLabel(
  strategy: CardCatalogProduct['templates'][number]['date_strategy'],
  localize: (english: string, simplifiedChinese: string) => string,
) {
  switch (strategy) {
    case 'account_anniversary':
      return localize('Account anniversary', '账户周年');
    case 'qualification_cycle':
      return localize('Qualification cycle', '资格周期');
    case 'fixed':
      return localize('Fixed dates', '固定日期');
    default:
      return localize('Calendar', '自然日历');
  }
}

function periodPreview(
  template: CardCatalogProduct['templates'][number],
  anniversary: string | null,
  firstQualifyingMonth: string | undefined,
  localize: (english: string, simplifiedChinese: string) => string,
  formatRecurrenceType: (type: RecurrenceType) => string,
  locale: string,
) {
  if (template.fixed_start && template.fixed_end)
    return `${formatDate(template.fixed_start, locale)} – ${formatDate(template.fixed_end, locale)}`;
  if (template.date_strategy === 'account_anniversary')
    return anniversary
      ? `${localize('Annual period anchored', '年度周期锚定于')} ${anniversary}`
      : localize('Anniversary date required', '需要周年日期');
  if (template.date_strategy === 'qualification_cycle') {
    if (!firstQualifyingMonth)
      return localize('First qualifying month required', '需要首个合格月份');
    const [year, month] = firstQualifyingMonth.split('-').map(Number);
    if (!year || !month) return localize('First qualifying month required', '需要首个合格月份');
    const expectedIndex = year * 12 + month - 1 + 11;
    const expectedDate = `${Math.floor(expectedIndex / 12)}-${String((expectedIndex % 12) + 1).padStart(2, '0')}-01`;
    return `${localize('Expected qualification begins', '预计合格期开始于')} ${formatDate(expectedDate, locale)}`;
  }
  const rawCadence = template.payload.recurrence_type;
  const cadence =
    typeof rawCadence === 'string' &&
    ['one_time', 'monthly', 'quarterly', 'semiannual', 'annual', 'custom'].includes(rawCadence)
      ? (rawCadence as RecurrenceType)
      : null;
  return cadence
    ? `${localize('Current', '当前')} ${formatRecurrenceType(cadence)} ${localize('calendar period', '日历周期')}`
    : localize('Current calendar period', '当前日历周期');
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
  const { language, t, localize } = useI18n();
  const formatRecurrenceType = (type: Parameters<typeof recurrenceTypeLabel>[0]) =>
    recurrenceTypeLabel(type, localize);
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
            localize(
              'Enter an annual-fee renewal date or a separate benefit anniversary/reset date for the selected anniversary benefit.',
              '请为所选周年福利填写年费续期日期，或单独填写福利周年/重置日期。',
            ),
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
          `${localize('Account created with', '账户已创建，包含')} ${created.benefits_created} ${localize('benefit(s)', '项福利')}${created.benefit_anniversary_inferred ? localize('. Benefit anniversary was inferred from the renewal date; verify the issuer boundary.', '。福利周年日期根据续期日期推断，请核对发卡行边界。') : '.'}`,
        );
      } else if (editing === 'new') {
        await createAccount(parsed);
        setMessage(
          localize(
            'Custom account created. Add any standard or side benefit manually.',
            '自定义账户已创建。你可以手动添加标准福利或其他福利。',
          ),
        );
      } else if (editing) {
        await updateAccount(editing.id, parsed);
        setMessage(
          localize(
            'Account saved. Existing benefit history was not changed.',
            '账户已保存，已有福利历史未改变。',
          ),
        );
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
    if (
      !window.confirm(
        `${localize('Delete', '删除')} ${account.display_name}? ${localize('Referenced accounts must be deactivated instead.', '已有引用的账户应改为停用。')}`,
      )
    )
      return;
    try {
      await deleteAccount(account.id);
      setMessage(localize('Account deleted.', '账户已删除。'));
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('accounts.deleteError'));
    }
  }

  if (result.error) return <ErrorState error={result.error} onRetry={result.refresh} />;
  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={localize('Cards, services & portals', '信用卡、服务与账户')}
        title={localize('Keep providers organized.', '让所有发卡方井然有序。')}
        description={localize(
          'Choose an exact U.S. card to preview standard benefits, or create a custom account. Never store a full card number, CVV, password, or banking credential.',
          '选择准确的美国信用卡以预览标准福利，或创建自定义账户。不要保存完整卡号、CVV、密码或银行凭证。',
        )}
        action={
          <div className="card-actions">
            <Link className="button button--secondary" to="/benefits/new">
              {localize('+ Add custom benefit', '+ 添加自定义福利')}
            </Link>
            <button className="button button--primary" onClick={() => open('new')}>
              {localize('+ Add account', '+ 添加账户')}
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
                      ? localize('Not set', '未设置')
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
            className="modal modal--wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-dialog-title"
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">
                  {editing === 'new'
                    ? `${localize('Step', '第')} ${step} ${localize('of 3', '步，共 3 步')}`
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
                  <p className="muted">
                    {localize(
                      'This non-exhaustive catalog covers selected U.S. cards and card types. Issuer terms control; this is not financial advice. Authorized-user cards can duplicate benefits.',
                      '此目录仅覆盖部分美国信用卡及卡种。以发卡行条款为准；这不是财务建议。授权用户卡可能重复计算福利。',
                    )}
                  </p>
                </div>
                {catalog.error && (
                  <div className="alert alert--warning" role="status">
                    {t('accounts.catalogUnavailable')}
                  </div>
                )}
                {!catalog.error && (
                  <label className="field">
                    <span>{localize('Search issuer or card', '搜索发卡行或信用卡')}</span>
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={localize(
                        'Chase Sapphire, Amex, Capital One…',
                        'Chase Sapphire、Amex、Capital One…',
                      )}
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
                            {item.templates.length} {localize('tracked benefit(s)', '项已追踪福利')}{' '}
                            · {catalogTypeLabel(item.card_type, localize)} ·{' '}
                            {catalogVerificationLabel(item.verification_state, localize)} ·{' '}
                            {item.official_source_urls?.length ?? 1}{' '}
                            {localize('official source(s)', '个官方来源')}
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
                        <strong>
                          {localize('Custom card, service, or portal', '自定义信用卡、服务或账户')}
                        </strong>
                        <small>
                          {localize(
                            'Enter details yourself and add benefits manually.',
                            '自行填写详情并手动添加福利。',
                          )}
                        </small>
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
                      placeholder={localize('Amex Platinum — Personal', 'Amex Platinum — 个人')}
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
                    <span>{localize('Currency', '货币')}</span>
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
                    <small>
                      {localize(
                        'Fee or membership renewal only—not a benefit reset.',
                        '仅填写年费或会员续期日期，不是福利重置日期。',
                      )}
                    </small>
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
                        ? localize(
                            'Auto-filled from the annual-fee renewal date. Verify the issuer benefit boundary; you can override it here.',
                            '已根据年费续期日期自动填写。请核对发卡行福利边界，也可以在这里修改。',
                          )
                        : localize(
                            'Used for selected anniversary benefits. Calendar-year benefits do not use this date.',
                            '用于所选周年福利；自然年福利不使用此日期。',
                          )}
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
                      ? localize('Preview benefits', '预览福利')
                      : busy
                        ? localize('Saving…', '保存中…')
                        : localize('Save account', '保存账户')}
                  </button>
                </div>
              </form>
            )}

            {editing === 'new' && step === 3 && product && (
              <form onSubmit={(event) => void save(event)} className="form-stack">
                <div>
                  <h3>{localize('Choose benefits to create', '选择要创建的福利')}</h3>
                  <p className="muted">
                    {localize(
                      'These become ordinary editable benefits. Catalog changes never overwrite them, and custom or side offers can be added later.',
                      '这些会成为普通的可编辑福利。目录更新不会覆盖它们，之后也可以添加自定义或其他福利。',
                    )}
                  </p>
                </div>
                {product.age_days > 90 && (
                  <div className="alert alert--warning">
                    {localize('Catalog facts are', '目录信息已有')} {product.age_days}{' '}
                    {localize(
                      'days old. Verify current issuer terms.',
                      '天，请核对发卡行当前条款。',
                    )}
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
                        <span>{dateStrategyLabel(item.date_strategy, localize)}</span>
                        <span>
                          {localize('Next', '下一个周期')}:{' '}
                          {periodPreview(
                            item,
                            form.benefit_anniversary_date,
                            setupMonths[item.template_version_id],
                            localize,
                            formatRecurrenceType,
                            locale,
                          )}
                        </span>
                        <span>
                          {item.payload.enrollment_required
                            ? localize('Enrollment required', '需要注册')
                            : localize('No enrollment marker', '无需注册标记')}
                        </span>
                        {item.fixed_end && (
                          <span>
                            {localize('Ends', '到期')} {formatDate(item.fixed_end, locale)}
                          </span>
                        )}
                        <span>
                          {catalogVerificationLabel(item.verification_state, localize)} ·{' '}
                          {item.official_source_urls?.length ?? 1} {localize('source(s)', '个来源')}
                        </span>
                      </div>
                      {item.setup_field === 'first_qualifying_month' &&
                        selected.has(item.template_version_id) && (
                          <label className="field">
                            <span>{localize('First qualifying month', '首个合格月份')}</span>
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
                              {localize(
                                'Creates an Upcoming estimate after 11 qualifying months. Reminders remain off.',
                                '完成 11 个合格月份后会创建“即将开始”的预计周期，提醒仍保持关闭。',
                              )}
                            </small>
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
                          ? localize('Issuer source · verified', '发卡行来源 · 已核验')
                          : localize('Issuer source · review status', '发卡行来源 · 核验状态')}{' '}
                        {catalogVerificationLabel(item.verification_state, localize)} ·{' '}
                        {formatDate(item.verified_on, locale)}
                      </a>
                    </article>
                  ))}
                </div>
                <p className="muted">
                  {localize(
                    'Benefits can depend on opening date, authorized-user status, targeting, enrollment, and issuer changes. Confirm every term with the issuer.',
                    '福利可能取决于开户日期、授权用户身份、定向资格、注册状态和发卡行调整。请向发卡行确认每项条款。',
                  )}
                </p>
                {product.age_days > 180 && (
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={staleAcknowledged}
                      onChange={(event) => setStaleAcknowledged(event.target.checked)}
                    />
                    <span>
                      <strong>
                        {localize('I reviewed current issuer terms', '我已核对发卡行当前条款')}
                      </strong>
                      <small>
                        {localize(
                          'Required because this catalog version is over 180 days old.',
                          '由于此目录版本超过 180 天，这是必填确认项。',
                        )}
                      </small>
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
                    {localize('Back', '返回')}
                  </button>
                  <button
                    type="submit"
                    className="button button--primary"
                    disabled={busy || (product.age_days > 180 && !staleAcknowledged)}
                  >
                    {busy
                      ? localize('Creating…', '创建中…')
                      : `${localize('Create account and', '创建账户并添加')} ${selected.size} ${
                          selected.size === 1
                            ? localize('benefit', '项福利')
                            : localize('benefits', '项福利')
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
