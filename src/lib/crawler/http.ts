import { parseRobots, type RobotsPolicy } from "./robots";

export type FetchStatus = "ok" | "disallowed" | "blocked" | "not_found" | "error";

export type FetchResult = {
  url: string;
  status: FetchStatus;
  httpStatus?: number;
  html?: string;
  note?: string;
};

type Options = {
  userAgent?: string;
  delayMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A deliberately slow HTTP client for crawling sites we don't own.
 *
 *  - obeys robots.txt (and its Crawl-delay when it is stricter than ours)
 *  - one request at a time per host, with a minimum gap between them
 *  - sends an honest User-Agent; never pretends to be a browser
 *  - treats 401/403/429 as "we are not welcome" and reports `blocked`
 *    instead of trying to get around it
 */
export class PoliteFetcher {
  private readonly userAgent: string;
  private readonly delayMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly robots = new Map<string, Promise<RobotsPolicy>>();
  private readonly nextSlot = new Map<string, number>();

  constructor(opts: Options = {}) {
    this.userAgent =
      opts.userAgent ?? process.env.CRAWLER_USER_AGENT ?? "A1LensBot/0.1 (personal learning project)";
    this.delayMs = opts.delayMs ?? Number(process.env.CRAWLER_DELAY_MS ?? 2000);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.maxRetries = opts.maxRetries ?? 2;
  }

  async get(url: string): Promise<FetchResult> {
    const target = new URL(url);
    const policy = await this.policyFor(target);
    if (!policy.isAllowed(target.pathname + target.search)) {
      return { url, status: "disallowed", note: "robots.txt disallows this path" };
    }

    for (let attempt = 0; ; attempt++) {
      await this.waitForSlot(target.host, policy.crawlDelayMs);
      let res: Response;
      try {
        res = await this.request(url);
      } catch (err) {
        if (attempt < this.maxRetries) continue;
        return { url, status: "error", note: err instanceof Error ? err.message : String(err) };
      }

      if (res.ok) return { url, status: "ok", httpStatus: res.status, html: await res.text() };
      if (res.status === 404 || res.status === 410) {
        return { url, status: "not_found", httpStatus: res.status };
      }
      if (res.status === 401 || res.status === 403) {
        return { url, status: "blocked", httpStatus: res.status, note: "site refuses automated requests" };
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000 * 2 ** attempt;
        await sleep(Math.min(backoff, 60_000));
        continue;
      }
      return {
        url,
        status: res.status === 429 ? "blocked" : "error",
        httpStatus: res.status,
        note: `HTTP ${res.status}`,
      };
    }
  }

  private request(url: string) {
    return fetch(url, {
      headers: { "user-agent": this.userAgent, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  /** Reserve the next free time slot for this host, then wait until it arrives. */
  private async waitForSlot(host: string, robotsDelayMs?: number) {
    const gap = Math.max(this.delayMs, robotsDelayMs ?? 0);
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + gap);
    if (slot > now) await sleep(slot - now);
  }

  private policyFor(target: URL): Promise<RobotsPolicy> {
    let policy = this.robots.get(target.origin);
    if (!policy) {
      policy = this.loadRobots(target.origin);
      this.robots.set(target.origin, policy);
    }
    return policy;
  }

  private async loadRobots(origin: string): Promise<RobotsPolicy> {
    try {
      const res = await this.request(`${origin}/robots.txt`);
      // 4xx = no robots.txt = everything allowed (RFC 9309 §2.3.1.3).
      if (res.status >= 400 && res.status < 500) return { isAllowed: () => true };
      // 5xx / unreachable = we can't know the rules, so assume the strictest.
      if (!res.ok) return { isAllowed: () => false };
      return parseRobots(await res.text(), this.userAgent);
    } catch {
      return { isAllowed: () => false };
    }
  }
}
