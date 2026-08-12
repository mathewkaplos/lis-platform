import { Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowCommandRegistry } from '../workflow/workflow-command.registry';
import { addReflexTestHandler } from './add-reflex-test.command';
import { addBlockReflexTestHandler } from './add-block-reflex-test.command';

/**
 * FEAT-030 (ADR-0030). Registers `addReflexTestHandler` as `'AddReflexTest'`
 * in `WorkflowCommandRegistry` -- the first real registrant (FEAT-029's own
 * registry shipped empty, exactly for this). Kept as its own module,
 * separate from `WorkflowModule`, extending the `OutboxModule` <-
 * `WorkflowModule` layering one level further: the general engine mechanism
 * and this feature's first domain-specific command handler stay
 * independently reviewable.
 *
 * FEAT-060 additionally registers `addBlockReflexTestHandler` as
 * `'AddBlockReflexTest'` here, not a new module -- still the reflex/cascade
 * sub-engine's own domain (KB-25), just a second command for anatomic
 * pathology's block-linked reflexes/add-ons (docs/plans/
 * feat-060-reflex-stains-ihc.md §5: a separate command, not a parameterized
 * `AddReflexTest`).
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
    this.commands.register('AddBlockReflexTest', addBlockReflexTestHandler);
  }
}

@Module({
  imports: [WorkflowModule],
  providers: [ReflexCommandRegistration],
})
export class ReflexModule {}
