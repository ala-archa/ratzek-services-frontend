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
repo copy). Rollback: delete the file on the gateway →
`nginx -t && systemctl reload nginx`.

### Gateway cache and stale assets after a deploy

`weather-forecast.html` is proxied uncached, but `js/` and `css/` are cached on
the gateway with `proxy_ignore_headers Cache-Control` (the origin sends
`no-store`). With the original `proxy_cache_valid 200 1h` that meant a deploy
produced a **fresh page against up-to-hour-old code** — which renders as a
visibly broken layout, not as "old version".

The cache is now split so this self-heals:

- `/assets/` (fonts, images — change only on a redesign): 24h + revalidate.
- `/js/`, `/css/` (change on every deploy): **1m**, which bounds the mismatch.

`proxy_cache_revalidate on` is set but currently does nothing: the origin is a
captive portal and deliberately defeats validators — `web.ratzek.conf` has
`add_header Last-Modified $date_gmt` (the *request* time, not the file's mtime),
`if_modified_since off` and `etag off`. A conditional request therefore gets
`200`, never `304`, and `X-Cache-Status` after expiry reads `EXPIRED`, not
`REVALIDATED`. Cost: a full refetch of js+css (~134 KB) at most once a minute,
and only when someone actually loads the page. If you ever want the cheap-304
behaviour, the origin would have to serve real validators for `/js/` and
`/css/` — which conflicts with the captive-portal no-cache policy, so it is a
deliberate trade, not an oversight.

So a normal deploy needs no gateway action — the page catches up within a
minute. Flush by hand only when you need it *immediately* (entries keep the TTL
they were stored with, so a config change to the TTL does not retroactively
expire them):

    ssh root@82.146.59.228 'find /var/cache/nginx-ratzek -mindepth 1 -delete \
      && systemctl reload nginx'

Check what the public port actually serves — this compares the proxy against
your working tree and is the fastest way to tell "not deployed" from "cached":

    md5sum css/style.css js/weather.js
    curl -s http://82.146.59.228:8080/css/style.css | md5sum
    curl -sI http://82.146.59.228:8080/css/style.css | grep -i x-cache-status

## Notes

- Contract: `js/weather.js` requires `contract_version === 3` (v3-only); any
  other version shows an error banner (no silent breakage) until the page is
  updated. A future v4 will do the same and need the same coordinated deploy.
- **Breaking-contract deploy (v3-only) — ordering matters.** The guard rejects
  the old version, so the frontend must be deployed AFTER the backend cuts over
  (when live `latest.json` returns `contract_version: 3`); until then the page
  shows the contract-error banner. `js/` is cached on the gateway (and in the
  browser — no cache-busting on `<script>`); the gateway now expires js/css
  after 1m and revalidates, so it catches up on its own, but for a *coordinated*
  cutover flush it by hand so the two sides never disagree even briefly
  (`find /var/cache/nginx-ratzek -mindepth 1 -delete`). A browser that already
  holds the old `weather.js` still needs a hard reload — there is no
  cache-busting on `<script>`. `latest.json` is `no-store`, so there is no JSON
  staleness race.
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
