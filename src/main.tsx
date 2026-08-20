import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './features/auth/AuthProvider';
import { supabase } from './services/supabase';
import './styles.css';

async function exchangePkceCode() {
  const parameters = new URLSearchParams(window.location.search);
  const code = parameters.get('code');
  const authError = parameters.get('error_description');
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    parameters.delete('code');
    if (error) parameters.set('auth_error', error.message);
  }
  if (authError) {
    parameters.delete('error');
    parameters.delete('error_code');
    parameters.delete('error_description');
    parameters.set('auth_error', authError);
  }
  if (code || authError) {
    const query = parameters.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}#/dashboard`,
    );
  }
}

await exchangePkceCode();

const root = document.getElementById('root');
if (!root) throw new Error('Application root not found.');
createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
