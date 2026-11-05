import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { AuthService } from './auth.service';
import { JwtSecurityService } from './jwt.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtAuthMiddleware } from './middleware/jwt-auth.middleware';
import { AuthController, UsersController } from './auth.controller';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [AuthController, UsersController],
  providers: [AuthService, JwtSecurityService, JwtAuthGuard, JwtAuthMiddleware],
  exports: [AuthService, JwtSecurityService, JwtAuthGuard, JwtAuthMiddleware],
})
export class AuthModule {}
