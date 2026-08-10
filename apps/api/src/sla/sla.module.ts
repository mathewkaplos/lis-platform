import { Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { WorkflowCommandRegistry } from '../workflow/workflow-command.registry';
import { notifySlaBreachHandler } from './notify-sla-breach.command';
import { SlaBreachController } from './sla-breach.controller';
import { SlaBreachDetectorService } from './sla-breach-detector.service';

/**
 * FEAT-029 (remainder). Registers `NotifySlaBreach` in
 * `WorkflowCommandRegistry` -- the third real registrant, after FEAT-030's
 * `AddReflexTest` and FEAT-031's `AutoVerifyObservation`. Same layering
 * `ReflexModule`/`AutoVerifyModule` already established (`OutboxModule` <-
 * `WorkflowModule` <- `<feature>Module`). `WorkflowEngineService`'s own new
 * `SlaBreached` outbox-handler registration (its own `onModuleInit`) needs
 * no forced injection here -- it's a `WorkflowModule` provider, already
 * eagerly instantiated the moment that module loads, same as
 * `ReflexModule`/`AutoVerifyModule` never needing to inject it either.
 */
@Injectable()
class SlaCommandRegistration implements OnModuleInit {
  // Explicit @Inject -- see CapabilityGuard's own header comment for why
  // (vitest esbuild design:paramtypes gap).
  constructor(
    @Inject(WorkflowCommandRegistry)
    private readonly commands: WorkflowCommandRegistry,
  ) {}

  onModuleInit() {
    this.commands.register('NotifySlaBreach', notifySlaBreachHandler);
  }
}

@Module({
  imports: [WorkflowModule],
  controllers: [SlaBreachController],
  providers: [SlaBreachDetectorService, SlaCommandRegistration],
})
export class SlaModule {}
