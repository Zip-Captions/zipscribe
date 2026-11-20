# Merge @fontsource latin + latin-ext woff2 pairs into single per-face files
# (shared glyphs stored once) — keeps the FR-201.4 default set ≤ 200 KB.
# fontTools is the approved dev tool (settings.yml approved_dependencies.dev).
# Invoked by scripts/copy-fonts.ts; `corepack pnpm fonts` is the entry point.
import os
import sys

from fontTools import merge

root = os.path.join(os.path.dirname(__file__), '..', 'node_modules', '@fontsource')
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'fonts')
os.makedirs(os.path.join(out, 'default'), exist_ok=True)
os.makedirs(os.path.join(out, 'display'), exist_ok=True)


def merge_pair(pkg, weight, dest_dir):
    a = os.path.join(root, pkg, 'files', f'{pkg}-latin-{weight}-normal.woff2')
    b = os.path.join(root, pkg, 'files', f'{pkg}-latin-ext-{weight}-normal.woff2')
    merged = os.path.join(out, dest_dir, f'{pkg}-latin-all-{weight}.woff2')
    merger = merge.Merger()
    font = merger.merge([a, b])
    font.flavor = 'woff2'
    # byte-stability (golden doctrine): pin the head timestamps and disable
    # fontTools' save-time modified-recalc, so re-running `pnpm fonts` on
    # unchanged sources is a no-op diff
    font.recalcTimestamp = False
    font['head'].created = 3_689_212_800  # 2026-11-19 00:00:00 UTC
    font['head'].modified = 3_689_212_800
    font.save(merged)
    return os.path.getsize(merged)


total = 0
# JetBrains Mono ships at 400 only: design.md uses it for timecode inputs at a
# single weight; 700 would push the FR-201.4 default set over its 200 KB budget.
for pkg, w in [('inter', 400), ('inter', 700), ('archivo', 400), ('archivo', 700), ('jetbrains-mono', 400)]:
    total += merge_pair(pkg, w, 'default')
disp = 0
for pkg, w in [('anton', 400), ('bebas-neue', 400), ('oswald', 500), ('poppins', 700)]:
    disp += merge_pair(pkg, w, 'display')
print(f'default {total / 1024:.1f} KB  display {disp / 1024:.1f} KB')
sys.exit(1 if total > 200 * 1024 else 0)
