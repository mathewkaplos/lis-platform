import { Module } from '@nestjs/common';
import { FhirController } from './fhir.controller';
import { FhirObservationDataService } from './fhir-observation-data.service';

@Module({
  controllers: [FhirController],
  providers: [FhirObservationDataService],
})
export class FhirModule {}
