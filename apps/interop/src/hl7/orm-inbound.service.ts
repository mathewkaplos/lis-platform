import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { InboundHandler, InboundRequest } from 'node-hl7-server';
import { Server, type Inbound } from 'node-hl7-server';
import type { HL7Version } from 'node-hl7-client';
import { InteropAuthService } from '../auth/interop-auth.service';
import { mapOrmToOrderIngest, OrmMappingError } from './orm-mapper';

type SendResponseArg = Parameters<InboundHandler>[1];

/**
 * The real MLLP/HL7 transport (§10 Q2: adopted `node-hl7-server`/
 * `node-hl7-client` rather than hand-rolling MLLP framing + segment
 * parsing -- ADR-0034's own placement decision, now backed by a real
 * library instead of Task A's stub `net.Server`). Owns exactly one inbound
 * listener (ORM^O01 -> order creation, AC #1); ORU generation (AC #2) is a
 * separate, not-yet-built service (this task's scope is AC #1 only).
 *
 * `HL7_AUTOSTART=false` skips binding a real port on `onModuleInit` -- used
 * by tests that want to construct the service without a live socket.
 */
@Injectable()
export class OrmInboundService implements OnModuleInit, OnModuleDestroy {
  private inbound: Inbound | null = null;

  constructor(
    @Inject(InteropAuthService)
    private readonly auth: InteropAuthService,
  ) {}

  onModuleInit(): void {
    if (process.env.HL7_AUTOSTART === 'false') {
      return;
    }
    this.start(
      Number(process.env.MLLP_PORT ?? 4301),
      (process.env.HL7_VERSION as HL7Version) ?? '2.5',
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.inbound?.close();
  }

  start(port: number, version: HL7Version): void {
    const server = new Server({ bindAddress: '0.0.0.0' });
    this.inbound = server.createInbound({ port, version }, (req, res) => {
      void this.handleMessage(req, res);
    });
  }

  private get apiBaseUrl(): string {
    return process.env.API_BASE_URL ?? 'http://localhost:4000';
  }

  private async handleMessage(
    req: InboundRequest,
    res: SendResponseArg,
  ): Promise<void> {
    let rawMessage: string;
    try {
      rawMessage = req.getMessage().toString();
    } catch (err: unknown) {
      console.error('[interop] failed to read inbound HL7 message', err);
      await res.sendResponse('AE');
      return;
    }

    let ingestInput;
    try {
      ingestInput = mapOrmToOrderIngest(req.getMessage(), rawMessage);
    } catch (err: unknown) {
      if (err instanceof OrmMappingError) {
        console.error('[interop] ORM mapping failed:', err.message);
        await res.sendResponse('AE');
        return;
      }
      throw err;
    }

    try {
      const token = await this.auth.getToken();
      const response = await fetch(
        `${this.apiBaseUrl}/internal/interop/orders`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(ingestInput),
        },
      );

      if (response.status === 202) {
        await res.sendResponse('AA');
        return;
      }
      if (response.status === 422) {
        // KB-29/KB-30 "park, never drop" -- a well-formed order this ACL
        // couldn't correlate (unknown MRN/test code) is an HL7 "AR"
        // (Application Reject), not a silent drop or a hard error.
        await res.sendResponse('AR');
        return;
      }
      if (response.status === 401) {
        this.auth.invalidate();
      }
      console.error(
        '[interop] unexpected apps/api response:',
        response.status,
        await response.text(),
      );
      await res.sendResponse('AE');
    } catch (err: unknown) {
      console.error('[interop] apps/api call failed', err);
      await res.sendResponse('AE');
    }
  }
}
