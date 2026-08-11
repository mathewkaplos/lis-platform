import { Controller, Get } from '@nestjs/common';

// FEAT-050 rollback rehearsal marker (2026-08-11): a real, harmless commit
// whose only purpose is to produce a second, distinct git-SHA-tagged deploy
// to roll back *from*, per the approved proposal's own testing plan §8 step
// 4. No behavior change.

@Controller()
export class AppController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      sha: process.env.GIT_SHA ?? 'local',
      ts: new Date().toISOString(),
    };
  }
}
