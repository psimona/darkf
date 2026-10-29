#!/usr/bin/env bash
# Builds a real local-distribution tarball of the single merged `darkf`
# package, so a consumer (including a global `darkf` install on this host)
# depends on a frozen snapshot instead of the live `workspace:*` symlink
# into this repo's own source tree. Editing darkf after packing never
# affects an already-packed or already-installed consumer — only re-running
# this script does.
#
# Packs from `git archive HEAD`, not the working tree: a pack always
# reflects the last commit, same as a real release would. The merged
# package has zero dependencies, so the sibling-tarball rewriting and the
# Bun diamond/`file:`-directory hazards the pre-merge script had to dodge
# (see the package-boundaries spec) are gone entirely.
#
# Usage: scripts/pack-local.sh
# Output: $DARKF_DIST_DIR/darkf-<version>.tgz
#   ($DARKF_DIST_DIR defaults to ${XDG_DATA_HOME:-$HOME/.local/share}/darkf/dist)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${DARKF_DIST_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/darkf/dist}"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

mkdir -p "$DIST_DIR"

git -C "$REPO_ROOT" archive HEAD -- darkf | tar -x -C "$STAGE_DIR"
version="$(bun -e "console.log(require('$STAGE_DIR/darkf/package.json').version)")"
(cd "$STAGE_DIR/darkf" && bun pm pack --destination "$DIST_DIR" >&2)

# Scoped package names pack to a dashed filename: @psimona/darkf →
# psimona-darkf-<version>.tgz.
name="$(bun -e "console.log(require('$STAGE_DIR/darkf/package.json').name.replace(/^@/, '').replace('/', '-'))")"
tgz="$DIST_DIR/$name-$version.tgz"
echo "built: $tgz" >&2
echo "$tgz"
