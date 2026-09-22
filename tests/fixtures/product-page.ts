/**
 * A hand-written page that mirrors the structure of a real A1 product page
 * (same data-testid hooks, same JSON-LD shape) without copying its content.
 * `overrides` lets each test break exactly one thing.
 */
type Overrides = {
  jsonLd?: Record<string, unknown> | null;
  visiblePrice?: string;
  conditionChip?: string;
  conditionNotes?: string | null;
  description?: string;
  specs?: [string, string][];
  metaDescription?: string | null;
  canonical?: string | null;
  extraH1?: boolean;
  thumbs?: number;
  /** Render the sold-out layout: no condition-price hook, a back-in-stock form instead of Add to Cart. */
  outOfStock?: boolean;
  /** [tab id, tab text, selected] e.g. ["grade-a", "Refurbished – Excellent£295.99", true] */
  conditionTabs?: [string, string, boolean][];
};

export const FIXTURE_URL = "https://a1techdeals.com/product/acme-soundbar-300";

export const baseJsonLd = {
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Acme Soundbar 300 with Wireless Subwoofer",
  image: ["https://cdn.example/1.jpg", "https://cdn.example/2.jpg", "https://cdn.example/3.jpg"],
  url: FIXTURE_URL,
  sku: "A1T-TEST000001",
  brand: { "@type": "Brand", name: "Acme" },
  gtin13: "4006381333931",
  description: "x".repeat(400),
  offers: {
    "@type": "Offer",
    priceCurrency: "GBP",
    price: "199.99",
    priceValidUntil: "2099-01-01",
    availability: "https://schema.org/InStock",
    itemCondition: "https://schema.org/NewCondition",
  },
};

export function productPage(o: Overrides = {}): string {
  const jsonLd = o.jsonLd === null ? "" : `<script type="application/ld+json" data-testid="product-jsonld">${JSON.stringify(o.jsonLd ?? baseJsonLd)}</script>`;
  const specs = o.specs ?? [
    ["Brand", "Acme"],
    ["Channels", "3.1"],
    ["Power Output", "300 W"],
    ["Connectivity", "HDMI eARC, Bluetooth 5.3"],
    ["Plug Type", "UK 3-pin plug"],
    ["In the box", "Soundbar, subwoofer, remote, HDMI cable"],
  ];
  const meta = o.metaDescription === null ? "" : `<meta name="description" content="${o.metaDescription ?? "Acme Soundbar 300 with free UK delivery and a 12-month warranty."}">`;
  const canonical = o.canonical === null ? "" : `<link rel="canonical" href="${o.canonical ?? FIXTURE_URL}">`;
  const notes = o.conditionNotes ? `<div data-testid="condition-details-panel"><p data-testid="condition-details-notes">${o.conditionNotes}</p></div>` : "";
  const thumbs = Array.from({ length: o.thumbs ?? 3 }, (_, i) => `<button data-testid="image-gallery-thumb"><img src="/t${i}.jpg" alt="Acme Soundbar 300 view ${i + 1}"></button>`).join("");

  return `<!doctype html><html><head>
<title>Acme Soundbar 300 | A1 Tech Deals</title>
${meta}${canonical}
<meta property="og:image" content="https://cdn.example/1.jpg">
${jsonLd}
</head><body>
<nav data-testid="breadcrumb-trail"><a>Home</a><a>Audio</a><a>Soundbars</a><span>Acme Soundbar 300</span></nav>
<div data-testid="image-gallery"><img src="/1.jpg" alt="Acme Soundbar 300 front">${thumbs}</div>
<a data-testid="pdp-brand-link" href="/brand/acme">ACME</a>
<h1>Acme Soundbar 300 with Wireless Subwoofer</h1>${o.extraH1 ? "<h1>Second heading</h1>" : ""}
<div data-testid="pdp-price-block">
  ${o.outOfStock ? `<span>${o.visiblePrice ?? "£199.99"}</span>` : `<span data-testid="condition-price">${o.visiblePrice ?? "£199.99"}</span><span class="line-through">£249.99</span>`}
</div>
${o.outOfStock ? `<form data-testid="back-in-stock-form"><input data-testid="back-in-stock-email"></form>` : ""}
<div data-testid="condition-selector">${(o.conditionTabs ?? []).map(([id, text, selected]) => `<button role="radio" aria-checked="${selected}" data-testid="condition-tab-${id}">${text}</button>`).join("")}</div>
<span data-testid="sticky-atc-condition-chip">${o.conditionChip ?? "Brand New"}</span>
${notes}
<p data-testid="pdp-category-trail">Category: Audio &gt; Soundbars</p>
<div data-testid="pdp-description">${o.description ?? "y".repeat(400)}</div>
<dl data-testid="pdp-specs">${specs.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
<section data-testid="trustpilot-reviews"><p>It came with a European plug and adapter.</p></section>
</body></html>`;
}
