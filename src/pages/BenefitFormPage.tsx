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
  const { language, localize } = useI18n();
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
      setError(
        localize(
          'Confirm that you want to create historical periods. Backfill never sends reactivation emails.',
          '请确认要创建历史周期。补录周期不会发送重新可用提醒。',
        ),
      );
      return;
    }
    setBusy(true);
    try {
      if (definitionId) {
        await editBenefit(definitionId, parsed.data, editScope, effectiveBoundary);
        void navigate('/benefits', {
          state: {
            message: localize(
              'Benefit revision saved. Historical periods were preserved.',
              '福利修订已保存，历史周期已保留。',
            ),
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
                  message: localize(
                    'Benefit created. Its first period is upcoming.',
                    '福利已创建，第一个周期即将开始。',
                  ),
                },
          },
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : localize('Could not save the benefit.', '无法保存福利。'),
      );
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
      <ErrorState
        error={
          new Error(
            localize(
              'This benefit was not found or you no longer have access.',
              '找不到此福利，或你已无权访问。',
            ),
          )
        }
      />
    );

  return (
    <form className="benefit-form page-stack" onSubmit={(event) => void submit(event)}>
      <PageHeader
        eyebrow={
          definitionId
            ? localize('Revision-aware edit', '修订式编辑')
            : localize('New benefit', '新福利')
        }
        title={
          definitionId
            ? `${localize('Edit', '编辑')} ${data.data?.definition?.name}`
            : localize('What benefit are you tracking?', '你要追踪什么福利？')
        }
        description={localize(
          'Use date-only periods. PerkLedger applies your selected IANA timezone instead of the browser timezone.',
          '使用仅日期的周期。PerkLedger 会使用你选择的 IANA 时区，而不是浏览器时区。',
        )}
        action={
          <Link className="button button--secondary" to={definitionId ? '/benefits' : '/dashboard'}>
            {localize('Cancel', '取消')}
          </Link>
        }
      />

      {definitionId && (
        <section className="panel form-section">
          <div className="form-section-title">
            <span>1</span>
            <div>
              <h2>{localize('Apply this change', '应用此更改')}</h2>
              <p>{localize('Historical periods are never rewritten.', '历史周期不会被改写。')}</p>
            </div>
          </div>
          {data.data?.definition?.origin_template_version_id && (
            <div className="info-box">
              <strong>
                {localize('Created from the standard card catalog', '根据标准信用卡目录创建')}
              </strong>
              <p>
                {localize('Template', '模板')} {data.data.definition.origin_template_stable_key}{' '}
                {localize('version', '版本')} {data.data.definition.origin_template_version} ·{' '}
                {localize('verified', '验证于')}{' '}
                {data.data.definition.origin_verified_on ??
                  localize('date unavailable', '日期不可用')}
                .
                {data.data.definition.customized_at
                  ? localize(
                      ' This benefit has been customized; its catalog sibling benefits are unaffected.',
                      ' 此福利已自定义；目录中的同卡福利不受影响。',
                    )
                  : localize(
                      ' Editing creates your own revision and never changes the catalog or sibling benefits.',
                      ' 编辑会创建你自己的修订，不会改变目录或同卡福利。',
                    )}
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
                <strong>{localize('Future periods', '未来周期')}</strong>
                <small>
                  {localize(
                    'Recommended. Current and historical usage stay unchanged.',
                    '推荐。当前和历史使用记录保持不变。',
                  )}
                </small>
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
                <strong>{localize('Current and future', '当前及未来')}</strong>
                <small>
                  {localize(
                    'Protected value/date changes are rejected if this period has usage or an email attempt.',
                    '如果此周期已有使用记录或邮件发送尝试，受保护的金额/日期更改会被拒绝。',
                  )}
                </small>
              </span>
            </label>
          </div>
          <label className="field compact-field">
            <span>
              {localize('Revision boundary', '修订边界')}{' '}
              <small>{localize('optional', '可选')}</small>
            </span>
            <input
              type="date"
              value={effectiveBoundary}
              onChange={(event) => setEffectiveBoundary(event.target.value)}
            />
          </label>
          <p className="field-help">
            {localize(
              'Leave blank to use the next period boundary (or the current period start for current-and-future). A custom date must exactly match an existing occurrence boundary. For one period, use “Override this period.”',
              '留空则使用下一个周期边界（当前及未来模式使用当前周期开始）。自定义日期必须准确匹配已有周期边界。只改一个周期请使用“仅覆盖此周期”。',
            )}
          </p>
        </section>
      )}

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '2' : '1'}</span>
          <div>
            <h2>{localize('Basics', '基本信息')}</h2>
            <p>
              {localize(
                'Name the benefit and attach it to a reusable account.',
                '命名福利并关联可重复使用的账户。',
              )}
            </p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field field--wide">
            <span>{localize('Benefit name', '福利名称')}</span>
            <input
              required
              maxLength={160}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder={localize('$15 monthly rideshare credit', '$15 月度网约车抵扣')}
            />
          </label>
          <label className="field">
            <span>{localize('Card, account, or provider', '信用卡、账户或提供方')}</span>
            <select
              value={form.account_id ?? ''}
              onChange={(event) => setForm({ ...form, account_id: event.target.value || null })}
            >
              <option value="">{localize('Unassigned', '未分配')}</option>
              {data.data?.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name}
                </option>
              ))}
            </select>
            <small>
              <Link to="/accounts">{localize('Manage accounts', '管理账户')}</Link>
            </small>
          </label>
          <label className="field">
            <span>{localize('Category', '类别')}</span>
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
            <span>{localize('Description', '描述')}</span>
            <textarea
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder={localize(
                'A concise summary of what this benefit provides.',
                '简要说明这项福利提供什么。',
              )}
            />
          </label>
          <label className="field field--wide">
            <span>{localize('Private notes', '私人备注')}</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder={localize(
                'Enrollment steps, exclusions, or a confirmation number—never credentials.',
                '填写注册步骤、排除条件或确认编号，不要填写凭证。',
              )}
            />
          </label>
        </div>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '3' : '2'}</span>
          <div>
            <h2>{localize('Value', '价值')}</h2>
            <p>
              {localize(
                'Track what you receive, not a gross card transaction.',
                '记录你获得的福利，而不是信用卡消费总额。',
              )}
            </p>
          </div>
        </div>
        <div className="segmented" aria-label={localize('Benefit value type', '福利价值类型')}>
          {(
            [
              ['money', localize('Fixed credit', '固定抵扣')],
              ['percentage_cashback', localize('Cashback %', '返现 %')],
              ['points', localize('Points', '积分')],
              ['membership', localize('Membership', '会员权益')],
              ['other', localize('Other', '其他')],
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
                {form.value_kind === 'money'
                  ? localize('Benefit amount', '福利金额')
                  : localize('Quantity', '数量')}
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
                <span>{localize('Cashback percentage', '返现比例')}</span>
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
                  {localize('Cashback cap', '返现上限')}{' '}
                  <small>{localize('blank = uncapped', '留空 = 不限额度')}</small>
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
              <span>{localize('Currency', '货币')}</span>
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
              <span>{localize('Unit label', '单位名称')}</span>
              <input
                required
                value={form.unit_label ?? ''}
                onChange={(event) => setForm({ ...form, unit_label: event.target.value || null })}
                placeholder={
                  form.value_kind === 'points' ? localize('points', '积分') : localize('uses', '次')
                }
              />
            </label>
          )}
          {['money', 'percentage_cashback'].includes(form.value_kind) && (
            <label className="field">
              <span>
                {localize('Minimum spend', '最低消费')}{' '}
                <small>{localize('optional', '可选')}</small>
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
          {localize(
            'Fiat inputs support two decimals. Uncapped cashback stays “Uncapped”; usage records cashback earned, not purchase spend.',
            '货币金额支持两位小数。不限额度返现会保持“不限额度”；使用记录填写获得的返现金额，而不是消费金额。',
          )}
        </p>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '4' : '3'}</span>
          <div>
            <h2>{localize('Eligibility', '适用条件')}</h2>
            <p>
              {localize(
                'Capture both searchable details and the full fine print.',
                '同时记录可搜索信息和完整细则。',
              )}
            </p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>{localize('Merchant', '商户')}</span>
            <input
              value={form.merchant ?? ''}
              onChange={(event) => setForm({ ...form, merchant: event.target.value || null })}
              placeholder={localize('Saks Fifth Avenue', 'Saks Fifth Avenue')}
            />
          </label>
          <label className="field">
            <span>{localize('Merchant category', '商户类别')}</span>
            <input
              value={form.merchant_category ?? ''}
              onChange={(event) =>
                setForm({ ...form, merchant_category: event.target.value || null })
              }
              placeholder={localize('Department store', '百货商店')}
            />
          </label>
          <label className="field field--wide">
            <span>{localize('Eligible website', '适用网站')}</span>
            <input
              type="url"
              value={form.website ?? ''}
              onChange={(event) => setForm({ ...form, website: event.target.value || null })}
              placeholder="https://example.com"
            />
          </label>
          <label className="field field--wide">
            <span>{localize('Tags', '标签')}</span>
            <div className="tag-input">
              {form.tags.map((tag) => (
                <button
                  type="button"
                  key={tag}
                  onClick={() =>
                    setForm({ ...form, tags: form.tags.filter((value) => value !== tag) })
                  }
                  aria-label={`${localize('Remove', '移除')} ${tag}`}
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
                placeholder={localize('Type a tag and press Enter', '输入标签后按 Enter')}
              />
            </div>
          </label>
          <label className="field field--wide">
            <span>{localize('Eligibility notes', '适用条件备注')}</span>
            <textarea
              rows={4}
              value={form.eligibility_notes}
              onChange={(event) => setForm({ ...form, eligibility_notes: event.target.value })}
              placeholder={localize(
                'Valid only for prepaid reservations booked through the provider portal…',
                '仅适用于通过提供方门户预付的预订…',
              )}
            />
          </label>
        </div>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '5' : '4'}</span>
          <div>
            <h2>{localize('Dates & recurrence', '日期与周期')}</h2>
            <p>
              {localize(
                'Calendar periods use real month boundaries—not a fixed number of days.',
                '日历周期使用真实月份边界，而不是固定天数。',
              )}
            </p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>{localize('Effective date', '生效日期')}</span>
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
                ? localize('Expiration/end date', '到期/结束日期')
                : localize('Final end date', '最终结束日期')}{' '}
              <small>
                {form.recurrence_type === 'one_time'
                  ? localize('required', '必填')
                  : localize('optional', '可选')}
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
            <span>{localize('Recurrence', '周期')}</span>
            <select
              value={form.recurrence_type}
              onChange={(event) => updateRecurrence(event.target.value as RecurrenceType)}
            >
              <option value="one_time">{localize('One-time', '一次性')}</option>
              <option value="monthly">{localize('Monthly', '每月')}</option>
              <option value="quarterly">{localize('Quarterly', '每季度')}</option>
              <option value="semiannual">{localize('Semiannual', '每半年')}</option>
              <option value="annual">{localize('Annual', '每年')}</option>
              <option value="custom">{localize('Custom month interval', '自定义月间隔')}</option>
            </select>
          </label>
          {form.recurrence_enabled && (
            <label className="field">
              <span>
                {localize('Display reset date', '显示重置日期')}{' '}
                <small>{localize('optional', '可选')}</small>
              </span>
              <input
                type="date"
                value={form.display_reset_date ?? ''}
                onChange={(event) =>
                  setForm({ ...form, display_reset_date: event.target.value || null })
                }
              />
              <small>
                {localize(
                  'Informational only. Period boundaries use the recurrence basis and anchor date.',
                  '仅供参考。周期边界使用周期基础和锚定日期。',
                )}
              </small>
            </label>
          )}
          {form.recurrence_enabled && form.recurrence_type !== 'custom' && (
            <label className="field">
              <span>{localize('Period basis', '周期基础')}</span>
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
                <option value="calendar">{localize('Calendar periods', '日历周期')}</option>
                <option value="anniversary">{localize('Anchored to a date', '按日期锚定')}</option>
              </select>
            </label>
          )}
          {form.recurrence_enabled &&
            (form.recurrence_basis === 'anniversary' || form.recurrence_type === 'custom') && (
              <label className="field">
                <span>{localize('Original anchor date', '原始锚定日期')}</span>
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
              <span>{localize('Repeat every', '重复间隔')}</span>
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
                <span>{localize('months', '个月')}</span>
              </div>
            </label>
          )}
        </div>
        {form.recurrence_enabled && (
          <div className="info-box">
            {localize(
              'End-of-month anchors use the last valid day without drift. A Feb 29 annual benefit uses Feb 28 in non-leap years and returns to Feb 29 in leap years.',
              '月末锚定会使用当月最后一个有效日期，不会漂移。2 月 29 日的年度福利在非闰年使用 2 月 28 日，闰年恢复为 2 月 29 日。',
            )}
          </div>
        )}
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span>{definitionId ? '6' : '5'}</span>
          <div>
            <h2>{localize('Enrollment & reminders', '登记与提醒')}</h2>
            <p>
              {localize(
                'Reminder email is processed securely on the server, even while this page is closed.',
                '提醒邮件会在服务器端安全处理，即使此页面已关闭也不会停止。',
              )}
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
              <strong>{localize('Enrollment is required', '需要登记')}</strong>
              <small>
                {localize(
                  'Show an attention item until enrollment is recorded.',
                  '在完成登记前显示待处理事项。',
                )}
              </small>
            </span>
          </label>
          {form.enrollment_required && (
            <>
              <label className="field">
                <span>{localize('Enrollment deadline', '登记截止日期')}</span>
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
                  {localize('Enrolled on', '登记日期')}{' '}
                  <small>{localize('optional', '可选')}</small>
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
              <strong>{localize('Expiration reminder', '到期提醒')}</strong>
              <small>
                {localize(
                  'Email 7 days before expiration, with catch-up while still active.',
                  '在到期前 7 天发送邮件；福利仍有效时会补发提醒。',
                )}
              </small>
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
              <strong>{localize('Available-again email', '可用额度恢复邮件')}</strong>
              <small>
                {localize(
                  'Sent on the local start date of a genuinely new recurring period.',
                  '在真正的新周期开始日期按本地时间发送。',
                )}
              </small>
            </span>
          </label>
          <label className="field field--wide">
            <span>{localize('Terms timezone', '条款时区')}</span>
            <input
              required
              value={form.terms_timezone}
              onChange={(event) => setForm({ ...form, terms_timezone: event.target.value })}
              placeholder={localize('America/New_York', 'America/New_York')}
            />
            <small>
              {localize(
                'Period boundaries and statuses use this explicit IANA timezone. Email processing still follows your profile schedule.',
                '周期边界和状态使用此明确的 IANA 时区；邮件处理仍遵循你的个人设置。',
              )}
            </small>
          </label>
        </div>
      </section>

      <details className="panel form-section" open={form.period_value_rules.length > 0}>
        <summary>{localize('Advanced period-specific values', '高级：按周期设置额度')}</summary>
        <p className="muted">
          {localize(
            'Optional month overrides for recurring fixed-money calendar benefits—for example $35 in December and the normal amount in other months.',
            '为按日历周期重复的固定金额福利设置可选的月份覆盖值，例如 12 月为 $35，其余月份使用常规金额。',
          )}
        </p>
        <div className="form-stack">
          {form.period_value_rules.map((rule, index) => (
            <div className="form-grid" key={`${rule.calendar_month}-${index}`}>
              <label className="field">
                <span>{localize('Calendar month', '日历月份')}</span>
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
                <span>{localize('Available value', '可用额度')}</span>
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
                {localize('Remove override', '移除覆盖值')}
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
            {localize('Add month override', '添加月份覆盖值')}
          </button>
        </div>
      </details>

      {!definitionId && (
        <details className="panel form-section">
          <summary>{localize('Optional historical backfill', '可选：补录历史周期')}</summary>
          <p className="muted">
            {localize(
              'Normal creation starts with the current period. Generate up to 24 months only when you intentionally want older empty history.',
              '正常创建从当前周期开始。只有在确实需要补充较早的空历史记录时，才生成最多 24 个月。',
            )}
          </p>
          <label className="field compact-field">
            <span>{localize('Months to backfill', '补录月数')}</span>
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
                <strong>
                  {localize(
                    'I understand these periods will not send reactivation email.',
                    '我了解这些周期不会发送额度恢复邮件。',
                  )}
                </strong>
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
          {localize('Cancel', '取消')}
        </Link>
        <button className="button button--primary" type="submit" disabled={busy}>
          {busy
            ? localize('Saving safely…', '正在安全保存…')
            : definitionId
              ? localize('Save new revision', '保存新版本')
              : localize('Create benefit', '创建福利')}
        </button>
      </div>
    </form>
  );
}
