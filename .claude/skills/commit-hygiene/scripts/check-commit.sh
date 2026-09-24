#!/usr/bin/env bash
# Scan the staged diff and a commit message for things that must never enter this public repo.
# Usage: check-commit.sh "<commit message>"   (run from the repository root)
set -uo pipefail
msg="${1:-}"
fail=0
red() { printf '\033[31mFAIL\033[0m %s\n' "$1"; fail=1; }

staged=$(git diff --cached --name-only)
if [ -z "$staged" ]; then echo "nothing staged"; exit 1; fi

echo "$staged" | grep -E '(^|/)\.env($|\.)|^\.kilocode/|(^|/)node_modules/' | grep -vE '\.env\.example$|\.env\..*\.template$' \
  && red "forbidden files staged"

diff_added=$(git diff --cached -U0 | grep -E '^\+' | grep -vE '^\+\+\+')
echo "$diff_added" | grep -nP '(?<![\w.-])(?!127\.0\.0\.1|0\.0\.0\.0)((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.-])' \
  && red "IPv4 address in staged diff"
echo "$diff_added" | grep -nE '\b[a-z_][a-z0-9_-]*@[a-z0-9.-]+\.[a-z]{2,}\b' | grep -viE 'example\.com|noreply@|users\.noreply|@[a-z0-9.-]+\.(test|local|example|invalid)\b' \
  && red "user@host / email in staged diff"
echo "$diff_added" | grep -nE 'BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY' && red "private key material"
echo "$diff_added" | grep -nEi '(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["'"'"']?[A-Za-z0-9+/_-]{12,}' \
  | grep -viE 'process\.env|\$\{|\$[A-Z_]+|change_me|example|placeholder|<[^>]+>' && red "credential-looking assignment"

patterns="${MYFINPRO_FORBIDDEN_PATTERNS:-$HOME/.config/myfinpro/forbidden-patterns}"
if [ -f "$patterns" ]; then
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    echo "$diff_added" | grep -nE "$p" && red "forbidden pattern from local list"
    printf '%s' "$msg" | grep -qE "$p" && red "forbidden pattern in message"
  done < "$patterns"
else
  echo "note: no local forbidden-patterns file at $patterns (hostname check skipped)"
fi

if [ -n "$msg" ]; then
  printf '%s' "$msg" | grep -qiP 'co-authored-by|generated with|anthropic|copilot|chatgpt|openai|claude(?![.\w/-])' \
    && red "AI mention or trailer in message"
  printf '%s' "$msg" | head -1 | grep -qE '^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9./-]+\))?!?: [a-z]' \
    || red "subject is not Conventional Commits (lowercase type(scope): subject)"
fi

[ $fail -eq 0 ] && echo "OK — staged diff and message pass"
exit $fail
