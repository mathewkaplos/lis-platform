import { Module } from '@nestjs/common';
import { OrgSettingsController } from './org-settings.controller';

@Module({
  controllers: [OrgSettingsController],
})
export class OrgSettingsModule {}
