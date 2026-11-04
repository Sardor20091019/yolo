import { IsString, IsNotEmpty, IsNumber, IsBoolean, IsOptional, Min } from 'class-validator';

export class CreateDetectionZoneDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  polygon_coordinates!: string;

  @IsNumber()
  @Min(1)
  dwell_time_threshold!: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class UpdateDetectionZoneDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  polygon_coordinates?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  dwell_time_threshold?: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
