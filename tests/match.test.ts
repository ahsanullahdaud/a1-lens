import { describe, expect, it } from "vitest";
import { assessMatch } from "../src/lib/pricing/match";

describe("assessMatch", () => {
  it("accepts the same variant and calls out a different colour", () => {
    expect(assessMatch("JBL Flip 7 Bluetooth Speaker White", "JBL Flip 7 Portable Speaker - White")).toEqual({ match: "exact" });
    expect(assessMatch("JBL Flip 7 Bluetooth Speaker White", "JBL Flip 7 Portable Speaker - Black")).toMatchObject({ match: "near", note: "colour: listing says black, A1 says white" });
  });

  it("treats a different capacity or a bundle as a near-match", () => {
    expect(assessMatch("Samsung Galaxy S25 Ultra 256GB Titanium Black", "Samsung Galaxy S25 Ultra 512GB Titanium Black")).toMatchObject({ match: "near", note: "capacity: listing says 512gb, A1 says 256gb" });
    expect(assessMatch("Sony PlayStation 5 Pro 2TB Digital Edition Console", "Sony PS5 Pro 2TB Console + EA FC 26 bundle")).toMatchObject({ match: "near", note: "listing is a bundle; A1 sells the bare product" });
  });

  it("is uncertain when the listing names no colour but A1 does", () => {
    expect(assessMatch("Apple AirPods Pro 3 White", "Apple AirPods Pro 3 with MagSafe Charging Case")).toMatchObject({ match: "uncertain" });
  });

  it("does not confuse multi-word colours with their parts", () => {
    expect(assessMatch("Garmin Forerunner 265 46mm Black", "Garmin Forerunner 265 46mm Black/Powder Grey")).toEqual({ match: "exact" });
  });
});
