import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.freedomforge.max',
  appName: 'FreedomForge Max',
  webDir: '.next',
  server: {
    url: process.env.CAPACITOR_SERVER_URL || process.env.APP_BASE_URL || 'https://freedomforge.one',
    cleartext: false,
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
