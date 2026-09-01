import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LoadingScreen } from './components/LoadingScreen';
import { AppShell } from './components/AppShell';
import { AccountsPage } from './pages/AccountsPage';
import { BenefitFormPage } from './pages/BenefitFormPage';
import { BenefitsPage } from './pages/BenefitsPage';
import { DashboardPage } from './pages/DashboardPage';
import { InstancePage } from './pages/InstancePage';
import { SettingsPage } from './pages/SettingsPage';
import { LoginPage } from './features/auth/LoginPage';
import { useAuth } from './features/auth/AuthProvider';
import { ProfileProvider } from './features/profile/ProfileProvider';
import { I18nProvider } from './features/i18n/I18nContext';

export function App() {
  const auth = useAuth();
  if (auth.loading)
    return (
      <I18nProvider>
        <LoadingScreen />
      </I18nProvider>
    );
  if (!auth.session)
    return (
      <I18nProvider>
        <LoginPage />
      </I18nProvider>
    );

  return (
    <ProfileProvider>
      <I18nProvider>
        <HashRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/benefits" element={<BenefitsPage />} />
              <Route path="/benefits/new" element={<BenefitFormPage />} />
              <Route path="/benefits/:definitionId/edit" element={<BenefitFormPage />} />
              <Route path="/instances/:instanceId" element={<InstancePage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </I18nProvider>
    </ProfileProvider>
  );
}
