import { describe, expect, it } from "vitest";
import { convertAuthorCase, type AuthorRow } from "./author-import";

const SPECIALTIES = new Set(["general-practice", "emergency", "paediatrics"]);

const qa = (question: string, answer: unknown) => ({ question, answer });

// Shaped like the author's cases: Q/A lists for the patient, marked sections per task.
const row: AuthorRow = {
  id: 1,
  title: "Haematuria in a smoker",
  "patient.name": "Mark Whitney",
  "patient.profile": JSON.stringify({
    opening_statement: qa("What's brought you in today?", "My pee has been red for a while now."),
    allergies: [qa("Do you have any allergies?", "No")],
    medications: [qa("What medications do you take?", ["Pantoprazole", "Ramipril"])],
    social_history: [qa("Do you smoke?", "Yes, 15 a day for 35 years."), qa("Do you smoke?", "Yes, 15 a day for 35 years.")],
    history_of_presenting_complaint: { time_course: [qa("When did it start?", "Three months ago.")] },
    introduction_identifying_details: { occupation: qa("What is your occupation?", "Retired factory worker") },
  }),
  "Voice ID": "twLPF55UcxNYRmxaWLAn",
  "Pre Reading Material": JSON.stringify({ prereading: "You are a General Practitioner. Mark Whitney is a 63-year-old male who presents with blood in his urine." }),
  "Assessment Instructions": JSON.stringify({
    tasks: ["Take a history from Mark. (5 minutes)", "Answer two questions. (3 minutes)"],
    assessment_task: "You will have 8 minutes to perform the following:",
  }),
  "Marking Rubric": JSON.stringify({
    task_1: {
      patient_details: {
        allergies: { marks: 0.5, ...qa("Do you have any allergies?", "No") },
        social_history: { marks: 2, questions: [qa("Do you smoke?", "Yes")] },
        opening_statement: { marks: 0, ...qa("What's brought you in today?", "Red pee") },
        associated: { mark_allocation: 4, marking_scheme: { "1_mark": "Asked about one system.", "4_marks": "Asked about three systems." } },
      },
    },
    task_2: {
      top_differentials: {
        marks: 3,
        answers: [
          { diagnosis: "Bladder cancer", rationale: ["Painless haematuria", "Smoker"] },
          { diagnosis: "Cystitis", rationale: ["No irritative symptoms"] },
        ],
      },
    },
    task_3: { ecg: { marks: 1, question: "Interpret this urine microscopy.", image: "renal/microscopy.png", answer: "Red cells, no casts" } },
  }),
  Avatar: "Mark Whitney.png",
};

describe("author case import", () => {
  const c = convertAuthorCase(row, SPECIALTIES);

  it("builds a valid, publishable case", () => {
    expect(c.gaps).toEqual([]);
    expect(c.content).not.toBeNull();
    expect(c.slug).toBe("haematuria-in-a-smoker");
    expect(c.specialty).toBe("general-practice");
    expect(c.voiceId).toBe("twLPF55UcxNYRmxaWLAn");
    expect(c.avatarPath).toBe("OSCE-ASSETS/Mark Whitney.png");
  });

  it("turns question/answer pairs into the patient's script, once each", () => {
    const p = c.content!.patient;
    expect(p).toMatchObject({ name: "Mark Whitney", age: 63, sex: "male", occupation: "Retired factory worker", opening_statement: "My pee has been red for a while now." });
    expect(p.facts.filter((f) => f.prompt === "Do you smoke?")).toHaveLength(1);
    expect(p.facts.find((f) => f.prompt === "What medications do you take?")).toMatchObject({ category: "DH", content: "Pantoprazole; Ramipril" });
    expect(p.facts.find((f) => f.prompt === "Do you have any allergies?")!.content).toBe("No.");
    expect(p.facts.find((f) => f.prompt === "When did it start?")!.disclosure).toBe("on_open_question");
  });

  it("reads tasks and the station length", () => {
    expect(c.content!.reading.tasks).toEqual(["Take a history from Mark. (5 minutes)", "Answer two questions. (3 minutes)"]);
    expect(c.content!.meta.station.station_seconds).toBe(480);
  });

  it("marks history sections and turns later tasks into examiner questions with model answers", () => {
    expect(c.rubricItems.map((i) => [i.key, i.domain, i.max_points])).toEqual([
      ["allergies", "history", 0.5],
      ["social_history", "history", 2],
      ["associated", "history", 4],
      ["top_differentials", "differentials", 3],
      ["ecg", "investigations", 1],
    ]);
    expect(c.rubricItems.find((i) => i.key === "associated")!.description).toContain("4 marks: Asked about three systems.");
    const [ddx, image] = c.content!.examiner_items;
    expect(ddx).toMatchObject({ key: "top_differentials", prompt: "What are your top 2 differential diagnoses, and why?" });
    expect(ddx.model_answer[0]).toBe("Bladder cancer (Painless haematuria; Smoker)");
    expect(image).toMatchObject({ prompt: "Interpret this urine microscopy.", media: { path: "renal/microscopy.png" }, model_answer: ["Answer: Red cells, no casts"] });
    expect(c.content!.clinical.diagnosis).toBe("Bladder cancer");
  });

  it("lists what's missing instead of guessing", () => {
    const bare = convertAuthorCase(
      {
        ...row,
        "Assessment Instructions": "You will have 8 minutes to perform the following:\n 1. Take a history (6 minutes).\n 2. Answer the examiner's questions (2 minutes).",
        "Marking Rubric": JSON.stringify({ marking_rubric: { allergies: { mark_allocation: 1, questions_and_answers: [qa("Allergies?", "No")] } } }),
      },
      SPECIALTIES,
    );
    expect(bare.content).toBeNull();
    expect(bare.gaps.join("\n")).toMatch(/Answer the examiner's questions/);
    expect(bare.gaps.join("\n")).toMatch(/No diagnosis/);
  });

  it("refuses a case whose patient would give away the diagnosis", () => {
    const leaky = convertAuthorCase(
      { ...row, "patient.profile": JSON.stringify({ ...JSON.parse(row["patient.profile"] as string), worry: [qa("What worries you?", "That it's bladder cancer.")] }) },
      SPECIALTIES,
    );
    expect(leaky.content).toBeNull();
    expect(leaky.gaps.join(" ")).toMatch(/mention the diagnosis/);
  });
});
