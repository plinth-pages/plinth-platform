import type { PortfolioEvent } from "@plinth-pages/shared";

export const PORTFOLIO_EVENTS = Symbol("PORTFOLIO_EVENTS");

/** Redis pub/sub channel for one portfolio. The worker publishes; the api fans out to the IDE over SSE. */
export const portfolioEventsChannel = (portfolioId: string) => `plinth:portfolio-events:${portfolioId}`;

export interface PortfolioEventPublisher {
  publish(portfolioId: string, event: PortfolioEvent): Promise<void>;
}

interface Publishing {
  publish(channel: string, message: string): Promise<number>;
}

/**
 * Publishes on an existing Redis connection. Delivery is best effort: an event is a hint to refetch, never the only
 * record of a change, so a failure is logged by the caller and never fails the operation that produced it.
 */
export class RedisPortfolioEventPublisher implements PortfolioEventPublisher {
  constructor(private readonly redis: () => Promise<Publishing>) {}

  async publish(portfolioId: string, event: PortfolioEvent): Promise<void> {
    await (await this.redis()).publish(portfolioEventsChannel(portfolioId), JSON.stringify(event));
  }
}
