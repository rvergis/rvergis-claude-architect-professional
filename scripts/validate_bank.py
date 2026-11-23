#!/usr/bin/env python3
"""Validate public/data/bank.json: schema, per-version blueprint coverage and answer-giveaway checks.

Usage: python3 scripts/validate_bank.py [path/to/bank.json]
Exits non-zero on errors. Prints warnings for weak spots.

Question types:
  choice  (default) options[4-5], select 1 or 2, answer = option indexes
  yesno   statements[3], answer = [true/false, ...] (true = Yes)
  match   choices[3-5], rows[3], answer = choice index per row
"""
import collections
import json
import re
import sys

LETTERS = "ABCDE"
REF = re.compile(r"\(([A-E](?:\s*,\s*[A-E])*)\)")
# Words that make an option easy to rule out without knowing the material.
ABSOLUTE = re.compile(r"\b(always|never|guarantee[sd]?|eliminates?|completely|entirely|impossible)\b", re.I)


def refs(text):
    return {ch for m in REF.finditer(text) for ch in re.findall("[A-E]", m.group(1))}


def check_choice(q, errors):
    qid, n = q["id"], len(q.get("options", []))
    if not 4 <= n <= 5:
        errors.append(f"{qid}: expected 4-5 options, got {n}")
    if len(set(q["options"])) != n:
        errors.append(f"{qid}: duplicate option text")
    sel = q.get("select", 1)
    if sel not in (1, 2):
        errors.append(f"{qid}: select must be 1 or 2 (multiple-response items are always 'choose TWO')")
    if sel != len(q["answer"]) or len(set(q["answer"])) != len(q["answer"]):
        errors.append(f"{qid}: select does not match answer list")
    if any(not isinstance(a, int) or a < 0 or a >= n for a in q["answer"]):
        errors.append(f"{qid}: answer index out of range")
    used = refs(q["explanation"])
    for ch in used:
        if LETTERS.index(ch) >= n:
            errors.append(f"{qid}: explanation references option {ch} that does not exist")
    missing = [LETTERS[i] for i in range(n) if i not in q["answer"] and LETTERS[i] not in used]
    if missing:
        errors.append(f"{qid}: explanation doesn't say why {', '.join(missing)} is wrong")


def check_grid(q, errors):
    qid, t = q["id"], q["type"]
    rows = q.get("statements") if t == "yesno" else q.get("rows")
    if not isinstance(rows, list) or len(rows) != 3:
        errors.append(f"{qid}: {t} items need exactly 3 {'statements' if t == 'yesno' else 'rows'}")
        return
    if not isinstance(q["answer"], list) or len(q["answer"]) != 3:
        errors.append(f"{qid}: answer needs one entry per row")
        return
    if t == "yesno":
        if not all(isinstance(a, bool) for a in q["answer"]):
            errors.append(f"{qid}: yesno answers must be true/false")
        if len(set(q["answer"])) == 1:
            errors.append(f"{qid}: yesno answers are all the same; mix Yes and No")
    else:
        n = len(q.get("choices", []))
        if not 3 <= n <= 5:
            errors.append(f"{qid}: match items need 3-5 choices, got {n}")
        if any(not isinstance(a, int) or a < 0 or a >= n for a in q["answer"]):
            errors.append(f"{qid}: match answer index out of range")
        for ch in refs(q["explanation"]):
            if LETTERS.index(ch) >= n:
                errors.append(f"{qid}: explanation references choice {ch} that does not exist")
    for r in range(1, 4):
        if not re.search(rf"\b{r}\b", q["explanation"]):
            errors.append(f"{qid}: explanation doesn't cover row {r}")


