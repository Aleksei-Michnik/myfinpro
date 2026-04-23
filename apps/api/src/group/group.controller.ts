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
  ApiBearerAuth,
  ApiBadRequestResponse,
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
}
