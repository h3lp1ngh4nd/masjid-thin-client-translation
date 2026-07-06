module.exports = {
  apps: [
    {
      name: "masjid-volg-relay",
      script: "src/relay-server.js",
      cwd: __dirname,
      interpreter: "node",
      autorestart: true,
      restart_delay: 1000,
      max_restarts: 20,
    },
  ],
};
