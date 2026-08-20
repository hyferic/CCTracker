import type { BenefitInstance } from '../types';
import { displayStatus } from '../domain/status';

export function StatusBadge({ instance }: { instance: BenefitInstance }) {
  const label = displayStatus(instance);
  const tone =
    instance.lifecycle_status === 'expired' || instance.lifecycle_status === 'void'
      ? 'neutral'
      : instance.expiring_7_days
        ? 'danger'
        : instance.usage_status === 'used'
          ? 'success'
          : instance.lifecycle_status === 'upcoming'
            ? 'info'
            : instance.usage_status === 'partial'
              ? 'warning'
              : 'available';
  return <span className={`status status--${tone}`}>{label}</span>;
}
