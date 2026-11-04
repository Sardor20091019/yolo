import { Controller, Get, Post, Patch, Delete, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertStatusDto } from './dto/update-alert-status.dto';
import { QueryAlertsDto } from './dto/query-alerts.dto';
import { AlertRecord } from '../database/database.types';
import { AlertMetrics } from './alerts.repository';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  public async findAll(@Query() query: QueryAlertsDto): Promise<AlertRecord[]> {
    return await this.alertsService.findAll(query.limit, query.offset, query.status);
  }

  @Get('metrics')
  public async getMetrics(): Promise<AlertMetrics> {
    return await this.alertsService.getMetrics();
  }

  @Get(':id')
  public async findById(@Param('id') id: string): Promise<AlertRecord> {
    return await this.alertsService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  public async create(@Body() createAlertDto: CreateAlertDto): Promise<AlertRecord> {
    return await this.alertsService.createAlert(createAlertDto);
  }

  @Patch(':id/status')
  public async updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateAlertStatusDto,
  ): Promise<AlertRecord> {
    return await this.alertsService.updateStatus(id, updateStatusDto.status);
  }

  @Delete(':id')
  public async deleteAlert(@Param('id') id: string): Promise<{ success: boolean; id: string }> {
    return await this.alertsService.deleteAlert(id);
  }
}
