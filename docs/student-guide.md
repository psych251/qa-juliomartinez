# Student guide: from template to live experiment

This is the human path. Each step also has a skill in `.claude/skills/` that an agent
(Claude Code, Codex, Cursor, …) can follow for you: just ask it to "set up Firebase for this
experiment" or "deploy this to GitHub Pages". You still do the account steps yourself.

**You need:** a GitHub account (in the class organization), a **personal** Google account
(see "Why personal?" below), Node.js 18 or newer, and R with the tidyverse for analysis.
Optional but recommended: Java 17 or newer, so `npm test` can run the Firestore emulator.

---

## 1. Create your repo from the template

1. On the template's GitHub page click **Use this template → Create a new repository**.
   Owner: the class organization. Name: your project shortcite, e.g. `smith2016`.
   Visibility: **Public** (GitHub Pages on a free org needs a public repo).
2. Clone it, then:
   ```bash
   npm install
   npm start
   ```
   Open http://localhost:8000. The demo runs in **offline mode** (red banner): everything
   works, but nothing is saved yet. At the end you get a "Download data" button.
3. Run `npm test`. A robot participant plays the whole experiment against a local Firestore
   emulator. It should pass before you change anything. (Needs Java; if you skip Java,
   `npx playwright test` still checks the offline flow.)

## 2. Create your Firebase project

This takes about ten minutes and you do it once per project.

1. Go to https://console.firebase.google.com with your **personal** Google account and
   click **Create a project**. Name it after your project (e.g. `smith2016-replication`).
   Turn Google Analytics **off** (not needed). Stay on the free **Spark** plan; never
   upgrade to Blaze for this course.
2. **Firestore Database → Create database.** Choose a location near you (e.g.
   `us-west1`). Choose **production mode**, *not* test mode. Test mode gives you open rules
   that expire after 30 days, typically in the middle of data collection.
3. **Rules tab** → delete what's there, paste the entire contents of
   `firebase/firestore.rules` from your repo, click **Publish**.
4. **Authentication → Get started → Sign-in method → Anonymous → Enable → Save.**
   If you skip this, every write fails and the experiment shows the offline banner with
   the hint "Enable Anonymous sign-in".
5. **Project settings (gear) → General → Your apps → Web (`</>`)**. Nickname: anything.
   Do **not** tick Firebase Hosting. Click Register app, then copy the
   `firebaseConfig = { ... }` object.
6. Paste it over the placeholder in `firebase-config.js`. Commit. Yes, commit it: the
   config is a public identifier, not a secret. The rules you published are what protect
   your data.
7. `npm start`, reload the page. The red banner should be gone. Run through the experiment
   once, then look in **Firestore Database → Data**: you should see
   `experiments / framing-demo / participants / <some id>`.

**Why personal?** University Google Workspace accounts often block creating Firebase
projects. A personal account also means the project, and your data, stay with you after
the course.

## 3. Put it on GitHub Pages

1. Push your repo. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy
   from a branch → Branch: `main`, folder: `/ (root)` → Save.**
2. After a minute your experiment is live at
   `https://<org>.github.io/<repo>/`. Run through it once from that URL and check that a
   participant document appears in Firestore.
3. Every `git push` to `main` redeploys within a minute or two. If you see stale content,
   hard-reload (the page is served with caching).

## 4. Build your experiment

Edit `experiment.js`. The demo shows every piece you are likely to need: consent,
instructions, a survey page, a between-subjects manipulation with random assignment, a
keyboard reaction-time block with timeline variables, Likert and free-text feedback, debrief.
jsPsych's documentation is at https://www.jspsych.org/latest/. Two rules:

- **The consent trial stays first and the debrief stays last.** The consent text is the
  course-wide IRB language; change only the contact email.
- **Keep `npm test` green.** When you change the flow, update `runThroughExperiment` in
  `tests/experiment.spec.js` so the robot still knows what to click. This is your
  guarantee that the whole thing still runs and saves before you send it to real people.

Settings at the top of `experiment.js`:

