import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module';
import { WorkflowCommandRegistry } from './workflow-command.registry';
import { WorkflowDefinitionController } from './workflow-definition.controller';
import { WorkflowEngineService } from './workflow-engine.service';

@Module({
  // OutboxModule exports OutboxHandlerRegistry -- WorkflowEngineService
  // registers itself against the same instance FEAT-028's relay reads from.
  imports: [OutboxModule],
  controllers: [WorkflowDefinitionController],
  providers: [WorkflowEngineService, WorkflowCommandRegistry],
  // Exported so a future feature (FEAT-030/031) can register its own real
  // command handlers against the same registry instance.
  exports: [WorkflowCommandRegistry],
})
export class WorkflowModule {}
