# CCAR-P Practice Exams

Hard, scenario-based practice exams for the **Claude Certified Architect – Professional (CCAR-P)**, served as a static site at
<https://claude-architect-professional.bettr.fyi> (also <https://rvergis-claude-architect-professional.pages.dev>).

Unofficial study material, not affiliated with or endorsed by Anthropic. Every question is original and written against the public CCAR-P exam blueprint (Exam Guide v1.0, July 2026). None are real exam items.

## What it does

- Generates 63-item exams at the official domain weighting, timed at 120 minutes, with single-answer and multiple-response ("choose TWO / THREE") items.
- **100 fixed practice forms.** A form number always produces the same questions and option order, so it can be retaken. Random forms and per-domain drills are also available.
- Scores items all-or-nothing, as the real exam does for multiple-response items, and breaks results down by domain. Every option has an explanation.
- Saves progress and history in the browser (localStorage). No tracking.
- **Resume codes:** each practice exam gets a 4-letter code (shown at the top of the exam). Typing it into the home page on another device continues the same exam. A Cloudflare Pages Function stores a compact copy (question IDs, option order, answers, clock) in Workers KV; codes expire 30 days after the last save and are deleted when the exam is submitted.

| Domain | Weight | Items per exam |
|---|---:|---:|
| 1. Solution Design & Architecture | 17% | 11 |
| 2. Claude Models, Prompting & Context Engineering | 13% | 8 |
| 3. Integration | 19% | 12 |
| 4. Evaluation, Testing & Optimization | 16% | 10 |
| 5. Governance, Safety & Risk | 14% | 9 |
| 6. Stakeholder Communication & Lifecycle | 14% | 9 |
| 7. Developer Productivity & Operational Enablement | 7% | 4 |

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
  validate_bank.py   # schema, blueprint coverage and answer-length bias checks
.github/workflows/
  validate.yml       # runs the validator on every push / PR
```

## Question bank format

`public/data/bank.json` holds the blueprint plus a `questions` array:

```json
{
  "id": "D3-018",
  "domain": 3,
  "select": 1,
  "stem": "Scenario text…",
  "options": ["…", "…", "…", "…"],
  "answer": [2],
  "explanation": "Why the answer is right, and why (A), (B) and (D) are wrong."
}
```

- `select` is the number of options to choose, and must equal `answer.length`.
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
