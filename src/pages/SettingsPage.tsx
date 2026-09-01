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
import { useI18n } from '../features/i18n/I18nContext';

type Localize = (english: string, simplifiedChinese: string) => string;

function localizeEntity(
  entity: 'accounts' | 'definitions' | 'instances' | 'redemptions',
  localize: Localize,
) {
  return {
    accounts: localize('Accounts', '账户'),
    definitions: localize('Definitions', '福利定义'),
    instances: localize('Periods', '周期'),
    redemptions: localize('Usage entries', '使用记录'),
  }[entity];
}

function localizeNotificationState(state: string, localize: Localize) {
  const labels: Record<string, [string, string]> = {
    provider_accepted: ['Provider accepted', '服务商已接受'],
    pending: ['Pending', '待处理'],
    failed_retryable: ['Retryable failure', '可重试失败'],
    failed_terminal: ['Permanent failure', '永久失败'],
    requires_review: ['Requires review', '需要检查'],
  };
  const [english, simplifiedChinese] = labels[state] ?? [
    state.replaceAll('_', ' '),
    state.replaceAll('_', ' '),
  ];
  return localize(english, simplifiedChinese);
}

function localizeNotificationType(type: string, localize: Localize) {
  const labels: Record<string, [string, string]> = {
    expiration: ['Expiration', '到期'],
    reactivation: ['Available again', '重新可用'],
  };
  const [english, simplifiedChinese] = labels[type] ?? [
    type.replaceAll('_', ' '),
    type.replaceAll('_', ' '),
  ];
  return localize(english, simplifiedChinese);
}

