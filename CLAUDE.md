@AGENTS.md

# A1 Lens

Listing-quality auditor + competitor price lens for the public a1techdeals.com catalogue. See README.md.

- Gates before calling work done: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Changed a **rule or the segment classifier** (`src/lib/audit/`)? `npm run audit` re-scores and re-segments stored snapshots, no network.
  Changed the **parser** (`src/lib/crawler/parse-product.ts`)? `npm run crawl -- --known` re-fetches stored pages.
- `DATABASE_URL` uses `127.0.0.1`, not `localhost`: Node resolves localhost to `::1` first and Docker Desktop's
  IPv6 port proxy accepts the TCP connection but never completes the Postgres handshake (CONNECT_TIMEOUT).
- Changed `src/db/schema.ts`? `npm run db:generate` then `npm run db:migrate`. Never hand-edit `drizzle/`.
- Pages are server components; DB reads live in `src/lib/queries.ts` and start with `await connection()`
  (Next 16 removed `export const dynamic`).
- In raw `sql` subqueries write `"products"."id"`, not `${products.id}` — Drizzle renders the latter as a bare `"id"`.
- Crawling rules are non-negotiable: all fetching goes through `PoliteFetcher` (robots.txt, ≥2 s/host, honest
  User-Agent). Never add browser impersonation, proxy rotation or anything that works around a block.
- Test fixtures are synthetic on purpose. Don't commit copies of real product pages.
