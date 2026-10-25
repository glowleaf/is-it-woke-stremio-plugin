#!/bin/sh
# Publish MetaWokeCritic: export the data, rebuild the SQLite database the PHP app reads, then sync
# the app and posters to the web roots nginx serves.
#
#   ./resources/publish.sh              full publish
#   ./resources/publish.sh --no-export  skip the data export (DB rebuild + sync only)
set -e
cd "$(dirname "$0")/.."

if [ "$1" != "--no-export" ]; then
  node tools/export_site_data.js data.json
fi
node tools/build_site_db.js data.json data/site.db

sudo mkdir -p /var/www/mwc-app/data/cache /var/www/metawokecritic/img
sudo rsync -a --delete app/ /var/www/mwc-app/ --exclude data
sudo rsync -a data/site.db /var/www/mwc-app/data/site.db
sudo rsync -a data/posters/ /var/www/metawokecritic/img/
sudo chown -R www-data:www-data /var/www/mwc-app /var/www/metawokecritic
# cached pages belong to the previous build stamp; clearing them makes a publish visible at once
sudo find /var/www/mwc-app/data/cache -type f -name '*.html' -delete 2>/dev/null || true
echo "published: $(ls data/posters | wc -l) posters, db $(du -h data/site.db | cut -f1)"
