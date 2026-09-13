import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PortfolioEvent } from "@plinth-pages/shared";
import Redis from "ioredis";
import { Observable } from "rxjs";
import type { Env } from "../config/env";
import { redisConnection } from "../queue/redis-connection";
import { portfolioEventsChannel } from "./portfolio-events";

/**
 * Api only: one Redis subscriber connection shared by every open IDE. Channels are subscribed while at least one
 * browser is listening to that portfolio and dropped when the last one leaves.
 */
@Injectable()
export class PortfolioEventsHub implements OnModuleDestroy {
  private readonly logger = new Logger(PortfolioEventsHub.name);
  private subscriber?: Redis;
  private readonly listeners = new Map<string, Set<(event: PortfolioEvent) => void>>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  stream(portfolioId: string): Observable<PortfolioEvent> {
    return new Observable<PortfolioEvent>((subscriber) => {
      const channel = portfolioEventsChannel(portfolioId);
      const listener = (event: PortfolioEvent) => subscriber.next(event);
      let set = this.listeners.get(channel);
      if (!set) {
        set = new Set();
        this.listeners.set(channel, set);
        this.connection()
          .subscribe(channel)
          .catch((error: Error) => this.logger.warn(`Could not subscribe to ${channel}: ${error.message}`));
      }
      set.add(listener);

      return () => {
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(channel);
          void this.subscriber?.unsubscribe(channel).catch(() => undefined);
        }
      };
    });
  }

  async onModuleDestroy() {
    await this.subscriber?.quit().catch(() => undefined);
  }

  private connection(): Redis {
    if (this.subscriber) return this.subscriber;
    const { maxRetriesPerRequest: _unused, ...options } = redisConnection(this.config.get("REDIS_URL", { infer: true }));
    this.subscriber = new Redis(options);
    this.subscriber.on("error", (error) => this.logger.warn(`Event subscriber: ${error.message}`));
    this.subscriber.on("message", (channel, message) => {
      const set = this.listeners.get(channel);
      if (!set) return;
      try {
        const event = JSON.parse(message) as PortfolioEvent;
        for (const listener of set) listener(event);
      } catch {
        this.logger.warn(`Ignored a malformed event on ${channel}`);
      }
    });
    return this.subscriber;
  }
}
