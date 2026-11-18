#!/usr/bin/env python3
"""Create the GitHub issues described in .github/tracker/tickets/*.md.

Safe to run again: an issue whose title already exists is skipped.
Usage: create_issues.py --dry-run   (check the files, change nothing)
       create_issues.py             (needs GH_TOKEN and GH_REPO)
"""
import glob, json, os, re, sys, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
LINKS = {
    "ROADMAP": "https://claude.ai/artifact/Q7awHkWEPD75CfJ3xZksJH",
    "ARCH": "https://claude.ai/artifact/X5UpnELuZDh6vJYU428J7G",
    "PROTO": "https://claude.ai/artifact/77KLF6DA2WFCMescbP92Vf",
}
REF = re.compile(r"\{\{([A-Za-z0-9-]+)\}\}")


def parse():
    tickets = []
    for path in sorted(glob.glob(os.path.join(HERE, "tickets", "*.md"))):
        text = open(path, encoding="utf-8").read()
        for block in re.split(r"^=== ISSUE ", text, flags=re.M)[1:]:
            head, body = block.split("\n---\n", 1)
            lines = head.strip().split("\n")
            t = {"key": lines[0].strip(), "body": body.strip() + "\n", "file": os.path.basename(path)}
            for line in lines[1:]:
                k, v = line.split(":", 1)
                t[k.strip()] = v.strip()
            t["labels"] = [x.strip() for x in t["labels"].split(",")]
            tickets.append(t)
    return tickets


def validate(tickets):
    errors = []
    labels = {l.split("\t")[0] for l in open(os.path.join(HERE, "labels.tsv"), encoding="utf-8") if l.strip()}
    miles = {l.split("\t")[0] for l in open(os.path.join(HERE, "milestones.tsv"), encoding="utf-8") if l.strip()}
    keys = [t["key"] for t in tickets]
    titles = [t["title"] for t in tickets]
    for name, seq in (("key", keys), ("title", titles)):
        for x in set(seq):
            if seq.count(x) > 1:
                errors.append(f"duplicate {name}: {x}")
    for t in tickets:
        k = t["key"]
        if len(t["labels"]) > 3:
            errors.append(f"{k}: more than 3 labels")
        if sum(l.startswith("priority:") for l in t["labels"]) != 1:
            errors.append(f"{k}: needs exactly one priority label")
        for l in t["labels"]:
            if l not in labels:
                errors.append(f"{k}: unknown label {l}")
        if t["milestone"] not in miles:
            errors.append(f"{k}: unknown milestone {t['milestone']}")
        if t["type"] not in ("Task", "Feature", "Bug"):
            errors.append(f"{k}: unknown type {t['type']}")
        for h in ("## Goal", "## Proposed change", "## Acceptance criteria", "## Out of scope", "## Evidence and links"):
            if h not in t["body"]:
                errors.append(f"{k}: missing heading {h}")
        for r in REF.findall(t["body"]):
            if r not in LINKS and r not in keys:
                errors.append(f"{k}: unknown reference {r}")
    return errors


def render(body, numbers):
    def sub(m):
        r = m.group(1)
        if r in LINKS:
            return LINKS[r]
        return f"#{numbers[r]}" if r in numbers else r
    return REF.sub(sub, body)


def api(method, path, data=None):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{os.environ['GH_REPO']}{path}",
        data=json.dumps(data).encode() if data is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {os.environ['GH_TOKEN']}",
                 "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code in (403, 429) and attempt < 4:
                wait = int(e.headers.get("Retry-After") or 30 * (attempt + 1))
                print(f"  rate limited ({e.code}), waiting {wait}s", flush=True)
                time.sleep(wait)
                continue
            raise RuntimeError(f"{method} {path}: {e.code} {msg}")


def paged(path):
    out, page = [], 1
    while True:
        chunk = api("GET", f"{path}{'&' if '?' in path else '?'}per_page=100&page={page}")
        out += chunk
        if len(chunk) < 100:
            return out
        page += 1


def main():
    tickets = parse()
    errors = validate(tickets)
    by_m = {}
    for t in tickets:
        by_m.setdefault(t["milestone"], []).append(t["key"])
    print(f"{len(tickets)} tickets")
    for m, ks in by_m.items():
        print(f"  {m}: {len(ks)}")
    if errors:
        print("\n".join("ERROR " + e for e in errors))
        sys.exit(1)
    if "--dry-run" in sys.argv:
        print("dry run OK")
        return

    miles = {m["title"]: m["number"] for m in paged("/milestones?state=all")}
    existing = {i["title"]: i for i in paged("/issues?state=all") if "pull_request" not in i}
    numbers, created_body = {}, {}
    for t in tickets:
        if t["title"] in existing:
            numbers[t["key"]] = existing[t["title"]]["number"]
            print(f"skip #{numbers[t['key']]} {t['title']}", flush=True)
            continue
        body = render(t["body"], numbers)
        payload = {"title": t["title"], "body": body, "labels": t["labels"],
                   "milestone": miles[t["milestone"]], "type": t["type"]}
        try:
            issue = api("POST", "/issues", payload)
        except RuntimeError as e:
            print(f"  retry without type: {e}", flush=True)
            payload.pop("type")
            issue = api("POST", "/issues", payload)
        numbers[t["key"]] = issue["number"]
        created_body[t["key"]] = body
        print(f"created #{issue['number']} {t['title']}", flush=True)
        time.sleep(1.5)

    # Second pass: fill in references to tickets that were created later.
    for t in tickets:
        final = render(t["body"], numbers)
        current = created_body.get(t["key"])
        if current is None:
            current = existing[t["title"]].get("body") or ""
        if final.strip() != current.strip():
            api("PATCH", f"/issues/{numbers[t['key']]}", {"body": final})
            print(f"updated links in #{numbers[t['key']]}", flush=True)
            time.sleep(1)

    for t in tickets:
        print(f"ISSUE\t{numbers[t['key']]}\t{t['key']}\t{t['milestone']}\t{','.join(t['labels'])}")


if __name__ == "__main__":
    main()
