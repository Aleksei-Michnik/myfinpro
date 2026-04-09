import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly useConsole: boolean;
  private readonly fromAddress: string;
  private readonly frontendUrl: string;

  constructor(private readonly configService: ConfigService) {
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    this.fromAddress = this.configService.get<string>(
      'SMTP_FROM',
      'MyFinPro <noreply@example.com>',
    );
    this.frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:3000');

    if (!smtpHost) {
      this.logger.warn('SMTP not configured — emails will be logged to console');
      this.useConsole = true;
      this.transporter = null;
    } else {
      this.useConsole = false;
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: this.configService.get<number>('SMTP_PORT', 587),
        secure: this.configService.get<string>('SMTP_SECURE', 'false') === 'true',
        auth: {
          user: this.configService.get<string>('SMTP_USER', ''),
          pass: this.configService.get<string>('SMTP_PASS', ''),
        },
      });
      this.logger.log(`SMTP transport configured (host: ${smtpHost})`);
    }
  }

  async sendMail(options: { to: string; subject: string; html: string }): Promise<void> {
    if (this.useConsole) {
      this.logger.log(
        `[Console Mail] To: ${options.to} | Subject: ${options.subject} | HTML: ${options.html.substring(0, 200)}...`,
      );
      return;
    }

    try {
      await this.transporter!.sendMail({
        from: this.fromAddress,
        to: options.to,
        subject: options.subject,
        html: options.html,
      });
      this.logger.log(`Email sent to ${options.to}: "${options.subject}"`);
    } catch (error) {
      this.logger.error(
        `Failed to send email to ${options.to}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  async sendVerificationEmail(
    to: string,
    name: string,
    token: string,
    locale: string,
  ): Promise<void> {
    try {
      const verificationUrl = `${this.frontendUrl}/${locale}/auth/verify-email?token=${token}`;
      const { subject, html } = this.buildVerificationEmail(name, verificationUrl, locale);
      await this.sendMail({ to, subject, html });
    } catch (error) {
      this.logger.error(
        `Failed to send verification email to ${to}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  async sendPasswordResetEmail(
    to: string,
    name: string,
    token: string,
    locale: string,
  ): Promise<void> {
    try {
      const resetUrl = `${this.frontendUrl}/${locale}/auth/reset-password?token=${token}`;
      const { subject, html } = this.buildPasswordResetEmail(name, resetUrl, locale);
      await this.sendMail({ to, subject, html });
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${to}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  async sendAccountDeletionConfirmation(
    to: string,
    name: string,
    deletionDate: Date,
    cancelToken: string,
    locale: string,
  ): Promise<void> {
    try {
      const cancelUrl = `${this.frontendUrl}/${locale}/auth/cancel-deletion?token=${cancelToken}`;
      const { subject, html } = this.buildDeletionConfirmationEmail(
        name,
        deletionDate,
        cancelUrl,
        locale,
      );
      await this.sendMail({ to, subject, html });
    } catch (error) {
      this.logger.error(
        `Failed to send account deletion confirmation to ${to}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  async sendAccountDeletionCancelled(to: string, name: string, locale: string): Promise<void> {
    try {
      const { subject, html } = this.buildDeletionCancelledEmail(name, locale);
      await this.sendMail({ to, subject, html });
    } catch (error) {
      this.logger.error(
        `Failed to send account deletion cancelled email to ${to}: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  // ── Template Builders ──────────────────────────────────────────────

  private buildVerificationEmail(
    name: string,
    verificationUrl: string,
    locale: string,
  ): { subject: string; html: string } {
    const isHebrew = locale === 'he';

    const subject = isHebrew ? 'אמת את כתובת האימייל שלך' : 'Verify your email address';

    const content = isHebrew
      ? `
        <h2 style="color: #1f2937; margin: 0 0 16px 0; font-size: 20px;">שלום ${name},</h2>
        <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px 0;">
          תודה שנרשמת ל-MyFinPro! אנא אמת את כתובת האימייל שלך על ידי לחיצה על הכפתור למטה.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${verificationUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 9999px; font-weight: 600; font-size: 16px;">
            אימות אימייל
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
          קישור זה יפוג תוך 24 שעות. אם לא נרשמת ל-MyFinPro, אנא התעלם מהודעה זו.
        </p>
      `
      : `
        <h2 style="color: #1f2937; margin: 0 0 16px 0; font-size: 20px;">Hello ${name},</h2>
        <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px 0;">
          Thank you for signing up for MyFinPro! Please verify your email address by clicking the button below.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${verificationUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 9999px; font-weight: 600; font-size: 16px;">
            Verify Email
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
          This link will expire in 24 hours. If you did not sign up for MyFinPro, please ignore this email.
        </p>
      `;

    return { subject, html: this.wrapInLayout(content, locale) };
  }

  private buildPasswordResetEmail(
    name: string,
    resetUrl: string,
    locale: string,
  ): { subject: string; html: string } {
    const isHebrew = locale === 'he';

    const subject = isHebrew ? 'איפוס סיסמה' : 'Reset your password';

    const content = isHebrew
      ? `
        <h2 style="color: #1f2937; margin: 0 0 16px 0; font-size: 20px;">שלום ${name},</h2>
        <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px 0;">
          קיבלנו בקשה לאיפוס הסיסמה שלך. לחץ על הכפתור למטה כדי לבחור סיסמה חדשה.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 9999px; font-weight: 600; font-size: 16px;">
            איפוס סיסמה
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
          קישור זה יפוג תוך שעה אחת. אם לא ביקשת לאפס את הסיסמה שלך, אנא התעלם מהודעה זו.
        </p>
      `
      : `
        <h2 style="color: #1f2937; margin: 0 0 16px 0; font-size: 20px;">Hello ${name},</h2>
        <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px 0;">
          We received a request to reset your password. Click the button below to choose a new password.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 9999px; font-weight: 600; font-size: 16px;">
            Reset Password
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
          This link will expire in 1 hour. If you did not request a password reset, please ignore this email.
        </p>
      `;

    return { subject, html: this.wrapInLayout(content, locale) };
  }

  private buildDeletionConfirmationEmail(
    name: string,
    deletionDate: Date,
    cancelUrl: string,
    locale: string,
  ): { subject: string; html: string } {
    const isHebrew = locale === 'he';
    const formattedDate = deletionDate.toLocaleDateString(isHebrew ? 'he-IL' : 'en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const subject = isHebrew
      ? 'החשבון שלך מתוזמן למחיקה'
      : 'Your account is scheduled for deletion';

    const content = isHebrew
      ? `
        <h2 style="color: #1f2937; margin: 0 0 16px 0; font-size: 20px;">שלום ${name},</h2>
        <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px 0;">
          החשבון שלך מתוזמן למחיקה ב-<strong>${formattedDate}</strong>. יש לך תקופת חסד של 30 יום לביטול המחיקה.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${cancelUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 9999px; font-weight: 600; font-size: 16px;">
            ביטול מחיקת חשבון
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
          אם ברצונך להמשיך עם מחיקת החשבון, אין צורך בפעולה נוספת. החשבון שלך יימחק לצמיתות לאחר תקופת החסד.
        </p>
      `
      : `
        <h2 style="color: #1f2937; margin: 0 0 16px 0; font-size: 20px;">Hello ${name},</h2>
        <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px 0;">
          Your account is scheduled for deletion on <strong>${formattedDate}</strong>. You have a 30-day grace period to cancel the deletion.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${cancelUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 9999px; font-weight: 600; font-size: 16px;">
            Cancel Account Deletion
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
          If you wish to proceed with account deletion, no further action is needed. Your account will be permanently deleted after the grace period.
        </p>
      `;

    return { subject, html: this.wrapInLayout(content, locale) };
  }

  private buildDeletionCancelledEmail(
    name: string,
    locale: string,
  ): { subject: string; html: string } {
    const isHebrew = locale === 'he';

    const subject = isHebrew ? 'ביטול מחיקת חשבון' : 'Account deletion cancelled';

    const content = isHebrew
      ? `
        <h2 style="color: #1f2937; margin: 0 0 16px 0; font-size: 20px;">שלום ${name},</h2>
        <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px 0;">
          מחיקת החשבון שלך בוטלה בהצלחה. החשבון שלך פעיל ותקין, ותוכל להמשיך להשתמש ב-MyFinPro כרגיל.
        </p>
        <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
          אם לא ביטלת את מחיקת החשבון, אנא צור קשר עם התמיכה שלנו מיד.
        </p>
      `
      : `
        <h2 style="color: #1f2937; margin: 0 0 16px 0; font-size: 20px;">Hello ${name},</h2>
        <p style="color: #4b5563; line-height: 1.6; margin: 0 0 24px 0;">
          Your account deletion has been successfully cancelled. Your account is active we and you can continue using MyFinPro as usual.
        </p>
        <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0;">
          If you did not cancel the account deletion, please contact our support team immediately.
        </p>
      `;

    return { subject, html: this.wrapInLayout(content, locale) };
  }

  // ── Layout Wrapper ─────────────────────────────────────────────────

  private wrapInLayout(content: string, locale: string): string {
    const dir = locale === 'he' ? 'rtl' : 'ltr';
    const align = locale === 'he' ? 'right' : 'left';

    return `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MyFinPro</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%;">
          <!-- Header -->
          <tr>
            <td style="background-color: #2563eb; padding: 24px 32px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">MyFinPro</h1>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="background-color: #ffffff; padding: 32px; text-align: ${align};">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f9fafb; padding: 16px 32px; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">&copy; 2026 MyFinPro</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
