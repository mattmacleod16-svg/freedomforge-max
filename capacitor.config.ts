import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.freedomforge.max',
  appName: 'FreedomForge Max',
  webDir: '.next',
  server: {
    url: process.env.CAPACITOR_SERVER_URL || 'https://freedomforge-max.up.railway.app',
    cleartext: false,
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
