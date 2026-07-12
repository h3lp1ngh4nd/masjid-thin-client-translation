import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("relay startup timed out")),
      3000,
    );
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`relay exited before startup (${code})`));
    });
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("relay listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

test("refresh backfills the full released stream and serves honorific font", async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, ["src/relay-server.js"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      RELAY_TOKEN: "test-token",
      MAX_CAPTIONS: "1000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));
  await waitForReady(child);

  const uplink = new WebSocket(`ws://127.0.0.1:${port}/ws/uplink`, {
    headers: { "x-relay-token": "test-token" },
  });
  await once(uplink, "open");
  const observer = new WebSocket(`ws://127.0.0.1:${port}/ws/view`);
  const initialObserverState = once(observer, "message");
  await once(observer, "open");
  await initialObserverState;

  const pongMessage = once(uplink, "message");
  uplink.send(JSON.stringify({ type: "preflight_ping", nonce: "probe-123" }));
  const [rawPong] = await pongMessage;
  assert.deepEqual(JSON.parse(String(rawPong)), {
    type: "preflight_pong",
    nonce: "probe-123",
  });

  const stateAfterProbeViewer = new WebSocket(`ws://127.0.0.1:${port}/ws/view`);
  const stateAfterProbeMessage = once(stateAfterProbeViewer, "message");
  await once(stateAfterProbeViewer, "open");
  const [rawStateAfterProbe] = await stateAfterProbeMessage;
  assert.deepEqual(JSON.parse(String(rawStateAfterProbe)).captions, []);
  stateAfterProbeViewer.close();

  const released = Array.from({ length: 120 }, (_, index) => ({
    id: `released-${index}`,
    text: index === 0 ? "Allah ﷻ" : `Caption ${index}`,
  }));
  const appliedState = once(observer, "message");
  uplink.send(JSON.stringify({
    type: "display_state",
    captions: released.slice(-30),
    published_captions: [...released, { id: "skipped", text: "Never shown" }],
    released_captions: released,
  }));
  const [rawAppliedState] = await appliedState;
  assert.equal(JSON.parse(String(rawAppliedState)).type, "display_state");

  const viewer = new WebSocket(`ws://127.0.0.1:${port}/ws/view`);
  const stateMessage = once(viewer, "message");
  await once(viewer, "open");
  const [rawState] = await stateMessage;
  const state = JSON.parse(String(rawState));

  assert.equal(state.captions.length, 30);
  assert.equal(state.released_captions.length, 120);
  assert.equal(state.released_captions[0].id, "released-0");
  assert.equal(
    state.released_captions.some((caption) => caption.id === "skipped"),
    false,
  );

  const page = await fetch(`http://127.0.0.1:${port}/volg`);
  assert.equal(page.headers.get("cache-control"), "no-store");
  const html = await page.text();
  assert.match(html, /const maxCaptions = 1000;/);
  assert.match(html, /message\.released_captions/);
  assert.match(html, /NotoNaskhArabic-Regular\.ttf/);

  const font = await fetch(
    `http://127.0.0.1:${port}/NotoNaskhArabic-Regular.ttf`,
  );
  assert.equal(font.status, 200);
  assert.equal(font.headers.get("content-type"), "font/ttf");
  assert.equal((await font.arrayBuffer()).byteLength, 197420);

  const license = await fetch(
    `http://127.0.0.1:${port}/OFL-NotoNaskhArabic.txt`,
  );
  assert.equal(license.status, 200);
  assert.equal(license.headers.get("content-type"), "text/plain; charset=utf-8");
  const licenseText = await license.text();
  assert.match(licenseText, /Copyright 2022 The Noto Project Authors/);
  assert.match(licenseText, /SIL OPEN FONT LICENSE Version 1\.1/);

  viewer.close();
  observer.close();
  uplink.close();
});
