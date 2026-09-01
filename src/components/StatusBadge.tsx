import type { BenefitInstance } from '../types';
import { displayStatus } from '../domain/status';
import { useOptionalI18n } from '../features/i18n/I18nContext';

export function StatusBadge({ instance }: { instance: BenefitInstance }) {
  const i18n = useOptionalI18n();
  const translated = i18n
    ? instance.lifecycle_status === 'active' && instance.expiring_7_days
      ? `${i18n.t('status.expiringSoon')} · ${i18n.t(instance.usage_status === 'partial' ? 'status.partial' : 'status.unused')}`
      : instance.lifecycle_status === 'active'
        ? i18n.t(
            instance.usage_status === 'unused'
              ? 'status.unused'
              : instance.usage_status === 'partial'
                ? 'status.partial'
                : 'status.used',
          )
        : i18n.t(
            instance.lifecycle_status === 'upcoming'
              ? 'status.upcoming'
              : instance.lifecycle_status === 'void'
                ? 'status.void'
                : 'status.expired',
          )
    : null;
  const label = translated ?? displayStatus(instance);
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
