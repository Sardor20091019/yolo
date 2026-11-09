import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';
import { UpdateAlertStatusDto } from './dto/update-alert-status.dto';
import { QueryAlertsDto } from './dto/query-alerts.dto';
import { AlertRecord } from '../database/database.types';
import { AlertMetrics } from './alerts.repository';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtTokenPayload } from '../auth/auth.dto';

@Controller('alerts')
@UseGuards(JwtAuthGuard)
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
  public async deleteAlert(
    @CurrentUser() user: JwtTokenPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean; id: string }> {
    if (user.role !== 'admin') {
      throw new UnauthorizedException('Administrative privileges required to delete alerts');
    }
    return await this.alertsService.deleteAlert(id);
  }
}

