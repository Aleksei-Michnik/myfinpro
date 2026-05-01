import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { DeleteCategoryQueryDto } from './dto/delete-category-query.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('Categories')
@Controller('categories')
export class CategoryController {
  constructor(private readonly service: CategoryService) {}

  @CustomThrottle({ limit: 120, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List categories visible to the authenticated user' })
  @ApiOkResponse({ description: 'List of categories' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Not a member of requested group scope' })
  async list(@CurrentUser() user: JwtPayload, @Query() q: ListCategoriesQueryDto) {
    return this.service.list(user.sub, q);
  }

  @CustomThrottle({ limit: 120, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single category (if visible to the caller)' })
  @ApiParam({ name: 'id', description: 'Category ID (UUID)' })
  @ApiOkResponse({ description: 'Category details' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiNotFoundResponse({ description: 'Category not found or not visible' })
  async findOne(@CurrentUser() user: JwtPayload, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.findById(user.sub, id);
  }

  @CustomThrottle({ limit: 20, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a personal or group-owned category' })
  @ApiCreatedResponse({ description: 'Category created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Not a group admin (for scope=group)' })
  @ApiConflictResponse({ description: 'Slug conflict' })
  @ApiTooManyRequestsResponse({ description: 'Too many requests' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCategoryDto) {
    return this.service.create(user.sub, dto);
  }

  @CustomThrottle({ limit: 20, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a category you own (personal) or administer (group)' })
  @ApiParam({ name: 'id', description: 'Category ID (UUID)' })
  @ApiOkResponse({ description: 'Category updated' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Not the owner / system category immutable' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  @ApiConflictResponse({ description: 'Direction change rejected (category in use)' })
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.service.update(user.sub, id, dto);
  }

  @CustomThrottle({ limit: 20, ttl: 60000 })
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Delete a category, optionally reassigning its payments to a replacement',
  })
  @ApiParam({ name: 'id', description: 'Category ID (UUID)' })
  @ApiOkResponse({ description: 'Category deleted' })
  @ApiUnauthorizedResponse({ description: 'Invalid or missing JWT token' })
  @ApiForbiddenResponse({ description: 'Not the owner / system category immutable' })
  @ApiNotFoundResponse({ description: 'Category not found' })
  @ApiConflictResponse({
    description: 'Category in use and no valid replacement provided',
  })
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: DeleteCategoryQueryDto,
  ) {
    return this.service.remove(user.sub, id, q);
  }
}
