#!/bin/sh
# Themes -> export -> AI summaries -> rebuild the whole site.
# Every stage is resumable (themes skip existing rows, summaries skip written ones), so re-running is
# safe and a crash costs only the current batch.
cd "$(dirname "$0")"
echo "=== $(date -Is) collect themes"
node tools/collect_wokealyzer_categories.js --rate 1.5
echo "=== $(date -Is) export with themes"
node tools/export_site_data.js data.json
echo "=== $(date -Is) ai summaries"
node tools/ai_summary.js data.json --workers 4
echo "=== $(date -Is) export with summaries"
node tools/export_site_data.js data.json
echo "=== $(date -Is) build site"
node tools/build_site.js data.json site
echo "=== $(date -Is) done: $(ls site/t | wc -l) pages"
