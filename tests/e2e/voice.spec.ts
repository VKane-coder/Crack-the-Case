import { expect, test, type Page } from "@playwright/test";
import { createOnboardedUser, deleteTestUsers } from "./helpers";

// Runs with VOICE_PROVIDERS=fake: the "speech recogniser" returns window.__fakeSttTranscript and the
// "voice" is silent WAV, so this covers the push-to-talk flow and the audio stream, not the vendors.

// Per test, not per file: the user list in helpers.ts is shared by every spec in the worker.
test.afterEach(deleteTestUsers);

type TestWindow = { __fakeSttTranscript: string; __turnBodies: string[] };

// Copies every patient-turn response body inside the page (reading streamed bodies back through
// the devtools protocol is unreliable under mobile emulation).
const teeTurns = () => {
  const w = window as unknown as TestWindow;
  w.__turnBodies = [];
  const original = window.fetch;
  window.fetch = async (...args) => {
    const res = await original(...args);
    if (String(args[0]).endsWith("/patient-turn")) void res.clone().text().then((t) => w.__turnBodies.push(t));
    return res;
  };
};

async function say(page: Page, text: string, how: "button" | "space") {
  const before = await page.evaluate(() => (window as unknown as TestWindow).__turnBodies.length);
  await page.evaluate((t) => ((window as unknown as TestWindow).__fakeSttTranscript = t), text);
  if (how === "button") {
    await page.getByRole("button", { name: /Hold to talk/ }).hover();
    await page.mouse.down();
    await expect(page.getByRole("button", { name: /Listening/ })).toBeVisible();
    await page.mouse.up();
  } else {
    await page.locator("body").click({ position: { x: 5, y: 5 } }); // focus off the textarea
    await page.keyboard.down("Space");
    await expect(page.getByRole("button", { name: /Listening/ })).toBeVisible();
    await page.keyboard.up("Space");
  }
  await page.waitForFunction((n) => (window as unknown as TestWindow).__turnBodies.length > n, before);
  return page.evaluate(() => (window as unknown as TestWindow).__turnBodies.at(-1)!);
}

test("push-to-talk sends speech to the patient and the reply comes back with audio", async ({ page }) => {
  const user = await createOnboardedUser();
  await page.addInitScript(teeTurns);
  await page.goto(`/auth/confirm?token_hash=${user.tokenHash}&type=email&next=/hub`);
  await page.getByRole("button", { name: "Start case" }).click();
  await expect(page.getByText("Hold the talk button")).toBeVisible();
  await page.getByRole("button", { name: /I'm ready/ }).click();
  const log = page.getByRole("log", { name: "Consultation" });
  await expect(log).toContainText("it's probably nothing really");

  const first = await say(page, "How many months has it been?", "button");
  await expect(log).toContainText("How many months has it been?");
  await expect(log).toContainText("It's been about three months now");
  expect(first).toContain('"type":"audio"');
  expect(first).toContain('"mime":"audio/wav"');

  const second = await say(page, "Do you have any allergies that you know of?", "space");
  await expect(log).toContainText("No allergies that I know of");
  expect(second).toContain('"type":"audio"');

  // Patient voice off: text only.
  await page.getByRole("button", { name: /Patient voice on/ }).click();
  await expect(page.getByRole("button", { name: /Patient voice off/ })).toBeVisible();
  await page.getByText("listening").waitFor();
  const third = await say(page, "Do you take any medicines, like thyroxine?", "button");
  expect(third).not.toContain('"type":"audio"');

  // Voice tokens are only issued while the history is running.
  const id = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "End history and move on" }).click();
  await expect(page.getByText("History complete")).toBeVisible();
  const token = await page.request.post("/api/voice/deepgram-token", { data: { consultationId: id } });
  expect(token.status()).toBe(409);
});
