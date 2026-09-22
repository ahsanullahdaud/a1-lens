/**
 * GS1 check-digit validation for GTIN-8/12/13/14.
 * Google Merchant Center disapproves offers whose GTIN fails this check.
 */
export function isValidGtin(raw: string): boolean {
  const digits = raw.replace(/\s|-/g, "");
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(digits)) return false;

  const body = digits.slice(0, -1);
  let sum = 0;
  // Walking right-to-left, weights alternate 3, 1, 3, 1…
  for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}
