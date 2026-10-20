#!/usr/bin/env bash
# Builds submission-<commit>.zip from git-tracked files only (so .env and ignored files cannot leak),
# adds the newest eval/results/<run>/ directory (full results.json lives there, gitignored),
# then unpacks the zip and runs the secret scan on what is actually inside it.
set -eu
cd "$(dirname "$0")/.."
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "must run inside the git repo"; exit 1; }
command -v zip >/dev/null 2>&1 && command -v unzip >/dev/null 2>&1 || { echo "zip and unzip are required"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean: commit first so the zip matches a commit"; exit 1; }
bash scripts/check-secrets.sh
commit=$(git rev-parse --short HEAD)
out="submission-${commit}.zip"
rm -f "$out"
git archive --format=zip --prefix=marginpilot/ -o "$out" HEAD
# newest run directory only (ignores README.md / .gitkeep that live next to the runs)
latest=$(ls -1d eval/results/*/ 2>/dev/null | sort | tail -n1 || true)
latest=${latest%/}
if [ -n "${latest:-}" ] && [ -d "$latest" ]; then
  tmp=$(mktemp -d); mkdir -p "$tmp/marginpilot/eval/results"; cp -r "$latest" "$tmp/marginpilot/eval/results/"
  (cd "$tmp" && zip -qr "$OLDPWD/$out" marginpilot); rm -rf "$tmp"
  echo "included $latest"
else
  echo "warning: no eval/results/<run>/ found, the zip has no evaluation results (run: pnpm eval:run -- --part all --seed 1)"
fi
chk=$(mktemp -d)
unzip -q "$out" -d "$chk"
if ! bash scripts/check-secrets.sh "$chk/marginpilot"; then
  rm -rf "$chk" "$out"; echo "secret scan of the zip FAILED: zip deleted"; exit 1
fi
rm -rf "$chk"
echo "created $out (commit $commit)"
echo "Reminder: fill docs from real results, check every tx hash on the explorer, then submit manually."
