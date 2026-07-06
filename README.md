# Masjid Thin Client Translation

Dumb external relay for the live-caption `/volg` read-along page.

The main caption app stays local in the masjid. This repo only mirrors the
existing `/ws/view` stream to an external VPS so phones can read captions from a
public URL without connecting to the local caption server.

## Shape

```text
Masjid laptop
  live-caption app /ws/view
        |
        v
  src/uplink-client.js
        |
        v
VPS src/relay-server.js
        |
        v
Phones /volg
```

The relay does not run ASR, translation, Quran matching, or finalizer logic. It
receives the same messages the local `/volg` browser receives and rebroadcasts
them.

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

## Masjid Laptop Uplink

Run this on the same machine as the local caption app:

```bash
LOCAL_VIEW_WS=ws://127.0.0.1:8000/ws/view \
RELAY_UPLINK_WS=wss://your-domain.example/ws/uplink \
RELAY_TOKEN=change-this \
npm run uplink
```

The uplink reconnects automatically. If the VPS is down, the local caption app
continues normally.

## PM2

On the VPS:

```bash
RELAY_TOKEN=change-this PORT=8080 \
  /home/xmrhooligan/.npm-global/bin/pm2 start ecosystem.config.cjs \
  --only masjid-volg-relay
```

On the masjid laptop:

```bash
LOCAL_VIEW_WS=ws://127.0.0.1:8000/ws/view \
RELAY_UPLINK_WS=wss://your-domain.example/ws/uplink \
RELAY_TOKEN=change-this \
  /home/xmrhooligan/.npm-global/bin/pm2 start ecosystem.config.cjs \
  --only masjid-volg-uplink
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
