import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // Sequenziell – geteilter DB-Zustand
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["list"],
  ],

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    // 1) Auth-Setup: Token holen und speichern
    {
      name: "setup",
      testMatch: /auth\.setup\.spec\.js/,
    },

    // 2) Haupt-Tests: laufen mit gespeichertem Auth-State
    {
      name: "chromium",
      use: {
        channel: "chrome",
        storageState: ".auth/user.json",
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        },
      },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.spec\.js/,
    },
  ],
});
