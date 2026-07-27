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

## Notes

- Contract: `js/weather.js` requires `contract_version === 2`; a future v3 shows
  an error banner (no silent breakage) until the page is updated.
- KG dictionaries (esp. the Zambretti scale and safety texts in `js/i18n.js`)
  are best-effort and need a native-speaker proofread.
- Edge-case fixtures live in `dev/fixtures/`; open
  `weather-forecast.html?data=dev/fixtures/<name>.json` (relative path only) to
  exercise stale/zambretti/contract-mismatch/partial branches locally.
