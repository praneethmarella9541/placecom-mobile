import type { ConfigContext, ExpoConfig } from 'expo/config';
import fs from 'fs';

const appJson = require('./app.json');

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = appJson.expo as ExpoConfig;
  const android = { ...base.android };

  if (fs.existsSync('./google-services.json')) {
    android.googleServicesFile = './google-services.json';
  }

  android.intentFilters = [
    {
      action: 'VIEW',
      autoVerify: false,
      data: [{ scheme: 'thenucleus', host: 'auth', pathPrefix: '/callback' }],
      category: ['BROWSABLE', 'DEFAULT'],
    },
  ];

  return {
    ...config,
    ...base,
    android,
  };
};
