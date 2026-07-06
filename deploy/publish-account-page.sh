#!/usr/bin/env bash
# Surgically update ONLY the account page on gh-pages — no LLM regeneration, no
# newsletter send (i.e. NOT `publish-edition.js`). It string-swaps the usage-cap
# line on the live account/index.html and pushes gh-pages.
#
# Safe to re-run: if the old line is already gone it errors out without pushing.
#
# Usage:  bash deploy/publish-account-page.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE="$(mktemp -d)"
OLD="document.getElementById('account-usage').textContent = user.chatUsage.count + ' / 100 this month';"
NEW="var chatLimit = user.chatLimit || 1000; document.getElementById('account-usage').textContent = user.chatUsage.count + ' / ' + chatLimit + ' this month';"

cleanup() { cd "$REPO_ROOT"; git worktree remove --force "$WORKTREE" 2>/dev/null || true; }
trap cleanup EXIT

cd "$REPO_ROOT"
git fetch origin gh-pages
git worktree add --force "$WORKTREE" origin/gh-pages
cd "$WORKTREE"
git switch -C gh-pages-deploy

FILE="account/index.html"
node -e '
const fs = require("fs");
const f = process.argv[1], oldS = process.argv[2], newS = process.argv[3];
let s = fs.readFileSync(f, "utf8");
if (s.includes(newS)) { console.error("Already up to date — nothing to do."); process.exit(2); }
if (!s.includes(oldS)) { console.error("Anchor line not found in " + f + " — aborting (no change)."); process.exit(1); }
fs.writeFileSync(f, s.replace(oldS, newS));
console.log("Swapped usage-cap line in " + f);
' "$FILE" "$OLD" "$NEW"

git add "$FILE"
git commit -m "fix(account): show real monthly chat cap (chatLimit) instead of hardcoded /100"
git push origin HEAD:gh-pages

echo "Pushed. Verify (Cloudflare ignores ?query cache-busters — use no-cache):"
echo "  curl -s -H 'Cache-Control: no-cache' https://gittimes.com/account/ | grep -o \"chatLimit[^;]*\""
