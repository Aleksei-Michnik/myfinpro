import { GROUP_ROLES } from '@myfinpro/shared';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class UpdateMemberRoleDto {
  @ApiProperty({
    description: 'New role for the member',
    example: 'member',
    enum: [...GROUP_ROLES],
  })
  @IsString()
  @IsIn([...GROUP_ROLES], { message: 'Invalid role' })
  role: string;
}
