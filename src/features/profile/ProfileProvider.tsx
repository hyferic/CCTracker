import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ErrorState } from '../../components/AsyncState';
import { LoadingScreen } from '../../components/LoadingScreen';
import { getProfile } from '../../services/api';
import type { Profile } from '../../types';
import { ProfileContext, type ProfileContextValue } from './ProfileContext';

export function ProfileProvider({
  children,
  initialProfile,
}: {
  children: ReactNode;
  initialProfile?: Profile;
}) {
  const [profile, setProfile] = useState<Profile | null>(initialProfile ?? null);
  const [loading, setLoading] = useState(!initialProfile);
  const [error, setError] = useState<Error | null>(null);

  const refreshProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProfile(await getProfile());
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Could not load profile settings.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialProfile) void refreshProfile();
  }, [initialProfile, refreshProfile]);

  const value = useMemo<ProfileContextValue | null>(
    () =>
      profile
        ? {
            profile,
            timezone: profile.timezone,
            replaceProfile: setProfile,
            refreshProfile,
          }
        : null,
    [profile, refreshProfile],
  );

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorState error={error} onRetry={() => void refreshProfile()} />;
  if (!value) return <ErrorState error={new Error('Profile settings are unavailable.')} />;
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}
