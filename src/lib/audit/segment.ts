import type { ParsedProduct } from "../crawler/parse-product";

/**
 * Catalogue segments: groups of listings that share one root cause, so the
 * dashboard can say "one import needs enriching" instead of "600 listings
 * each have three problems". Classified at audit time and stored on
 * `products.segment`; re-run `npm run audit` after changing anything here.
 */
export type Segment = "thin-feed" | "no-copy" | "standard";

export type SegmentInfo = { id: Segment; label: string; description: string };

export const SEGMENTS: SegmentInfo[] = [
  {
    id: "thin-feed",
    label: "Thin feed import",
    description:
      "A placeholder spec table (brand and EAN only), a description under 100 characters and a single image — the signature of a distributor feed imported without enrichment.",
  },
  {
    id: "no-copy",
    label: "Images, no copy",
    description: "Product images are present but there is no description and no specification table at all.",
  },
  { id: "standard", label: "Standard", description: "Listings that show none of the import signatures above." },
];

export const SEGMENT_BY_ID = new Map(SEGMENTS.map((s) => [s.id, s]));

/** Spec labels a feed fills in by default; a table made only of these carries no product information. */
const GENERIC_SPEC = /^(brand|ean|gtin|upc|mpn|sku|model|product code)$/i;

export function segmentSignals(p: ParsedProduct) {
  const specs = p.specs ?? [];
  const descriptionLength = (p.description ?? p.jsonLd?.description ?? "").length;
  const images = Math.max(p.galleryImageCount ?? 0, p.jsonLd?.images.length ?? 0);
  return {
    genericSpecsOnly: specs.length <= 2 && specs.every((s) => GENERIC_SPEC.test(s.label)),
    shortDescription: descriptionLength < 100,
    singleImage: images <= 1,
    noSpecs: specs.length === 0,
    noDescription: descriptionLength === 0,
  };
}

export function classifySegment(p: ParsedProduct): Segment {
  const s = segmentSignals(p);
  if (s.genericSpecsOnly && s.shortDescription && s.singleImage) return "thin-feed";
  if (s.noSpecs && s.noDescription) return "no-copy";
  return "standard";
}
