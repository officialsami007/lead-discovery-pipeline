import type {
  CandidateLead,
  DiscoverContext,
  DiscoverProvider,
  JobSearchInput
} from '@lead/shared';
import { isAISearchRequest } from '@lead/shared';

export class RouterDiscoverProvider implements DiscoverProvider {
  constructor(
    private readonly guidedProvider: DiscoverProvider,
    private readonly aiProvider: DiscoverProvider
  ) {}

  discover(input: JobSearchInput, context: DiscoverContext): Promise<CandidateLead[]> {
    if (isAISearchRequest(input)) {
      return this.aiProvider.discover(input, context);
    }
    return this.guidedProvider.discover(input, context);
  }
}
