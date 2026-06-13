#!/usr/bin/env fish
# Generate (or ensure) Android launcher icons for release APK builds.
#
# This script is called by build-release-apk.fish before cap:sync.
#
# Current status: No-op / success stub.
# Icons are already committed in android/app/src/main/res/mipmap-*/ (from Capacitor template + prior runs).
#
# When ready for real icon automation:
#   - Place a high-res source icon (e.g. static/icon.png or assets/icon.svg)
#   - Use npx @capacitor/assets or sharp + manual copy into the various mipmap-* and drawable-* folders
#   - Or port a real implementation if icon automation is added later.
#
# Keeping this script ensures the release build flow never fails on missing icon step.

set -l root (builtin realpath (dirname (status filename))/..)
cd $root || exit 1

echo "[tractatus-icons] Android icon resources present in res/mipmap-*."
echo "[tractatus-icons] Skipping generation (stub). Run with real icon source when branding updates needed."

# Always succeed so the caller (build-release-apk.fish) continues cleanly.
exit 0
