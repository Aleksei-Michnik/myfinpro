import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer');

const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id' });
const mockCreateTransport = nodemailer.createTransport as jest.Mock;

describe('MailService', () => {
  const smtpConfig: Record<string, string | number> = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: 587,
    SMTP_SECURE: 'false',
    SMTP_USER: 'user@example.com',
    SMTP_PASS: 'password',
    SMTP_FROM: 'MyFinPro <noreply@example.com>',
    FRONTEND_URL: 'https://myfinpro.com',
  };

  function createConfigService(overrides: Record<string, string | number | undefined> = {}) {
    const merged = { ...smtpConfig, ...overrides };
    return {
      get: jest.fn((key: string, defaultValue?: string | number) => {
        const val = merged[key];
        return val !== undefined ? val : defaultValue;
      }),
    };
  }

  async function createService(configOverrides: Record<string, string | number | undefined> = {}) {
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: createConfigService(configOverrides),
        },
      ],
    }).compile();

    return module.get<MailService>(MailService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Transporter Creation ──────────────────────────────────────────

  it('creates SMTP transporter when SMTP_HOST is configured', async () => {
    await createService();

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {
        user: 'user@example.com',
        pass: 'password',
      },
    });
  });

  it('creates SMTP transporter without auth when SMTP_USER is empty', async () => {
    await createService({ SMTP_USER: '', SMTP_PASS: '' });

    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
    });
  });

  it('uses console fallback when SMTP_HOST is not configured', async () => {
    const service = await createService({ SMTP_HOST: undefined });

    expect(mockCreateTransport).not.toHaveBeenCalled();
    // Verify the service still works (won't throw)
    await expect(
      service.sendMail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      }),
    ).resolves.toBeUndefined();
  });

  // ── sendMail ──────────────────────────────────────────────────────

  it('sendMail sends email via transporter', async () => {
    const service = await createService();

    await service.sendMail({
      to: 'user@test.com',
      subject: 'Hello',
      html: '<p>World</p>',
    });

    expect(mockSendMail).toHaveBeenCalledWith({
      from: 'MyFinPro <noreply@example.com>',
      to: 'user@test.com',
      subject: 'Hello',
      html: '<p>World</p>',
    });
  });

  it('sendMail logs to console when in fallback mode', async () => {
    const service = await createService({ SMTP_HOST: undefined });
    const logSpy = jest.spyOn(service['logger'], 'log');

    await service.sendMail({
      to: 'user@test.com',
      subject: 'Test Subject',
      html: '<p>Email content</p>',
    });

    expect(mockSendMail).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[Console Mail]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Test Subject'));
  });

  it('sendMail catches and logs errors (never throws)', async () => {
    mockCreateTransport.mockReturnValue({
      sendMail: jest.fn().mockRejectedValue(new Error('SMTP failure')),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: ConfigService,
          useValue: createConfigService(),
        },
      ],
    }).compile();

    const service = module.get<MailService>(MailService);
    const errorSpy = jest.spyOn(service['logger'], 'error');

    await expect(
      service.sendMail({
        to: 'user@test.com',
        subject: 'Test',
        html: '<p>Test</p>',
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('SMTP failure'),
      expect.any(String),
    );
  });

  // ── Specialized Email Methods ─────────────────────────────────────

  it('sendVerificationEmail builds correct English email', async () => {
    const service = await createService();

    await service.sendVerificationEmail('user@test.com', 'John', 'abc123', 'en');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@test.com',
        subject: 'Verify your email address',
        html: expect.stringContaining('https://myfinpro.com/en/auth/verify-email?token=abc123'),
      }),
    );
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('Hello John'),
      }),
    );
  });

  it('sendVerificationEmail builds correct Hebrew email', async () => {
    const service = await createService();

    await service.sendVerificationEmail('user@test.com', 'יוחנן', 'abc123', 'he');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@test.com',
        subject: 'אמת את כתובת האימייל שלך',
        html: expect.stringContaining('https://myfinpro.com/he/auth/verify-email?token=abc123'),
      }),
    );
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('dir="rtl"'),
      }),
    );
  });

  it('sendPasswordResetEmail builds correct email with reset link', async () => {
    const service = await createService();

    await service.sendPasswordResetEmail('user@test.com', 'John', 'reset-token-xyz', 'en');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@test.com',
        subject: 'Reset your password',
        html: expect.stringContaining(
          'https://myfinpro.com/en/auth/reset-password?token=reset-token-xyz',
        ),
      }),
    );
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('1 hour'),
      }),
    );
  });

  it('sendAccountDeletionConfirmation includes deletion date and cancel link', async () => {
    const service = await createService();
    const deletionDate = new Date('2026-05-01T00:00:00Z');

    await service.sendAccountDeletionConfirmation(
      'user@test.com',
      'John',
      deletionDate,
      'cancel-token-abc',
      'en',
    );

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@test.com',
        subject: 'Your account is scheduled for deletion',
        html: expect.stringContaining(
          'https://myfinpro.com/en/auth/cancel-deletion?token=cancel-token-abc',
        ),
      }),
    );
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('30-day grace period'),
      }),
    );
  });

  it('sendAccountDeletionCancelled sends confirmation email', async () => {
    const service = await createService();

    await service.sendAccountDeletionCancelled('user@test.com', 'John', 'en');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@test.com',
        subject: 'Account deletion cancelled',
        html: expect.stringContaining('successfully cancelled'),
      }),
    );
  });
});
