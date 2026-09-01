import { Link } from 'react-router-dom';
import { formatDate } from '../domain/dates';
import { formatQuantity } from '../domain/money';
import type { BenefitInstance } from '../types';
import { StatusBadge } from './StatusBadge';
import { useOptionalI18n, type MessageKey } from '../features/i18n/I18nContext';

function valueLabel(instance: BenefitInstance, value: number | null, locale: string) {
  return formatQuantity(value, {
    valueKind: instance.value_kind,
    currency: instance.currency,
    unitLabel: instance.unit_label,
    locale,
  });
}

const fallbackMessages: Partial<Record<MessageKey, string>> = {
  'benefitTable.caption': 'Benefit periods and remaining values',
  'benefitTable.minimumSpendSummary': '{value} minimum spend',
  'common.actions': 'Actions',
  'common.auditVersion': 'Audit version',
  'common.ago': 'ago',
  'common.benefit': 'Benefit',
  'common.confirmUsed': 'Confirm used',
  'common.endsToday': 'Ends today',
  'common.period': 'Period',
  'common.starts': 'Starts',
  'common.status': 'Status',
  'common.timeLeft': 'Time left',
  'common.unassigned': 'Unassigned',
  'common.value': 'Value',
  'common.view': 'View',
  'dashboard.cashback': 'cashback',
  'dashboard.minimumSpend': 'Minimum spend',
  'dashboard.of': 'of',
  'dashboard.remaining': 'remaining',
  'dashboard.saving': 'Saving…',
  'status.days': '{count} days',
};

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
  const t = i18n?.t ?? ((key: MessageKey) => fallbackMessages[key] ?? key);
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
  return (
    <div className="table-wrap">
      <table className="benefit-table">
        <caption className="sr-only">{t('benefitTable.caption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('common.benefit')}</th>
            <th scope="col">{t('common.value')}</th>
            <th scope="col">{t('common.period')}</th>
            <th scope="col">{t('common.status')}</th>
            <th scope="col">{t('common.timeLeft')}</th>
            <th scope="col">
              <span className="sr-only">{t('common.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {instances.map((instance) => {
            const cashbackSummary =
              instance.value_kind === 'percentage_cashback' && instance.cashback_percentage !== null
                ? `${instance.cashback_percentage}% ${t('dashboard.cashback')}${
                    instance.minimum_spend !== null
                      ? ` · ${t('benefitTable.minimumSpendSummary').replace(
                          '{value}',
                          formatQuantity(instance.minimum_spend, {
                            valueKind: 'money',
                            currency: instance.currency,
                            locale,
                          }),
                        )}`
                      : ''
                  }`
                : null;

            return (
              <tr
                key={instance.instance_id}
                className={instance.expiring_7_days ? 'row--urgent' : ''}
              >
                <td data-label={t('common.benefit')}>
                  <Link className="benefit-name" to={`/instances/${instance.instance_id}`}>
                    {instance.benefit_name}
                  </Link>
                  <span className="cell-subtitle">
                    {accountLabel?.(instance) ??
                      instance.account_display_name ??
                      instance.issuer ??
                      t('common.unassigned')}{' '}
                    · {instance.category}
                  </span>
                  {instance.is_audit_version && (
                    <span className="mini-status mini-status--danger">
                      {t('common.auditVersion')} {instance.instance_version}
                    </span>
                  )}
                </td>
                <td data-label={t('common.value')}>
                  <strong>{valueLabel(instance, instance.remaining_quantity, locale)}</strong>
                  <span className="cell-subtitle">
                    {t('dashboard.of')} {valueLabel(instance, instance.available_quantity, locale)}{' '}
                    {t('dashboard.remaining')}
                  </span>
                  {cashbackSummary && <span className="cell-subtitle">{cashbackSummary}</span>}
                </td>
                <td data-label={t('common.period')}>
                  <strong>{instance.period_label}</strong>
                  <span className="cell-subtitle">
                    {formatDate(instance.period_start, locale)} –{' '}
                    {formatDate(instance.period_end, locale)}
                  </span>
                </td>
                <td data-label={t('common.status')}>
                  <StatusBadge instance={instance} />
                </td>
                <td data-label={t('common.timeLeft')}>
                  <strong className={instance.expiring_7_days ? 'text-danger' : ''}>
                    {instance.lifecycle_status === 'upcoming'
                      ? `${t('common.starts')} ${formatDate(instance.period_start, locale)}`
                      : instance.days_remaining === 0
                        ? t('common.endsToday')
                        : instance.days_remaining > 0
                          ? t('status.days').replace('{count}', String(instance.days_remaining))
                          : `${t('status.days').replace('{count}', String(Math.abs(instance.days_remaining)))} ${t('common.ago')}`}
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
                          : t('common.confirmUsed')}
                      </button>
                    )}
                  <Link className="text-link" to={`/instances/${instance.instance_id}`}>
                    {t('common.view')}
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
