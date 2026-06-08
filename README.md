# The Nucleus Mobile

React Native (Expo) mobile app for Android & iOS, mirroring all features of The Nucleus web application.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
Copy `.env.example` to `.env.local` and fill in your values:
```bash
cp .env.example .env.local
```

Required values:
- `EXPO_PUBLIC_SUPABASE_URL` — your Supabase project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — your Supabase anon key
- `EXPO_PUBLIC_API_BASE_URL` — your deployed The Nucleus Next.js app URL (e.g. `https://yourapp.vercel.app`)
- `EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB` — Google OAuth client ID (Web)

### 3. Run the app
```bash
# Start Expo dev server
npm start

# Android
npm run android

# iOS (requires macOS)
npm run ios
```

## Architecture

### Stack
- **Framework**: Expo SDK 54 + Expo Router v6 (file-based routing)
- **Language**: TypeScript (strict mode)
- **Auth**: Supabase Auth (email/password + Google OAuth)
- **Backend**: Connects to existing The Nucleus Next.js API endpoints + Supabase DB directly
- **Navigation**: Slide-out drawer sidebar (left panel, mirrors web app sidebar)

### Project Structure
```
app/
├── _layout.tsx              # Root layout + auth guard
├── index.tsx                # Redirect to inbox
├── (auth)/
│   └── login.tsx            # Login screen (email + Google OAuth)
└── (workspace)/
    ├── _layout.tsx          # Drawer sidebar navigation
    ├── inbox/               # Mail / Gmail (threads + reply)
    ├── crm/                 # Lead management (dual funnel + interactions)
    ├── calls/               # Twilio call logs + transcripts
    ├── sms/                 # Two-way SMS (Twilio)
    ├── whatsapp/            # Two-way WhatsApp (Twilio)
    ├── calendar/            # Google Calendar (create/edit/delete, Meet, guests)
    ├── meetings/            # Fireflies meeting recordings + AI transcripts
    ├── drive/               # Google Drive file browser
    ├── forms/               # Google Forms builder
    ├── broadcasting/        # Bulk email/SMS/WhatsApp campaigns
    ├── dashboard/           # AI email contact extraction (OpenAI)
    └── admin/               # Team member management (Admin only)

lib/
├── supabase.ts              # Supabase client
├── api.ts                   # All API calls to Next.js backend
└── types.ts                 # TypeScript types (mirrors DB schema)

components/
├── ScreenHeader.tsx         # Header with hamburger menu + optional action
├── EmptyState.tsx           # Empty state placeholder
├── Badge.tsx                # Colored pill badge
└── LoadingScreen.tsx        # Full-screen loading indicator

hooks/
└── useAuth.ts               # Session, profile, role, feature access

constants/
└── colors.ts                # Design system colors
```

## Features

| Module | Description |
|--------|-------------|
| **Mail** | Gmail integration — thread list, read emails, send replies |
| **CRM** | Dual-funnel lead management (New Lead / Regular Recruiter), lead scoring (Hot/Warm/Cold), interaction logging |
| **Calls** | Twilio call log, recordings, AI transcripts, make outbound calls |
| **SMS** | Two-way Twilio SMS — conversation threads, send/receive |
| **WhatsApp** | Two-way Twilio WhatsApp — conversation threads, send/receive |
| **Calendar** | Google Calendar — monthly view, event list, create events |
| **Meetings** | Fireflies meeting recordings, AI summaries + transcripts, email summaries |
| **Drive** | Google Drive browser — folder navigation, file upload |
| **Forms** | Google Forms — list, build questions, settings, share link |
| **Broadcasting** | Bulk email/SMS/WhatsApp with recipient list |
| **Dashboard** | OpenAI-powered email contact extraction, job history, cost tracking |
| **Admin/Team** | Add/edit/delete team members, role assignment, feature restrictions |

## Role-Based Access
- **Admin**: Full access to all features including Team management
- **Staff**: Access to all features except Team management
- **Committee**: Restricted access — admin controls which features are visible

## Push notifications (WhatsApp + mail)

Requires a **development build** or **EAS production build** (not Expo Go alone). On sign-in the app registers an Expo push token with `POST /api/push/register`.

**Backend (deploy placecom + Supabase):**

1. Run migration `placecom/supabase/migrations/0029_push_notifications.sql`
2. Set `CRON_SECRET` on Vercel (used by `/api/cron/gmail-push` every 2 minutes for new mail)
3. WhatsApp pushes fire immediately from the Exotel/Twilio inbound webhooks

**iOS:** Configure push credentials in [Expo dashboard](https://expo.dev) → your project → Credentials.

**Android:** Requires `google-services.json` + FCM V1 key on EAS — see [docs/FCM_SETUP.md](docs/FCM_SETUP.md). Rebuild after adding the file.

## EAS builds (recommended)

Logged in as **dreamerslabs** on [expo.dev](https://expo.dev/accounts/dreamerslabs/projects/pal-mobile).

| Goal | Command | Output |
|------|---------|--------|
| **Dev APK** (push + dev client) | `npm run build:dev:android` | `.apk` — install, then `npm start` |
| **Play Store** | `npm run build:store:android` | `.aab` (app-bundle) |
| **Release APK** (share without Play Store) | `npm run build:apk:android` or `npm run build:local:apk:android` | `.apk` standalone (no dev client) |

Download from the build page when status is **Finished**, or:

```bash
npx eas-cli build:list --platform android --limit 5
npx eas-cli build:download --id <BUILD_ID>
```

**Dev APK:** includes `expo-dev-client`; connect to your Metro server after install.  
**Store AAB:** standalone release build (`versionCode` auto-increments on EAS). Upload the `.aab` in Google Play Console → Production / Testing.

## Android native build (`expo run:android`)

Requires **Java 17+** and the Android SDK (`ANDROID_HOME` is set in `~/.zshrc`).

If you see `JAVA_HOME is set to an invalid directory`:

1. Install [Android Studio](https://developer.android.com/studio) (recommended — includes a JDK), **or** `brew install openjdk@17`
2. Open a **new terminal** (reloads `~/.zshrc`) or run `source ~/.zshrc`
3. Run `npm run android` (uses `scripts/run-android.sh` to pick a valid JDK)

## Running on Device
Use a dev client (`npm start` / `npm run android`) or build a native binary with `eas build`. Push notifications need a physical device and EAS `projectId` in `app.json`.
