#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
site_dir="$repo_dir/site"

if [[ -L "$site_dir" ]]; then
  echo "Deployment directory must not be a symbolic link: $site_dir" >&2
  exit 1
fi
mkdir -p "$site_dir"

# This file is a manually managed deployment setting. Check for it, but
# never copy, overwrite, or create it here.
if [[ ! -f "$site_dir/.geni_app_id" ]]; then
  echo "Missing $site_dir/.geni_app_id" >&2
  echo "Create it manually before deploying." >&2
  exit 1
fi

node "$repo_dir/tools/check_deploy_allowlist.js" \
  "$repo_dir" "$repo_dir/deploy-manifest.txt"

stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/acac-deploy.XXXXXX")"
trap 'rm -rf -- "$stage_dir"' EXIT

while IFS= read -r entry || [[ -n "$entry" ]]; do
  [[ "$entry" =~ ^[[:space:]]*(#|$) ]] && continue
  entry="${entry#"${entry%%[![:space:]]*}"}"
  if [[ "$entry" == manual:* ]]; then
    manual_file="${entry#manual:}"
    if [[ ! -f "$site_dir/$manual_file" ]]; then
      echo "Missing manually provisioned file: $site_dir/$manual_file" >&2
      exit 1
    fi
    continue
  fi
  destination_dir="$stage_dir/$(dirname -- "$entry")"
  mkdir -p "$destination_dir"
  cp -- "$repo_dir/$entry" "$stage_dir/$entry"
done < "$repo_dir/deploy-manifest.txt"

# Replace the deployed files, removing stale or unrelated content while
# preserving the manually managed app ID at the site root.
find "$site_dir" -mindepth 1 -maxdepth 1 ! -name '.geni_app_id' \
  -exec rm -rf -- {} +
cp -R -- "$stage_dir/." "$site_dir/"

echo "Deployed ACAC to $site_dir"
