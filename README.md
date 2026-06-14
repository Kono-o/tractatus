<div align="center">
  <img src="static/icon-light.svg" width="80" height="80" alt="Tractatus logo">

  <h1 align="center">Tractatus</h1>

  <p align="center">
    A minimalist writing platform — blog on the web, app on Android.
    <br />
    <a href="https://tractatus-opal.vercel.app"><strong>tractatus-opal.vercel.app »</strong></a>
    <br />
    <br />
    <img src="https://img.shields.io/badge/SvelteKit-5-FF3E00?logo=svelte" alt="SvelteKit 5">
    <img src="https://img.shields.io/badge/Android-Capacitor-3DDC84?logo=android" alt="Android / Capacitor">
    <img src="https://img.shields.io/badge/Supabase-FF6600?logo=supabase" alt="Supabase">
    <img src="https://img.shields.io/badge/TipTap_Editor-3.26-2196F3" alt="TipTap Editor">
    <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version 1.0.0">
  </p>
</div>

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Supabase Setup](#supabase-setup)
- [Project Structure](#project-structure)
- [Development](#development)
  - [Web (Vite)](#web-vite)
  - [Android](#android)
- [Architecture](#architecture)
  - [Auth Flow](#auth-flow)
  - [Editor & Rendering](#editor--rendering)
  - [Realtime Feed](#realtime-feed)
  - [Auto-Update System](#auto-update-system)
- [Deployment](#deployment)
  - [Vercel (Web)](#vercel-web)
  - [Android APK Release](#android-apk-release)
- [Scripts](#scripts)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Tractatus is a minimalist writing platform where you write in a rich-text editor and publish instantly to a public feed. It works as a **progressive web app** on any device and ships as a **native Android app** via Capacitor. Auth is username-based — no email required.

The name is a nod to Wittgenstein's *Tractatus Logico-Philosophicus*.

---

## Features

- **Rich-Text Editor** — TipTap-powered with headings, bold, italic, inline code, blockquotes, unordered lists, links, images, syntax-highlighted code blocks, underline, subscript, superscript, and text alignment.
- **Public Feed** — Real-time updated feed of published essays with excerpts, identicons, and author attribution.
- **Dark Mode** — Full theme toggle persisted to localStorage (eye open/closed iconography).
- **Dynamic App Icon** — Android launcher icon switches between open-eye (light) and closed-eye (dark) to match the theme.
- **Code Blocks** — Syntax highlighting via lowlight (highlight.js), language labels, and one-click copy with animated checkmark feedback.
- **Identicon Avatars** — Perceptually uniform OKLCH-based 5×5 grid generated from a user's avatar seed.
- **Library** — Personal essay management with search, sort by created date, and two-click delete confirmation.
- **Optimistic UI** — Draft/Public toggles update instantly and revert on error — no page reloads.
- **Pull-to-Refresh** — Mobile-friendly feed refresh via swipe gesture.
- **Auto-Update** — Android app checks GitHub Releases on startup and offers to download & install new APKs in-app.
- **PWA** — Installable with standalone display, portrait orientation, and dark theme.
- **Save Status Chip** — Real-time indicator: Unsaved (amber), Saving (blue), Saved (green).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | [SvelteKit 5](https://kit.svelte.dev) (runes) |
| **Language** | [TypeScript 6](https://www.typescriptlang.org) |
| **Styling** | [Tailwind CSS 4](https://tailwindcss.com) |
| **Rich Text** | [TipTap 3](https://tiptap.dev) + [ProseMirror](https://prosemirror.net) |
| **Markdown** | [marked](https://marked.js.org) + [Turndown](https://github.com/mixmark-io/turndown) |
| **Syntax Highlighting** | [highlight.js](https://highlightjs.org) / [lowlight](https://github.com/wooorm/lowlight) |
| **Backend** | [Supabase](https://supabase.com) (Postgres, Auth, Realtime, Storage) |
| **Mobile** | [Capacitor 8](https://capacitorjs.com) (Android) |
| **Web Hosting** | [Vercel](https://vercel.com) (Node.js 22) |
| **Icons** | [Lucide](https://lucide.dev) |
| **Fonts** | Inter, DM Serif Display, Source Serif 4, JetBrains Mono, Playfair Display, Space Mono, Oxanium |

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) >= 18
- npm
- A [Supabase](https://supabase.com) project (free tier works)
- (Optional) [Android Studio](https://developer.android.com/studio) + JDK 17 for Android builds

### Installation

```bash
git clone https://github.com/Kono-o/tractatus.git
cd tractatus
npm install
```

### Supabase Setup

1. Create a **new** Supabase project at [supabase.com](https://supabase.com).
2. Copy `.env.example` to `.env` and fill in your project's URL and anon key:

```bash
cp .env.example .env
# Edit .env:
#   PUBLIC_SUPABASE_URL=https://your-project.supabase.co
#   PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

3. In the Supabase SQL Editor, run the entire `supabase/setup.sql` file. This creates the `usernames` table, sets up Row-Level Security, creates helper functions, and enables realtime.

---

## Project Structure

```
tractatus/
├── android/                  # Capacitor Android platform
│   └── app/src/main/java/    # Custom native plugins (UpdaterPlugin, IconSwitcherPlugin)
├── scripts/                  # Fish shell build & dev helpers
│   ├── build-release-apk.fish
│   ├── generate-android-icons.fish
│   └── setup-android-signing.fish
├── src/
│   ├── lib/
│   │   ├── components/       # Svelte components (AuthScreen, RichEditor, GeneratedAvatar, etc.)
│   │   ├── db.ts             # Supabase client, auth, and data access
│   │   ├── markdown.ts       # Shared markdown rendering utilities
│   │   ├── updater.ts        # GitHub Releases auto-updater
│   │   ├── native.ts         # Capacitor native helpers
│   │   └── icon-switcher.ts  # Android icon theme switching bridge
│   ├── routes/
│   │   ├── +page.svelte      # Home / feed / library / writer
│   │   ├── +layout.svelte    # Root layout
│   │   ├── post/[slug]/      # Public essay reader page
│   │   └── write/            # Standalone writing page
│   └── app.css               # Global styles, theme variables, dark mode
├── static/                   # Static assets (icons, manifest, robots.txt)
├── supabase/
│   ├── setup.sql             # Full DB schema & RLS setup
│   └── migrations/           # Timestamped SQL migrations
├── capacitor.config.ts       # Capacitor configuration
├── svelte.config.js          # SvelteKit adapter config (Vercel / static)
└── vite.config.ts            # Vite + Tailwind + SvelteKit
```

---

## Development

### Web (Vite)

```bash
npm run dev
```

Opens on `http://localhost:5173`. Uses Vite dev server with HMR.

### Android

Build the static web assets and sync to Android:

```bash
npm run cap:sync
```

Open in Android Studio:

```bash
npm run cap:open:android
```

For a full release build from scratch:

```bash
npm run build:apk:release
```

---

## Architecture

### Auth Flow

Auth is handled entirely through Supabase Auth with username/password credentials. A `usernames` table maps display names to Supabase user IDs. The app uses PKCE flow and persists session tokens via `@capacitor/preferences` on native or `localStorage` on web.

- First launch on a device shows **Sign Up**.
- Subsequent launches prefer **Sign In**.
- User avatars are identicons generated from `avatar_seed` stored in the `usernames` table.

### Editor & Rendering

Writing uses **TipTap** (ProseMirror-based) with a rich toolbar. On save, content is serialized to HTML via TipTap's `getHTML()`. For reading, the same HTML is sanitized with DOMPurify and rendered with shared CSS classes. A Markdown pipeline (`marked` + `Turndown`) is also available for import/export.

Syntax highlighting uses **lowlight** (highlight.js wrapper) inside TipTap code blocks and during static rendering — the same highlighter, same theme (Atom One Dark/Light).

### Realtime Feed

Published essays are broadcast via **Supabase Realtime** (Postgres replication). The client subscribes to `essays` and `usernames` channels and debounces updates (2 seconds) before refreshing the feed. A dedup guard prevents redundant refreshes within 800ms.

### Auto-Update System

The Android app checks `api.github.com/repos/Kono-o/tractatus/releases/latest` on startup. If a newer version is found, it downloads the APK via `@capacitor/filesystem`, verifies size and magic bytes, then launches the Android system installer. A centered update prompt with release notes is shown, followed by a "UPDATED" confirmation screen post-install.

---

## Deployment

### Vercel (Web)

The project auto-deploys from the `master` branch to [tractatus-opal.vercel.app](https://tractatus-opal.vercel.app). Environment variables (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`) must be configured in the Vercel dashboard.

The `svelte.config.js` smart-switches between adapters:
- **Vercel** (`adapter-vercel`, Node.js 22.x) — default for `npm run build`
- **Static** (`adapter-static`, with `fallback: 'index.html'`) — used when `CAPACITOR=1` env is set for Android builds

### Android APK Release

```bash
./scripts/build-release-apk.fish
```

This runs the full pipeline:
1. Generate Android icon PNGs from SVGs
2. Set up or reuse the release keystore
3. Build static assets with `CAPACITOR=1`
4. Sync with `npx cap sync`
5. Patch the Android version name
6. Assemble the signed release APK

Output: `android/app/build/outputs/apk/release/tractatus-v1.0.0.apk`

---

## Scripts

| Script | Description |
|--------|------------|
| `npm run dev` | Start Vite dev server (LAN accessible) |
| `npm run build` | Production build for Vercel |
| `npm run build:capacitor` | Static build for Android |
| `npm run cap:sync` | Build + Capacitor sync |
| `npm run cap:open:android` | Open Android project in Android Studio |
| `npm run build:apk:release` | Full signed APK release build |
| `npm run check` | Run `svelte-check` for type checking |

---

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes and run `npm run check` for type safety.
4. Commit with conventional commits (`feat:`, `fix:`, `refactor:`, etc.).
5. Push and open a pull request.

---

## License

Distributed under the MIT License. See `LICENSE` for more information.
