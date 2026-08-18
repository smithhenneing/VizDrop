// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:8323',
  },
  webServer: {
    command: 'powershell -NoProfile -ExecutionPolicy Bypass -File tools/server.ps1 -Port 8323',
    port: 8323,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
