import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileContext } from '../profile/ProfileContext';
import { profileFixture } from '../../test/fixtures';
import { I18nProvider, initialLanguage, useI18n } from './I18nContext';

const updateProfileLanguage = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ updateProfileLanguage }));

function Probe() {
  const { language, setLanguage, t } = useI18n();
  return (
    <button type="button" onClick={() => setLanguage(language === 'en' ? 'zh-CN' : 'en')}>
      {t('settings.language')}
    </button>
  );
}

function MigratedKeyProbe() {
  const { language, setLanguage, t } = useI18n();
  return (
    <>
      <p>{t('benefitTable.caption')}</p>
      <button type="button" onClick={() => setLanguage(language === 'en' ? 'zh-CN' : 'en')}>
        {t('login.homeAria')}
      </button>
    </>
  );
}

describe('language initialization and persistence', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    updateProfileLanguage.mockReset();
  });
  it('prefers an explicit profile preference over local storage and system language', () => {
    localStorage.setItem('perkledger.language', 'zh-CN');
    Object.defineProperty(window.navigator, 'language', { configurable: true, value: 'en-US' });
    expect(initialLanguage('en')).toBe('en');
    expect(initialLanguage(null)).toBe('zh-CN');
  });

  it('uses the system language when no local preference exists and falls back to English', () => {
    localStorage.removeItem('perkledger.language');
    Object.defineProperty(window.navigator, 'language', { configurable: true, value: 'zh-TW' });
    expect(initialLanguage(null)).toBe('zh-CN');
    Object.defineProperty(window.navigator, 'language', { configurable: true, value: 'fr-FR' });
    expect(initialLanguage(null)).toBe('en');
  });

  it('updates copy immediately and persists an explicit profile preference', async () => {
    updateProfileLanguage.mockResolvedValue({ ...profileFixture(), language: 'zh-CN' });
    const replaceProfile = vi.fn();
    render(
      <ProfileContext.Provider
        value={{
          profile: profileFixture(),
          timezone: 'America/New_York',
          replaceProfile,
          refreshProfile: vi.fn(),
        }}
      >
        <I18nProvider>
          <Probe />
        </I18nProvider>
      </ProfileContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
    expect(screen.getByRole('button', { name: '语言' })).toBeInTheDocument();
    await waitFor(() => expect(updateProfileLanguage).toHaveBeenCalledWith('zh-CN'));
    expect(replaceProfile).toHaveBeenCalled();
  });

  it('updates migrated UI resource keys immediately when the language changes', async () => {
    updateProfileLanguage.mockResolvedValue({ ...profileFixture(), language: 'zh-CN' });
    render(
      <ProfileContext.Provider
        value={{
          profile: profileFixture(),
          timezone: 'America/New_York',
          replaceProfile: vi.fn(),
          refreshProfile: vi.fn(),
        }}
      >
        <I18nProvider>
          <MigratedKeyProbe />
        </I18nProvider>
      </ProfileContext.Provider>,
    );
    expect(screen.getByText('Benefit periods and remaining values')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'PerkLedger home' }));
    expect(screen.getByText('福利周期与剩余价值')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PerkLedger 首页' })).toBeInTheDocument();
    await waitFor(() => expect(updateProfileLanguage).toHaveBeenCalledWith('zh-CN'));
  });
});
