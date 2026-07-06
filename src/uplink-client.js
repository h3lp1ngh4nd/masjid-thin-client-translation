import WebSocket from "ws";

const localViewWs = String(process.env.LOCAL_VIEW_WS || "ws://127.0.0.1:8000/ws/view");
const relayUplinkWs = String(process.env.RELAY_UPLINK_WS || "").trim();
const relayToken = String(process.env.RELAY_TOKEN || "").trim();
const reconnectMinMs = Number.parseInt(process.env.RECONNECT_MIN_MS || "500", 10);
const reconnectMaxMs = Number.parseInt(process.env.RECONNECT_MAX_MS || "5000", 10);

if (!relayUplinkWs) {
  console.error("RELAY_UPLINK_WS is required.");
  process.exit(1);
}
if (!relayToken) {
  console.error("RELAY_TOKEN is required.");
  process.exit(1);
}

function withToken(rawUrl) {
  const url = new URL(rawUrl);
  url.searchParams.set("token", relayToken);
  return url.toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function closeQuietly(ws) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  } catch {
    // best effort
  }
}

async function runBridge() {
  let attempt = 0;

  for (;;) {
    let relay = null;
    let local = null;

    try {
      console.log(`connecting relay ${relayUplinkWs}`);
      relay = new WebSocket(withToken(relayUplinkWs));
      await waitOpen(relay, "relay");

      console.log(`connecting local viewer ${localViewWs}`);
      local = new WebSocket(localViewWs);
      await waitOpen(local, "local");

      attempt = 0;
      console.log("uplink bridge connected");

      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };

        local.on("message", (data) => {
          if (relay.readyState === WebSocket.OPEN) {
            relay.send(data);
          }
        });
        local.on("close", finish);
        local.on("error", finish);
        relay.on("close", finish);
        relay.on("error", finish);
      });
    } catch (error) {
      console.error(`uplink bridge error: ${error.message}`);
    } finally {
      closeQuietly(local);
      closeQuietly(relay);
    }

    const delay = Math.min(
      reconnectMaxMs,
      reconnectMinMs * (2 ** Math.min(attempt, 6)),
    );
    attempt += 1;
    console.log(`reconnecting in ${delay}ms`);
    await sleep(delay);
  }
}

function waitOpen(ws, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${label} websocket open timed out`));
    }, 10000);

    const cleanup = () => {
      clearTimeout(timer);
      ws.off("open", onOpen);
      ws.off("error", onError);
      ws.off("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`${label} websocket closed before opening`));
    };

    ws.once("open", onOpen);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
}

runBridge().catch((error) => {
  console.error(error);
  process.exit(1);
});
