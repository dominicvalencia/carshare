import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

@Global()
@Module({
  controllers: [AuthController],
  exports: [AuthService, TokenService],
  imports: [JwtModule.register({})],
  providers: [AuthService, TokenService],
})
export class AuthModule {}
