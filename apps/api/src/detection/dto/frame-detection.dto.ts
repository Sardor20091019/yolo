import { IsString, IsNotEmpty, IsNumber, IsOptional } from 'class-validator';

export class FrameDetectionDto {
  @IsString()
  @IsNotEmpty()
  frameData!: string;

  @IsNumber()
  @IsNotEmpty()
  frameIndex!: number;

  @IsNumber()
  @IsOptional()
  timestamp?: number;

  @IsString()
  @IsOptional()
  source?: 'WEBCAM' | 'IP_CAMERA';

  @IsString()
  @IsOptional()
  stationId?: string;

  @IsString()
  @IsOptional()
  stationName?: string;

  @IsOptional()
  detectedBoxes?: Array<{
    trackId: number;
    label: string;
    confidence: number;
    bbox: [number, number, number, number];
  }>;
}
