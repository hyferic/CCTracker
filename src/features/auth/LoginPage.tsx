import { useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { useAuth } from './AuthProvider';
import { useI18n } from '../i18n/I18nContext';

export function LoginPage() {
  const auth = useAuth();
  const { t, localize } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passkeysSupported = typeof window !== 'undefined' && 'PublicKeyCredential' in window;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.signIn(email.trim());
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('login.signInError'));
    } finally {
      setBusy(false);
    }
  }

  async function signInWithPasskey() {
    setBusy(true);
    setError(null);
    try {
      await auth.signInWithPasskey();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('login.passkeyError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page" data-testid="auth-screen">
      <section className="auth-brand" aria-label={t('login.introduction')}>
        <a
          className="brand brand--light"
          href="#/"
          aria-label={localize('PerkLedger home', 'PerkLedger 首页')}
        >
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <span>PerkLedger</span>
        </a>
        <div className="auth-promise">
          <p className="eyebrow eyebrow--light">{t('login.promise')}</p>
          <h1>{t('login.title')}</h1>
          <p>{t('login.description')}</p>
          <ul className="auth-points">
            <li>
              <span aria-hidden="true">
                <Icon name="check" size={13} />
              </span>
              {t('login.privateAccess')}
            </li>
            <li>
              <span aria-hidden="true">
                <Icon name="check" size={13} />
              </span>
              {t('login.recurring')}
            </li>
            <li>
              <span aria-hidden="true">
                <Icon name="check" size={13} />
              </span>
              {t('login.reminders')}
            </li>
          </ul>
        </div>
        <p className="auth-footnote">{t('login.footnote')}</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          {auth.configurationError ? (
            <>
              <p className="eyebrow">{t('login.setupNeeded')}</p>
              <h2>{t('login.connectDatabase')}</h2>
              <div className="alert alert--warning" role="alert">
                {localize(
                  'This deployment is not connected to Supabase. Add the browser-safe project URL and publishable key.',
                  '此部署尚未连接 Supabase。请添加浏览器安全的项目 URL 和 publishable key。',
                )}
              </div>
              <p className="muted">{t('login.deploymentHelp')}</p>
            </>
          ) : sent ? (
            <div aria-live="polite">
              <div className="success-orb" aria-hidden="true">
                <Icon name="check" />
              </div>
              <p className="eyebrow">{t('login.checkInbox')}</p>
              <h2>{t('login.secureLinkSent')}</h2>
              <p className="muted">{t('login.linkHelp')}</p>
              <button
                className="button button--secondary button--wide"
                onClick={() => setSent(false)}
              >
                {t('login.sendAnother')}
              </button>
            </div>
          ) : (
            <>
              <p className="eyebrow">{t('login.privateDashboard')}</p>
              <h2>{t('login.welcome')}</h2>
              <p className="muted">{t('login.signInHelp')}</p>
              {passkeysSupported && (
                <button
                  className="button button--primary button--wide"
                  disabled={busy}
                  onClick={() => void signInWithPasskey()}
                  type="button"
                >
                  {busy ? t('login.waitingPasskey') : t('login.signInPasskey')}
                </button>
              )}
              <form onSubmit={(event) => void submit(event)}>
                <label className="field">
                  <span>{t('login.email')}</span>
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={localize('you@example.com', 'you@example.com')}
                  />
                </label>
                {error && (
                  <div className="alert alert--danger" role="alert">
                    {error}
                  </div>
                )}
                <button
                  className="button button--primary button--wide"
                  disabled={busy}
                  type="submit"
                >
                  {busy ? t('login.sending') : t('login.sendLink')}
                </button>
              </form>
              <p className="privacy-note">{t('login.privacy')}</p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
