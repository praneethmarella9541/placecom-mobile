# PlaceCom Mobile

React Native (Expo) mobile app for Android & iOS, mirroring all features of the PlaceCom web application.

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
- `EXPO_PUBLIC_API_BASE_URL` — your deployed PlaceCom Next.js app URL (e.g. `https://yourapp.vercel.app`)
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
- **Backend**: Connects to existing PlaceCom Next.js API endpoints + Supabase DB directly
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
    ├── inbox/               # Gmail inbox (threads + reply)
    ├── crm/                 # Lead management (dual funnel + interactions)
    ├── calls/               # Twilio call logs + transcripts
    ├── sms/                 # Two-way SMS (Twilio)
    ├── whatsapp/            # Two-way WhatsApp (Twilio)
    ├── calendar/            # Google Calendar (view + create events)
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
| **Inbox** | Gmail integration — thread list, read emails, send replies |
| **CRM** | Dual-funnel lead management (New Lead / Regular Recruiter), lead scoring (Hot/Warm/Cold), interaction logging |
| **Calls** | Twilio call log, recordings, AI transcripts, make outbound calls |
| **SMS** | Two-way Twilio SMS — conversation threads, send/receive |
| **WhatsApp** | Two-way Twilio WhatsApp — conversation threads, send/receive |
| **Calendar** | Google Calendar — monthly view, event list, create events |
| **Meetings** | Fireflies meeting recordings, AI summaries + transcripts, email summaries |
| **Drive** | Google Drive browser — folder navigation, file upload |
| **Forms** | Google Forms list, create new forms |
| **Broadcasting** | Bulk email/SMS/WhatsApp with recipient list |
| **Dashboard** | OpenAI-powered email contact extraction, job history, cost tracking |
| **Admin/Team** | Add/edit/delete team members, role assignment, feature restrictions |

## Role-Based Access
- **Admin**: Full access to all features including Team management
- **Staff**: Access to all features except Team management
- **Committee**: Restricted access — admin controls which features are visible

## Running on Device
Use the [Expo Go](https://expo.dev/go) app to scan the QR code from `npm start`, or build a native binary with `eas build`.
