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

Point DNS for `volg.alhouda.nl` at the VPS, then run the relay behind a HTTPS
reverse proxy. Keep Node on localhost; let Caddy or Nginx own public ports
`80` and `443`.

Create `.env` on the VPS:

```env
HOST=127.0.0.1
PORT=8080
RELAY_TOKEN=change-this
MAX_CAPTIONS=1000
HEARTBEAT_MS=30000
VOLG_HEADER_TEXT=live
VOLG_EMPTY_TEXT=Wachten op vertaling...
VOLG_FOOTER_TEXT=Live vertaling is in BETA. Er kunnen fouten voorkomen.
```

Run with PM2:

```bash
/home/xmrhooligan/.npm-global/bin/pm2 start ecosystem.config.cjs \
  --only masjid-volg-relay --update-env
/home/xmrhooligan/.npm-global/bin/pm2 save
```

Caddy example:

```caddyfile
volg.alhouda.nl {
  reverse_proxy 127.0.0.1:8080
}
```

The public mobile URL is:

```text
https://volg.alhouda.nl/volg
```

Health check:

```bash
curl https://volg.alhouda.nl/health
```

## Main App Uplink

Configure the main live-caption app on the masjid laptop:

```env
EXTERNAL_VOLG_RELAY_ENABLED=true
EXTERNAL_VOLG_RELAY_URL=wss://volg.alhouda.nl/ws/uplink
EXTERNAL_VOLG_RELAY_TOKEN=change-this
```

The main app reconnects automatically and mirrors viewer messages best-effort.
If the VPS is down, the local caption app continues normally.
The authenticated uplink also answers the main app's no-op pre-flight nonce;
that round-trip never changes stored captions or broadcasts to phones.

## PM2

On the VPS, after `.env` exists:

```bash
/home/xmrhooligan/.npm-global/bin/pm2 start ecosystem.config.cjs \
  --only masjid-volg-relay --update-env
```

Save after starting:

```bash
/home/xmrhooligan/.npm-global/bin/pm2 save
```

## Notes

- The VPS stores up to `MAX_CAPTIONS` released captions in memory only. The
  default 1,000-caption history lets a refreshed phone scroll back to the
  beginning of a normal khutbah session.
- Restarting the VPS clears relay history; the next local `display_state` or
  caption repopulates it.
- Phone traffic goes to the VPS. If phones use masjid Wi-Fi, they still consume
  Wi-Fi airtime, but they no longer fan out from the local caption server.
- The VPS sends websocket pings every `HEARTBEAT_MS` (default 30s) and treats a
  missed pong as a dead connection. Keep any reverse-proxy read timeout above
  the heartbeat interval.
- `VOLG_HEADER_TEXT`, `VOLG_EMPTY_TEXT`, and `VOLG_FOOTER_TEXT` control the
  connected status label, waiting text, and bottom disclaimer on `/volg`.
- `public/volg.html` mirrors `app/templates/volg.html` from the main
  live-caption repo, with relay-rendered placeholders for the configurable
  copy. When that file changes, update this repo and `git pull` on the VPS.
- `public/NotoNaskhArabic-Regular.ttf` is distributed under the SIL Open Font
  License 1.1; its copyright notice and license are in
  `public/OFL-NotoNaskhArabic.txt`.
