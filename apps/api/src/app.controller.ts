import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', sha: process.env.GIT_SHA ?? 'local', ts: new Date().toISOString() };
  }
}
