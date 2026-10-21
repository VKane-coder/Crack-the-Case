import { describe, expect, it } from "vitest";
import { filtersToQuery, parseFilters, toPrefixTsquery } from "./filters";

describe("parseFilters", () => {
  it("reads valid filters from a query string", () => {
    const f = parseFilters(new URLSearchParams("q=chest+pain&specialty=emergency&difficulty=3&length=standard&page=2"));
    expect(f).toEqual({ q: "chest pain", specialty: "emergency", difficulty: 3, length: "standard", page: 2 });
  });

  it("drops malformed values instead of failing", () => {
    const f = parseFilters({ specialty: "Emergency; drop", difficulty: "9", length: "huge", page: "-1", q: "  " });
    expect(f).toEqual({ q: undefined, specialty: undefined, difficulty: undefined, length: undefined, page: 1 });
  });

  it("takes the first value of a repeated param", () => {
    expect(parseFilters({ difficulty: ["2", "4"] }).difficulty).toBe(2);
  });

  it("ignores a search with no letters or digits", () => {
    expect(parseFilters({ q: "&|!:*" }).q).toBeUndefined();
  });
});

describe("filtersToQuery", () => {
  it("round-trips through parseFilters", () => {
    const f = { q: "renal", specialty: "general-practice", difficulty: 2, length: "long" as const, page: 3 };
    expect(parseFilters(new URLSearchParams(filtersToQuery(f)))).toEqual(f);
  });

  it("leaves out page 1 and empty filters", () => {
    expect(filtersToQuery({ page: 1 })).toBe("");
  });
});

describe("toPrefixTsquery", () => {
  it("prefix-matches every word and strips tsquery operators", () => {
    expect(toPrefixTsquery("Palp & chest:* | !pain")).toBe("palp:* & chest:* & pain:*");
  });
});
