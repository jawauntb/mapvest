import { describe, expect, test } from "bun:test";
import { placeFromNominatim } from "../src/lib/local-brief-generator.js";

describe("placeFromNominatim", () => {
  test("prefers Astoria over New York", () => {
    const place = placeFromNominatim({
      neighbourhood: "Astoria",
      suburb: "Queens",
      city: "New York",
      state: "New York",
      postcode: "11102",
    });
    expect(place.neighborhood).toBe("Astoria");
    expect(place.city).toBe("New York");
    expect(place.state).toBe("New York");
    expect(place.zip).toBe("11102");
  });

  test("uses suburb when neighbourhood is missing", () => {
    const place = placeFromNominatim({
      suburb: "Astoria",
      city: "New York",
      state: "New York",
    });
    expect(place.neighborhood).toBe("Astoria");
    expect(place.city).toBe("New York");
  });
});
