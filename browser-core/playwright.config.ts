import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for running MutationObserver tests in real browsers
 */
export default defineConfig({
  testDir: './test/recorder',
  testMatch: 'mutationobserver-behavior-playwright.spec.ts',
  
  // Run tests in multiple browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // Test timeout
  timeout: 30 * 1000,
  
  // Retry on failure
  retries: 0,
  
  // Reporters - save HTML report without serving/opening
  reporter: [
    ['list'],
    ['html', { 
      outputFolder: 'playwright-report',
      open: 'never' // Don't open the report automatically, just save it
    }],
  ],
});

