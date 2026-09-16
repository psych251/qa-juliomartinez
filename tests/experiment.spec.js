// End-to-end test: a robot participant runs the whole experiment.
//
// Two modes:
//   - Emulator mode (EMULATOR=1, set automatically by `npm test`): data must land in the
//     local Firestore emulator, the security rules must reject forbidden requests, and
//     client errors must be logged.
//   - Offline mode (plain `npx playwright test`): the experiment must still run to the end
//     and offer the JSON download fallback.
//
// If you change the timeline in experiment.js, update `runThroughExperiment` below so the
// robot still knows which buttons to press. That is a feature: the test documents the flow.

const { test, expect } = require("@playwright/test");

const EMULATOR = process.env.EMULATOR === "1" || !!process.env.FIRESTORE_EMULATOR_HOST;
const PROJECT = "demo-psych251";
const EXPERIMENT_ID = "framing-demo";
const FS = `http://localhost:8080/v1/projects/${PROJECT}/databases/(default)/documents`;

async function runThroughExperiment(page) {
  // 1. consent
  await page.getByRole("button", { name: "I agree to participate" }).click();
  // 2. instructions (two pages)
  await page.locator("#jspsych-instructions-next").click();
  await page.locator("#jspsych-instructions-next").click();
  // 3. demographics (SurveyJS)
  await page.locator('input[type="number"]').fill("34");
  await page.getByText("Woman", { exact: true }).click();
  // SurveyJS boolean switches render "Yes" twice once toggled; scope to the question.
  await page.locator('[data-name="native_english"]').getByText("Yes", { exact: true }).first().click();
  await page.locator('input[value="Continue"]').click();
  // 4. framing
  await page.getByRole("button", { name: "Program A" }).click();
  // 5. lexical decision: one instructions page, then 8 trials
  await page.locator("#jspsych-instructions-next").click();
  for (let i = 0; i < 8; i++) {
    const stim = page.locator(".stimulus");
    await stim.waitFor({ state: "visible" });
    const word = (await stim.textContent()).trim();
    const realWords = ["TABLE", "GARDEN", "PLANET", "SILVER"];
    await page.keyboard.press(realWords.includes(word) ? "f" : "j");
    await stim.waitFor({ state: "detached" });
  }
  // 6. feedback
  await page.locator('input[name="Q0"][value="4"]').check();
  await page.locator("#jspsych-survey-likert-next").click();
  await page.locator("textarea").fill("Robot participant says hi.");
  await page.locator("#jspsych-survey-text-next").click();
  // 7. debrief
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("All done")).toBeVisible({ timeout: 30000 });
}

async function fsGet(path) {
  // "Bearer owner" is the emulator's admin token: it bypasses security rules, like the Admin SDK.
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: "Bearer owner" } });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
}

// Unwrap Firestore REST "fields" encoding into plain JS.
function decode(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  return v;
}
function decodeFields(fields) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = decode(fields[k]);
  return out;
}

