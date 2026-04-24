import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GroupController } from './group.controller';
import { GroupService } from './group.service';
import { GroupAdminGuard } from './guards/group-admin.guard';
import { GroupMemberGuard } from './guards/group-member.guard';

@Module({
  imports: [PrismaModule],
  controllers: [GroupController],
  providers: [GroupService, GroupMemberGuard, GroupAdminGuard],
  exports: [GroupService],
})
export class GroupModule {}
