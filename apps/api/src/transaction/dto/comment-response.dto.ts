import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CommentAuthorDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class CommentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() transactionId!: string;
  @ApiProperty({ type: () => CommentAuthorDto }) author!: CommentAuthorDto;
  @ApiProperty() content!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
  @ApiPropertyOptional({ nullable: true }) deletedAt?: string | null;
  /** True when the requesting user is the comment author (UI uses this to show edit/delete). */
  @ApiProperty() isMine!: boolean;
}

export class CommentListResponseDto {
  @ApiProperty({ type: [CommentResponseDto] }) data!: CommentResponseDto[];
  @ApiPropertyOptional({ nullable: true }) nextCursor?: string | null;
  @ApiProperty() hasMore!: boolean;
}
