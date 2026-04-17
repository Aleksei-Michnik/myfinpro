'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth/auth-context';

export function TimezoneDetector() {
  const { user, updateProfile } = useAuth();

  useEffect(() => {
    if (!user) return;
    // Only auto-detect if user still has the default timezone
    if (user.timezone !== 'UTC') return;

    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (browserTimezone && browserTimezone !== 'UTC') {
      updateProfile({ timezone: browserTimezone }).catch(() => {
        // Silently fail — this is a convenience feature
      });
    }
  }, [user, updateProfile]);

  return null; // This component renders nothing
}
