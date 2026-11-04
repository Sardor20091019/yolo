import { IsNumber, IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

export class CreateAlertDto {
  @IsNumber()
  @IsNotEmpty()
  track_id!: number;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsNumber()
  @IsNotEmpty()
  suspicion_score!: number;

  @IsString()
  @IsOptional()
  snapshot_url?: string;

  @IsString()
  @IsOptional()
  @IsIn(['NEW', 'REVIEWED', 'DISMISSED', 'CONFIRMED'])
  status?: 'NEW' | 'REVIEWED' | 'DISMISSED' | 'CONFIRMED';

  @IsString()
  @IsOptional()
  details?: string;
}
