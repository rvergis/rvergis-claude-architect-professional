# CCAR-P Practice Exams

Hard, scenario-based practice exams for the **Claude Certified Architect – Professional (CCAR-P)**, served as a static site at
<https://claude-architect-professional.bettr.fyi> (also <https://rvergis-claude-architect-professional.pages.dev>).

Unofficial study material, not affiliated with or endorsed by Anthropic. Every question is original and written against the public CCAR-P exam guides (v1.0, July 2026, and v1.1, November 2026). None are real exam items, and none are based on recalled exam content.

## What it does

- Supports both exam-guide versions, picked on the home page (the default follows the date):
  - **v1.0** (exams through Dec 6, 2026): 63 items, all scored.
  - **v1.1** (exams from Dec 7, 2026): 70 items, of which 10 are unscored trial items revealed only in the results.
- Four item formats: single answer, multiple response (always "choose TWO"), Yes/No sets (three statements, each with a Yes/No drop-down) and matching (three items, each matched to a lettered choice from a drop-down).
- 120-minute timer labeled "Time remaining" and a "Question N of M" counter in the top bar. A timed exam keeps running in a background tab, as the real one does; Save & exit pauses it.
- **100 fixed practice forms.** A form number always produces the same questions and option order, so it can be retaken. Random forms and per-domain drills are also available.
- Scores items all-or-nothing (every option or row must be right) and breaks results down by domain. Every wrong option has an explanation.
- Saves progress and history in the browser (localStorage). No tracking.
- **Resume codes:** each practice exam gets a 4-letter code (shown at the top of the exam). Typing it into the home page on another device continues the same exam. A Cloudflare Pages Function stores a compact copy (question IDs, option order, answers, clock) in Workers KV; codes expire 30 days after the last save and are deleted when the exam is submitted.

| Domain | v1.0 weight | v1.0 items | v1.1 weight | v1.1 items |
|---|---:|---:|---:|---:|
| 1. Solution Design & Architecture | 17% | 11 | 18% | 13 |
| 2. Claude Models, Prompting & Context Engineering | 13% | 8 | 13% | 9 |
| 3. Integration | 19% | 12 | 21% | 15 |
| 4. Evaluation, Testing & Optimization | 16% | 10 | 17% | 12 |
| 5. Governance, Safety & Risk | 14% | 9 | 16% | 11 |
| 6. Stakeholder Communication & Lifecycle | 14% | 9 | 7% | 5 |
| 7. Developer Productivity & Operational Enablement | 7% | 4 | 8% | 5 |

## Repository layout

```
wrangler.toml        # Pages config: output directory + KV binding for resume codes
functions/api/progress/  # Pages Functions: create, load, update, delete resume codes
public/              # deployed site (Cloudflare Pages output directory)
  index.html
  app.js             # exam generator, timer, scoring, review
  styles.css
  _headers           # Cloudflare Pages response headers
  data/bank.json     # question bank + blueprint
scripts/
  validate_bank.py   # schema, per-version coverage, explanation coverage and answer-giveaway checks
.github/workflows/
  validate.yml       # runs the validator on every push / PR
```

## Question bank format

`public/data/bank.json` holds a blueprint per exam version (`versions`), the domain list and a `questions` array. A question may list the `versions` it fits; with no list it fits every version.

```json
{ "id": "D3-018", "domain": 3, "select": 1, "versions": ["1.0", "1.1"],
  "stem": "Scenario text…", "options": ["…", "…", "…", "…"], "answer": [2],
  "explanation": "Why (C) is right, and why (A), (B) and (D) are wrong." }

{ "id": "D5-048", "domain": 5, "type": "yesno", "stem": "…",
  "statements": ["…", "…", "…"], "answer": [true, false, true],
  "explanation": "Statement 1: … Statement 2: … Statement 3: …" }

{ "id": "D3-065", "domain": 3, "type": "match", "stem": "…",
  "choices": ["…", "…", "…", "…"], "rows": ["…", "…", "…"], "answer": [2, 1, 0],
  "explanation": "Row 1: … (C). Row 2: … Row 3: …" }
```

- `select` is 1 or 2 and must equal `answer.length`.
- Explanations refer to options as `(A)`, `(B, D)` and so on. The app reshuffles options per form and rewrites these letters automatically.
- Write distractors that are as specific and plausible as the correct answer. The validator warns when correct answers are systematically the longest or shortest option.

## Adding questions

1. Append items to `public/data/bank.json`, using IDs like `D2-019`.
2. Run `python3 scripts/validate_bank.py` and fix any errors or warnings.
3. Commit and push. Cloudflare Pages redeploys automatically.

Aim for at least 3× the per-exam item count in every domain so forms overlap less.

## Deployment (Cloudflare Pages)

The site is plain static files with no build step.

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git** and pick this repository.
2. Leave the framework preset at **None** and the build command empty, and set the build output directory to `public`.
3. Deploy. The site is served at `rvergis-claude-architect-professional.pages.dev`, and the custom domain `claude-architect-professional.bettr.fyi` is set up under **Custom domains** in the Pages project.

Every push to `main` then redeploys, and pull requests get preview URLs.

Local preview: `cd public && python3 -m http.server 8080`, then open <http://localhost:8080>.
