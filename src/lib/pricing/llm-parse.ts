import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Read a retailer's product page (as markdown) and pick out the main product's
 * own price. Retail pages are full of other numbers — accessories, protection
 * plans, delivery charges, "£12.33/month" finance — so this is a judgement
 * call, and the model has to show its evidence.
 */

const MODEL = "claude-opus-5";
/** Bump when the prompt or schema changes so cached parses are redone. */
const PROMPT_VERSION = "2026-09-23.1";
const CACHE_DIR = join("data", "cache", "parse");

export const ListingParse = z.object({
  product_title: z.string().describe("The main product's title as the page shows it"),
  price: z.number().nullable().describe("The main product's current selling price in GBP, or null if not shown / not sold"),
  price_evidence: z.string().nullable().describe("The exact snippet the price was read from"),
  was_price: z.number().nullable().describe("Strike-through / 'was' / RRP figure for the main product, if shown"),
  delivery_cost: z.number().nullable().describe("Cheapest standard home delivery to the UK mainland in GBP; 0 if free; null if not stated"),
  delivery_note: z.string().nullable().describe("Delivery wording the cost came from"),
  stock: z.enum(["in_stock", "out_of_stock", "preorder", "unknown"]),
  match: z.enum(["exact", "near", "uncertain"]).describe("Is this the same variant (colour, capacity, bundle) as the A1 listing?"),
  match_note: z.string().nullable().describe("What differs, or what could not be confirmed"),
  confidence: z.number().min(0).max(1).describe("Confidence that `price` is the main product's own price"),
  ignored: z.array(z.string()).describe("Amounts deliberately not used, with why, e.g. '£3.95 — delivery', '£12.33 — monthly finance'"),
});
export type ListingParse = z.infer<typeof ListingParse>;

const SYSTEM = `You read a UK retailer's product page, supplied as markdown, and report the MAIN product's own price.

Rules:
- The main product is the one the page is for (its title is the page's H1 / <title>). Report ITS current selling price in GBP, incl. VAT.
- Ignore, and list under "ignored": accessories, add-ons, "frequently bought together", "customers also bought", protection plans and care/repair cover, extended warranties, trade-in credits, delivery charges, click-and-collect fees, monthly finance or credit amounts ("£x/month", "pay monthly", "0% APR"), gift-card promotions, and prices of other colours/sizes when they are clearly not the selected one.
- was_price: only a strike-through / "was" / "RRP" figure shown for the main product itself.
- delivery_cost: the cheapest standard home delivery to UK mainland for this product; 0 if the page says free; null if not stated. Never subtract or add it to price.
- stock: in_stock if the page offers to buy/add to basket; out_of_stock if it says unavailable/out of stock; preorder if pre-order; unknown otherwise.
- match: compare the page's product with the A1 listing name you are given. exact = same model, colour, capacity and bundle. near = same model but colour, capacity or bundle differs. uncertain = cannot tell from the page.
- If the page is a bot-check, error page, or the product is not on it, set price to null with confidence 0 and explain in match_note.
- Quote evidence verbatim. Do not guess a price that is not on the page.`;

export type ParseInput = {
  retailer: string;
  url: string;
  a1Name: string;
  a1Price: number | null;
  title: string | null;
  markdown: string;
  excerpts: string[];
};

export type ParseOutcome = { parse: ListingParse; model: string; cached: boolean; usage?: { input: number; output: number } };

const cacheKey = (input: ParseInput) =>
  createHash("sha256").update([PROMPT_VERSION, MODEL, input.url, input.a1Name, input.markdown].join("\n")).digest("hex").slice(0, 24);

export function isLlmConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function parseListing(input: ParseInput, opts: { refresh?: boolean } = {}): Promise<ParseOutcome> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, `${cacheKey(input)}.json`);
  if (!opts.refresh && existsSync(path)) {
    const cached = JSON.parse(readFileSync(path, "utf8")) as Omit<ParseOutcome, "cached">;
    return { ...cached, cached: true };
  }

  const client = new Anthropic();
  const user = [
    `Retailer: ${input.retailer}`,
    `URL: ${input.url}`,
    `Page title: ${input.title ?? "(none)"}`,
    `A1 listing to compare against: ${input.a1Name}${input.a1Price != null ? ` (A1 price £${input.a1Price.toFixed(2)})` : ""}`,
    "",
    input.excerpts.length ? `Relevant excerpts:\n${input.excerpts.map((e) => `- ${e}`).join("\n")}\n` : "",
    "Full page markdown:",
    "<page>",
    input.markdown,
    "</page>",
  ].join("\n");

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "medium", format: zodOutputFormat(ListingParse) },
    messages: [{ role: "user", content: user }],
  });

  if (response.stop_reason === "refusal") throw new Error(`model refused: ${response.stop_details?.explanation ?? "no explanation"}`);
  if (!response.parsed_output) throw new Error(`could not parse model output (stop_reason ${response.stop_reason})`);

  const outcome = {
    parse: response.parsed_output,
    model: response.model,
    usage: { input: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0), output: response.usage.output_tokens },
  };
  writeFileSync(path, JSON.stringify(outcome, null, 2));
  return { ...outcome, cached: false };
}
