import { Inject, Injectable } from '@nestjs/common';
import type { InteropOruData } from '@lis/domain';
import { InteropAuthService } from '../auth/interop-auth.service';
import { buildOru } from './oru-builder';

/**
 * FEAT-036 AC #2, the orchestration point tying together the read side
 * (`apps/api`'s `GET /internal/interop/observations/:id/oru-data`) and the
 * pure build side (`buildOru`) -- "generate an ORU from a verified
 * Observation" end to end. Deliberately stops at generation: actual
 * delivery to a real partner (which partner, outbound MLLP connection
 * management, retry) is a separate, still-open question this task does not
 * decide -- KB-30's own "Interface engine: build vs. buy" open question,
 * and this feature's proposal never named a confirmed second real partner
 * to deliver to yet (same reasoning FEAT-027 deferred its own real
 * instrument driver).
 */
@Injectable()
export class OruGeneratorService {
  constructor(
    @Inject(InteropAuthService)
    private readonly auth: InteropAuthService,
  ) {}

  private get apiBaseUrl(): string {
    return process.env.API_BASE_URL ?? 'http://localhost:4000';
  }

  async generate(observationId: string): Promise<string> {
    const token = await this.auth.getToken();
    const response = await fetch(
      `${this.apiBaseUrl}/internal/interop/observations/${observationId}/oru-data`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (response.status === 401) {
      this.auth.invalidate();
    }
    if (!response.ok) {
      throw new Error(
        `failed to fetch ORU data for observation ${observationId}: ` +
          `${response.status} ${await response.text()}`,
      );
    }

    const data = (await response.json()) as InteropOruData;
    return buildOru(data);
  }
}
