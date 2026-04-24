/**
 * User object returned by validateUser() — all User fields except passwordHash,
 * plus a derived `hasPassword` boolean flag used by the UI.
 * Used as the parameter type for login() and related authentication flows.
 */
export interface ValidatedUser {
  id: string;
  email: string;
  name: string;
  defaultCurrency: string;
  locale: string;
  timezone: string;
  isActive: boolean;
  emailVerified: boolean;
  hasPassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
