# Android push (FCM) setup

The error `Default FirebaseApp is not initialized` means the app was built **without** Firebase/FCM. Fix it once, then **rebuild** the dev APK / store AAB.

## 1. Firebase project

1. Open [Firebase Console](https://console.firebase.google.com/)
2. Create a project (or use an existing one)
3. **Add app** → Android  
   - Package name: `in.thenucleus.app` (must match `app.json`)
4. Download **`google-services.json`**
5. Put it in the project root:

   ```
   Placecom-Mobile-app/google-services.json
   ```

6. Commit `google-services.json` (it only contains public IDs)

## 2. EAS — FCM server key (for sending pushes)

Expo’s servers need a Google service account to deliver notifications:

1. Firebase → **Project settings** → **Service accounts** → **Generate new private key** (JSON)
2. Do **not** commit that JSON — add `*-firebase-adminsdk-*.json` to `.gitignore`
3. Upload to EAS:

   ```bash
   npx eas credentials
   ```

   - Android → **development** (and **production** for store builds)  
   - **Google Service Account** → **FCM V1** → upload the JSON

Or upload in [expo.dev](https://expo.dev) → **pal-mobile** → **Credentials** → Android → FCM V1.

Guide: https://docs.expo.dev/push-notifications/fcm-credentials/

## 3. Rebuild the native app

Config is baked into the binary. After adding `google-services.json`:

```bash
npm run build:dev:android
```

Install the new APK, then `npm start` and sign in again.

## Troubleshooting “register works but no notifications”

1. **Local test** — After sign-in, you should see a **“Local test”** notification. If not: check Android notification permission for The Nucleus.
2. **Token in DB** — Supabase → `push_device_tokens` should have your `user_id` and an `ExponentPushToken[…]` value.
3. **FCM on Expo** — Same Firebase project as `google-services.json`; FCM V1 uploaded under **`in.thenucleus.app`** for the profile you built (**development** vs **production**).
4. **Deploy placecom to Vercel** — WhatsApp pushes need `lib/push-notifications.ts`, updated `/api/exotel/whatsapp`, and `/api/push/test`. **No mail cron required.**
5. **Rebuild** — `google-services.json` only applies to APKs built **after** the file was added.

Run migration `0030_push_tokens_rls_fix.sql` if upsert to `push_device_tokens` fails silently.

## 4. iOS (optional)

Upload APNs key in the same EAS **Credentials** screen for iOS if you need iPhone push.
