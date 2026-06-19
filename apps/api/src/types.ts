import type { AuthContext, QueueJobPayload } from '@lead/shared';

export interface QueuePublisher {
  publishDiscovery(payload: QueueJobPayload): Promise<void>;
  close(): Promise<void>;
}

export interface ApiConfig {
  cookieSecret: string;
  isProduction: boolean;
  secureCookies: boolean;
  appOrigin: string;
  staticRoot?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}
