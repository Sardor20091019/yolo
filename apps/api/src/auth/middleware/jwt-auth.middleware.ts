import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { JwtSecurityService } from '../jwt.service';
import { JwtTokenPayload } from '../auth.dto';

export interface AuthenticatedExpressRequest extends Request {
  user?: JwtTokenPayload;
}

@Injectable()
export class JwtAuthMiddleware implements NestMiddleware {
  constructor(private readonly jwtSecurityService: JwtSecurityService) {}

  public use(req: AuthenticatedExpressRequest, _res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Authorization header is missing');
    }

    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization scheme: expected Bearer token');
    }

    try {
      const payload = this.jwtSecurityService.verifyAccessToken(token);
      req.user = payload;
      next();
    } catch (err: unknown) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException('Access denied: invalid or expired access token');
    }
  }
}

