/**
 * Examiner calibration eval (M4 exit criterion, docs/architecture.md §16): scripted good and poor
 * performances on the GP case are marked by the real assessor and scored by the server's own
 * scoring. A good station must score ≥ 75 and a poor one ≤ 50.
 *
 *   npm run eval:examiner           # needs ANTHROPIC_API_KEY; one Opus call per fixture
 */
import path from "node:path";
import type { ExaminerInput, Transcripts } from "../src/server/agents/examiner/context";
import { claudeExaminerLlm } from "../src/server/agents/examiner/claude-llm";
import { scoreAssessment } from "../src/server/assessment/scoring";
import { loadCaseLibrary } from "../src/server/cases/library";

type Fixture = { name: string; band: [number, number]; disclosed: string[]; transcripts: Transcripts };

const s = (content: string) => ({ role: "student" as const, content });
const p = (content: string) => ({ role: "patient" as const, content });

const FIXTURES: Fixture[] = [
  {
    name: "good",
    band: [75, 100],
    disclosed: [
      "looser_frequent",
      "duration_3_months",
      "rectal_bleeding_mixed",
      "crampy_lif",
      "weight_loss",
      "fatigue",
      "no_nocturnal_mucus",
      "no_fever_travel",
      "pmh_hypothyroid",
      "dh_thyroxine",
      "dh_no_nsaids",
      "allergy_nkda",
      "screening_not_done",
      "fh_brother_polyps",
      "sh_alcohol_smoking",
      "ice_idea_piles",
      "ice_concern",
      "ice_expectation",
    ],
    transcripts: {
      history: [
        p("Oh, it's probably nothing really. My tummy's just been a bit... unsettled. Ron made me come."),
        s(
          "Hi, I'm Alex, one of the GP registrars. Can I check your full name and date of birth? Thanks, Margaret. What's been going on with your tummy?",
        ),
        p("My motions have been looser and I'm going three or four times a day. I used to be like clockwork, once a day."),
        s("How long has that been happening?"),
        p("It's been about three months now, maybe a bit more."),
        s("I ask everyone these questions, so please don't be embarrassed. Have you noticed any blood when you open your bowels?"),
        p("Well... sometimes there's blood. Darkish red, sort of mixed in, not just on the paper."),
        s("Thank you for telling me, I know that's not easy. Any pain in your tummy?"),
        p("I get a crampy ache down on the left side sometimes."),
        s("Any weight loss without trying, or feeling more tired than usual?"),
        p("My slacks are looser. I've lost about four kilos without trying. And I'm tired all the time."),
        s("Do you get up at night to open your bowels, or notice mucus? Any fevers, recent travel or antibiotics?"),
        p(
          "No, I don't have to get up at night for it, and I haven't noticed any mucus. No fevers, no trips overseas, and I haven't had any antibiotics.",
        ),
        s("Any medical conditions, medicines or allergies?"),
        p("I have an underactive thyroid. I take thyroxine, 100 micrograms. Just Panadol now and then. No allergies that I know of."),
        s("Has anyone in your family had bowel problems? And have you done the bowel screening test that comes in the mail?"),
        p("My brother had some polyps taken out of his bowel a few years ago. I got one of those kits but I threw it out."),
        s("What have you been thinking it might be, and is there anything worrying you?"),
        p("I thought it might just be piles. Ron's mum died of something in her bowel. I was hoping you could give me a cream."),
        s(
          "Thank you. So, three months of looser, more frequent motions with blood mixed in, weight loss and tiredness. Have I got that right? I'd like to examine you and arrange some tests, which I'll explain.",
        ),
      ],
      presentation: [
        "Margaret is a 64-year-old woman with three months of change in bowel habit: looser, three to four times a day, with dark blood mixed in, left-sided crampy pain, four kilos of unintentional weight loss and fatigue.",
        "No nocturnal symptoms, mucus, fever, travel or antibiotics. She has hypothyroidism on a stable thyroxine dose, her brother had colonic polyps, and she discarded her screening kit. She thought it was piles and is quietly worried about cancer.",
        "My leading concern is colorectal cancer. Differentials include inflammatory bowel disease, diverticular disease, haemorrhoids, thyroid over-replacement and coeliac disease.",
        "I'd examine her abdomen and do a rectal exam, check FBC and iron studies, UEC, LFT, CRP, TFTs and coeliac serology, and refer her urgently for colonoscopy rather than a screening kit. I'd explain the reason honestly, book follow-up and safety-net for heavy bleeding or severe pain.",
      ],
      qa: [
        {
          question: "She asks whether she can just do the bowel screening kit instead. What would you tell her?",
          answer:
            "That the kit is for people without symptoms. Because she has bleeding and weight loss she needs a colonoscopy, which looks directly at the bowel.",
        },
        {
          question: "Which features in her history worry you the most, and why?",
          answer:
            "Her age over fifty, change in bowel habit for more than six weeks, blood mixed with stool, unintentional weight loss and fatigue suggesting iron deficiency.",
        },
      ],
    },
  },
  {
    name: "poor",
    band: [0, 50],
    disclosed: ["looser_frequent", "pmh_hypothyroid"],
    transcripts: {
      history: [
        p("Oh, it's probably nothing really. My tummy's just been a bit... unsettled. Ron made me come."),
        s("What's wrong with your bowels?"),
        p("My motions have been looser and I'm going three or four times a day."),
        s("Any medical problems?"),
        p("I have an underactive thyroid."),
        s("OK, it's probably piles or your thyroid."),
      ],
      presentation: ["Margaret has loose stools. It's probably haemorrhoids or her thyroid. I'd give her a cream and check her thyroid."],
      qa: [{ question: "Which features in her history worry you the most, and why?", answer: "Not much really, it seems benign." }],
    },
  },
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("ANTHROPIC_API_KEY is not set; skipping the examiner calibration eval.");
    return;
  }
  const gp = loadCaseLibrary(path.resolve(__dirname, "../content")).find((c) => c.content.meta.slug === "gp-change-in-bowel-habit")!;
  const rubric = {
    items: gp.rubric.items.map((i) => ({ ...i, linked_fact_ids: i.linked_fact_ids ?? [], is_critical: i.is_critical ?? false })),
    question_bank: gp.rubric.examiner_question_bank,
    global_rating_descriptors: gp.rubric.global_rating_descriptors,
    domain_weights: gp.rubric.domain_weights,
    pass_mark: gp.rubric.pass_mark,
  };

  let failed = 0;
  for (const f of FIXTURES) {
    const input: ExaminerInput = { content: gp.content, rubric, disclosedFactIds: f.disclosed, transcripts: f.transcripts };
    const { output, call } = await claudeExaminerLlm.assess(input, AbortSignal.timeout(300_000));
    const scored = scoreAssessment(rubric, output.items, f.disclosed);
    const ok = scored.overallPct >= f.band[0] && scored.overallPct <= f.band[1];
    if (!ok) failed++;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${f.name.padEnd(5)} ${scored.overallPct.toFixed(1)}% (expected ${f.band[0]}–${f.band[1]}) · ${output.global_rating} · passed=${scored.passed} · ${call.model} ${(call.latencyMs / 1000).toFixed(1)}s`,
    );
  }
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
