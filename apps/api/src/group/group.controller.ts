import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CustomThrottle } from '../common/decorators/throttle.decorator';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { GroupService } from './group.service';
import { GroupAdminGuard } from './guards/group-admin.guard';
import { GroupMemberGuard } from './guards/group-member.guard';

@ApiTags('Groups')
@Controller('groups')
export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  @CustomThrottle({ limit: 10, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new group (creator becomes admin)' })
  @ApiCreatedResponse({ description: 'Group created successfully' })
  @ApiBadRequestResponse({ description: 'Invalid group data' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiTooManyRequestsResponse({ description: 'Too many requests' })
  async createGroup(@CurrentUser() user: JwtPayload, @Body() dto: CreateGroupDto) {
    return this.groupService.createGroup(user.sub, dto);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the authenticated user's groups" })
  @ApiOkResponse({ description: 'List of groups the user belongs to' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  async listGroups(@CurrentUser() user: JwtPayload) {
    return this.groupService.getUserGroups(user.sub);
  }

  // NOTE: `/groups/invite/:token` must be declared BEFORE `/groups/:id`
  // so that NestJS does not match `invite` as an :id path parameter.
  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Get('invite/:token')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get invite details (group name, inviter) for a raw invite token' })
  @ApiParam({ name: 'token', description: 'Raw invite token (UUID)' })
  @ApiOkResponse({ description: 'Invite info' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Invalid invite token' })
  @ApiBadRequestResponse({ description: 'Invite token expired or already used' })
  async getInviteInfo(@Param('token') token: string) {
    return this.groupService.getInviteInfo(token);
  }

  @CustomThrottle({ limit: 5, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post('invite/:token/accept')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Accept a group invite and join the group' })
  @ApiParam({ name: 'token', description: 'Raw invite token (UUID)' })
  @ApiOkResponse({ description: 'Joined group successfully' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Invalid invite token' })
  @ApiBadRequestResponse({ description: 'Invite token expired or already used' })
  @ApiConflictResponse({ description: 'Already a member of this group' })
  async acceptInvite(@CurrentUser() user: JwtPayload, @Param('token') token: string) {
    return this.groupService.acceptInvite(token, user.sub);
  }

  @CustomThrottle({ limit: 30, ttl: 60000 })
  @UseGuards(JwtAuthGuard, GroupMemberGuard)
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get group details with members (member access only)' })
  @ApiParam({ name: 'id', description: 'Group ID (UUID)' })
  @ApiOkResponse({ description: 'Group details with member list' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Not a member of this group' })
  @ApiNotFoundResponse({ description: 'Group not found' })
  async getGroup(@Param('id') id: string) {
    return this.groupService.getGroup(id);
  }

  @CustomThrottle({ limit: 10, ttl: 60000 })
  @UseGuards(JwtAuthGuard, GroupAdminGuard)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update group details (admin only)' })
  @ApiParam({ name: 'id', description: 'Group ID (UUID)' })
  @ApiOkResponse({ description: 'Group updated successfully' })
  @ApiBadRequestResponse({ description: 'Invalid group data' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Not an admin of this group' })
  @ApiNotFoundResponse({ description: 'Group not found' })
  async updateGroup(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.groupService.updateGroup(id, user.sub, dto);
  }

  @CustomThrottle({ limit: 5, ttl: 60000 })
  @UseGuards(JwtAuthGuard, GroupAdminGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a group (admin only)' })
  @ApiParam({ name: 'id', description: 'Group ID (UUID)' })
  @ApiOkResponse({ description: 'Group deleted successfully' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Not an admin of this group' })
  @ApiNotFoundResponse({ description: 'Group not found' })
  async deleteGroup(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.groupService.deleteGroup(id, user.sub);
  }

  @CustomThrottle({ limit: 10, ttl: 60000 })
  @UseGuards(JwtAuthGuard, GroupAdminGuard)
  @Post(':id/invites')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate a new invite token for the group (admin only)' })
  @ApiParam({ name: 'id', description: 'Group ID (UUID)' })
  @ApiCreatedResponse({ description: 'Invite token created' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Not an admin of this group' })
  @ApiNotFoundResponse({ description: 'Group not found' })
  async createInvite(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.groupService.createInvite(id, user.sub);
  }

  @CustomThrottle({ limit: 20, ttl: 60000 })
  @UseGuards(JwtAuthGuard, GroupAdminGuard)
  @Patch(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a member role within a group (admin only)' })
  @ApiParam({ name: 'id', description: 'Group ID (UUID)' })
  @ApiParam({ name: 'userId', description: 'Target member user ID (UUID)' })
  @ApiOkResponse({ description: 'Membership updated successfully' })
  @ApiBadRequestResponse({ description: 'Invalid role' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Not an admin of this group' })
  @ApiNotFoundResponse({ description: 'User is not a member of this group' })
  @ApiConflictResponse({ description: 'Cannot demote the last admin' })
  async updateMemberRole(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.groupService.updateMemberRole(id, userId, user.sub, dto.role);
  }

  @CustomThrottle({ limit: 20, ttl: 60000 })
  @UseGuards(JwtAuthGuard, GroupAdminGuard)
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a member from the group (admin only)' })
  @ApiParam({ name: 'id', description: 'Group ID (UUID)' })
  @ApiParam({ name: 'userId', description: 'Target member user ID (UUID)' })
  @ApiOkResponse({ description: 'Member removed successfully' })
  @ApiBadRequestResponse({ description: 'Cannot remove yourself via this endpoint' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Not an admin of this group' })
  @ApiNotFoundResponse({ description: 'User is not a member of this group' })
  @ApiConflictResponse({ description: 'Cannot remove the last admin' })
  async removeMember(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.groupService.removeMember(id, userId, user.sub);
  }

  @CustomThrottle({ limit: 10, ttl: 60000 })
  @UseGuards(JwtAuthGuard, GroupMemberGuard)
  @Post(':id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Leave the group (any member). Deletes the group if last member.' })
  @ApiParam({ name: 'id', description: 'Group ID (UUID)' })
  @ApiOkResponse({ description: 'Left the group successfully' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Not a member of this group' })
  @ApiNotFoundResponse({ description: 'Group not found or user not a member' })
  @ApiConflictResponse({ description: 'Cannot leave as last admin while other members exist' })
  async leaveGroup(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<void> {
    await this.groupService.leaveGroup(id, user.sub);
  }
}
