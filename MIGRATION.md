# Tractatus Migration from Lift Tracker

This document captures the setup and migration process from the original `lift-tracker` project.

**Date:** ~June 2026 (based on chat)

**Original Project:** /media/kono/HDD/dev/lift-tracker (Kono-o/lift-tracker on GitHub)
**New Project:** /media/kono/HDD/dev/tractatus (Kono-o/tractatus on GitHub)

## Stack (Identical to Lift Tracker)
- SvelteKit 5 (runes mode forced)
- Tailwind CSS v4
- Supabase (username + password auth, no email required for core flow)
- Capacitor 8 (Android app + PWA)
- GitHub Releases for auto-updates (APK sideloading)
- Same release/build scripts and signing philosophy

## Key Configurations

### Supabase
- Project URL: https://wreoyekpjmuioemsepal.supabase.co
- Publishable / Anon Key: sb_publishable_ccPBOYh_vnC62FzO3_Op6Q_GWh9Q2YO (stored in .env)
- Setup: `supabase/setup.sql` executed via Supabase CLI (`supabase db query --file supabase/setup.sql --linked`)
  - Includes usernames table, register/rename functions, avatar_seed support, RLS, trigger for OAuth.
- Auth behavior: Exact same as lift-tracker (first launch on device prefers "Sign up", subsequent prefer "Sign in", persisted via Capacitor Preferences, resets on uninstall).

### Auth Redirect URLs (Supabase Auth → URL Configuration)
Add these Redirect URLs:

- http://localhost:5173/auth/callback
- http://127.0.0.1:5173/auth/callback
- https://tractatus-opal.vercel.app/auth/callback
- https://*.vercel.app/auth/callback
- com.tractatus.app://auth/callback

Site URL: https://tractatus-opal.vercel.app

### Capacitor / Android
- appId: com.tractatus.app
- appName: Tractatus
- Native deep link: com.tractatus.app://auth/callback
- Android platform added via `npx cap add android`
- UpdaterPlugin.java placed at: android/app/src/main/java/com/tractatus/app/UpdaterPlugin.java (for GitHub release auto-updates)
- Signing: New keystore generated via `./scripts/setup-android-signing.fish` (stored in scripts/android-signing/, **never commit keys**)
- Build flow: `npm run build:capacitor && npx cap sync` then `./scripts/build-release-apk.fish` for signed APKs named `tractatus-vX.Y.Z.apk`

### Vercel (Website / PWA)
- Actual production URL: https://tractatus-opal.vercel.app/
- Uses `@sveltejs/adapter-vercel` (see svelte.config.js – switches based on `CAPACITOR=1` env)
- Separate from APK build (use `npm run build` for Vercel; `CAPACITOR=1 npm run build` for app)
- Environment variables set on Vercel:
  - PUBLIC_SUPABASE_URL
  - PUBLIC_SUPABASE_ANON_KEY

### Git & Project Hygiene
- Repo: Kono-o/tractatus
- Clean initial commit performed (after gitignore fixes).
- .gitignore updated to protect:
  - .env (real secrets)
  - scripts/android-signing/ (keystores)
  - android/, ios/ (generated)
  - build/, .svelte-kit/
  - node_modules/
  - .vercel, etc.
- .env.example committed (template only)
- No sensitive data in repo.

### Migrated Features (Auth + Core)
- Username/password authentication (full migration of logic from lift-tracker/src/lib/db.ts)
- Identicons via GeneratedAvatar.svelte + avatar_seed
- Auto-update from GitHub Releases (full port of updater.ts + native plugin + UI prompts + post-update modal)
- Session time estimator (1 min per reps set + actual timed targets + N rests for N sets)
- Exercise property editor fixes and +s=0 support for timed exercises (client + server-side Supabase function update)
- New app icon (barbell design, updated across web + Android)
- Basic blog skeleton (write stub, post view) – ready for Substack-like expansion

## Commands Used During Setup
- Project init: `npx sv create . --template minimal --types ts --add tailwindcss ...`
- Supabase CLI: `supabase link --project-ref wreoyekpjmuioemsepal`, then `supabase db query --file supabase/setup.sql --linked`
- Capacitor: `npx cap add android`, `CAPACITOR=1 npm run build`, `npx cap sync`
- Signing: `./scripts/setup-android-signing.fish` (generates new key)
- Git: Cleaned .gitignore, `git add .`, descriptive root commit, `git push`
- Vercel prep: Set PUBLIC_ env vars, auth redirect URLs as listed above

## Next Steps (as of last chat)
- Vercel deployment (connect Kono-o/tractatus repo)
- Add the auth redirect URLs listed above in Supabase for the tractatus project
- Continue building blog features (posts, writing UI, public reading experience)
- First Android release build + GitHub release for auto-update testing

## Notes
- This project deliberately reuses the proven auth + updater architecture from lift-tracker for speed and reliability.
- All "new keys" generated: new Supabase project, new Android signing key.
- Future releases should follow the same RELEASE.md / SIGNING.md pattern (copy from lift-tracker if needed).

For the full chat history / decisions, refer to the original conversation that created this project.
