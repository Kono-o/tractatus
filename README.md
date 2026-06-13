# Tractatus

A minimalist writing platform (blog + app) inspired by Substack.

## Stack (exact same as Lift Tracker)
- SvelteKit 5 (runes)
- Tailwind 4 + Vite
- Supabase (username/password auth + identicons)
- Capacitor (Android app + PWA)
- Same username-based auth system (no email required for core flow)

## Auth (migrated)
- Username + password (3-24 chars)
- First launch on a device prefers "Sign up"
- Subsequent launches prefer "Sign in"
- Identicons using avatar_seed from Supabase
- Full support for rename, avatar seed, etc.

## Getting Started

1. Create a **new** Supabase project.
2. Copy `.env.example` → `.env` and fill with your new keys.
3. In Supabase SQL Editor, run the entire `supabase/setup.sql`.
4. `npm install`
5. `npm run dev`

## Android
- `npm run cap:sync`
- `npm run cap:open:android`
- For release builds: set up new signing (see scripts like the original project)

## Next
- Posts / writing UI
- Public reading experience
- Etc.

This is the auth + skeleton migration. The blog features come next.

## Auto-Updates (GitHub Releases)
- The app checks https://api.github.com/repos/Kono-o/tractatus/releases/latest on startup (after sign-in).
- Prefers tractatus-vX.Y.Z.apk assets.
- Native streaming download + size/magic-byte verification + system installer.
- Centered update prompt + post-update "UPDATED" screen with release notes.
- Same stable-key + release process as Lift Tracker (copy of RELEASE.md / SIGNING.md recommended).

To publish updates: tag + release an APK named `tractatus-vX.Y.Z.apk` on GitHub. The in-app updater will offer it to users.
