import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { DetectionService, FrameProcessingResult } from './detection.service';
import { CreateDetectionZoneDto, UpdateDetectionZoneDto } from './dto/detection-zone.dto';
import { StreamConfigDto } from './dto/stream-config.dto';
import { FrameDetectionDto } from './dto/frame-detection.dto';
import { DetectionZoneRecord, DetectionLogRecord, NewDetectionLogRecord } from '../database/database.types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtTokenPayload } from '../auth/auth.dto';

@Controller('detection')
@UseGuards(JwtAuthGuard)
export class DetectionController {
  constructor(private readonly detectionService: DetectionService) {}

  @Get('config')
  public getConfig(): StreamConfigDto {
    return this.detectionService.getConfig();
  }

  @Post('config')
  @HttpCode(HttpStatus.OK)
  public updateConfig(
    @CurrentUser() user: JwtTokenPayload,
    @Body() configDto: StreamConfigDto,
  ): StreamConfigDto {
    if (user.role !== 'admin') {
      throw new UnauthorizedException('Administrative privileges required');
    }
    return this.detectionService.updateConfig(configDto);
  }

  @Post('process-frame')
  @HttpCode(HttpStatus.OK)
  public async processFrame(
    @CurrentUser() user: JwtTokenPayload,
    @Body() frameDto: FrameDetectionDto,
  ): Promise<FrameProcessingResult> {
    return await this.detectionService.processFrame(
      frameDto.frameData,
      frameDto.frameIndex,
      frameDto.source,
      frameDto.detectedBoxes,
      frameDto.stationId,
      frameDto.stationName,
      user.sub || frameDto.userId,
    );
  }

  @Get('cctv-stations')
  public getCctvStations(): import('./detection.service').CctvStationInfo[] {
    return this.detectionService.getAllCctvStations();
  }

  @Get('logs')
  public async getDetectionLogs(
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
  ): Promise<DetectionLogRecord[]> {
    const num = limit ? parseInt(limit, 10) : 100;
    return await this.detectionService.getDetectionLogs(num, userId);
  }

  @Delete('logs')
  public async deleteDetectionLogs(
    @CurrentUser() user: JwtTokenPayload,
    @Query('userId') userId?: string,
  ): Promise<{ success: boolean }> {
    if (user.role !== 'admin') {
      throw new UnauthorizedException('Administrative privileges required');
    }
    const success = await this.detectionService.deleteDetectionLogs(userId);
    return { success };
  }

  @Post('logs')
  @HttpCode(HttpStatus.CREATED)
  public async createDetectionLogs(
    @CurrentUser() user: JwtTokenPayload,
    @Body() logs: NewDetectionLogRecord[],
  ): Promise<DetectionLogRecord[]> {
    const stampedLogs = logs.map((log) => ({
      ...log,
      user_id: user.sub || log.user_id,
    }));
    return await this.detectionService.saveDetectionLogsBatch(stampedLogs);
  }

  @Get('zones')
  public async getZones(): Promise<DetectionZoneRecord[]> {
    return await this.detectionService.getAllZones();
  }

  @Post('zones')
  @HttpCode(HttpStatus.CREATED)
  public async createZone(
    @CurrentUser() user: JwtTokenPayload,
    @Body() dto: CreateDetectionZoneDto,
  ): Promise<DetectionZoneRecord> {
    if (user.role !== 'admin') {
      throw new UnauthorizedException('Administrative privileges required');
    }
    return await this.detectionService.createZone(dto);
  }

  @Patch('zones/:id')
  public async updateZone(
    @CurrentUser() user: JwtTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDetectionZoneDto,
  ): Promise<DetectionZoneRecord> {
    if (user.role !== 'admin') {
      throw new UnauthorizedException('Administrative privileges required');
    }
    return await this.detectionService.updateZone(id, dto);
  }

  @Delete('zones/:id')
  public async deleteZone(
    @CurrentUser() user: JwtTokenPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean; id: string }> {
    if (user.role !== 'admin') {
      throw new UnauthorizedException('Administrative privileges required');
    }
    return await this.detectionService.deleteZone(id);
  }
}

