import { Injectable, Logger } from '@nestjs/common';
import { OAuthProvider } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByProvider(provider: string, providerId: string): Promise<OAuthProvider | null> {
    return this.prisma.oAuthProvider.findUnique({
      where: {
        provider_providerId: { provider, providerId },
      },
    });
  }

  async findByProviderEmail(provider: string, email: string): Promise<OAuthProvider | null> {
    return this.prisma.oAuthProvider.findFirst({
      where: { provider, email },
    });
  }

  async createOAuthProvider(data: {
    provider: string;
    providerId: string;
    userId: string;
    email?: string;
    name?: string;
    avatarUrl?: string;
    metadata?: Record<string, unknown>;
  }): Promise<OAuthProvider> {
    const oauthProvider = await this.prisma.oAuthProvider.create({
      data: {
        provider: data.provider,
        providerId: data.providerId,
        userId: data.userId,
        email: data.email,
        name: data.name,
        avatarUrl: data.avatarUrl,
        metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
      },
    });

    this.logger.log(
      `OAuth provider linked: ${data.provider} (${data.providerId}) → user ${data.userId}`,
    );

    return oauthProvider;
  }

  async linkToUser(
    provider: string,
    providerId: string,
    userId: string,
    data: { email?: string; name?: string; avatarUrl?: string },
  ): Promise<OAuthProvider> {
    return this.createOAuthProvider({
      provider,
      providerId,
      userId,
      email: data.email,
      name: data.name,
      avatarUrl: data.avatarUrl,
    });
  }
}
