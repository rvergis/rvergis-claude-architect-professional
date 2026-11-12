#!/usr/bin/env python3
"""Validate public/data/bank.json: schema, blueprint coverage and answer-length bias.

Usage: python3 scripts/validate_bank.py [path/to/bank.json]
Exits non-zero on errors. Prints warnings for weak spots.
"""
import collections
import json
import re
import sys

LETTERS = "ABCDE"
REF = re.compile(r"\(([A-E](?:\s*,\s*[A-E])*)\)")


def main(path):
    bank = json.load(open(path, encoding="utf-8"))
    qs = bank["questions"]
    domains = {d["id"]: d for d in bank["domains"]}
    errors, warnings = [], []

    if sum(d["weight"] for d in domains.values()) != 100:
        errors.append("domain weights do not sum to 100")
    if sum(d["items"] for d in domains.values()) != bank["items_per_exam"]:
        errors.append("domain item counts do not sum to items_per_exam")

    seen = set()
    for q in qs:
        qid = q.get("id", "?")
        for key in ("id", "domain", "select", "stem", "options", "answer", "explanation"):
            if key not in q:
                errors.append(f"{qid}: missing {key}")
        if qid in seen:
            errors.append(f"{qid}: duplicate id")
        seen.add(qid)
        if q["domain"] not in domains:
            errors.append(f"{qid}: unknown domain {q['domain']}")
        n = len(q["options"])
        if not 4 <= n <= 5:
            errors.append(f"{qid}: expected 4-5 options, got {n}")
        if len(set(q["options"])) != n:
            errors.append(f"{qid}: duplicate option text")
        if q["select"] != len(q["answer"]) or len(set(q["answer"])) != len(q["answer"]):
            errors.append(f"{qid}: select does not match answer list")
        if any(a < 0 or a >= n for a in q["answer"]):
            errors.append(f"{qid}: answer index out of range")
        for m in REF.finditer(q["explanation"]):
            for ch in re.findall("[A-E]", m.group(1)):
                if LETTERS.index(ch) >= n:
                    errors.append(f"{qid}: explanation references option {ch} that does not exist")

    counts = collections.Counter(q["domain"] for q in qs)
    for did, d in domains.items():
        if counts[did] < d["items"]:
            errors.append(f"domain {did}: only {counts[did]} questions, exam needs {d['items']}")
        elif counts[did] < 2 * d["items"]:
            warnings.append(f"domain {did}: {counts[did]} questions (< 2x per-exam need); forms will overlap heavily")

    # Length bias: is the correct option systematically the longest or shortest?
    ranks = collections.Counter()
    singles = [q for q in qs if q["select"] == 1]
    for q in singles:
        lengths = [len(o) for o in q["options"]]
        order = sorted(range(len(lengths)), key=lambda i: -lengths[i])
        ranks[order.index(q["answer"][0])] += 1
    if singles:
        longest = ranks[0] / len(singles)
        shortest = sum(v for k, v in ranks.items() if k >= 3) / len(singles)
        if longest > 0.35:
            warnings.append(f"correct answer is the longest option in {longest:.0%} of single-answer items")
        if shortest > 0.35:
            warnings.append(f"correct answer is the shortest option in {shortest:.0%} of single-answer items")

    print(f"{len(qs)} questions | by domain: {dict(sorted(counts.items()))} | "
          f"multi-response: {sum(1 for q in qs if q['select'] > 1)}")
    print(f"single-answer length rank of correct option (0 = longest): {dict(sorted(ranks.items()))}")
    for w in warnings:
        print("WARN:", w)
    for e in errors:
        print("ERROR:", e)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "public/data/bank.json"))
