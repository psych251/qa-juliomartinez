---
name: firebase-setup
description: Connect this experiment to the student's own Firebase project (Firestore + anonymous auth) and verify data is being saved. Use when asked to set up Firebase, fix the red "data is NOT being saved" banner, publish or debug security rules, or estimate free-tier quota. The student does the console clicks; you verify and troubleshoot.
---

# Firebase setup for this experiment

The template needs one free Firebase (Spark) project per student, on a **personal** Google
account. The browser talks to Firestore directly; there is no server and no build. Nothing
here requires the Firebase CLI to log in, so the student never links accounts.

## What the student must do in the browser (give them this list verbatim)

1. https://console.firebase.google.com → **Create a project** (Analytics off, Spark plan).
2. **Firestore Database → Create database** → pick a region → **production mode**
   (not test mode: test-mode rules expire after 30 days).
3. **Rules** tab → replace everything with the contents of `firebase/firestore.rules` → **Publish**.
4. **Authentication → Get started → Sign-in method → Anonymous → Enable → Save**.
5. **Project settings → General → Your apps → Web `</>`** → register (no Hosting) → copy
   the `firebaseConfig` object.
6. Paste it into `firebase-config.js` over the placeholder, keeping `window.FIREBASE_CONFIG =`.

Show them where to paste and ask them to tell you when steps 1–6 are done. Everything below
is yours.

## What you do

1. **Validate the config file.** `node -e "require('vm').runInNewContext(require('fs').readFileSync('firebase-config.js','utf8'),{window:{}})"`
   must not throw; `projectId`, `apiKey`, `appId`, `authDomain` must be present and not `PASTE_ME`.
   `authDomain` should be `<projectId>.firebaseapp.com`.
2. **Validate the rules locally**: `npm test` starts the emulator with these rules and runs
   the robot; the "security rules" test proves the rules deny reads and cross-participant writes.
   Never edit the rules to `allow read, write: if true`, even temporarily.
3. **Verify the live connection.** `npm start`, then load http://localhost:8000 in a headless
   browser (Playwright is installed) and read `window.__saver.mode` and `window.__saver.reason`
   after `window.__saver.uid` is set. Expect `mode === "firebase"`. Then run through the
   experiment (`tests/experiment.spec.js` shows how) and check `window.__saver.stats.writes_failed === 0`.
   Ask the student to confirm a document appears under **Firestore → Data → experiments**.
4. **Quota check.** Writes per participant ≈ trials / `chunk_size` + 3. Multiply by the
   planned N per day. If it approaches 20,000, raise `chunk_size` in `experiment.js`.
5. Commit `firebase-config.js`. It is a public identifier, not a secret; explain this if
   GitHub or the student flags it.

## Troubleshooting (banner text or console error → cause → fix)

| Message | Cause | Fix |
| --- | --- | --- |
| `placeholder values` | config not pasted | step 5–6 |
| `auth/operation-not-allowed` or `admin-restricted-operation` | Anonymous sign-in disabled | step 4 |
| `auth/invalid-api-key`, `auth/api-key-not-valid` | typo or config from another project | re-copy step 5 |
| `permission-denied` | rules not published, test-mode rules expired, or path changed | step 3; check `experiments/{id}/participants/{uid}` layout unchanged |
| `unavailable`, `timed out` | network/firewall (some campus or corporate networks block Firestore's long-polling) | try another network; report it |
| `Missing or insufficient permissions` on export | service-account key from a different project | regenerate in the right project |
| Console says project creation blocked | Google Workspace policy | personal Google account |
| Firestore "quota exceeded" | free-tier daily limit | raise `chunk_size`; writes resume next day; `full_data` on completion still lands if under quota |

## Optional: Firebase CLI

The CLI is only needed to deploy rules from the terminal instead of pasting:
`npx firebase login` (opens a browser), create `.firebaserc` with `{"projects":{"default":"<projectId>"}}`,
then `npx firebase deploy --only firestore:rules`. Not required; the console paste is fine.
Do not enable App Check, Cloud Functions, or the Blaze plan for a course project.
