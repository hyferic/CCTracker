import { useEffect, useState, type FormEvent } from 'react';
import { ErrorState, SkeletonRows } from '../components/AsyncState';
import { PageHeader } from '../components/PageHeader';
import { Icon } from '../components/Icon';
import { CSV_IMPORT_TEMPLATE, parseCsvImport } from '../domain/csvImport';
import { formatInstantInTimeZone, validateTimeZone } from '../domain/dates';
import {
  buildBackup,
  downloadText,
  parseBackup,
  toCsv,
  type BackupData,
} from '../domain/portability';
import { useAsync } from '../hooks/useAsync';
import { useAuth } from '../features/auth/AuthProvider';
import { useBusinessDate, useProfile } from '../features/profile/ProfileContext';
import {
  getExportData,
  importBackup,
  listNotifications,
  schedulerHealth,
  updateProfile,
} from '../services/api';
import type { Profile } from '../types';
import { useI18n, type MessageKey } from '../features/i18n/I18nContext';

type T = (key: MessageKey) => string;

function entityLabel(entity: 'accounts' | 'definitions' | 'instances' | 'redemptions', t: T) {
  return {
    accounts: t('settings.entity.accounts'),
    definitions: t('settings.entity.definitions'),
    instances: t('settings.entity.instances'),
    redemptions: t('settings.entity.redemptions'),
  }[entity];
}

function notificationStateLabel(state: string, t: T) {
  const keys: Record<string, MessageKey> = {
    provider_accepted: 'settings.notificationState.providerAccepted',
    pending: 'settings.notificationState.pending',
    failed_retryable: 'settings.notificationState.failedRetryable',
    failed_terminal: 'settings.notificationState.failedTerminal',
    requires_review: 'settings.notificationState.requiresReview',
  };
  return keys[state] ? t(keys[state]) : state.replaceAll('_', ' ');
}

function notificationTypeLabel(type: string, t: T) {
  const keys: Record<string, MessageKey> = {
    expiration: 'settings.notificationType.expiration',
    reactivation: 'settings.notificationType.reactivation',
  };
  return keys[type] ? t(keys[type]) : type.replaceAll('_', ' ');
}