def main(path):
    bank = json.load(open(path, encoding="utf-8"))
    qs = bank["questions"]
    domains = {d["id"]: d for d in bank["domains"]}
    versions = bank["versions"]
    errors, warnings = [], []

    for ver, bp in versions.items():
        if sum(d["weight"] for d in bp["domains"]) != 100:
            errors.append(f"v{ver}: domain weights do not sum to 100")
        if sum(d["items"] for d in bp["domains"]) != bp["items_per_exam"]:
            errors.append(f"v{ver}: domain item counts do not sum to items_per_exam")
        if {d["id"] for d in bp["domains"]} != set(domains):
            errors.append(f"v{ver}: blueprint domains don't match the domain list")
        if not 0 <= bp.get("unscored", 0) < bp["items_per_exam"]:
            errors.append(f"v{ver}: bad unscored count")

    seen = set()
    for q in qs:
        qid = q.get("id", "?")
        for key in ("id", "domain", "stem", "answer", "explanation"):
            if key not in q:
                errors.append(f"{qid}: missing {key}")
        if qid in seen:
            errors.append(f"{qid}: duplicate id")
        seen.add(qid)
        if q["domain"] not in domains:
            errors.append(f"{qid}: unknown domain {q['domain']}")
        for v in q.get("versions", []):
            if v not in versions:
                errors.append(f"{qid}: unknown version {v}")
        t = q.get("type", "choice")
        if t == "choice":
            check_choice(q, errors)
        elif t in ("yesno", "match"):
            check_grid(q, errors)
        else:
            errors.append(f"{qid}: unknown type {t}")

    def fits(q, ver):
        return "versions" not in q or ver in q["versions"]

    for ver, bp in versions.items():
        counts = collections.Counter(q["domain"] for q in qs if fits(q, ver))
        for d in bp["domains"]:
            have = counts[d["id"]]
            if have < d["items"]:
                errors.append(f"v{ver} domain {d['id']}: only {have} questions, exam needs {d['items']}")
            elif have < 2 * d["items"]:
                warnings.append(f"v{ver} domain {d['id']}: {have} questions (< 2x per-exam need); forms will overlap heavily")
        types = collections.Counter(q.get("type", "choice") for q in qs if fits(q, ver))
        print(f"v{ver}: {sum(counts.values())} questions | by domain: {dict(sorted(counts.items()))} | types: {dict(types)}")

    # Giveaways: is the correct option systematically the longest, or the distractors the absolute ones?
    singles = [q for q in qs if q.get("type", "choice") == "choice" and q.get("select", 1) == 1]
    ranks = collections.Counter()
    for q in singles:
        lengths = [len(o) for o in q["options"]]
        order = sorted(range(len(lengths)), key=lambda i: (-lengths[i], i))
        ranks[order.index(q["answer"][0])] += 1
    if singles:
        n = len(singles)
        longest, top2 = ranks[0] / n, (ranks[0] + ranks[1]) / n
        shortest = sum(v for k, v in ranks.items() if k >= 3) / n
        chance2 = sum(2 / len(q["options"]) for q in singles) / n
        if longest > 0.35:
            warnings.append(f"correct answer is the longest option in {longest:.0%} of single-answer items")
        if top2 > chance2 + 0.10:
            warnings.append(f"correct answer is one of the two longest options in {top2:.0%} of single-answer items (chance: {chance2:.0%})")
        if shortest > 0.35:
            warnings.append(f"correct answer is the shortest option in {shortest:.0%} of single-answer items")
        print(f"single-answer length rank of correct option (0 = longest): {dict(sorted(ranks.items()))}")

    rate = collections.Counter(); total = collections.Counter()
    for q in qs:
        if q.get("type", "choice") != "choice":
            continue
        for i, o in enumerate(q["options"]):
            k = "correct" if i in q["answer"] else "wrong"
            total[k] += 1
            rate[k] += bool(ABSOLUTE.search(o))
    if total["wrong"] and total["correct"]:
        w, c = rate["wrong"] / total["wrong"], rate["correct"] / total["correct"]
        print(f"absolute wording: {w:.0%} of wrong options, {c:.0%} of correct options")
        if w > c + 0.05:
            warnings.append(f"absolute wording ('always', 'never', ...) flags wrong options: {w:.0%} of wrong vs {c:.0%} of correct")

    for w in warnings:
        print("WARN:", w)
    for e in errors:
        print("ERROR:", e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "public/data/bank.json"))
