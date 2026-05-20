import type { Response } from 'express';
import { clearAuthCookie, setAuthCookie } from './auth-cookie';

const mockResponse = () => {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  return { cookie, clearCookie } as unknown as Response & {
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  };
};

describe('auth-cookie helper', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
  });

  it('sets the access_token cookie with HttpOnly + Lax + path=/', () => {
    process.env.NODE_ENV = 'development';
    const res = mockResponse();
    setAuthCookie(res, 'jwt-value', 60);
    expect(res.cookie).toHaveBeenCalledWith('access_token', 'jwt-value', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 60_000,
    });
  });

  it('marks Secure=true only in production', () => {
    process.env.NODE_ENV = 'production';
    const res = mockResponse();
    setAuthCookie(res, 'jwt');
    const opts = (res.cookie as jest.Mock).mock.calls[0]![2] as { secure: boolean };
    expect(opts.secure).toBe(true);
  });

  it('keeps Secure=false in staging (per task spec)', () => {
    process.env.NODE_ENV = 'staging';
    const res = mockResponse();
    setAuthCookie(res, 'jwt');
    const opts = (res.cookie as jest.Mock).mock.calls[0]![2] as { secure: boolean };
    expect(opts.secure).toBe(false);
  });

  it('clears the access_token cookie with the same attributes', () => {
    process.env.NODE_ENV = 'development';
    const res = mockResponse();
    clearAuthCookie(res);
    expect(res.clearCookie).toHaveBeenCalledWith('access_token', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
  });
});
