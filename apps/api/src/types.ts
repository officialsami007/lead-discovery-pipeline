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
  /** Whether real discovery providers are configured. When false, the worker uses mock data. */
  providers: { tavily: boolean; groq: boolean };
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}
