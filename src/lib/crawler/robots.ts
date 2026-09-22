/**
 * Minimal robots.txt parser (RFC 9309 subset): user-agent groups, Allow,
 * Disallow, Crawl-delay, `*` wildcards and `$` end anchors.
 * Longest matching rule wins; Allow wins a tie.
 */

type Rule = { allow: boolean; pattern: string };
type Group = { agents: string[]; rules: Rule[]; crawlDelayMs?: number };

export type RobotsPolicy = {
  isAllowed(pathWithQuery: string): boolean;
  crawlDelayMs?: number;
};

const ALLOW_ALL: RobotsPolicy = { isAllowed: () => true };

export function parseRobots(text: string, userAgent: string): RobotsPolicy {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (key === "user-agent") {
      // Consecutive User-agent lines share one group.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;

    if (key === "allow" || key === "disallow") {
      // An empty Disallow means "nothing is disallowed".
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) current.crawlDelayMs = seconds * 1000;
    }
  }

  // Product token is the part before "/" — "A1LensBot/0.1 (...)" -> "a1lensbot".
  const token = userAgent.split(/[\/\s]/)[0].toLowerCase();
  const group =
    groups.find((g) => g.agents.some((a) => a !== "*" && token.includes(a))) ??
    groups.find((g) => g.agents.includes("*"));
  if (!group) return ALLOW_ALL;

  const compiled = group.rules.map((r) => ({ ...r, regex: toRegex(r.pattern) }));
  return {
    crawlDelayMs: group.crawlDelayMs,
    isAllowed(path) {
      let best: { allow: boolean; length: number } | null = null;
      for (const rule of compiled) {
        if (!rule.regex.test(path)) continue;
        const length = rule.pattern.length;
        if (!best || length > best.length || (length === best.length && rule.allow)) {
          best = { allow: rule.allow, length };
        }
      }
      return best ? best.allow : true;
    },
  };
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}