| Setting | What to do |
| --- | --- |
| `id` | Change it when you move from pilot to real data (`smith2016-pilot-a`, `smith2016-final`) so datasets never mix. |
| `chunk_size` | 1 saves every trial. For long RT tasks raise it (say 20) to stay inside the free tier's 20,000 writes/day. Expected writes ≈ N × (trials / chunk_size + 3). |
| `prolific_completion_code` | From your Prolific study page. Participants are redirected there at the end. |

Adding a jsPsych plugin: add it to `package.json` and `scripts/vendor.js`, run
`npm install && npm run vendor`, add the `<script>` tag to `index.html`. Do not use CDN links.

## 5. Recruit

**Prolific.** Set the study URL to your Pages URL with the parameters Prolific offers:
`https://<org>.github.io/<repo>/?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}`.
Put the completion code in `experiment.js`. Choose "I'll redirect them using a URL" as the
completion method. Test with Prolific's preview link before publishing the study.

**Pilot A / Pilot B.** Use a different `EXPERIMENT.id` for each phase. Run the course's
pilot checklists as usual.

## 6. Get your data out

1. **Project settings → Service accounts → Generate new private key.** Save the JSON
   file *outside* your repo (e.g. `~/keys/smith2016-service-account.json`). This key can
   read and delete everything in your project. It is the one real secret in this setup.
   Filenames containing `service-account` are gitignored as a backstop, but do not rely on
   that. If it ever ends up on GitHub, delete the key in the Google Cloud console
   immediately and generate a new one.
2. Export:
   ```bash
   npm run export -- --experiment smith2016-final --key ~/keys/smith2016-service-account.json
   ```
   This writes `data/raw/smith2016-final/participants.csv`, `trials.csv`, `errors.csv`
   and `export.json` (all anonymous: random ids, no IP addresses, no Prolific ids), plus
   `identifiers.csv`, which maps ids to Prolific ids. That last file is gitignored; use it to
   approve and pay participants and never commit or share it.
3. Open `analysis/analysis.Rmd` in RStudio, set `experiment_id`, knit. The stub shows how to
   go from the long trial table to the framing analysis; replace it with your preregistered
   analysis.
4. **Commit your raw data** (the CSVs are anonymous) so the repository is a complete record.
   Do not commit anything a participant typed that could identify them; check the free-text
   columns first. Leave `identifiers.csv` where it is (gitignored).

`errors.csv` lists JavaScript errors that happened in participants' browsers, with the
trial index. Empty is good. If it is not empty, the stack trace tells you where to look.

## Things that go wrong, and the fix

| Symptom | Cause | Fix |
| --- | --- | --- |
| Red banner: "placeholder values" | `firebase-config.js` not filled in | Step 2.5–2.6 |
| Red banner: "operation-not-allowed" / "Enable Anonymous sign-in" | Anonymous auth not enabled | Step 2.4 |
| Red banner: "permission-denied … rules published?" | Rules not pasted / published, or test-mode rules expired | Step 2.3 |
| Page loads locally but is blank on Pages | Pages not enabled, or `/docs` chosen instead of root, or repo private | Step 3 |
| Works on Pages, but old version shows | Browser cache | Hard reload; wait two minutes after pushing |
| `npm test` fails at "emulator" | Java missing | Install Java 17+, or use `npx playwright test` for the offline flow |
| GitHub warns about a secret in `firebase-config.js` | It is not a secret | Ignore, or see the comment at the top of the file |
| Google won't let you create a project | University Workspace policy | Use a personal Google account |
| Data appears in Firestore but `npm run export` finds nothing | Wrong `--experiment` id | Match `EXPERIMENT.id` in `experiment.js` |
| Writes fail late in data collection | Free-tier daily write quota | Raise `chunk_size`, wait until the next day; nothing is lost if `full_data` landed |

## What the agent may not do

Agents are good at this stack, but tell yours (it is already in `CLAUDE.md`):

- never loosen `firebase/firestore.rules` "to make it work",
- never commit a service-account key,
- never switch to jsPsych 7 syntax or CDN links,
- always keep consent first and debrief last,
- always run `npm test` before pushing.