test.describe("experiment", () => {
  test("runs to the end and saves data", async ({ page }) => {
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    await page.goto(EMULATOR ? "/?emulator=1&PROLIFIC_PID=robot123&STUDY_ID=s1&SESSION_ID=sess1" : "/");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    const mode = await page.evaluate(() => window.__saver.mode);
    expect(mode).toBe(EMULATOR ? "emulator" : "offline");

    await runThroughExperiment(page);

    // No uncaught errors from the experiment itself.
    expect(consoleErrors, "uncaught page errors").toEqual([]);

    const uid = await page.evaluate(() => window.__saver.uid);
    const stats = await page.evaluate(() => window.__saver.stats);

    if (!EMULATOR) {
      // Offline: banner + download fallback, nothing else to check.
      await expect(page.locator("#data-saver-banner")).toHaveAttribute("data-kind", "offline");
      await expect(page.locator("#data-saver-fallback")).toBeVisible();
      return;
    }

    expect(stats.writes_failed).toBe(0);
    await expect(page.locator("#data-saver-fallback")).toHaveCount(0);

    // Participant document is complete and carries condition + Prolific ids.
    const p = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`);
    expect(p.status).toBe(200);
    const pdoc = decodeFields(p.body.fields);
    expect(pdoc.completed).toBe(true);
    expect(["gain", "loss"]).toContain(pdoc.condition);
    expect(pdoc.prolific_pid).toBe("robot123");
    expect(pdoc.n_trials).toBeGreaterThan(10);
    expect(typeof pdoc.full_data).toBe("string");
    const full = JSON.parse(pdoc.full_data);
    expect(full.length).toBe(pdoc.n_trials);

    // One chunk per trial (chunk_size = 1), each carrying the trial data.
    const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials?pageSize=500`);
    expect(chunks.status).toBe(200);
    const docs = (chunks.body.documents || []).map((d) => decodeFields(d.fields));
    expect(docs.length).toBe(pdoc.n_trials);
    const trials = docs.flatMap((d) => d.trials);
    const framing = trials.find((t) => t.task === "framing");
    expect(framing.choice).toBe("certain");
    expect(framing.condition).toBe(pdoc.condition);
    const ld = trials.filter((t) => t.task === "lexical_decision");
    expect(ld.length).toBe(8);
    expect(ld.every((t) => t.correct === true)).toBe(true);
    const demo = trials.find((t) => t.task === "demographics");
    expect(demo.response.age).toBe(34);
  });

  test("chunked writes (chunk_size > 1) save every trial", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1&chunk_size=5");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await runThroughExperiment(page);
    const uid = await page.evaluate(() => window.__saver.uid);
    const p = decodeFields((await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}`)).body.fields);
    const chunks = await fsGet(`experiments/${EXPERIMENT_ID}/participants/${uid}/trials?pageSize=500`);
    const docs = (chunks.body.documents || []).map((d) => decodeFields(d.fields));
    expect(docs.length).toBe(Math.ceil(p.n_trials / 5));
    const indices = docs.flatMap((d) => d.trials).map((t) => t.trial_index).sort((a, b) => a - b);
    expect(indices).toEqual([...Array(p.n_trials).keys()]);
  });

  test("declining consent ends the study without a thank-you-for-your-data message", async ({ page }) => {
    await page.goto(EMULATOR ? "/?emulator=1" : "/");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await page.getByRole("button", { name: "I do not agree" }).click();
    await expect(page.getByText("You chose not to participate")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
  });

  test("losing the connection at the end offers the download fallback instead of hanging", async ({ page, context }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    test.setTimeout(120000);
    // Run the real flow up to the last click, then cut the connection before "Finish".
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    await page.getByRole("button", { name: "I agree to participate" }).click();
    await page.locator("#jspsych-instructions-next").click();
    await page.locator("#jspsych-instructions-next").click();
    await page.locator('input[value="Continue"]').click();
    await page.getByRole("button", { name: "Program B" }).click();
    await page.locator("#jspsych-instructions-next").click();
    for (let i = 0; i < 8; i++) {
      const stim = page.locator(".stimulus");
      await stim.waitFor({ state: "visible" });
      await page.keyboard.press("f");
      await stim.waitFor({ state: "detached" });
    }
    await page.locator("#jspsych-survey-likert-next").click();
    await page.locator("#jspsych-survey-text-next").click();
    await context.setOffline(true);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.locator("#data-saver-fallback")).toBeVisible({ timeout: 40000 });
    await expect(page.getByText("connection to the server was lost")).toBeVisible();
    await expect(page.getByText("Your responses were saved")).toHaveCount(0);
    await context.setOffline(false);
  });

  test("security rules reject reads and writes to other participants", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);

    const results = await page.evaluate(async () => {
      const s = window.__saver;
      const fb = s.fb;
      const out = {};
      const attempt = async (name, fn) => {
        try { await fn(); out[name] = "allowed"; } catch (e) { out[name] = e.code || e.message; }
      };
      await attempt("read own doc", () =>
        fb.getDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.uid)));
      await attempt("write other participant", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else"), { hacked: true }));
      await attempt("write other participant trials", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", "someone-else", "trials", "c0"), { trials: [] }));
      await attempt("write unrelated collection", () =>
        fb.setDoc(fb.doc(s.db, "spam", "doc"), { spam: true }));
      await attempt("error doc with wrong uid", () =>
        fb.addDoc(fb.collection(s.db, "experiments", s.opts.experiment_id, "errors"), { uid: "not-me", message: "x" }));
      await attempt("own chunk (should be allowed)", () =>
        fb.setDoc(fb.doc(s.db, "experiments", s.opts.experiment_id, "participants", s.uid, "trials", "chunk-test"), { trials: [{ a: 1 }] }));
      return out;
    });

    expect(results["read own doc"]).toBe("permission-denied");
    expect(results["write other participant"]).toBe("permission-denied");
    expect(results["write other participant trials"]).toBe("permission-denied");
    expect(results["write unrelated collection"]).toBe("permission-denied");
    expect(results["error doc with wrong uid"]).toBe("permission-denied");
    expect(results["own chunk (should be allowed)"]).toBe("allowed");
  });

  test("uncaught errors are logged to the errors collection", async ({ page }) => {
    test.skip(!EMULATOR, "needs the Firestore emulator");
    await page.goto("/?emulator=1");
    await page.waitForFunction(() => window.__saver && window.__saver.uid);
    const uid = await page.evaluate(() => window.__saver.uid);

    // Simulate a bug in a trial: an uncaught exception.
    await page.evaluate(() => {
      setTimeout(() => { throw new Error("simulated bug in trial code"); }, 0);
    });
    await page.waitForFunction(() => window.__saver.stats.errors_logged >= 1);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

    const errs = await fsGet(`experiments/${EXPERIMENT_ID}/errors?pageSize=100`);
    const mine = (errs.body.documents || []).map((d) => decodeFields(d.fields)).filter((d) => d.uid === uid);
    expect(mine.length).toBe(1);
    expect(mine[0].message).toContain("simulated bug");
    expect(mine[0].context.kind).toBe("uncaught");
  });
});
