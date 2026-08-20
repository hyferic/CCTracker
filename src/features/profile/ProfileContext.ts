import { createContext, useContext } from 'react';
import { todayInTimeZone } from '../../domain/dates';
import type { Profile } from '../../types';

export interface ProfileContextValue {
  profile: Profile;
  timezone: string;
  replaceProfile: (profile: Profile) => void;
  refreshProfile: () => Promise<void>;
}

export const ProfileContext = createContext<ProfileContextValue | null>(null);

export function useProfile() {
  const value = useContext(ProfileContext);
  if (!value) throw new Error('useProfile must be used inside ProfileProvider.');
  return value;
}

export function useBusinessDate() {
  const { timezone } = useProfile();
  return { timezone, today: todayInTimeZone(timezone).toString() };
}
