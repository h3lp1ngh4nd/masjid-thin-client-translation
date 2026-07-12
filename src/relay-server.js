import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

function loadEnvFile(filePath = path.resolve(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "8080", 10);
const relayToken = String(process.env.RELAY_TOKEN || "").trim();
const maxCaptions = Math.max(1, Number.parseInt(process.env.MAX_CAPTIONS || "1000", 10));
const volgHeaderText = process.env.VOLG_HEADER_TEXT || "live";
const volgEmptyText = process.env.VOLG_EMPTY_TEXT || "Wachten op vertaling...";
const volgFooterText = process.env.VOLG_FOOTER_TEXT
  || "Live vertaling is in BETA. Er kunnen fouten voorkomen.";
// Reap connections that stop answering pings. Without this, NAT tables and
// reverse proxies silently kill idle sockets (the uplink idles for days
// between khutbahs) and dead viewers linger in memory.
const heartbeatMs = Math.max(
  1000,
  Number.parseInt(process.env.HEARTBEAT_MS || "30000", 10),
);

if (!relayToken) {
  console.error("RELAY_TOKEN is required.");
  process.exit(1);
}

const viewers = new Set();
const uplinks = new Set();

function emptyState() {
  return {
    type: "display_state",
    settings: {},
    max_paced_caption_wait_ms: 0,
    test_mode: false,
    test_captions: [],
    captions: [],
    published_captions: [],
    released_captions: [],
    display_caption_statuses: [],
    audit_events: [],
  };
}

let state = emptyState();

function sendJson(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function broadcast(payload) {
  const encoded = JSON.stringify(payload);
  for (const ws of viewers) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encoded);
    }
  }
}

function trimCaptionLists() {
  if (Array.isArray(state.captions) && state.captions.length > maxCaptions) {
    state.captions = state.captions.slice(-maxCaptions);
  }
  if (
    Array.isArray(state.published_captions)
    && state.published_captions.length > maxCaptions
  ) {
    state.published_captions = state.published_captions.slice(-maxCaptions);
  }
  if (
    Array.isArray(state.released_captions)
    && state.released_captions.length > maxCaptions
  ) {
    state.released_captions = state.released_captions.slice(-maxCaptions);
  }
}

function captionIds(caption) {
  const ids = [];
  if (caption && caption.id) ids.push(String(caption.id));
  if (caption && Array.isArray(caption.merged_caption_ids)) {
    for (const id of caption.merged_caption_ids) {
      const normalized = String(id || "").trim();
      if (normalized && !ids.includes(normalized)) ids.push(normalized);
    }
  }
  return ids;
}

function hasCaption(captions, caption) {
  const ids = captionIds(caption);
  if (!ids.length) return false;
  return captions.some((existing) => captionIds(existing).some((id) => ids.includes(id)));
}

