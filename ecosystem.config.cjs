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
  ],
};
