import type { ParsedProduct } from "../crawler/parse-product";
import type { Condition } from "../jsonld";
import {
  ACCESSORY,
  BOX_CONTENTS_STATED,
  CONDITION_WORDS,
  CONNECTIVITY_HINT,
  CONNECTIVITY_IN_NAME,
  CONNECTIVITY_SPEC_LABEL,
  CONNECTIVITY_SPEC_VALUE,
  DUAL_CONNECTIVITY_WATCH,
  WATCH_ACCESSORY,
  MAINS_POWERED,
  NAME_DANGLING_END,
  NAME_MALFORMED,
  PLUG_STATED,
  THRESHOLDS,
} from "./config";
import { isValidGtin } from "./gtin";

export type Severity = "high" | "medium" | "low";
export type Category = "accuracy" | "pricing" | "content" | "structured-data" | "seo";
export type RuleHit = { message: string; evidence?: string };

export type Rule = {
  id: string;
  title: string;
  severity: Severity;
  category: Category;
  /** Why the business should care — shown in the dashboard. */
  why: string;
  /** What to change to make the finding go away. */
  fix: string;
  check(p: ParsedProduct, ctx: { now: Date }): RuleHit | null;
};

// --- helpers ---------------------------------------------------------------

const description = (p: ParsedProduct) => p.description ?? p.jsonLd?.description ?? "";
const name = (p: ParsedProduct) => p.jsonLd?.name ?? p.h1 ?? "";
const specsText = (p: ParsedProduct) => p.specs.map((s) => `${s.label}: ${s.value}`).join("\n");
const listingText = (p: ParsedProduct) => [name(p), description(p), specsText(p)].join("\n");

const samePrice = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** Best condition first. Keys are the ids of the site's condition tabs. */
const GRADE_RANK: Record<string, number> = { new: 0, "open-box": 1, "grade-a": 2, "grade-b": 3, "grade-c": 4 };

export function conditionFromLabel(label?: string): Condition {
  const l = label?.toLowerCase() ?? "";
  if (l.includes("refurb") || l.includes("open box")) return "refurbished";
  if (l.includes("used") || l.includes("pre-owned")) return "used";
  if (l.includes("new")) return "new";
  return "unknown";
}

/** What the page actually opens on. JSON-LD is only a fallback: it may describe another condition tab. */
const visibleCondition = (p: ParsedProduct): Condition => {
  const visible = conditionFromLabel(p.conditionLabel);
  return visible === "unknown" ? (p.jsonLd?.offer?.condition ?? "unknown") : visible;
};

const isRefurbished = (p: ParsedProduct) => visibleCondition(p) === "refurbished";

/** True when the JSON-LD offer's price belongs to a condition tab other than the one the page opens on. */
const describesAnotherVariant = (p: ParsedProduct) => {
  const ld = p.jsonLd?.offer?.price;
  return ld != null && p.conditionVariants.some((v) => !v.selected && v.price != null && samePrice(v.price, ld));
};

/** Grade word promised by the slug, e.g. "…-very-good-condition" -> "very-good". */
export function slugConditionWord(slug: string): string | undefined {
  if (!/(^|-)(refurbished|condition|grade)(-|$)/.test(slug)) return undefined;
  return CONDITION_WORDS.find((word) => new RegExp(`(^|-)${word}(-|$)`).test(slug));
}

// --- rules -----------------------------------------------------------------

