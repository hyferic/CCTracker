import { useState, type FormEvent } from 'react';
import { Icon } from '../../components/Icon';
import { useAuth } from './AuthProvider';

export function LoginPage() {
  const auth = useAuth();
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
      setError(caught instanceof Error ? caught.message : 'Could not send the sign-in link.');
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
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not sign in with this passkey. Try your email link instead.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page" data-testid="auth-screen">
      <section className="auth-brand" aria-label="Product introduction">
        <a className="brand brand--light" href="#/" aria-label="PerkLedger home">
          <span className="brand-mark" aria-hidden="true">
            P
          </span>
          <span>PerkLedger</span>
        </a>
        <div className="auth-promise">
          <p className="eyebrow eyebrow--light">Your benefits, on time</p>
          <h1>Stop leaving credits on the table.</h1>
          <p>
            Track card benefits, cashback offers, reimbursements, and every reset—without storing
            sensitive card credentials.
          </p>
          <ul className="auth-points">
            <li>
              <span aria-hidden="true">
                <Icon name="check" size={13} />
              </span>
              Private, owner-only access
            </li>
            <li>
              <span aria-hidden="true">
                <Icon name="check" size={13} />
              </span>
              Calendar-correct recurring periods
            </li>
            <li>
              <span aria-hidden="true">
                <Icon name="check" size={13} />
              </span>
              Email reminders while you are offline
            </li>
          </ul>
        </div>
        <p className="auth-footnote">Built for a clear view of what is available now.</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          {auth.configurationError ? (
            <>
              <p className="eyebrow">Setup needed</p>
              <h2>Connect your private database</h2>
              <div className="alert alert--warning" role="alert">
                {auth.configurationError}
              </div>
              <p className="muted">
                Follow the deployment guide to add the Supabase project URL and publishable key. No
                service-role or email secret belongs in the browser.
              </p>
            </>
          ) : sent ? (
            <div aria-live="polite">
              <div className="success-orb" aria-hidden="true">
                <Icon name="check" />
              </div>
              <p className="eyebrow">Check your inbox</p>
              <h2>Your secure link is on its way</h2>
              <p className="muted">
                Open the link on this same device and in this browser. PKCE links cannot be moved to
                a different browser safely.
              </p>
              <button
                className="button button--secondary button--wide"
                onClick={() => setSent(false)}
              >
                Send another link
              </button>
            </div>
          ) : (
            <>
              <p className="eyebrow">Private dashboard</p>
              <h2>Welcome back</h2>
              <p className="muted">
                Use your saved passkey, or the confirmed owner email configured in Supabase.
              </p>
              {passkeysSupported && (
                <button
                  className="button button--primary button--wide"
                  disabled={busy}
                  onClick={() => void signInWithPasskey()}
                  type="button"
                >
                  {busy ? 'Waiting for passkey…' : 'Sign in with passkey'}
                </button>
              )}
              <form onSubmit={(event) => void submit(event)}>
                <label className="field">
                  <span>Email address</span>
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
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
                  {busy ? 'Sending…' : 'Email me a secure sign-in link'}
                </button>
              </form>
              <p className="privacy-note">
                No password is stored by this app. Set up a passkey from Settings after an
                email-link sign-in; unknown email addresses cannot create accounts.
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
