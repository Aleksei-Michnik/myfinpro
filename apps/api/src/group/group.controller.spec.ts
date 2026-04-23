import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { GroupController } from './group.controller';
import { GroupService } from './group.service';
import { GroupAdminGuard } from './guards/group-admin.guard';
import { GroupMemberGuard } from './guards/group-member.guard';

describe('GroupController', () => {
  let controller: GroupController;

  const mockGroupService = {
    createGroup: jest.fn(),
    getUserGroups: jest.fn(),
    getGroup: jest.fn(),
    updateGroup: jest.fn(),
    deleteGroup: jest.fn(),
  };

  const user: JwtPayload = {
    sub: 'user-1',
    email: 'alice@test.com',
    name: 'Alice',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GroupController],
      providers: [{ provide: GroupService, useValue: mockGroupService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(GroupMemberGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(GroupAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<GroupController>(GroupController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /groups (createGroup)', () => {
    it('should delegate to service with current user id and DTO', async () => {
      const dto: CreateGroupDto = { name: 'Family', type: 'family', defaultCurrency: 'USD' };
      const fakeResult = {
        id: 'g1',
        name: 'Family',
        memberCount: 1,
        role: 'admin',
      };
      mockGroupService.createGroup.mockResolvedValue(fakeResult);

      const result = await controller.createGroup(user, dto);

      expect(mockGroupService.createGroup).toHaveBeenCalledWith('user-1', dto);
      expect(result).toEqual(fakeResult);
    });
  });

  describe('GET /groups (listGroups)', () => {
    it("should return the user's groups", async () => {
      const fakeGroups = [{ id: 'g1', memberCount: 2, role: 'admin' }];
      mockGroupService.getUserGroups.mockResolvedValue(fakeGroups);

      const result = await controller.listGroups(user);

      expect(mockGroupService.getUserGroups).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(fakeGroups);
    });

    it('should return empty array when user has no groups', async () => {
      mockGroupService.getUserGroups.mockResolvedValue([]);

      const result = await controller.listGroups(user);

      expect(result).toEqual([]);
    });
  });

  describe('GET /groups/:id (getGroup)', () => {
    it('should return group details', async () => {
      const fakeDetail = { id: 'g1', members: [] };
      mockGroupService.getGroup.mockResolvedValue(fakeDetail);

      const result = await controller.getGroup('g1');

      expect(mockGroupService.getGroup).toHaveBeenCalledWith('g1');
      expect(result).toEqual(fakeDetail);
    });
  });

  describe('PATCH /groups/:id (updateGroup)', () => {
    it('should delegate to service with groupId, userId, and DTO', async () => {
      const dto: UpdateGroupDto = { name: 'Renamed' };
      const fakeResult = { id: 'g1', name: 'Renamed', members: [] };
      mockGroupService.updateGroup.mockResolvedValue(fakeResult);

      const result = await controller.updateGroup(user, 'g1', dto);

      expect(mockGroupService.updateGroup).toHaveBeenCalledWith('g1', 'user-1', dto);
      expect(result).toEqual(fakeResult);
    });
  });

  describe('DELETE /groups/:id (deleteGroup)', () => {
    it('should delegate to service and return success', async () => {
      mockGroupService.deleteGroup.mockResolvedValue({ message: 'Group deleted successfully' });

      const result = await controller.deleteGroup(user, 'g1');

      expect(mockGroupService.deleteGroup).toHaveBeenCalledWith('g1', 'user-1');
      expect(result).toEqual({ message: 'Group deleted successfully' });
    });
  });

  describe('CreateGroupDto validation', () => {
    it('should fail when name is missing', async () => {
      const dto = plainToInstance(CreateGroupDto, { type: 'family' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'name')).toBe(true);
    });

    it('should fail when name exceeds 100 characters', async () => {
      const dto = plainToInstance(CreateGroupDto, { name: 'x'.repeat(101) });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'name')).toBe(true);
    });

    it('should fail with an invalid type', async () => {
      const dto = plainToInstance(CreateGroupDto, { name: 'Family', type: 'cabal' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'type')).toBe(true);
    });

    it('should fail with an invalid currency code', async () => {
      const dto = plainToInstance(CreateGroupDto, { name: 'Family', defaultCurrency: 'XXX' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'defaultCurrency')).toBe(true);
    });

    it('should accept a valid DTO', async () => {
      const dto = plainToInstance(CreateGroupDto, {
        name: 'Family',
        type: 'family',
        defaultCurrency: 'EUR',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should accept a minimal DTO (name only)', async () => {
      const dto = plainToInstance(CreateGroupDto, { name: 'Family' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe('UpdateGroupDto validation', () => {
    it('should allow an empty DTO', async () => {
      const dto = plainToInstance(UpdateGroupDto, {});
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should fail with an empty name', async () => {
      const dto = plainToInstance(UpdateGroupDto, { name: '' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'name')).toBe(true);
    });

    it('should fail with an invalid currency code', async () => {
      const dto = plainToInstance(UpdateGroupDto, { defaultCurrency: 'XXX' });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'defaultCurrency')).toBe(true);
    });

    it('should accept valid partial updates', async () => {
      const dto = plainToInstance(UpdateGroupDto, { name: 'New Name' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
