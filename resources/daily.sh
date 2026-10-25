#!/bin/sh
# MetaWokeCritic daily batch.
#
# The corpus is ~2,500 titles; the expensive part is the LLM writing. So each day this fills a fixed
# quota and publishes, rather than trying to do everything at once. Every stage is resumable, so a
# missed day simply resumes where it stopped; nothing is lost and nothing is generated twice.
#
# Quotas (roughly 20-25 minutes a day at these rates):
#   themes 300 · tmdb 200 · scripts 150 · script analysis 60 · page summaries 100
set -e
cd "$(dirname "$0")/.."

THEMES=${THEMES_LIMIT:-300}
TMDB=${TMDB_LIMIT:-200}
SCRIPTS=${SCRIPTS_LIMIT:-150}
ANALYSIS=${ANALYSIS_LIMIT:-60}
SUMMARIES=${SUMMARIES_LIMIT:-100}

LOG=data/daily.log
[ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 5000000 ] && mv "$LOG" "$LOG.1"
exec >> "$LOG" 2>&1
echo "=== $(date -Is) daily batch start"

node tools/collect_wokealyzer_categories.js --rate 1.5 --limit "$THEMES" || echo "  themes stage failed"
node tools/enrich_tmdb.js --rate 1.5 --limit "$TMDB" || echo "  tmdb stage failed"
node tools/fetch_scripts.js data.json --limit "$SCRIPTS" || echo "  script fetch failed"
node tools/script_analysis.js data.json --workers 2 --limit "$ANALYSIS" || echo "  script analysis failed"
node tools/ai_summary.js data.json --workers 3 --limit "$SUMMARIES" || echo "  summaries failed"

./resources/publish.sh

echo "=== $(date -Is) daily batch done: $(ls data/script-analysis 2>/dev/null | wc -l) script analyses, $(ls data/ai-summary 2>/dev/null | wc -l) summaries, $(ls data/posters | wc -l) posters"
