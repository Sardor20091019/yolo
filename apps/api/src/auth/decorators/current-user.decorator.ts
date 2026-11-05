import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtTokenPayload } from '../auth.dto';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtTokenPayload | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtTokenPayload }>();
    return request.user;
  },
);

