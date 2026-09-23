import type { MatchQuality } from "./types";

/**
 * Is a competitor listing the *same variant* as A1's, or merely the same model?
 * A GTIN match should already guarantee the variant, but sellers mis-list, so
 * the title is checked for the attributes shoppers actually care about:
 * colour, capacity and whether it's a bundle.
 */

const COLOUR =
  /\b(black|white|blue|red|green|pink|purple|grey|gray|silver|gold|yellow|orange|navy|midnight|graphite|titanium|starlight|lavender|lilac|mint|olive|sand|sandstone|squad|camo|teal|indigo|cream|beige|bronze|rose|coral|violet|jet ?black|space ?gr[ae]y|whitestone|aqua|powder ?grey)\b/gi;

const CAPACITY = /\b(\d+(?:\.\d+)?)\s?(gb|tb)\b/gi;

/** Words that mean the listing carries more than the bare product. */
const BUNDLE = /\b(bundle|bundled|combo pack|\+ ?(game|controller|headset|case|charger|gift card|voucher)|with (game|controller|headset|case|charger|gift card|voucher)|\d+[- ]pack|pack of \d+|twin pack|x ?\d+ units)\b/i;

const words = (text: string, re: RegExp) => new Set((text.match(re) ?? []).map((w) => w.toLowerCase().replace(/\s+/g, " ")));

export function assessMatch(a1Name: string, listingTitle: string): { match: MatchQuality; note?: string } {
  const a1Colours = words(a1Name, COLOUR);
  const listingColours = words(listingTitle, COLOUR);
  if (a1Colours.size && listingColours.size && ![...a1Colours].some((c) => listingColours.has(c))) {
    return { match: "near", note: `colour: listing says ${[...listingColours].join("/")}, A1 says ${[...a1Colours].join("/")}` };
  }

  const a1Capacity = words(a1Name, CAPACITY);
  const listingCapacity = words(listingTitle, CAPACITY);
  if (a1Capacity.size && listingCapacity.size && ![...a1Capacity].some((c) => listingCapacity.has(c))) {
    return { match: "near", note: `capacity: listing says ${[...listingCapacity].join("/")}, A1 says ${[...a1Capacity].join("/")}` };
  }

  if (BUNDLE.test(listingTitle) && !BUNDLE.test(a1Name)) {
    return { match: "near", note: "listing is a bundle; A1 sells the bare product" };
  }

  // Nothing contradicts, but a listing that names no colour when A1 does can't be confirmed either.
  if (a1Colours.size && !listingColours.size) return { match: "uncertain", note: "listing title does not state a colour" };
  return { match: "exact" };
}
