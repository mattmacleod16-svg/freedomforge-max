import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.freedomforge.max',
  appName: 'FreedomForge Max',
  webDir: '.next',
  server: {
    url: 'https://freedomforge-max.vercel.app',
    cleartext: false,
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
