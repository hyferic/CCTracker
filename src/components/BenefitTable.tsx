import { Link } from 'react-router-dom';
import { formatDate } from '../domain/dates';
import { formatQuantity } from '../domain/money';
import type { BenefitInstance } from '../types';
import { StatusBadge } from './StatusBadge';
import { useOptionalI18n } from '../features/i18n/I18nContext';

function valueLabel(instance: BenefitInstance, value: number | null, locale: string) {
  return formatQuantity(value, {
    valueKind: instance.value_kind,
    currency: instance.currency,
    unitLabel: instance.unit_label,
    locale,
  });
}

export function BenefitTable({
  instances,
  onConfirmUsed,
  confirmingInstanceId,
  accountLabel,
}: {
  instances: BenefitInstance[];
  onConfirmUsed?: (instance: BenefitInstance) => void;
  confirmingInstanceId?: string | null;
  accountLabel?: (instance: BenefitInstance) => string;
}) {
  const i18n = useOptionalI18n();
  const language = i18n?.language ?? 'en';
  const t =
    i18n?.t ??
    ((key: string) =>
      ({
        'dashboard.remaining': 'remaining',
        'dashboard.cashback': 'cashback',
        'dashboard.minimumSpend': 'minimum spend',
        'dashboard.saving': 'Saving…',
        'status.days': '{count} days',
      })[key] ?? key);
  const localize = i18n?.localize ?? ((english: string) => english);
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
  return (
    <div className="table-wrap">
      <table className="benefit-table">
        <caption className="sr-only">
          {localize('Benefit periods and remaining values', '福利周期与剩余价值')}
        </caption>
        <thead>
          <tr>
            <th scope="col">{localize('Benefit', '福利')}</th>
            <th scope="col">{localize('Value', '价值')}</th>
            <th scope="col">{localize('Period', '周期')}</th>
            <th scope="col">{localize('Status', '状态')}</th>
            <th scope="col">{localize('Time left', '剩余时间')}</th>
            <th scope="col">
              <span className="sr-only">{localize('Actions', '操作')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {instances.map((instance) => {
            const cashbackSummary =
              instance.value_kind === 'percentage_cashback' && instance.cashback_percentage !== null
                ? `${instance.cashback_percentage}% ${t('dashboard.cashback')}${
                    instance.minimum_spend !== null
                      ? ` · ${
                          language === 'zh-CN'
                            ? `${localize('Minimum spend', '最低消费')} ${formatQuantity(
                                instance.minimum_spend,
                                {
                                  valueKind: 'money',
                                  currency: instance.currency,
                                  locale,
                                },
                              )}`
                            : `${formatQuantity(instance.minimum_spend, {
                                valueKind: 'money',
                                currency: instance.currency,
                                locale,
                              })} ${t('dashboard.minimumSpend')}`
                        }`
                      : ''
                  }`
                : null;

            return (
              <tr
                key={instance.instance_id}
                className={instance.expiring_7_days ? 'row--urgent' : ''}
              >
                <td data-label={localize('Benefit', '福利')}>
                  <Link className="benefit-name" to={`/instances/${instance.instance_id}`}>
                    {instance.benefit_name}
                  </Link>
                  <span className="cell-subtitle">
                    {accountLabel?.(instance) ??
                      instance.account_display_name ??
                      instance.issuer ??
                      localize('Unassigned', '未分配')}{' '}
                    · {instance.category}
                  </span>
                  {instance.is_audit_version && (
                    <span className="mini-status mini-status--danger">
                      {localize('Audit version', '审计版本')} {instance.instance_version}
                    </span>
                  )}
                </td>
                <td data-label={localize('Value', '价值')}>
                  <strong>{valueLabel(instance, instance.remaining_quantity, locale)}</strong>
                  <span className="cell-subtitle">
                    {localize('of', '共')}{' '}
                    {valueLabel(instance, instance.available_quantity, locale)}{' '}
                    {t('dashboard.remaining')}
                  </span>
                  {cashbackSummary && <span className="cell-subtitle">{cashbackSummary}</span>}
                </td>
                <td data-label={localize('Period', '周期')}>
                  <strong>{instance.period_label}</strong>
                  <span className="cell-subtitle">
                    {formatDate(instance.period_start, locale)} –{' '}
                    {formatDate(instance.period_end, locale)}
                  </span>
                </td>
                <td data-label={localize('Status', '状态')}>
                  <StatusBadge instance={instance} />
                </td>
                <td data-label={localize('Time left', '剩余时间')}>
                  <strong className={instance.expiring_7_days ? 'text-danger' : ''}>
                    {instance.lifecycle_status === 'upcoming'
                      ? `${localize('Starts', '开始于')} ${formatDate(instance.period_start, locale)}`
                      : instance.days_remaining === 0
                        ? localize('Ends today', '今天到期')
                        : instance.days_remaining > 0
                          ? t('status.days').replace('{count}', String(instance.days_remaining))
                          : `${t('status.days').replace('{count}', String(Math.abs(instance.days_remaining)))} ${localize('ago', '前')}`}
                  </strong>
                </td>
                <td>
                  {onConfirmUsed &&
                    instance.lifecycle_status === 'active' &&
                    instance.usage_status !== 'used' &&
                    instance.is_live && (
                      <button
                        className="text-link"
                        type="button"
                        onClick={() => onConfirmUsed(instance)}
                        disabled={confirmingInstanceId === instance.instance_id}
                      >
                        {confirmingInstanceId === instance.instance_id
                          ? t('dashboard.saving')
                          : localize('Confirm used', '确认已使用')}
                      </button>
                    )}
                  <Link className="text-link" to={`/instances/${instance.instance_id}`}>
                    {localize('View', '查看')}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
