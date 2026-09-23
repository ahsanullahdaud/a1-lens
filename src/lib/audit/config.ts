/**
 * Tunable thresholds and heuristics. These are judgement calls, not facts —
 * change them as you learn what the business actually cares about.
 */

export const SEVERITY_WEIGHT = { high: 15, medium: 7, low: 3 } as const;

export const THRESHOLDS = {
  descriptionMinChars: 300,
  specsMinRows: 5,
  imagesMin: 3,
  metaDescriptionMaxChars: 160,
  titleTagMaxChars: 70,
};

/** Product *names* that imply a mains plug ships in the box. */
export const MAINS_POWERED =
  /\b(chargers?|charging (dock|station|stand)|power adapter|hair ?dryer|airwrap|airstrait|supersonic|straighteners?|vacuum|purifier|heater|soundbar|monitor|television|tv|projector|printer|consoles?|desktop|imac|mac mini|mac studio|macbook|laptop|chromebook|air fryer|coffee machine|kettle|blender|toothbrush|shaver|trimmer|epilator|router|mesh wi-?fi)\b/i;

/** …unless the name is clearly an accessory *for* one of those. */
export const ACCESSORY =
  /\b(case|cover|cable|controller|headset|stand|mount|bag|sleeve|protector|skin|strap|filter|replacement|memory|keyboard|mouse|ssd|transceiver|for (the )?(ps5|playstation|xbox|nintendo|switch|iphone|ipad|macbook|samsung|dyson))\b/i;

/** Any of these in the name, description or specs counts as "plug type is stated". */
export const PLUG_STATED =
  /\b((uk|eu|european|us|3[- ]?pin|2[- ]?pin|type[- ]?[cg])[- ]?(mains )?(plug|adapt[eo]r|charger|power)|plug type|(uk|eu|us|international) (version|model|spec|stock|import))\b/i;

/** Any of these counts as "box contents are stated". */
export const BOX_CONTENTS_STATED =
  /\b(in the box|box contents?|what'?s (included|in the box)|package contents?|included accessories|accessories included|comes with|supplied with|includes?:)/i;

/** A name ending like this was cut off mid-phrase or left with dangling punctuation. ("x" and "a" are left out: "Xbox Series X".) */
export const NAME_DANGLING_END = /([,&–—-]|\b(that|with|and|for|of|the|to|in|from|or|by))$/i;

/** A space before a comma, or an opening bracket that never closes, is feed damage rather than a style choice. */
export const NAME_MALFORMED = /\s,|\([^)]*$/;

/** Watch lines sold as both a Bluetooth/Wi-Fi and an LTE model at different prices. (Ultras are LTE-only, so they are left out.) */
export const DUAL_CONNECTIVITY_WATCH = /\b(galaxy watch ?(\d|fe)|apple watch (series|se)|pixel watch)\b/i;
export const WATCH_ACCESSORY = /\b(bands?|straps?|case|protector|charger|stand|dock)\b/i;

/** The variant is "stated" only where a shopper looks: the name, or a spec row about the variant itself. */
export const CONNECTIVITY_IN_NAME = /\b(LTE|4G|5G|cellular|bluetooth|BT|wi-?fi|GPS)\b/i;
/** A row like "Cellular: No", "Network: LTE" or "Model: SM-L305 (LTE)" — not the generic feature list "Connectivity: Bluetooth, WiFi, NFC". */
export const CONNECTIVITY_SPEC_LABEL = /cellular|lte|4g|5g|\bsim\b|network|variant|version|model/i;
export const CONNECTIVITY_SPEC_VALUE = /(LTE|4G|5G|cellular|bluetooth|\bBT\b|wi-?fi|^(yes|no)$)/i;
/** An incidental mention elsewhere (box contents, description) — not enough, but worth pointing at. */
export const CONNECTIVITY_HINT = /\b(BT|LTE|4G|cellular)\b/;

/** Grade words that may appear in a URL slug, most specific first. */
export const CONDITION_WORDS = ["pristine", "excellent", "very-good", "good", "fair", "grade-a", "grade-b", "grade-c"];
