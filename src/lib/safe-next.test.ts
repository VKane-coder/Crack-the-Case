import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it.each([
    ["/hub", "/hub"],
    ["/cases?specialty=emergency", "/cases?specialty=emergency"],
    ["/results/abc#report", "/results/abc#report"],
  ])("keeps %s", (input, expected) => expect(safeNext(input)).toBe(expected));

  it.each([
    [null],
    [""],
    ["hub"],
    ["https://evil.com"],
    ["//evil.com"],
    ["/\\evil.com"],
    ["/\t/evil.com"],
    ["javascript:alert(1)"],
  ])("rejects %j", (input) => expect(safeNext(input)).toBe("/hub"));

  it("uses the fallback given", () => expect(safeNext(undefined, "/onboarding")).toBe("/onboarding"));
});
