# Masjid Thin Client Translation

Dumb external relay for the live-caption `/volg` read-along page.

The main caption app stays local in the masjid and opens the outbound uplink to
this relay itself. This repo is VPS-only: it receives that trusted uplink,
serves the static `/volg` page, and fans caption messages out to phones.

## Shape

```text
Masjid laptop
  live-caption app external relay client
        |
        v
VPS src/relay-server.js
        |
        v
Phones /volg
```

The relay does not run ASR, translation, Quran matching, or finalizer logic. It
receives the same messages the local `/volg` browser receives and rebroadcasts
them. There is no separate Node uplink process on the masjid laptop.

## Install

```bash
git clone https://github.com/h3lp1ngh4nd/masjid-thin-client-translation.git
cd masjid-thin-client-translation
npm install
cp .env.example .env
```

Set a long random shared token in `.env`:

```text
RELAY_TOKEN=change-this
```

## VPS

Run the relay server on the VPS:

```bash
HOST=0.0.0.0 PORT=8080 RELAY_TOKEN=change-this npm run server
```

Expose it through HTTPS, for example with Caddy or Nginx. The public mobile URL
is:

```text
https://your-domain.example/volg
```

Health check:

```bash
curl http://127.0.0.1:8080/health
```

## Main App Uplink

Configure the main live-caption app on the masjid laptop:

```env
EXTERNAL_VOLG_RELAY_ENABLED=true
EXTERNAL_VOLG_RELAY_URL=wss://your-domain.example/ws/uplink
EXTERNAL_VOLG_RELAY_TOKEN=change-this
```

The main app reconnects automatically and mirrors viewer messages best-effort.
If the VPS is down, the local caption app continues normally.

## PM2

On the VPS:

```bash
RELAY_TOKEN=change-this PORT=8080 \
  /home/xmrhooligan/.npm-global/bin/pm2 start ecosystem.config.cjs \
  --only masjid-volg-relay
```

Save after starting:

```bash
/home/xmrhooligan/.npm-global/bin/pm2 save
```

## Notes

- The VPS stores recent caption state in memory only.
- Restarting the VPS clears relay history; the next local `display_state` or
  caption repopulates it.
- Phone traffic goes to the VPS. If phones use masjid Wi-Fi, they still consume
  Wi-Fi airtime, but they no longer fan out from the local caption server.
- The VPS sends websocket pings every `HEARTBEAT_MS` (default 30s) and treats a
  missed pong as a dead connection. Keep any reverse-proxy read timeout above
  the heartbeat interval.
- `public/volg.html` is a verbatim copy of `app/templates/volg.html` from the
  main live-caption repo (the page is fully static). When that file changes,
  update this repo and `git pull` on the VPS.
