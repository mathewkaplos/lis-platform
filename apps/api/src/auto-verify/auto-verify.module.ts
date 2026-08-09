import { Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { ObservationModule } from '../observation/observation.module';
import { ObservationWriteService } from '../observation/observation-write.service';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowCommandRegistry } from '../workflow/workflow-command.registry';
import { createAutoVerifyObservationHandler } from './auto-verify-observation.command';

/**
 * FEAT-031 (ADR-0031). Registers `AutoVerifyObservation` in
 * `WorkflowCommandRegistry` -- the second real registrant after FEAT-030's
 * `AddReflexTest`. Its own module, separate from `WorkflowModule`, same
 * layering `ReflexModule` already established (`OutboxModule` <-
 * `WorkflowModule` <- `<feature>Module`) -- imports `ObservationModule` too,
 * for the already-exported `ObservationWriteService` its handler needs.
 */
@Injectable()
class AutoVerifyCommandRegistration implements OnModuleInit {
  // Explicit @Inject -- see CapabilityGuard's own header comment for why
  // (vitest esbuild design:paramtypes gap).
  constructor(
    @Inject(WorkflowCommandRegistry)
    private readonly commands: WorkflowCommandRegistry,
    @Inject(ObservationWriteService)
    private readonly writeService: ObservationWriteService,
  ) {}

  onModuleInit() {
    this.commands.register(
      'AutoVerifyObservation',
      createAutoVerifyObservationHandler(this.writeService),
    );
  }
}

@Module({
  imports: [WorkflowModule, ObservationModule],
  providers: [AutoVerifyCommandRegistration],
})
export class AutoVerifyModule {}
