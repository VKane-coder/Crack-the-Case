import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadCaseLibrary } from "./library";
import { findLeaks, leakTerms, toPatientView } from "./projector";

const library = loadCaseLibrary(path.resolve(__dirname, "../../../content"));

describe("case library", () => {
  it("compiles every case file", () => {
    expect(library.length).toBeGreaterThanOrEqual(3);
  });

  it.each(library.map((c) => [c.content.meta.slug, c] as const))("%s: patient view is allow-listed", (_slug, c) => {
    const view = c.patientView as Record<string, unknown>;
    expect(view).not.toHaveProperty("clinical");
    expect(JSON.stringify(view)).not.toContain("is_red_flag");
    expect(findLeaks(c.patientView, leakTerms(c.content))).toEqual([]);
  });

  it.each(library.map((c) => [c.content.meta.slug, c] as const))("%s: rubric covers every weighted domain", (_slug, c) => {
    for (const [domain, weight] of Object.entries(c.rubric.domain_weights)) {
      if (weight > 0) expect(c.rubric.items.some((i) => i.domain === domain)).toBe(true);
    }
  });

  it("case items override template items by key", () => {
    const chest = library.find((c) => c.content.meta.slug === "ed-chest-pain-arvo")!;
    const ice = chest.rubric.items.filter((i) => i.key === "ice_explored");
    expect(ice).toHaveLength(1);
    expect(ice[0].linked_fact_ids).toContain("ice_idea");
  });

  it("hashes are stable", () => {
    const again = loadCaseLibrary(path.resolve(__dirname, "../../../content"));
    expect(again.map((c) => c.contentHash + c.rubricHash)).toEqual(library.map((c) => c.contentHash + c.rubricHash));
  });
});

describe("leak detection", () => {
  it("flags diagnosis terms that slip into the patient view", () => {
    const c = structuredClone(library[0].content);
    c.patient.behaviour_rules.push(`Mentions that the doctor said it might be ${c.clinical.diagnosis_synonyms[0]}`);
    expect(findLeaks(toPatientView(c), leakTerms(c))).toContain(c.clinical.diagnosis_synonyms[0].toLowerCase());
  });

  it("matches whole words only", () => {
    const c = structuredClone(library[0].content);
    c.clinical.diagnosis_synonyms = ["ACS"];
    c.patient.behaviour_rules = ["Talks about his backstory"];
    expect(findLeaks(toPatientView(c), leakTerms(c))).toEqual([]);
  });
});
