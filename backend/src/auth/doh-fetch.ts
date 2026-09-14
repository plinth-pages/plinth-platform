import { Logger } from "@nestjs/common";
import { isIP } from "net";
import { Agent, fetch as undiciFetch } from "undici";

const logger = new Logger("DohFetch");
const DOH_URL = "https://cloudflare-dns.com/dns-query";

/** Resolves a hostname's IPv4 address through Cloudflare DNS-over-HTTPS, bypassing the local resolver. */
async function resolveOverHttps(hostname: string): Promise<string> {
  const response = await fetch(`${DOH_URL}?name=${encodeURIComponent(hostname)}&type=A`, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(5_000),
  });
  const json = (await response.json()) as { Answer?: { type: number; data: string }[] };
  const address = json.Answer?.find((answer) => answer.type === 1 && isIP(answer.data) === 4)?.data;
  if (!address) throw new Error(`DNS-over-HTTPS returned no address for ${hostname}`);
  return address;
}

/**
 * A fetch that falls back to DNS-over-HTTPS when the connection fails. Some networks answer DNS for a blocked domain
 * with a sinkhole address, so the TLS handshake is reset even though the service is up; resolving the real address
 * and connecting to it (certificate still checked against the hostname) gets through. Once needed, the fallback is
 * used for the rest of the process, so the failed attempt is paid only once.
 */
export function createDohFallbackFetch(): typeof fetch {
  let useDoh = false;
  const cache = new Map<string, { address: string; until: number }>();
  const agent = new Agent({
    connect: {
      lookup: (hostname, _options, callback) => {
        const cached = cache.get(hostname);
        if (cached && cached.until > Date.now()) return callback(null, [{ address: cached.address, family: 4 }]);
        resolveOverHttps(hostname).then(
          (address) => {
            cache.set(hostname, { address, until: Date.now() + 5 * 60_000 });
            callback(null, [{ address, family: 4 }]);
          },
          (error: Error) => callback(error, []),
        );
      },
    },
  });

  const viaDoh = (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(input as never, { ...(init as object), dispatcher: agent } as never) as unknown as Promise<Response>;

  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (useDoh) return viaDoh(input, init);
    try {
      return await fetch(input, init);
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause?.code;
      if ((init?.signal as AbortSignal | undefined)?.aborted || !cause) throw error;
      logger.warn(`Connection failed (${cause}); retrying with DNS-over-HTTPS. The local DNS may be blocking this service.`);
      useDoh = true;
      return viaDoh(input, init);
    }
  }) as typeof fetch;
}
