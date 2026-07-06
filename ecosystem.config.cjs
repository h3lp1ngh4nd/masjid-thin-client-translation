module.exports = {
  apps: [
    {
      name: "masjid-volg-relay",
      script: "src/relay-server.js",
      cwd: __dirname,
      interpreter: "node",
      env: {
        HOST: process.env.HOST || "0.0.0.0",
        PORT: process.env.PORT || "8080",
        RELAY_TOKEN: process.env.RELAY_TOKEN || "",
        MAX_CAPTIONS: process.env.MAX_CAPTIONS || "100",
      },
      autorestart: true,
      restart_delay: 1000,
      max_restarts: 20,
    },
    {
      name: "masjid-volg-uplink",
      script: "src/uplink-client.js",
      cwd: __dirname,
      interpreter: "node",
      env: {
        LOCAL_VIEW_WS: process.env.LOCAL_VIEW_WS || "ws://127.0.0.1:8000/ws/view",
        RELAY_UPLINK_WS: process.env.RELAY_UPLINK_WS || "",
        RELAY_TOKEN: process.env.RELAY_TOKEN || "",
        RECONNECT_MIN_MS: process.env.RECONNECT_MIN_MS || "500",
        RECONNECT_MAX_MS: process.env.RECONNECT_MAX_MS || "5000",
      },
      autorestart: true,
      restart_delay: 1000,
      max_restarts: 20,
    },
  ],
};
