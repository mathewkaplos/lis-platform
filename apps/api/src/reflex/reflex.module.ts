import { Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowCommandRegistry } from '../workflow/workflow-command.registry';
import { addReflexTestHandler } from './add-reflex-test.command';

/**
 * FEAT-030 (ADR-0030). Registers `addReflexTestHandler` as `'AddReflexTest'`
 * in `WorkflowCommandRegistry` -- the first real registrant (FEAT-029's own
 * registry shipped empty, exactly for this). Kept as its own module,
 * separate from `WorkflowModule`, extending the `OutboxModule` <-
 * `WorkflowModule` layering one level further: the general engine mechanism
 * and this feature's first domain-specific command handler stay
 * independently reviewable.
 */
@Injectable()
class ReflexCommandRegistration implements OnModuleInit {
  // Explicit @Inject -- see CapabilityGuard's own header comment for why
  // (vitest esbuild design:paramtypes gap).
  constructor(
    @Inject(WorkflowCommandRegistry)
    private readonly commands: WorkflowCommandRegistry,
  ) {}

  onModuleInit() {
    this.commands.register('AddReflexTest', addReflexTestHandler);
  }
}

@Module({
  imports: [WorkflowModule],
  providers: [ReflexCommandRegistration],
})
export class ReflexModule {}
