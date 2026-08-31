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

export function SettingsPage() {
  const auth = useAuth();
  const { profile, replaceProfile, timezone } = useProfile();
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
    setProfileForm(profile);
  }, [profile]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!validateTimeZone(profileForm.timezone)) {
      setError('Enter a valid IANA timezone such as America/New_York.');
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
      });
      replaceProfile(saved);
      setProfileForm(saved);
      setMessage('Settings saved. Existing date-only periods did not shift.');
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save settings.');
    } finally {
      setBusy(false);
    }
  }

  async function registerPasskey() {
    setPasskeyBusy(true);
    setError(null);
    try {
      await auth.registerPasskey();
      setMessage(
        'Passkey added. You can now use it from this iPhone Home Screen app or another compatible device.',
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not add a passkey. Confirm passkeys are enabled in Supabase, then try again.',
      );
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
      setMessage('Canonical JSON backup exported. Encrypt it before storing it off-repository.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not export data.');
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
      setMessage(`${entity[0]?.toUpperCase()}${entity.slice(1)} CSV exported.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not export CSV.');
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
      setError(caught instanceof Error ? caught.message : 'Could not validate this backup.');
    }
  }

  async function restore() {
    if (!importData) return;
    if (
      notificationPolicy === 'schedule_fresh' &&
      !window.confirm(
        'Schedule fresh notifications? Emails sent before this restore cannot be deduplicated, so this may produce a duplicate reminder.',
      )
    )
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
        `Restore completed atomically: ${counts.accounts} accounts, ${counts.definitions} definitions, ${counts.instances} periods, and ${counts.redemptions} usage entries.${counts.warnings.length ? ` Provenance warning: ${counts.warnings.join(' ')}` : ''}`,
      );
      setImportData(null);
      setImportKind(null);
      result.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Restore failed. Nothing was imported.');
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
        eyebrow="Preferences, portability & operations"
        title="Keep the tracker dependable."
        description="Manage local-date behavior, email preferences, backups, and reminder health."
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
            <Icon name="clock" />
          </span>
          <div>
            <h2>Timezone & reminders</h2>
            <p>Date boundaries are calculated in this explicit IANA timezone.</p>
          </div>
        </div>
        <form className="form-stack" onSubmit={(event) => void saveProfile(event)}>
          <label className="field">
            <span>Timezone</span>
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
            <small>
              Changing this affects “today” and future processing; existing date-only history never
              shifts.
            </small>
          </label>
          <div className="field">
            <label htmlFor="verified-notification-recipient">Verified notification recipient</label>
            <input
              id="verified-notification-recipient"
              type="email"
              readOnly
              value={profile.email.toLowerCase()}
              aria-describedby="verified-notification-recipient-help"
            />
            <small id="verified-notification-recipient-help">
              Reminders can only go to the confirmed email on your signed-in account. Change and
              verify that address through authentication before using a different recipient.
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
              <strong>Expiration reminders</strong>
              <small>
                Send one logical event 7 days before expiration, with active-period catch-up.
              </small>
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
              <strong>Available-again reminders</strong>
              <small>
                Send only for genuinely new, pre-generated periods on their local start date.
              </small>
            </span>
          </label>
          <label className="field">
            <span>Show recent resets for</span>
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
              <span>days</span>
            </div>
          </label>
          <button type="submit" className="button button--primary" disabled={busy}>
            Save preferences
          </button>
        </form>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span aria-hidden="true">
            <Icon name="key" />
          </span>
          <div>
            <h2>Passkey sign-in</h2>
            <p>Use Face ID, Touch ID, or your device passcode instead of opening an email link.</p>
          </div>
        </div>
        <p className="muted">
          Passkeys are saved by your device or password manager. Add one while signed in, then use
          “Sign in with passkey” from the Home Screen app.
        </p>
        <button
          className="button button--secondary"
          disabled={busy || passkeyBusy}
          onClick={() => void registerPasskey()}
          type="button"
        >
          {passkeyBusy ? 'Waiting for device confirmation…' : 'Add passkey to this device'}
        </button>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span className={health?.is_stale ? 'health-dot health-dot--bad' : 'health-dot'}>●</span>
          <div>
            <h2>Reminder health</h2>
            <p>
              “Sent” means the email provider accepted the message, not guaranteed inbox delivery.
            </p>
          </div>
        </div>
        <dl className="data-list health-list">
          <div>
            <dt>Last successful run</dt>
            <dd>
              {health?.last_success_at
                ? formatInstantInTimeZone(health.last_success_at, timezone)
                : 'No successful run recorded'}
            </dd>
          </div>
          <div>
            <dt>Last outcome</dt>
            <dd>{health?.last_status ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Next expected run</dt>
            <dd>
              {health?.next_expected_at
                ? formatInstantInTimeZone(health.next_expected_at, timezone)
                : 'Not available'}
            </dd>
          </div>
          <div>
            <dt>Failed messages</dt>
            <dd>{health?.failed_count ?? 0}</dd>
          </div>
          <div>
            <dt>Requires review</dt>
            <dd>{health?.requires_review_count ?? 0}</dd>
          </div>
        </dl>
        {health?.is_stale && (
          <div className="alert alert--danger">
            <strong>Processing is stale.</strong> Check whether Supabase is paused, inspect Cron and
            Edge Function logs, verify the Vault/Edge scheduler secret copies match, then use the
            protected GitHub recovery workflow once and confirm a fresh heartbeat.
          </div>
        )}
        <details>
          <summary>Recent notification audit</summary>
          <div className="notification-list">
            {result.data?.notifications.length ? (
              result.data.notifications.map((notification) => (
                <div key={notification.id}>
                  <span
                    className={`mini-status mini-status--${notification.state === 'provider_accepted' ? 'used' : notification.state.includes('failed') || notification.state === 'requires_review' ? 'danger' : 'partial'}`}
                  >
                    {notification.state.replaceAll('_', ' ')}
                  </span>
                  <span>{notification.notification_type.replaceAll('_', ' ')}</span>
                  <span>
                    {formatInstantInTimeZone(notification.scheduled_for, timezone, 'en-US', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                  <small>
                    {notification.provider_message_id ??
                      notification.last_error_category ??
                      'No provider result yet'}
                  </small>
                </div>
              ))
            ) : (
              <p className="muted">No notification events yet.</p>
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
            <h2>Export & encrypted backup</h2>
            <p>JSON preserves portable history. Flattened CSV files are for analysis.</p>
          </div>
        </div>
        <div className="export-actions">
          <button
            className="button button--primary"
            onClick={() => void exportJson()}
            disabled={busy}
          >
            Export canonical JSON
          </button>
          {(['accounts', 'definitions', 'instances', 'redemptions'] as const).map((entity) => (
            <button
              key={entity}
              className="button button--secondary"
              onClick={() => void exportCsv(entity)}
              disabled={busy}
            >
              {entity} CSV
            </button>
          ))}
        </div>
        <div className="info-box">
          <strong>Backup safety:</strong> exports contain private financial-benefit notes. Never
          commit them to GitHub. Encrypt the JSON file before off-repository storage and perform a
          restore drill at least quarterly on the free-tier profile.
        </div>
      </section>

      <section className="panel form-section settings-span">
        <div className="form-section-title">
          <span>⇧</span>
          <div>
            <h2>Validate & import</h2>
            <p>
              Restore canonical JSON or import accounts and definitions from the CSV template.
              Client preview is advisory; the database validates again and rolls back everything on
              any error.
            </p>
          </div>
        </div>
        <label className="file-drop">
          <input
            type="file"
            accept="application/json,text/csv,.json,.csv"
            onChange={(event) => void selectImport(event.target.files?.[0])}
          />
          <span>
            <strong>Select canonical JSON or template CSV</strong>
            <small>Maximum 5 MiB and 5,000 total rows</small>
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
          Download CSV import template
        </button>
        {importData && (
          <div className="import-preview">
            <h3>Validation preview · {importKind}</h3>
            <dl className="preview-counts">
              <div>
                <dt>Accounts</dt>
                <dd>{importData.accounts.length}</dd>
              </div>
              <div>
                <dt>Definitions</dt>
                <dd>{importData.definitions.length}</dd>
              </div>
              <div>
                <dt>Periods</dt>
                <dd>{importData.instances.length}</dd>
              </div>
              <div>
                <dt>Usage entries</dt>
                <dd>{importData.redemptions.length}</dd>
              </div>
            </dl>
            <div className="form-grid">
              <label className="field">
                <span>Duplicates</span>
                <select
                  value={duplicatePolicy}
                  onChange={(event) =>
                    setDuplicatePolicy(event.target.value as typeof duplicatePolicy)
                  }
                >
                  <option value="skip">Skip matching records</option>
                  <option value="import_as_new">Import as new</option>
                </select>
              </label>
              <label className="field">
                <span>Current-period notifications</span>
                <select
                  value={notificationPolicy}
                  onChange={(event) =>
                    setNotificationPolicy(event.target.value as typeof notificationPolicy)
                  }
                >
                  <option value="suppress_current">Suppress current (recommended)</option>
                  <option value="schedule_fresh">Schedule fresh with duplicate warning</option>
                </select>
              </label>
            </div>
            {notificationPolicy === 'schedule_fresh' && (
              <div className="alert alert--warning">
                Prior provider sends cannot be deduplicated after restore. Eligible current periods
                may receive one new event under normal due-date rules.
              </div>
            )}
            <button
              className="button button--primary"
              onClick={() => void restore()}
              disabled={busy}
            >
              {busy ? 'Restoring atomically…' : 'Restore validated backup'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
