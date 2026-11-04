import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { DetectionService, FrameProcessingResult } from './detection.service';
import { CreateDetectionZoneDto, UpdateDetectionZoneDto } from './dto/detection-zone.dto';
import { StreamConfigDto } from './dto/stream-config.dto';
import { FrameDetectionDto } from './dto/frame-detection.dto';
import { DetectionZoneRecord, DetectionLogRecord, NewDetectionLogRecord } from '../database/database.types';

@Controller('detection')
export class DetectionController {
  constructor(private readonly detectionService: DetectionService) {}

  @Get('config')
  public getConfig(): StreamConfigDto {
    return this.detectionService.getConfig();
  }

  @Post('config')
  @HttpCode(HttpStatus.OK)
  public updateConfig(@Body() configDto: StreamConfigDto): StreamConfigDto {
    return this.detectionService.updateConfig(configDto);
  }

  @Post('process-frame')
  @HttpCode(HttpStatus.OK)
  public async processFrame(@Body() frameDto: FrameDetectionDto): Promise<FrameProcessingResult> {
    return await this.detectionService.processFrame(
      frameDto.frameData,
      frameDto.frameIndex,
      frameDto.source,
      frameDto.detectedBoxes,
      frameDto.stationId,
      frameDto.stationName,
    );
  }

  @Get('cctv-stations')
  public getCctvStations(): import('./detection.service').CctvStationInfo[] {
    return this.detectionService.getAllCctvStations();
  }

  @Get('logs')
  public async getDetectionLogs(@Query('limit') limit?: string): Promise<DetectionLogRecord[]> {
    const num = limit ? parseInt(limit, 10) : 100;
    return await this.detectionService.getDetectionLogs(num);
  }

  @Post('logs')
  @HttpCode(HttpStatus.CREATED)
  public async createDetectionLogs(@Body() logs: NewDetectionLogRecord[]): Promise<DetectionLogRecord[]> {
    return await this.detectionService.saveDetectionLogsBatch(logs);
  }

  @Get('zones')
  public async getZones(): Promise<DetectionZoneRecord[]> {
    return await this.detectionService.getAllZones();
  }

  @Post('zones')
  @HttpCode(HttpStatus.CREATED)
  public async createZone(@Body() dto: CreateDetectionZoneDto): Promise<DetectionZoneRecord> {
    return await this.detectionService.createZone(dto);
  }

  @Patch('zones/:id')
  public async updateZone(
    @Param('id') id: string,
    @Body() dto: UpdateDetectionZoneDto,
  ): Promise<DetectionZoneRecord> {
    return await this.detectionService.updateZone(id, dto);
  }

  @Delete('zones/:id')
  public async deleteZone(@Param('id') id: string): Promise<{ success: boolean; id: string }> {
    return await this.detectionService.deleteZone(id);
  }
}

