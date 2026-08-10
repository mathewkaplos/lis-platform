import { Module } from '@nestjs/common';
import { InteropAuthService } from './interop-auth.service';

@Module({
  providers: [InteropAuthService],
  exports: [InteropAuthService],
})
export class AuthModule {}
