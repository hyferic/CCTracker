import { Link } from 'react-router-dom';
import { formatDate } from '../domain/dates';
import { formatQuantity } from '../domain/money';
import type { BenefitInstance } from '../types';
import { StatusBadge } from './StatusBadge';

function valueLabel(instance: BenefitInstance, value: number | null) {
  return formatQuantity(value, {
    valueKind: instance.value_kind,
    currency: instance.currency,
    unitLabel: instance.unit_label,
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
  return (
    <div className="table-wrap">
      <table className="benefit-table">
        <caption className="sr-only">Benefit periods and remaining values</caption>
        <thead>
          <tr>
            <th scope="col">Benefit</th>
            <th scope="col">Value</th>
            <th scope="col">Period</th>
            <th scope="col">Status</th>
            <th scope="col">Time left</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {instances.map((instance) => (
            <tr
              key={instance.instance_id}
              className={instance.expiring_7_days ? 'row--urgent' : ''}
            >
              <td data-label="Benefit">
                <Link className="benefit-name" to={`/instances/${instance.instance_id}`}>
                  {instance.benefit_name}
                </Link>
                <span className="cell-subtitle">
                  {accountLabel?.(instance) ??
                    instance.account_display_name ??
                    instance.issuer ??
                    'Unassigned'}{' '}
                  · {instance.category}
                </span>
                {instance.is_audit_version && (
                  <span className="mini-status mini-status--danger">
                    Audit version {instance.instance_version}
                  </span>
                )}
              </td>
              <td data-label="Value">
                <strong>{valueLabel(instance, instance.remaining_quantity)}</strong>
                <span className="cell-subtitle">
                  of {valueLabel(instance, instance.available_quantity)} remaining
                </span>
                {instance.value_kind === 'percentage_cashback' &&
                  instance.cashback_percentage !== null && (
                    <span className="cell-subtitle">
                      {instance.cashback_percentage}% cashback
                      {instance.minimum_spend !== null
                        ? ` · ${formatQuantity(instance.minimum_spend, {
                            valueKind: 'money',
                            currency: instance.currency,
                          })} minimum spend`
                        : ''}
                    </span>
                  )}
              </td>
              <td data-label="Period">
                <strong>{instance.period_label}</strong>
                <span className="cell-subtitle">
                  {formatDate(instance.period_start)} – {formatDate(instance.period_end)}
                </span>
              </td>
              <td data-label="Status">
                <StatusBadge instance={instance} />
              </td>
              <td data-label="Time left">
                <strong className={instance.expiring_7_days ? 'text-danger' : ''}>
                  {instance.lifecycle_status === 'upcoming'
                    ? `Starts ${formatDate(instance.period_start)}`
                    : instance.days_remaining === 0
                      ? 'Ends today'
                      : instance.days_remaining > 0
                        ? `${instance.days_remaining} days`
                        : `${Math.abs(instance.days_remaining)} days ago`}
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
                      {confirmingInstanceId === instance.instance_id ? 'Saving…' : 'Confirm used'}
                    </button>
                  )}
                <Link className="text-link" to={`/instances/${instance.instance_id}`}>
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