export function SettingsPage() {
  const auth = useAuth();
  const { profile, replaceProfile, timezone } = useProfile();
  const { language, setLanguage, t, localize } = useI18n();
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
      setMessage(
        t('settings.csvExported').replace(
          '{entity}',
          `${entity[0]?.toUpperCase()}${entity.slice(1)}`,
        ),
      );
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
              <strong>{localize('Expiration reminders', '到期提醒')}</strong>
              <small>
                {localize(
                  'Send one logical event 7 days before expiration, with active-period catch-up.',
                  '在到期前 7 天发送一次提醒；如果任务错过，会在周期仍有效时补发。',
                )}
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
              <strong>{localize('Available-again reminders', '重新可用提醒')}</strong>
              <small>
                {localize(
                  'Send only for genuinely new, pre-generated periods on their local start date.',
                  '只在真正新生成的周期本地开始日发送提醒。',
                )}
              </small>
            </span>
          </label>
          <label className="field">
            <span>{localize('Show recent resets for', '显示最近重置')}</span>
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
              <span>{localize('days', '天')}</span>
            </div>
          </label>
          <button type="submit" className="button button--primary" disabled={busy}>
            {localize('Save preferences', '保存偏好设置')}
          </button>
        </form>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span aria-hidden="true">
            <Icon name="key" />
          </span>
          <div>
            <h2>{localize('Passkey sign-in', '通行密钥登录')}</h2>
            <p>
              {localize(
                'Use Face ID, Touch ID, or your device passcode instead of opening an email link.',
                '使用 Face ID、Touch ID 或设备密码登录，无需打开邮件链接。',
              )}
            </p>
          </div>
        </div>
        <p className="muted">
          {localize(
            'Passkeys are saved by your device or password manager. Add one while signed in, then use “Sign in with passkey” from the Home Screen app.',
            '通行密钥由设备或密码管理器保存。登录后添加一个，即可在主屏幕应用中使用“使用通行密钥登录”。',
          )}
        </p>
        <button
          className="button button--secondary"
          disabled={busy || passkeyBusy}
          onClick={() => void registerPasskey()}
          type="button"
        >
          {passkeyBusy
            ? localize('Waiting for device confirmation…', '等待设备确认…')
            : localize('Add passkey to this device', '为此设备添加通行密钥')}
        </button>
      </section>

      <section className="panel form-section">
        <div className="form-section-title">
          <span className={health?.is_stale ? 'health-dot health-dot--bad' : 'health-dot'}>●</span>
          <div>
            <h2>{localize('Reminder health', '提醒状态')}</h2>
            <p>
              {localize(
                '“Sent” means the email provider accepted the message, not guaranteed inbox delivery.',
                '“已发送”表示邮件服务商已接受消息，不代表邮件一定进入收件箱。',
              )}
            </p>
          </div>
        </div>
        <dl className="data-list health-list">
          <div>
            <dt>{localize('Last successful run', '上次成功运行')}</dt>
            <dd>
              {health?.last_success_at
                ? formatInstantInTimeZone(health.last_success_at, timezone, locale)
                : localize('No successful run recorded', '暂无成功运行记录')}
            </dd>
          </div>
          <div>
            <dt>{localize('Last outcome', '上次结果')}</dt>
            <dd>{health?.last_status ?? localize('Unknown', '未知')}</dd>
          </div>
          <div>
            <dt>{localize('Next expected run', '预计下次运行')}</dt>
            <dd>
              {health?.next_expected_at
                ? formatInstantInTimeZone(health.next_expected_at, timezone, locale)
                : localize('Not available', '暂无数据')}
            </dd>
          </div>
          <div>
            <dt>{localize('Failed messages', '失败消息')}</dt>
            <dd>{health?.failed_count ?? 0}</dd>
          </div>
          <div>
            <dt>{localize('Requires review', '需要检查')}</dt>
            <dd>{health?.requires_review_count ?? 0}</dd>
          </div>
        </dl>
        {health?.is_stale && (
          <div className="alert alert--danger">
            <strong>{localize('Processing is stale.', '处理任务已过期。')}</strong>{' '}
            {localize(
              'Check whether Supabase is paused, inspect Cron and Edge Function logs, verify the Vault/Edge scheduler secret copies match, then use the protected GitHub recovery workflow once and confirm a fresh heartbeat.',
              '请检查 Supabase 是否暂停，查看 Cron 和 Edge Function 日志，确认 Vault 与 Edge 中的调度密钥副本一致，然后运行一次受保护的 GitHub 恢复流程并确认新的心跳记录。',
            )}
          </div>
        )}
        <details>
          <summary>{localize('Recent notification audit', '最近提醒审计')}</summary>
          <div className="notification-list">
            {result.data?.notifications.length ? (
              result.data.notifications.map((notification) => (
                <div key={notification.id}>
                  <span
                    className={`mini-status mini-status--${notification.state === 'provider_accepted' ? 'used' : notification.state.includes('failed') || notification.state === 'requires_review' ? 'danger' : 'partial'}`}
                  >
                    {localizeNotificationState(notification.state, localize)}
                  </span>
                  <span>{localizeNotificationType(notification.notification_type, localize)}</span>
                  <span>
                    {formatInstantInTimeZone(notification.scheduled_for, timezone, locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                  <small>
                    {notification.provider_message_id ??
                      notification.last_error_category ??
                      localize('No provider result yet', '暂无服务商结果')}
                  </small>
                </div>
              ))
            ) : (
              <p className="muted">{localize('No notification events yet.', '暂无提醒事件。')}</p>
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
            <h2>{localize('Export & encrypted backup', '导出与加密备份')}</h2>
            <p>
              {localize(
                'JSON preserves portable history. Flattened CSV files are for analysis.',
                'JSON 会保留可迁移的完整历史；扁平 CSV 适合分析。',
              )}
            </p>
          </div>
        </div>
        <div className="export-actions">
          <button
            className="button button--primary"
            onClick={() => void exportJson()}
            disabled={busy}
          >
            {localize('Export canonical JSON', '导出标准 JSON')}
          </button>
          {(['accounts', 'definitions', 'instances', 'redemptions'] as const).map((entity) => (
            <button
              key={entity}
              className="button button--secondary"
              onClick={() => void exportCsv(entity)}
              disabled={busy}
            >
              {localizeEntity(entity, localize)} CSV
            </button>
          ))}
        </div>
        <div className="info-box">
          <strong>{localize('Backup safety:', '备份安全：')}</strong>{' '}
          {localize(
            'Exports contain private financial-benefit notes. Never commit them to GitHub. Encrypt the JSON file before off-repository storage and perform a restore drill at least quarterly on the free-tier profile.',
            '导出文件包含私人财务福利备注。不要提交到 GitHub；存放在仓库外前请加密 JSON，并至少每季度在免费方案账户上进行一次恢复演练。',
          )}
        </div>
      </section>

      <section className="panel form-section settings-span">
        <div className="form-section-title">
          <span>⇧</span>
          <div>
            <h2>{localize('Validate & import', '验证与导入')}</h2>
            <p>
              {localize(
                'Restore canonical JSON or import accounts and definitions from the CSV template. Client preview is advisory; the database validates again and rolls back everything on any error.',
                '恢复标准 JSON，或从 CSV 模板导入账户和福利定义。客户端预览仅供参考；数据库会再次验证，任何错误都会回滚全部操作。',
              )}
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
            <strong>
              {localize('Select canonical JSON or template CSV', '选择标准 JSON 或模板 CSV')}
            </strong>
            <small>
              {localize('Maximum 5 MiB and 5,000 total rows', '最大 5 MiB，共 5,000 行')}
            </small>
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
          {localize('Download CSV import template', '下载 CSV 导入模板')}
        </button>
        {importData && (
          <div className="import-preview">
            <h3>
              {localize('Validation preview', '验证预览')} ·{' '}
              {importKind === 'JSON backup'
                ? localize('JSON backup', 'JSON 备份')
                : localize('CSV accounts/definitions', 'CSV 账户/福利定义')}
            </h3>
            <dl className="preview-counts">
              <div>
                <dt>{localize('Accounts', '账户')}</dt>
                <dd>{importData.accounts.length}</dd>
              </div>
              <div>
                <dt>{localize('Definitions', '福利定义')}</dt>
                <dd>{importData.definitions.length}</dd>
              </div>
              <div>
                <dt>{localize('Periods', '周期')}</dt>
                <dd>{importData.instances.length}</dd>
              </div>
              <div>
                <dt>{localize('Usage entries', '使用记录')}</dt>
                <dd>{importData.redemptions.length}</dd>
              </div>
            </dl>
            <div className="form-grid">
              <label className="field">
                <span>{localize('Duplicates', '重复记录')}</span>
                <select
                  value={duplicatePolicy}
                  onChange={(event) =>
                    setDuplicatePolicy(event.target.value as typeof duplicatePolicy)
                  }
                >
                  <option value="skip">{localize('Skip matching records', '跳过匹配记录')}</option>
                  <option value="import_as_new">
                    {localize('Import as new', '作为新记录导入')}
                  </option>
                </select>
              </label>
              <label className="field">
                <span>{localize('Current-period notifications', '当前周期提醒')}</span>
                <select
                  value={notificationPolicy}
                  onChange={(event) =>
                    setNotificationPolicy(event.target.value as typeof notificationPolicy)
                  }
                >
                  <option value="suppress_current">
                    {localize('Suppress current (recommended)', '抑制当前提醒（推荐）')}
                  </option>
                  <option value="schedule_fresh">
                    {localize('Schedule fresh with duplicate warning', '安排新提醒并显示重复警告')}
                  </option>
                </select>
              </label>
            </div>
            {notificationPolicy === 'schedule_fresh' && (
              <div className="alert alert--warning">
                {localize(
                  'Prior provider sends cannot be deduplicated after restore. Eligible current periods may receive one new event under normal due-date rules.',
                  '恢复后无法去重服务商之前发送的提醒。符合条件的当前周期可能会按正常到期规则收到一条新提醒。',
                )}
              </div>
            )}
            <button
              className="button button--primary"
              onClick={() => void restore()}
              disabled={busy}
            >
              {busy
                ? localize('Restoring atomically…', '正在原子恢复…')
                : localize('Restore validated backup', '恢复已验证备份')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