function applyMessage(message) {
  if (!message || typeof message !== "object") return null;

  if (message.type === "display_state") {
    // Replace, never merge: a display_state is a full snapshot, and merging
    // onto the previous state would keep stale fields the new snapshot omits.
    state = {
      ...emptyState(),
      ...message,
      type: "display_state",
      captions: Array.isArray(message.captions) ? [...message.captions] : [],
      published_captions: Array.isArray(message.published_captions)
        ? [...message.published_captions]
        : [],
      released_captions: Array.isArray(message.released_captions)
        ? [...message.released_captions]
        : (Array.isArray(message.captions) ? [...message.captions] : []),
      display_caption_statuses: Array.isArray(message.display_caption_statuses)
        ? [...message.display_caption_statuses]
        : [],
      audit_events: Array.isArray(message.audit_events) ? [...message.audit_events] : [],
    };
    trimCaptionLists();
    return message;
  }

  if (message.type === "caption") {
    const caption = message.caption;
    if (caption && caption.text) {
      if (!Array.isArray(state.captions)) state.captions = [];
      if (!hasCaption(state.captions, caption)) state.captions.push(caption);
      if (!Array.isArray(state.released_captions)) state.released_captions = [];
      if (!hasCaption(state.released_captions, caption)) {
        state.released_captions.push(caption);
      }
      trimCaptionLists();
    }
    return message;
  }

  if (message.type === "clear_captions") {
    state.captions = [];
    state.published_captions = [];
    state.released_captions = [];
    state.display_caption_statuses = [];
    state.audit_events = [];
    return message;
  }

  if (message.type === "display_settings") {
    state.settings = message.settings || {};
    return message;
  }

  if (message.type === "test_state") {
    state.test_mode = Boolean(message.enabled);
    state.test_captions = Array.isArray(message.captions) ? [...message.captions] : [];
    return message;
  }

  return message;
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (filePath.endsWith(".ttf")) return "font/ttf";
  return "application/octet-stream";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeScriptString(value) {
  return JSON.stringify(String(value ?? ""))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function renderVolgHtml(data) {
  return String(data)
    .replaceAll("__VOLG_HEADER_TEXT_JSON__", escapeScriptString(volgHeaderText))
    .replaceAll("__VOLG_EMPTY_TEXT__", escapeHtml(volgEmptyText))
    .replaceAll("__VOLG_FOOTER_TEXT__", escapeHtml(volgFooterText))
    .replaceAll("__MAX_CAPTIONS__", String(maxCaptions));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      viewers: viewers.size,
      uplinks: uplinks.size,
      captions: Array.isArray(state.captions) ? state.captions.length : 0,
    }));
    return;
  }

  const route = url.pathname === "/" ? "/volg" : url.pathname;
  const fileName = route === "/volg" ? "volg.html" : path.basename(route);
  const filePath = path.join(publicDir, fileName);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const headers = { "content-type": contentTypeFor(filePath) };
    if (fileName === "volg.html") headers["cache-control"] = "no-store";
    res.writeHead(200, headers);
    res.end(fileName === "volg.html" ? renderVolgHtml(data) : data);
  });
});

const viewerWss = new WebSocketServer({ noServer: true });
const uplinkWss = new WebSocketServer({ noServer: true });

function trackLiveness(ws) {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
}

const heartbeatTimer = setInterval(() => {
  for (const pool of [viewers, uplinks]) {
    for (const ws of pool) {
      if (ws.isAlive === false) {
        pool.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        pool.delete(ws);
        ws.terminate();
      }
    }
  }
}, heartbeatMs);
heartbeatTimer.unref();

viewerWss.on("connection", (ws) => {
  trackLiveness(ws);
  viewers.add(ws);
  sendJson(ws, state);
  ws.on("close", () => viewers.delete(ws));
  ws.on("error", () => viewers.delete(ws));
});

uplinkWss.on("connection", (ws) => {
  trackLiveness(ws);
  uplinks.add(ws);
  console.log(`uplink connected (${uplinks.size})`);

  ws.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    if (message?.type === "preflight_ping") {
      const nonce = String(message.nonce || "").slice(0, 128);
      if (nonce) sendJson(ws, { type: "preflight_pong", nonce });
      return;
    }
    const outbound = applyMessage(message);
    if (outbound) broadcast(outbound);
  });

  ws.on("close", () => {
    uplinks.delete(ws);
    console.log(`uplink disconnected (${uplinks.size})`);
  });
  ws.on("error", () => uplinks.delete(ws));
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/ws/view") {
    viewerWss.handleUpgrade(req, socket, head, (ws) => {
      viewerWss.emit("connection", ws, req);
    });
    return;
  }

  if (url.pathname === "/ws/uplink") {
    const token = url.searchParams.get("token") || req.headers["x-relay-token"];
    if (token !== relayToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    uplinkWss.handleUpgrade(req, socket, head, (ws) => {
      uplinkWss.emit("connection", ws, req);
    });
    return;
  }

  socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
  socket.destroy();
});

server.listen(port, host, () => {
  console.log(`masjid thin client relay listening on ${host}:${port}`);
});