export const RULES: Rule[] = [
  // ── accuracy: the page contradicts itself ────────────────────────────────
  {
    id: "price-mismatch",
    title: "Structured-data price differs from the visible price",
    severity: "high",
    category: "accuracy",
    why: "Google Shopping and rich results show the JSON-LD price. A mismatch can get the offer disapproved and shows shoppers a price they won't get.",
    fix: "Generate the JSON-LD offer from the same price the buy box renders.",
    check(p) {
      const ld = p.jsonLd?.offer?.price;
      if (ld == null || p.visiblePrice == null || samePrice(ld, p.visiblePrice)) return null;
      // A price that belongs to another condition tab is the softer rule below.
      if (p.conditionVariants.some((v) => v.price != null && samePrice(v.price, ld))) return null;
      return { message: `JSON-LD says £${ld.toFixed(2)}, page shows £${p.visiblePrice.toFixed(2)}.` };
    },
  },
  {
    id: "jsonld-price-is-other-variant",
    title: "Structured data advertises a different condition than the page opens on",
    severity: "medium",
    category: "accuracy",
    why: "Google shows the JSON-LD price. A shopper who clicks “£284.99” and lands on a £295.99 default feels baited, and Merchant Center can flag it as a landing-page price mismatch.",
    fix: "Open the page on the variant the Offer describes (its `url` already points at one), or publish one Offer per condition.",
    check(p) {
      const ld = p.jsonLd?.offer?.price;
      if (ld == null || p.visiblePrice == null || samePrice(ld, p.visiblePrice)) return null;
      const advertised = p.conditionVariants.find((v) => v.price != null && samePrice(v.price, ld));
      if (!advertised) return null;
      return {
        message: `JSON-LD advertises £${ld.toFixed(2)} (${advertised.label}); the page opens on ${p.conditionLabel ?? "another variant"} at £${p.visiblePrice.toFixed(2)}.`,
      };
    },
  },
  {
    id: "grade-price-inversion",
    title: "A worse condition costs more than a better one",
    severity: "medium",
    category: "pricing",
    why: "Each grade is priced by whichever supplier bid lowest, so grades can leapfrog. To a shopper, “Good” costing more than “Excellent” looks like a mistake and undermines trust in the grading.",
    fix: "Cap each grade at the price of the next grade up, or hide a grade while a better one is cheaper.",
    check(p) {
      const ranked = p.conditionVariants
        .filter((v) => v.price != null && !v.outOfStock && v.id in GRADE_RANK)
        .sort((a, b) => GRADE_RANK[a.id] - GRADE_RANK[b.id]);
      for (const [i, better] of ranked.entries()) {
        const worse = ranked.slice(i + 1).find((v) => v.price! > better.price!);
        if (worse) {
          return { message: `${worse.label} is £${worse.price!.toFixed(2)} but ${better.label} is only £${better.price!.toFixed(2)}.` };
        }
      }
      return null;
    },
  },
  {
    id: "condition-mismatch",
    title: "Structured-data condition differs from the visible condition",
    severity: "high",
    category: "accuracy",
    why: "Selling refurbished stock flagged as new (or the reverse) is a trust and compliance problem, and Google treats it as misrepresentation.",
    fix: "Drive itemCondition from the selected condition variant.",
    check(p) {
      const ld = p.jsonLd?.offer?.condition ?? "unknown";
      const visible = conditionFromLabel(p.conditionLabel);
      if (ld === "unknown" || visible === "unknown" || ld === visible) return null;
      // Open Box has no schema.org condition of its own; either value is defensible.
      if (/open box/i.test(p.conditionLabel ?? "")) return null;
      // JSON-LD describing another tab is jsonld-price-is-other-variant's job, not a mislabel.
      if (describesAnotherVariant(p)) return null;
      return { message: `JSON-LD says "${ld}", page shows "${p.conditionLabel}".` };
    },
  },
  {
    id: "slug-condition-mismatch",
    title: "URL promises a different grade than the page sells",
    severity: "medium",
    category: "accuracy",
    why: "The URL is visible in search results and shared links. A shopper who clicked “very good condition” and lands on another grade has been told two different things.",
    fix: "Keep grade words out of product slugs (the condition selector already handles it), or redirect to a slug that matches.",
    check(p) {
      const word = slugConditionWord(p.slug);
      if (!word || !p.conditionLabel) return null;
      const label = p.conditionLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      // "good" must not be satisfied by "very-good".
      const labelHasWord = new RegExp(`(^|-)${word}(-|$)`).test(word === "good" ? label.replace("very-good", "") : label);
      if (labelHasWord) return null;
      return { message: `Slug says "${word.replace("-", " ")}", page sells "${p.conditionLabel}".`, evidence: p.slug };
    },
  },
  {
    id: "refurb-condition-unexplained",
    title: "Refurbished listing has no condition report",
    severity: "high",
    category: "accuracy",
    why: "“Arrived used / not as described” is a recurring 1-star theme. Refurbished buyers need to know exactly what cosmetic state to expect.",
    fix: "Show the condition report panel for every refurbished variant.",
    check(p) {
      if (!isRefurbished(p) || p.conditionNotes) return null;
      return { message: "Refurbished item with no visible condition notes." };
    },
  },
  {
    id: "price-valid-until-expired",
    title: "priceValidUntil is in the past",
    severity: "medium",
    category: "accuracy",
    why: "Google ignores offers whose priceValidUntil has passed, so the product loses its price rich result.",
    fix: "Roll priceValidUntil forward whenever the page is regenerated.",
    check(p, { now }) {
      const until = p.jsonLd?.offer?.priceValidUntil;
      if (!until) return null;
      const date = new Date(until);
      if (Number.isNaN(date.getTime()) || date >= now) return null;
      return { message: `priceValidUntil is ${until}.` };
    },
  },

  // ── content: would a shopper know what they are getting? ──────────────────
  {
    id: "description-missing",
    title: "No product description",
    severity: "high",
    category: "content",
    why: "A listing with no description converts poorly and gives search engines nothing to rank.",
    fix: "Add a description — even the manufacturer's summary is better than nothing.",
    check: (p) => (description(p) ? null : { message: "No description found on the page or in JSON-LD." }),
  },
  {
    id: "description-short",
    title: "Description is very short",
    severity: "medium",
    category: "content",
    why: "Thin descriptions leave buying questions unanswered, which become support tickets and returns.",
    fix: `Expand to at least ${THRESHOLDS.descriptionMinChars} characters covering what it is, who it's for and what's notable.`,
    check(p) {
      const length = description(p).length;
      if (length === 0 || length >= THRESHOLDS.descriptionMinChars) return null;
      return { message: `Description is ${length} characters.` };
    },
  },
  {
    id: "specs-missing",
    title: "No specification table",
    severity: "high",
    category: "content",
    why: "Tech shoppers compare on specs. Without them they leave to check elsewhere — and often buy there.",
    fix: "Populate the specification table from the supplier feed or manufacturer data.",
    check: (p) => (p.specs.length === 0 ? { message: "The page has no specification rows." } : null),
  },
  {
    id: "specs-thin",
    title: "Specification table is thin",
    severity: "medium",
    category: "content",
    why: "A handful of rows rarely covers the questions shoppers ask (dimensions, compatibility, connectivity, power).",
    fix: `Aim for at least ${THRESHOLDS.specsMinRows} meaningful rows.`,
    check(p) {
      if (p.specs.length === 0 || p.specs.length >= THRESHOLDS.specsMinRows) return null;
      return { message: `Only ${p.specs.length} specification row(s).`, evidence: p.specs.map((s) => s.label).join(", ") };
    },
  },
  {
    id: "images-few",
    title: "Too few product images",
    severity: "medium",
    category: "content",
    why: "Shoppers can't pick the product up. Multiple angles reduce “not what I expected” returns.",
    fix: `Provide at least ${THRESHOLDS.imagesMin} images: front, back/ports and in-box contents.`,
    check(p) {
      const count = Math.max(p.galleryImageCount, p.jsonLd?.images.length ?? 0);
      return count < THRESHOLDS.imagesMin ? { message: `${count} image(s) found.` } : null;
    },
  },
  {
    id: "plug-type-unstated",
    title: "Mains-powered product doesn't state its plug type",
    severity: "medium",
    category: "content",
    why: "Reviews mention items arriving with EU or US plugs and an adapter, “which was not clear in the description”. Saying it upfront turns a complaint into an informed choice.",
    fix: "State the plug type (UK 3-pin, or EU/US with adapter included) in the specs or description.",
    check(p) {
      const n = name(p);
      if (!MAINS_POWERED.test(n) || ACCESSORY.test(n)) return null;
      if (PLUG_STATED.test(listingText(p))) return null;
      return { message: "Looks mains-powered, but no plug type or region is mentioned.", evidence: n };
    },
  },
  {
    id: "refurb-accessories-unstated",
    title: "Refurbished listing doesn't say which accessories are included",
    severity: "medium",
    category: "content",
    why: "“Missing accessories” is a recurring complaint. Refurbished stock often ships without the original charger or cable, so say so.",
    fix: "Add an “In the box” line to every refurbished listing.",
    check(p) {
      if (!isRefurbished(p) || BOX_CONTENTS_STATED.test(listingText(p))) return null;
      return { message: "No “in the box” / included accessories statement found." };
    },
  },
  {
    id: "box-contents-unstated",
    title: "Listing doesn't say what's in the box",
    severity: "low",
    category: "content",
    why: "Box contents is one of the most common pre-purchase questions for electronics.",
    fix: "Add an “In the box” line or spec row.",
    check(p) {
      if (isRefurbished(p) || BOX_CONTENTS_STATED.test(listingText(p))) return null;
      return { message: "No “in the box” statement found." };
    },
  },
  {
    id: "name-leads-with-code",
    title: "Product name starts with a part number",
    severity: "low",
    category: "content",
    why: "Search results and product cards truncate names. Leading with “10GBN9901” hides the brand and product type shoppers scan for.",
    fix: "Lead with brand and product, and move the part number to the end or into the specs.",
    check(p) {
      const first = name(p).split(/\s+/)[0] ?? "";
      const looksLikeCode = /^[A-Z0-9][A-Z0-9-]{5,}$/.test(first) && /\d/.test(first) && /[A-Z]/.test(first);
      return looksLikeCode ? { message: `Name starts with "${first}".`, evidence: name(p) } : null;
    },
  },

  {
    id: "watch-connectivity-unstated",
    title: "Smartwatch listing doesn't say Bluetooth or LTE",
    severity: "medium",
    category: "content",
    why: "Galaxy, Apple and Pixel watches ship as a Bluetooth/Wi-Fi model and an LTE model that share a name and differ by £50–£100. Without the variant a shopper can't tell which one they're buying — and neither can a price comparison; this is exactly what made the Galaxy Watch8 comparison uncertain.",
    fix: "Put the connectivity variant (Bluetooth or LTE) in the name and in a spec row.",
    check(p) {
      const n = name(p);
      if (!DUAL_CONNECTIVITY_WATCH.test(n) || WATCH_ACCESSORY.test(n)) return null;
      if (CONNECTIVITY_IN_NAME.test(n)) return null;
      if (p.specs.some((s) => CONNECTIVITY_SPEC_LABEL.test(s.label) && CONNECTIVITY_SPEC_VALUE.test(s.value))) return null;
      const hint = p.specs.find((s) => CONNECTIVITY_HINT.test(s.value));
      return {
        message: hint
          ? `Neither the name nor a variant spec row says Bluetooth or LTE; the only hint is buried in “${hint.label}”.`
          : "Neither the name nor the specs say whether this is the Bluetooth/Wi-Fi or the LTE model.",
        evidence: hint ? `${hint.label}: ${hint.value}` : n,
      };
    },
  },
  {
    id: "name-truncated",
    title: "Product name looks cut off or malformed",
    severity: "medium",
    category: "content",
    why: "The name is the headline in search results, product cards and the basket. “USB-C Power Adapter PD 65W -” or “QSFP28 transceiver that” reads as broken and hides what the product is.",
    fix: "The importer is truncating a longer feed field or keeping stray punctuation. Fix the mapping, re-import, and hand-edit the leftovers.",
    check(p) {
      const n = name(p);
      const dangling = n.match(NAME_DANGLING_END)?.[0];
      if (dangling) return { message: `Name ends with “${dangling}”.`, evidence: n };
      if (NAME_MALFORMED.test(n)) return { message: "Name has a space before a comma or an unclosed bracket.", evidence: n };
      return null;
    },
  },

  // ── structured data: what machines read ──────────────────────────────────
  {
    id: "jsonld-missing",
    title: "No schema.org Product markup",
    severity: "high",
    category: "structured-data",
    why: "Without Product JSON-LD the page can't earn price/availability rich results or free Google Shopping listings.",
    fix: "Render a Product JSON-LD block with name, image, brand, GTIN and an Offer.",
    check: (p) => (p.jsonLd ? null : { message: "No Product JSON-LD block found." }),
  },
  {
    id: "jsonld-offer-missing",
    title: "Product markup has no Offer",
    severity: "medium",
    category: "structured-data",
    why: "Without an Offer the page loses its price and stock rich result. Out-of-stock pages currently drop the Offer entirely, so Google can't tell “sold out” from “no longer sold” — and the listing has to re-earn its snippet when stock returns.",
    fix: "Keep the Offer on out-of-stock pages with `availability: https://schema.org/OutOfStock`.",
    check(p) {
      if (!p.jsonLd || p.jsonLd.offer) return null;
      return { message: p.outOfStockNotice ? "Out-of-stock page publishes no Offer at all." : "JSON-LD Product has no `offers`." };
    },
  },
  {
    id: "jsonld-image-missing",
    title: "Product markup has no image",
    severity: "medium",
    category: "structured-data",
    why: "Google requires an image for product rich results.",
    fix: "Add the gallery image URLs to the JSON-LD `image` array.",
    check: (p) => (p.jsonLd && p.jsonLd.images.length === 0 ? { message: "JSON-LD `image` is empty." } : null),
  },
  {
    id: "brand-missing",
    title: "Product markup has no brand",
    severity: "medium",
    category: "structured-data",
    why: "Brand is how shoppers filter and how Google matches the product to its catalogue.",
    fix: "Populate `brand.name` in the JSON-LD.",
    check: (p) => (p.jsonLd && !p.jsonLd.brand ? { message: "JSON-LD `brand` is missing." } : null),
  },
  {
    id: "gtin-missing",
    title: "No GTIN / EAN",
    severity: "medium",
    category: "structured-data",
    why: "GTIN is how Google Shopping — and A1 Lens's price comparison — match this listing to the same product elsewhere.",
    fix: "Capture the EAN from the supplier offer and expose it as `gtin13`.",
    check: (p) => (p.jsonLd && !p.jsonLd.gtin ? { message: "JSON-LD has no gtin field." } : null),
  },
  {
    id: "gtin-invalid",
    title: "GTIN fails its check digit",
    severity: "medium",
    category: "structured-data",
    why: "Merchant Center disapproves offers with invalid GTINs, and price matching silently fails.",
    fix: "Re-key the barcode; this is usually a typo or a dropped leading zero.",
    check(p) {
      const gtin = p.jsonLd?.gtin;
      return gtin && !isValidGtin(gtin) ? { message: `"${gtin}" is not a valid GTIN.` } : null;
    },
  },
  {
    id: "jsonld-no-return-policy",
    title: "Offer markup omits the return policy",
    severity: "low",
    category: "structured-data",
    why: "A1 offers free 30-day returns — a selling point Google can show in results, but only if `hasMerchantReturnPolicy` is present.",
    fix: "Add a MerchantReturnPolicy (30 days, free returns, GB) to every Offer.",
    check: (p) => (p.jsonLd?.offer && !p.jsonLd.offer.hasReturnPolicy ? { message: "Offer has no hasMerchantReturnPolicy." } : null),
  },
  {
    id: "jsonld-no-shipping-details",
    title: "Offer markup omits shipping details",
    severity: "low",
    category: "structured-data",
    why: "Free UK delivery is a headline promise. `shippingDetails` lets Google display “Free delivery” next to the price.",
    fix: "Add OfferShippingDetails with a £0 rate for GB to every Offer.",
    check: (p) => (p.jsonLd?.offer && !p.jsonLd.offer.hasShippingDetails ? { message: "Offer has no shippingDetails." } : null),
  },

  // ── seo: how the page presents itself in search ──────────────────────────
  {
    id: "noindex-in-sitemap",
    title: "Page is in the sitemap but marked noindex",
    severity: "high",
    category: "seo",
    why: "The sitemap says “index this”, the page says “don't”. The product won't appear in search.",
    fix: "Remove the noindex, or drop the URL from the sitemap if it is meant to be hidden.",
    check: (p) => (p.robotsMeta?.toLowerCase().includes("noindex") ? { message: `robots meta is "${p.robotsMeta}".` } : null),
  },
  {
    id: "canonical-mismatch",
    title: "Canonical URL is missing or points elsewhere",
    severity: "medium",
    category: "seo",
    why: "The canonical tells search engines which URL to rank. A wrong one splits or loses ranking signals.",
    fix: "Emit a self-referencing canonical on every product page.",
    check(p) {
      if (!p.canonical) return { message: "No canonical link." };
      try {
        const canonical = new URL(p.canonical, p.url).pathname.replace(/\/$/, "");
        const own = new URL(p.url).pathname.replace(/\/$/, "");
        return canonical === own ? null : { message: "Canonical points to a different path.", evidence: p.canonical };
      } catch {
        return { message: "Canonical is not a valid URL.", evidence: p.canonical };
      }
    },
  },
  {
    id: "h1-count",
    title: "Page doesn't have exactly one H1",
    severity: "medium",
    category: "seo",
    why: "The H1 is the strongest on-page signal of what the page is about; zero or several dilutes it.",
    fix: "Keep a single H1 containing the product name.",
    check: (p) => (p.h1Count === 1 ? null : { message: `Found ${p.h1Count} H1 elements.` }),
  },
  {
    id: "meta-description-missing",
    title: "No meta description",
    severity: "medium",
    category: "seo",
    why: "Without one, Google picks arbitrary page text for the search snippet.",
    fix: "Write or generate a 120–160 character summary.",
    check: (p) => (p.metaDescription ? null : { message: "No meta description." }),
  },
  {
    id: "meta-description-long",
    title: "Meta description is far longer than Google displays",
    severity: "low",
    category: "seo",
    why: `Google shows roughly ${THRESHOLDS.metaDescriptionMaxChars} characters. Dumping the whole description means the snippet is cut mid-sentence and never mentions price, delivery or warranty.`,
    fix: "Generate a purpose-written snippet: product, key benefit, “free UK delivery, 12-month warranty”.",
    check(p) {
      const length = p.metaDescription?.length ?? 0;
      return length > THRESHOLDS.metaDescriptionMaxChars ? { message: `Meta description is ${length} characters.` } : null;
    },
  },
  {
    id: "title-tag-long",
    title: "Title tag will be truncated in search results",
    severity: "low",
    category: "seo",
    why: "Titles over ~60–70 characters are cut off, usually losing the brand suffix or the key variant (size, colour).",
    fix: "Shorten the product name or drop the site-name suffix on long titles.",
    check(p) {
      const length = p.titleTag?.length ?? 0;
      return length > THRESHOLDS.titleTagMaxChars ? { message: `Title tag is ${length} characters.`, evidence: p.titleTag } : null;
    },
  },
  {
    id: "slug-dedupe-suffix",
    title: "URL ends in a duplicate-slug counter",
    severity: "low",
    category: "seo",
    why: "“…-printer-bw-2” is what an importer produces when a slug is already taken: it appends a counter. That usually means the product was imported twice (a duplicate to merge) or the slug came from a truncated name. Either way the URL looks machine-made in search results and shared links.",
    fix: "Build slugs from brand + full name + a distinguishing attribute (colour, capacity), and de-duplicate products before import rather than URLs after.",
    check(p) {
      const suffix = p.slug.match(/-(\d{1,3})$/)?.[1];
      if (!suffix) return null;
      // "airpods-pro-2" is fine when the name says "AirPods Pro 2". Slugs drop decimal
      // points, so 6.7" becomes "-67": strip them from the name before comparing.
      const nameDigits = name(p).replace(/(\d)[.,](?=\d)/g, "$1");
      if (new RegExp(`(^|[^0-9])${suffix}([^0-9]|$)`).test(nameDigits)) return null;
      return { message: `URL ends in “-${suffix}”, which does not appear in the product name.`, evidence: p.slug };
    },
  },
  {
    id: "image-alt-missing",
    title: "Gallery images without alt text",
    severity: "low",
    category: "seo",
    why: "Alt text is an accessibility requirement and how product images rank in Google Images.",
    fix: "Default the alt text to the product name plus the image's angle.",
    check: (p) => (p.imagesMissingAlt > 0 ? { message: `${p.imagesMissingAlt} gallery image(s) have no alt text.` } : null),
  },
];

export const RULES_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));
