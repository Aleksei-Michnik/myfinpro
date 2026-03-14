import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './services/password.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
  ) {}

  async register(dto: RegisterDto) {
    // Check if email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('An account with this email already exists');
    }

    // Hash password
    const passwordHash = await this.passwordService.hash(dto.password);

    // Create user
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        defaultCurrency: dto.defaultCurrency || 'USD',
        locale: dto.locale || 'en',
      },
    });

    this.logger.log(`User registered: ${user.email} (${user.id})`);

    // Log audit event
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_REGISTERED',
        entity: 'User',
        entityId: user.id,
        details: { email: user.email },
      },
    });

    // Return user (without passwordHash) and placeholder accessToken
    // JWT issuance will be implemented in iteration 1.5
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        defaultCurrency: user.defaultCurrency,
        locale: user.locale,
      },
      accessToken: 'placeholder-will-be-jwt-in-iteration-1.5',
    };
  }
}
