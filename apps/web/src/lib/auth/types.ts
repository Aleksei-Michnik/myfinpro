export interface User {
  id: string;
  email: string;
  name: string;
  defaultCurrency: string;
  locale: string;
  emailVerified: boolean;
  deletedAt: string | null;
  scheduledDeletionAt: string | null;
}

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
  defaultCurrency?: string;
  locale?: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
}
