# A1 Lens

A personal learning project: a **listing-quality auditor** and **competitor price lens** for the
public [A1 Tech Deals](https://a1techdeals.com) catalogue.

- **Phase 1 — Listing audit.** Crawls product pages from the public sitemap, parses what a shopper
  and a search engine each see, and runs ~30 rules over it: does the structured-data price match
  the buy box? Does a refurbished listing explain its grade? Does a mains-powered product say which
  plug it ships with? Every rule carries a *why it matters* and a *fix*.
- **Phase 2 — Price lens.** Compares A1's price with the same product elsewhere, matched by GTIN
  or by competitor URLs you map by hand.

Built with Next.js 16 (App Router), TypeScript, Postgres + Drizzle ORM, cheerio and Vitest.

> This project only reads public pages, and only the way a polite crawler should. It is not
> affiliated with or endorsed by A1 Tech Deals. See [Crawling etiquette](#crawling-etiquette).

## Quick start

Requires Node 22+ and Docker Desktop (running).

```bash
cp .env.example .env     # defaults work as-is
npm install
npm run db:up            # Postgres 17 in Docker, waits until healthy
npm run db:migrate       # apply drizzle/ migrations
npm run crawl            # audit 25 product pages (~1 min)
npm run dev              # http://localhost:3000
```

## Commands

| Command | What it does |
|---|---|
| `npm run crawl` | Crawl + audit 25 pages: never-crawled first, then the stalest |
| `npm run crawl -- --limit 100` | Same, 100 pages |
| `npm run crawl -- --all` | Whole catalogue (~1,000 pages, ~35 min at 2 s/page) |
| `npm run crawl -- --known` | Re-crawl only stored pages — use after changing the **parser** |
| `npm run crawl -- --url <product url>` | One page |
| `npm run audit` | Re-run the rules over stored snapshots, no network — use after changing a **rule** |
| `npm run prices:import` | Load `data/competitor-urls.csv` |
| `npm run prices` | Check competitor prices |
| `npm test` · `npm run typecheck` · `npm run lint` | Quality gates |
| `npm run db:generate` | Create a migration after editing `src/db/schema.ts` |
| `npm run db:studio` | Browse the database in Drizzle Studio |

## How it fits together

```
sitemap.xml ──► PoliteFetcher ──► parseProductPage ──► products.snapshot (jsonb)
                (robots.txt,        (cheerio: JSON-LD,            │
                 2 s/host)           data-testid hooks)           ▼
                                                        auditProduct (rules.ts)
                                                                  │
                                       audit_findings ◄───────────┘
                                                                  │
PriceSource(s) ──► competitor_prices ──────────────► Next.js dashboard (server components)
```

| Path | Role |
|---|---|
| `src/lib/crawler/` | `robots.ts` parser, `http.ts` rate-limited fetcher, `sitemap.ts`, `parse-product.ts` |
| `src/lib/jsonld.ts` | schema.org Product/Offer extraction — shared by the A1 parser and competitor pages |
| `src/lib/audit/rules.ts` | **The rules.** Start here. `config.ts` holds thresholds and heuristics |
| `src/lib/audit/segment.ts` | Segment classifier: groups listings that share an import signature (thin feed, no copy) |
| `src/lib/pricing/` | `PriceSource` interface + `url-source.ts` (mapped URLs) + `ebay-source.ts` (Browse API) |
| `src/lib/queries.ts` | Every read the dashboard makes |
| `src/db/schema.ts` | Tables: products, audit_findings, price_history, competitor_listings, competitor_prices, crawl_runs |
| `scripts/` | CLI entry points run with `tsx` |
| `tests/` | Vitest, against a synthetic fixture that mirrors the real page structure |

### Dashboard pages

| Page | Shows |
|---|---|
| `/` Overview | Stat tiles, catalogue segments, findings by rule, score distribution — filterable by segment |
| `/categories` Scorecard | Score, import-thin share and top issues per category; click through to sub-categories |
| `/feed-quality` | The thin distributor-feed import as one problem: size, symptoms, where it sits, how to fix it |
| `/listings` | Every audited listing, filterable by rule, severity, segment and category |
| `/listings/[id]` | One listing: findings with fixes, facts, condition variants, competitor prices, price history |
| `/prices` Price lens | A1's price vs the cheapest competitor found per product |

### Adding a rule

Add an object to `RULES` in `src/lib/audit/rules.ts`, add a test in `tests/audit.test.ts`, then
`npm run audit`. A good rule is grounded in evidence (a customer complaint, a Google requirement),
has a low false-positive rate, and says what to change.

### Adding a price source

Implement `PriceSource` (`src/lib/pricing/types.ts`) and register it in `scripts/prices.ts`.

## Phase 2 — getting price data

1. **Mapped URLs (works today).** Put rows in `data/competitor-urls.csv`
   (`a1_product,retailer,url`), run `npm run prices:import`, then `npm run prices`. The source reads the
   schema.org Offer from each page. Match the *same* product — model, storage, colour **and condition**.
2. **eBay UK (optional).** Create a free Production keyset at <https://developer.ebay.com>, put it in
   `.env`, and every product with a GTIN is checked through the official Browse API.
   ⚠️ `ebay-source.ts` follows eBay's documented contract but has not been run with real credentials yet.

Large retailers often refuse automated requests. A1 Lens records those as `blocked` and moves on —
it will not disguise itself as a browser, rotate IPs or otherwise work around a refusal. For those
retailers, enter prices by hand or use an official feed/API.

`npm run probe -- --file data/probe-<retailer>.txt` answers "can we crawl retailer X politely?"
without storing anything: honest User-Agent, robots.txt respected, one request every 5 s, stop at
the first 401/403/429.

| Retailer | Tested | Result |
|---|---|---|
| Currys | 2026-09-23 | robots.txt allows `/products*` and serves the sitemap, but the first product page is **403** (Cloudflare bot rule). Use their affiliate datafeed instead. |
| Argos | 2026-09-23 | **403 on robots.txt itself** (Akamai). No crawling possible; affiliate datafeed only. |
| Wonderprice, Smart Home Sounds | 2026-09-21 | Pages served; Wonderprice has schema.org Offer markup, Smart Home Sounds does not. |

## Crawling etiquette

- Obeys `robots.txt` (including `Crawl-delay`) for every host, A1 and competitors alike.
- One request at a time per host, ≥ 2 s apart (`CRAWLER_DELAY_MS`).
- Honest `User-Agent`; add a contact address in `.env` so a site owner can reach you.
- Stops the crawl on the first 401/403 rather than pushing on.
- Stores parsed fields, not page copies. Fixtures in `tests/` are synthetic.

Once you work at the company: keep internal data (orders, supplier offers, margins) **out** of this
repo unless your manager explicitly approves it, and ask before crawling at volume — the team may
prefer you use a staging site or a product feed instead.

## Ideas for next steps

- Price-history sparkline per listing; alert when A1 stops being the cheapest.
- Category-level scorecards ("Smartphones average 71, Audio 88").
- Export findings per rule as CSV for the content team.
- Crawl `/category` and `/brand` pages: thin categories, empty brands, broken pagination.
- LLM pass over descriptions: spot copy that contradicts the specs, draft 155-character meta descriptions.
- Lighthouse / Core Web Vitals per template.