export function SettingsPage() {
  const auth = useAuth();
  const { profile, replaceProfile, timezone } = useProfile();
  const { language, setLanguage, t } = useI18n();
  const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
  const { today } = useBusinessDate();
  const result = useAsync(async () => {
    const [health, notifications] = await Promise.all([schedulerHealth(), listNotifications()]);
    return { health, notifications };
  });
  const [profileForm, setProfileForm] = useState<Profile>(profile);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [importData, setImportData] = useState<BackupData | null>(null);
  const [importKind, setImportKind] = useState<'JSON backup' | 'CSV accounts/definitions' | null>(
    null,
  );
  const [duplicatePolicy, setDuplicatePolicy] = useState<'skip' | 'import_as_new'>('skip');
  const [notificationPolicy, setNotificationPolicy] = useState<
    'suppress_current' | 'schedule_fresh'
  >('suppress_current');

  useEffect(() => {
    setProfileForm((current) => ({ ...current, language: profile.language }));
  }, [profile]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!validateTimeZone(profileForm.timezone)) {
      setError(t('settings.invalidTimezone'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await updateProfile({
        notification_email: profile.email.toLowerCase(),
        timezone: profileForm.timezone,
        expiration_reminders_enabled: profileForm.expiration_reminders_enabled,
        reactivation_reminders_enabled: profileForm.reactivation_reminders_enabled,
        recent_reset_days: profileForm.recent_reset_days,
        language: profileForm.language,
      });
      replaceProfile(saved);
      setProfileForm(saved);
      setMessage(t('settings.savedDateHelp'));
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('settings.saveError'));
    } finally {
      setBusy(false);
    }
  }

  async function registerPasskey() {
    setPasskeyBusy(true);
    setError(null);
    try {
      await auth.registerPasskey();
      setMessage(t('settings.passkeyAdded'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('settings.passkeyError'));
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function exportJson() {
    setBusy(true);
    setError(null);
    try {
      const data = await getExportData();
      const backup = buildBackup({
        timezone,
        accounts: data.accounts,
        definitions: data.definitions,
        revisions: data.revisions,
        instances: data.instances,
        redemptions: data.redemptions,
        notificationAudit: data.notifications,
      });
      downloadText(
        `perkledger-backup-${today}.json`,
        JSON.stringify(backup, null, 2),
        'application/json',
      );
      setMessage(t('settings.exported'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('settings.exportError'));
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv(entity: 'accounts' | 'definitions' | 'instances' | 'redemptions') {
    setBusy(true);
    try {
      const data = await getExportData();
      const rows = entity === 'instances' ? data.csvInstances : data[entity];
      downloadText(`perkledger-${entity}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
      setMessage(t('settings.csvExported').replace('{entity}', entityLabel(entity, t)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('settings.csvError'));
    } finally {
      setBusy(false);
    }
  }

  async function selectImport(file: File | undefined) {
    if (!file) return;
    setError(null);
    setImportData(null);
    setImportKind(null);
    try {
      const contents = await file.text();
      const csv = file.name.toLowerCase().endsWith('.csv') || file.type.includes('csv');
      setImportData(csv ? parseCsvImport(contents, timezone) : parseBackup(contents));
      setImportKind(csv ? 'CSV accounts/definitions' : 'JSON backup');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('settings.backupInvalid'));
    }
  }

  async function restore() {
    if (!importData) return;
    if (notificationPolicy === 'schedule_fresh' && !window.confirm(t('settings.restoreConfirm')))
      return;
    setBusy(true);
    setError(null);
    try {
      const counts = await importBackup(
        importData as unknown as Record<string, unknown>,
        duplicatePolicy,
        notificationPolicy,
      );
      setMessage(
        `${t('settings.restoreComplete').replace('{accounts}', String(counts.accounts)).replace('{definitions}', String(counts.definitions)).replace('{instances}', String(counts.instances)).replace('{redemptions}', String(counts.redemptions))}${counts.warnings.length ? ` ${counts.warnings.join(' ')}` : ''}`,
      );
      setImportData(null);
      setImportKind(null);
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('settings.restoreError'));
    } finally {
      setBusy(false);
    }
  }

  if (result.error) return <ErrorState error={result.error} onRetry={result.refresh} />;
  if (result.loading) return <SkeletonRows count={5} />;
  const health = result.data?.health;

  return (
    <div className="page-stack settings-grid">
      <PageHeader
        className="settings-span"
        eyebrow={t('settings.preferences')}
        title={t('settings.title')}
        description={t('settings.description')}
      />
      {message && (
        <div className="alert alert--success settings-span" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="alert alert--danger settings-span preserve-lines" role="alert">
          {error}
        </div>
      )}

      <section className="panel form-section">
        <div className="form-section-title">
          <span aria-hidden="true">
            <Icon name="settings" />
          </span>
          <div>
            <h2>{t('settings.language')}</h2>
            <p>{t('settings.languageHelp')}</p>
          </div>
        </div>
        <label className="field">
          <span>{t('settings.language')}</span>
          <select
            value={language}
            onChange={(event) => {
              const next = event.target.value as Exclude<Profile['language'], null>;
              const previous = language;
              setMessage(null);
              setError(null);
              setProfileForm((current) => ({ ...current, language: next }));
              void setLanguage(next).catch((caught) => {
                setProfileForm((current) => ({ ...current, language: previous }));
                setError(caught instanceof Error ? caught.message : t('settings.saveError'));
              });
            }}
          >
            <option value="en">{t('settings.english')}</option>
            <option value="zh-CN">{t('settings.chinese')}</option>
          </select>
        </label>
        <p className="muted">{t('settings.languageSaved')}</p>
      </section>
      <section className="panel form-section">
        <div className="form-section-title">
          <span aria-hidden="true">
            <Icon name="clock" />
          </span>
          <div>
            <h2>{t('settings.timezoneReminders')}</h2>
            <p>{t('settings.timezoneHelp')}</p>
          </div>
        </div>
        <form className="form-stack" onSubmit={(event) => void saveProfile(event)}>
          <label className="field">
            <span>{t('settings.timezone')}</span>
            <input
              required
              value={profileForm.timezone}
              onChange={(event) => setProfileForm({ ...profileForm, timezone: event.target.value })}
              list="timezones"
            />
            <datalist id="timezones">
              <option value="America/New_York" />
              <option value="America/Chicago" />
              <option value="America/Denver" />
              <option value="America/Los_Angeles" />
              <option value="Europe/London" />
              <option value="Asia/Tokyo" />
            </datalist>
            <small>{t('settings.timezoneChangeHelp')}</small>
          </label>
          <div className="field">
            <label htmlFor="verified-notification-recipient">
              {t('settings.notificationRecipient')}
            </label>
            <input
              id="verified-notification-recipient"
              type="email"
              readOnly
              value={profile.email.toLowerCase()}
              aria-describedby="verified-notification-recipient-help"
            />
            <small id="verified-notification-recipient-help">
              {t('settings.notificationHelp')}
            </small>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={profileForm.expiration_reminders_enabled}
              onChange={(event) =>
                setProfileForm({
                  ...profileForm,
                  expiration_reminders_enabled: event.target.checked,
                })
              }
            />
            <span>
              <strong>{t('settings.expirationReminders')}</strong>
              <small>{t('settings.expirationRemindersHelp')}</small>
            </span>
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={profileForm.reactivation_reminders_enabled}
              onChange={(event) =>
                setProfileForm({
                  ...profileForm,
                  reactivation_reminders_enabled: event.target.checked,
                })
              }
            />
            <span>
              <strong>{t('settings.reactivationReminders')}</strong>
              <small>{t('settings.reactivationRemindersHelp')}</small>
            </span>
          </label>
          <label className="field">
            <span>{t('settings.showRecentResets')}</span>
            <div className="input-suffix">
              <input
                type="number"
                min="0"
                max="30"
                value={profileForm.recent_reset_days}
                onChange={(event) =>
                  setProfileForm({ ...profileForm, recent_reset_days: Number(event.target.value) })
                }
              />
              <span>{t('status.days').replace('{count}', '').trim()}</span>
            </div>
          </label>
          <button type="submit" className="button button--primary" disabled={busy}>
            {t('settings.savePreferences')}
          </button>
        </form>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span aria-hidden="true">
            <Icon name="key" />
          </span>
          <div>
            <h2>{t('settings.passkeySignIn')}</h2>
            <p>{t('settings.passkeySignInHelp')}</p>
          </div>
        </div>
        <p className="muted">{t('settings.passkeySavedHelp')}</p>
        <button
          className="button button--secondary"
          disabled={busy || passkeyBusy}
          onClick={() => void registerPasskey()}
          type="button"
        >
          {passkeyBusy ? t('settings.waitingDevice') : t('settings.addPasskey')}
        </button>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span className={health?.is_stale ? 'health-dot health-dot--bad' : 'health-dot'}>●</span>
          <div>
            <h2>{t('settings.reminderHealth')}</h2>
            <p>{t('settings.reminderHealthHelp')}</p>
          </div>
        </div>
        <dl className="data-list health-list">
          <div>
            <dt>{t('settings.lastSuccessfulRun')}</dt>
            <dd>
              {health?.last_success_at
                ? formatInstantInTimeZone(health.last_success_at, timezone, locale)
                : t('settings.noSuccessfulRun')}
            </dd>
          </div>
          <div>
            <dt>{t('settings.lastOutcome')}</dt>
            <dd>
              {health?.last_status
                ? notificationStateLabel(health.last_status, t)
                : t('settings.unknown')}
            </dd>
          </div>
          <div>
            <dt>{t('settings.nextExpectedRun')}</dt>
            <dd>
              {health?.next_expected_at
                ? formatInstantInTimeZone(health.next_expected_at, timezone, locale)
                : t('settings.notAvailable')}
            </dd>
          </div>
          <div>
            <dt>{t('settings.failedMessages')}</dt>
            <dd>{health?.failed_count ?? 0}</dd>
          </div>
          <div>
            <dt>{t('settings.requiresReview')}</dt>
            <dd>{health?.requires_review_count ?? 0}</dd>
          </div>
        </dl>
        {health?.is_stale && (
          <div className="alert alert--danger">
            <strong>{t('settings.processingStale')}</strong> {t('settings.recoverySteps')}
          </div>
        )}
        <details>
          <summary>{t('settings.recentNotificationAudit')}</summary>
          <div className="notification-list">
            {result.data?.notifications.length ? (
              result.data.notifications.map((notification) => (
                <div key={notification.id}>
                  <span
                    className={`mini-status mini-status--${notification.state === 'provider_accepted' ? 'used' : notification.state.includes('failed') || notification.state === 'requires_review' ? 'danger' : 'partial'}`}
                  >
                    {notificationStateLabel(notification.state, t)}
                  </span>
                  <span>{notificationTypeLabel(notification.notification_type, t)}</span>
                  <span>
                    {formatInstantInTimeZone(notification.scheduled_for, timezone, locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                  <small>
                    {notification.provider_message_id ??
                      notification.last_error_category ??
                      t('settings.noProviderResult')}
                  </small>
                </div>
              ))
            ) : (
              <p className="muted">{t('settings.noNotificationEvents')}</p>
            )}
          </div>
        </details>
      </section>

      <section className="panel form-section settings-span">
        <div className="form-section-title">
          <span aria-hidden="true">
            <Icon name="download" />
          </span>
          <div>
            <h2>{t('settings.exportBackup')}</h2>
            <p>{t('settings.exportBackupHelp')}</p>
          </div>
        </div>
        <div className="export-actions">
          <button
            className="button button--primary"
            onClick={() => void exportJson()}
            disabled={busy}
          >
            {t('settings.exportJson')}
          </button>
          {(['accounts', 'definitions', 'instances', 'redemptions'] as const).map((entity) => (
            <button
              key={entity}
              className="button button--secondary"
              onClick={() => void exportCsv(entity)}
              disabled={busy}
            >
              {entityLabel(entity, t)} CSV
            </button>
          ))}
        </div>
        <div className="info-box">
          <strong>{t('settings.backupSafety')}</strong> {t('settings.backupSafetyHelp')}
        </div>
      </section>

      <section className="panel form-section settings-span">
        <div className="form-section-title">
          <span>⇧</span>
          <div>
            <h2>{t('settings.validateImport')}</h2>
            <p>{t('settings.importHelp')}</p>
          </div>
        </div>
        <label className="file-drop">
          <input
            type="file"
            accept="application/json,text/csv,.json,.csv"
            onChange={(event) => void selectImport(event.target.files?.[0])}
          />
          <span>
            <strong>{t('settings.selectImport')}</strong>
            <small>{t('settings.importLimits')}</small>
          </span>
        </label>
        <button
          type="button"
          className="button button--secondary"
          onClick={() =>
            downloadText(
              'perkledger-accounts-benefits-import-template.csv',
              CSV_IMPORT_TEMPLATE,
              'text/csv;charset=utf-8',
            )
          }
        >
          {t('settings.downloadTemplate')}
        </button>
        {importData && (
          <div className="import-preview">
            <h3>
              {t('settings.validationPreview')} ·{' '}
              {importKind === 'JSON backup'
                ? t('settings.importKindJson')
                : t('settings.importKindCsv')}
            </h3>
            <dl className="preview-counts">
              <div>
                <dt>{t('settings.entity.accounts')}</dt>
                <dd>{importData.accounts.length}</dd>
              </div>
              <div>
                <dt>{t('settings.entity.definitions')}</dt>
                <dd>{importData.definitions.length}</dd>
              </div>
              <div>
                <dt>{t('settings.entity.instances')}</dt>
                <dd>{importData.instances.length}</dd>
              </div>
              <div>
                <dt>{t('settings.entity.redemptions')}</dt>
                <dd>{importData.redemptions.length}</dd>
              </div>
            </dl>
            <div className="form-grid">
              <label className="field">
                <span>{t('settings.duplicates')}</span>
                <select
                  value={duplicatePolicy}
                  onChange={(event) =>
                    setDuplicatePolicy(event.target.value as typeof duplicatePolicy)
                  }
                >
                  <option value="skip">{t('settings.skipMatching')}</option>
                  <option value="import_as_new">{t('settings.importAsNew')}</option>
                </select>
              </label>
              <label className="field">
                <span>{t('settings.currentNotifications')}</span>
                <select
                  value={notificationPolicy}
                  onChange={(event) =>
                    setNotificationPolicy(event.target.value as typeof notificationPolicy)
                  }
                >
                  <option value="suppress_current">{t('settings.suppressCurrent')}</option>
                  <option value="schedule_fresh">{t('settings.scheduleFresh')}</option>
                </select>
              </label>
            </div>
            {notificationPolicy === 'schedule_fresh' && (
              <div className="alert alert--warning">{t('settings.restoreDuplicateWarning')}</div>
            )}
            <button
              className="button button--primary"
              onClick={() => void restore()}
              disabled={busy}
            >
              {busy ? t('settings.restoring') : t('settings.restoreValidated')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
