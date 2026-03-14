export interface JwtPayload {
  sub: string; // User ID (UUID)
  email: string;
  name: string;
  iat?: number;
  exp?: number;
}
