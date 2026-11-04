import { IsString, IsNotEmpty, IsIn } from 'class-validator';

export class UpdateAlertStatusDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['NEW', 'REVIEWED', 'DISMISSED', 'CONFIRMED'])
  status!: 'NEW' | 'REVIEWED' | 'DISMISSED' | 'CONFIRMED';
}

