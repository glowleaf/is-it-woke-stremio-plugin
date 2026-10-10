# Deployment notes

How the public instance is run. Everything below assumes a Linux box with Node 18+ and, optionally, a
Cloudflare tunnel for HTTPS.

## Service

```ini
# /etc/systemd/system/woke-addon.service
[Unit]
Description=Is It Woke - Stremio addon
After=network-online.target

[Service]
Type=simple
User=hermes
WorkingDirectory=/home/hermes/iiwon-addon
Environment=PORT=7090
Environment=HOST=0.0.0.0
Environment=DATA_DIR=/home/hermes/iiwon-addon/data
Environment=BASE_PATH=/woke          # optional; the addon answers with or without the prefix
ExecStart=/usr/bin/node /home/hermes/iiwon-addon/src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`systemctl enable --now woke-addon` and it is live on `http://box:7090/manifest.json`.

## Exposing it

The reference setup serves it under a **path rule on an existing tunnel hostname**, so no DNS record is
needed:

```yaml
# /etc/cloudflared/config.yml (the tunnel that owns the hostname!)
ingress:
  - hostname: scrut.greekai.gr
    path: ^/woke(/.*)?$
    service: http://localhost:7090
  - hostname: scrut.greekai.gr
    service: http://localhost:3020
  - service: http_status:404
```

Check which tunnel actually serves the hostname before editing — a box can run several
(`ps aux | grep cloudflared`, `systemctl list-units '*tunnel*'`), and the rule only applies to the
one whose config names that hostname. Validate, then restart:

```bash
cloudflared --config /etc/cloudflared/config.yml tunnel ingress validate   # flag BEFORE the subcommand
cloudflared --config /etc/cloudflared/config.yml tunnel ingress rule https://host/woke/health
sudo systemctl restart <the tunnel service>
```

For a dedicated hostname (`woke.example.com`), create a proxied CNAME to
`<tunnel-id>.cfargotunnel.com` first, add a hostname rule, and drop `BASE_PATH`.

## Data

| File | Contents |
|---|---|
| `data/woke.db` | **SQLite** (via `node:sqlite`, no deps): one row per (title, source) — the score cache |
| `data/cache.json` | Cinemeta meta responses and site search results (TTL'd) |
| `data/index.json` | catalog index for the browse rows, built by `tools/prime_index.js` |

Inspect the score cache any time:

```bash
sqlite3 data/woke.db "select key, source, status, score, label from woke_scores limit 20;"
curl -s localhost:7090/health        # -> {"db":{"titles":N,"rows":M}, ...}
```

`tools/prime_index.js` walks the isitwokeornot.com catalogue politely (that site rate-limits 429 above
about 1 request/second, so the crawler halves its rate and backs off when it happens). It is resumable:

```bash
node tools/prime_index.js --rate 1        # ~4.5k titles
node tools/prime_index.js --pages 20
```

## Ordering (the one gotcha)

Stremio renders the **first metadata addon in the collection order that loads**, so the score row only
appears when this addon sits above Cinemeta. The desktop app syncs its collection through
`api.strem.io` using the profile key it stores locally, which means:

- writing the order into the app's localStorage does not stick (it is a mirror, not the source);
- the reliable way is `addonCollectionGet` / `addonCollectionSet` with `authKey = localStorage['profile'].auth.key`,
  run from inside the app's own page (see `tools/api_reorder.py`), or the "move to the top" button on
  the addon's `/configure` page for account users.

## Tests

```bash
node test/e2e.js      # boots the server on a random port and requests it the way Stremio does
node test/smoke.js    # per-title upstream check, prints every chip row
```

The e2e test asserts both source rows are present, that every chip has a URL and no colon in its label,
that Cinemeta's poster/background/episode list survive, and that a malformed config is rejected.
