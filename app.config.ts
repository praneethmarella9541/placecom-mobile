import type { ConfigContext, ExpoConfig } from 'expo/config';
import fs from 'fs';
import path from 'path';

const appJson = require('./app.json');

function readAppVersion(): string {
  const file = path.join(__dirname, 'constants', 'app-version.ts');
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error('APP_VERSION not found in constants/app-version.ts');
  return match[1];
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = appJson.expo as ExpoConfig;
  const android = { ...base.android };

  // Edge-to-edge production APKs need pan + manual keyboard insets. Expo Go and
  // local dev keep resize (see lib/android-keyboard-layout.ts).
  const easProfile = process.env.EAS_BUILD_PROFILE;
  const androidManualKeyboard =
    easProfile === 'production' ||
    easProfile === 'production-apk' ||
    easProfile === 'preview';

  android.softwareKeyboardLayoutMode = androidManualKeyboard ? 'pan' : 'resize';

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
    version: readAppVersion(),
    android,
    extra: {
      ...base.extra,
      androidManualKeyboard,
    },
  };
};
