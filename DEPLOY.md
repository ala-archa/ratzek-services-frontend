# Deploy

The site is static. `make deploy` rsyncs the working tree to
`root@10.11.5.1:/var/www/ratzek-portal/` (nginx serves it). `make dry-run`
previews. Excluded from deploy: `.git/`, `Makefile`, `README.md`, `DEPLOY.md`,
`dev/`, `.claude/`, `*.log`.

## Host dependency: weather-forecast JSON (nginx)

`weather-forecast.html` (via `js/weather.js`) fetches `/weather/latest.json`.
That path is NOT part of our rsync — it is an nginx alias to the forecast
service's file on the host. It must exist before the page is useful.

In `/etc/nginx/sites-enabled/web.ratzek.conf`, before `location / {`:

```nginx
location = /weather/latest.json {
  alias /var/lib/prometheus-weather-forecast-api/latest.json;
  default_type application/json;
}
```

`Cache-Control: no-store` is inherited from the server block (no `add_header`
here), so the browser always gets a fresh file. The forecast service rewrites
the file atomically every 30 min.

Apply: `nginx -t && systemctl reload nginx`, then verify:
`curl -sI http://127.0.0.1/weather/latest.json -H 'Host: www.ratzek'`
(expect `200`, `Content-Type: application/json`).

## Rollout order (weather page)

1. Apply the nginx `location` on the host → `nginx -t` → `systemctl reload nginx`
   → `curl` check. (Do this FIRST — otherwise the page 404s on fetch.)
2. `make dry-run` — eyeball the `--delete` section.
3. `make deploy`.

## Rollback

- Page/assets: `git revert <commit>` (or checkout previous tree) + `make deploy`
  (rsync overwrites deterministically).
- nginx: remove the `location` block + `nginx -t && systemctl reload nginx`.

## Public access (internet gateway, port 8080)

The mountain prod (`10.11.5.1`) is internet-facing only through a public gateway
VPS `82.146.59.228` (`vpn.lepikhin.site`) over a **narrow satellite VPN**. The
gateway's `:80` serves Grafana; the forecast page is published on a **dedicated
port 8080**:

    http://82.146.59.228:8080/   →  302  /weather-forecast.html

Config lives on the GATEWAY (ssh `root@82.146.59.228` port 22), source of truth
is `deploy/gateway/ratzek-portal-public.conf` in this repo. It is an nginx
`server{listen 8080}` that proxies to the mountain portal (`10.8.0.10:80`,
`Host: www.ratzek`) over the VPN, with an **allowlist**: only
`/weather-forecast.html`, `/js/`, `/css/`, `/assets/`, `/weather/latest.json`
(and `/`→redirect). Everything else → 404, so `/api`, `/ap-admin`, `donate.html`
(bank details), the captive index and the media dirs stay private. Static assets
are cached on the gateway; `latest.json` is not (freshness). `limit_req`/
`limit_conn` + short proxy timeouts protect the shared VPN from abuse.

Apply / update on the gateway:

    scp deploy/gateway/ratzek-portal-public.conf \
        root@82.146.59.228:/etc/nginx/sites-enabled/ratzek-portal-public.conf   # port 22
    ssh root@82.146.59.228 'install -d -o www-data -g www-data /var/cache/nginx-ratzek \
        && nginx -t && systemctl reload nginx'

Verify from OUTSIDE the VPN (public internet, e.g. LTE): `curl -sI
http://82.146.59.228:8080/weather-forecast.html` (200); `/api/v1/client`,
`/donate.html` → 404; `http://82.146.59.228/` (Grafana) still 200.

Caveats: no TLS (plain HTTP over IP:port — that's why bank details are NOT
exposed); the config is not under config-management (keep it in sync with the
repo copy); after a big asset change flush the gateway cache
(`rm -rf /var/cache/nginx-ratzek/*`). Rollback: delete the file on the gateway →
`nginx -t && systemctl reload nginx`.

## Notes

- Contract: `js/weather.js` requires `contract_version === 3` (v3-only); any
  other version shows an error banner (no silent breakage) until the page is
  updated. A future v4 will do the same and need the same coordinated deploy.
- **Breaking-contract deploy (v3-only) — ordering matters.** The guard rejects
  the old version, so the frontend must be deployed AFTER the backend cuts over
  (when live `latest.json` returns `contract_version: 3`); until then the page
  shows the contract-error banner. `js/` is cached on the gateway (and in the
  browser — no cache-busting on `<script>`), so **flush the gateway cache on
  every deploy AND rollback** (`find /var/cache/nginx-ratzek -mindepth 1
  -delete`); `latest.json` is `no-store`, so there is no JSON staleness race.
- **Rollback is fix-forward only.** `git revert` + redeploy does NOT recover
  after the backend cutover (old `CONTRACT` vs new data = the same error). Fix
  forward, or ask the backend to roll the generator back to the previous major.
- To inspect the live source JSON directly: `ssh root@10.11.5.1 'cat
  /var/lib/prometheus-weather-forecast-api/latest.json'` (this is the alias
  target of `/weather/latest.json`; it is NOT in the rsync tree).
- KG dictionaries (esp. the Zambretti scale and safety texts in `js/i18n.js`)
  are best-effort and need a native-speaker proofread.
- Edge-case fixtures live in `dev/fixtures/`; open
  `weather-forecast.html?data=dev/fixtures/<name>.json` (relative path only) to
  exercise branches locally: `kitchen-sink` (v3, all new states — quality
  severe/unknown, per-altitude verdicts, critical-altitude row, avalanche,
  window fields), `window-nofit` (window `status != found`), `contract-bad`
  (unsupported version → contract-error branch), `zambretti`, `contract3`.
