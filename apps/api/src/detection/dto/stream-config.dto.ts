import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class StreamConfigDto {
  @IsString()
  @IsNotEmpty()
  mode!: 'WEBCAM' | 'IP_CAMERA';

  @IsString()
  @IsOptional()
  streamUrl?: string;

  @IsNumber()
  @IsOptional()
  @Min(0.1)
  @Max(1.0)
  confidenceThreshold?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  suspicionThreshold?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(60)
  loiteringThresholdSeconds?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(10)
  nervousCheckSensitivity?: number;
}
