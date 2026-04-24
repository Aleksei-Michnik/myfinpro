import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GROUP_ERRORS } from '../constants/group-errors';

/**
 * Ensures the authenticated user is a member of the group identified by the `:id`
 * route parameter. Attaches the resolved `GroupMembership` to the request for
 * downstream handlers under `request.groupMembership`.
 *
 * Must be used AFTER `JwtAuthGuard`, which populates `request.user`.
 */
@Injectable()
export class GroupMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.sub;
    const groupId: string | undefined = request.params?.id;

    if (!userId || !groupId) return false;

    const membership = await this.prisma.groupMembership.findUnique({
      where: { groupId_userId: { groupId, userId } },
    });

    if (!membership) {
      throw new ForbiddenException({
        message: 'You are not a member of this group',
        errorCode: GROUP_ERRORS.NOT_A_MEMBER,
      });
    }

    // Attach membership to request for downstream use
    request.groupMembership = membership;
    return true;
  }
}
