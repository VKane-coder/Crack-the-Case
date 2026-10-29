# Writing cases in Supabase

Cases are written in the Supabase **`Patients`** table, one row per case, then imported into the app with
`npm run cases:import` (a dry run that reports what's ready and what's missing) and
`npm run cases:import -- --apply` (publishes the ready ones). A case is never published with gaps.
Editing a published case and importing again creates a new version; students' past results keep the
version they were marked against.

## Columns

| Column                    | What goes in it                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `title`                   | The case name students see, e.g. `Renal Case`. Also used for the case's web address, so keep it stable.                                                            |
| `patient.name`            | The person the student talks to (for a child, the parent who's speaking).                                                                                          |
| `patient.profile`         | The patient's script: question/answer pairs, grouped however you like. See below.                                                                                  |
| `Voice ID`                | The ElevenLabs voice id for this patient.                                                                                                                          |
| `Pre Reading Material`    | The scenario shown during reading time. Must include the patient's age and sex (e.g. "a 63-year-old man").                                                         |
| `Assessment Instructions` | The tasks, e.g. `"You will have 8 minutes to perform the following:\n 1. Take a history ... (5 minutes).\n 2. ..."`. The total (8 minutes) sets the station clock. |
| `Marking Rubric`          | The mark scheme. See below.                                                                                                                                        |
| `Avatar`                  | The patient's picture: a file name in the `OSCE-ASSETS` storage bucket.                                                                                            |

## The patient's script (`patient.profile`)

Any grouping works, as long as each piece of information is a question/answer pair:

```json
{
  "opening_statement": { "question": "What's brought you in today?", "answer": "My pee has been red for a while now." },
  "allergies": [{ "question": "Do you have any allergies?", "answer": "No" }],
  "medications": [{ "question": "What medications do you take?", "answer": ["Pantoprazole", "Ramipril"] }]
}
```

- An `opening_statement` pair is required: it's the patient's first line.
- Group names guide how the patient treats each answer: things under `history_of_presenting_complaint` come out
  with open questions, everything else when asked directly.
- **Never name the diagnosis in the patient's answers.** The import refuses a case whose patient could give it away.

## The mark scheme (`Marking Rubric`)

- `task_1` (or no task wrapper) is the patient stage. Each section with `marks` (or `mark_allocation`) becomes one
  marked item. Put the questions you expect inside it, and any level descriptors in `marking_scheme` or
  `marking_criteria` (e.g. `"2_marks": "Asked about X and Y"`). Sections with 0 marks aren't marked.
  The patient only knows what's in `patient.profile`: question/answer pairs inside the rubric are a guide for
  you, not the patient's script, so put every answer the patient should give in `patient.profile` too.
- Keep one question per task (`task_2`, `task_3`, …) when the order matters. Within a task, the database stores
  sections sorted by the length of their names, so `management` would come before `top_differentials`.
- `task_2`, `task_3`, … are the **examiner stage**. Each section with marks becomes one question the examiner asks
  after the student presents, in order:

```json
"task_2": {
  "top_differentials": {
    "marks": 3,
    "answers": [
      { "diagnosis": "Bladder cancer", "rationale": ["Painless macroscopic haematuria", "Smoker"] },
      { "diagnosis": "Renal cell carcinoma", "rationale": ["Less likely without flank pain"] }
    ]
  }
},
"task_3": {
  "ecg_interpretation": {
    "marks": 2,
    "question": "Here is her ECG. What does it show?",
    "image": "palpitations/ecg.png",
    "image_alt": "12-lead ECG",
    "answer": ["Narrow-complex regular tachycardia at about 180 bpm", "No visible P waves"]
  }
}
```

- `question` sets the examiner's exact words. Without it, the app words it from the section name
  (differentials, provisional diagnosis, investigations, management).
- `image` is a file in the private **`case-media`** storage bucket. Students only see it when that question is asked.
- The answers are the model answer the examiner marks against.

**Diagnosis:** add `"diagnosis": "Supraventricular tachycardia"` at the top of the rubric (or inside
`marking_rubric`). Without one, the first differential in a `top_differentials` section is used.

## What the station does with it

Reading time (2 minutes) shows the scenario and the numbered tasks. Then one clock (the total from the
instructions, 8 minutes by default) runs across the patient and examiner stages; the per-task minutes are guidance
for the student. When the clock runs out, the station goes straight to marking, and the stages the student didn't
reach earn no marks.

Difficulty (3 of 5), specialty (from the title and scenario) and the patient's manner (cooperative) are defaulted
for now; the import report lists every default it used.
