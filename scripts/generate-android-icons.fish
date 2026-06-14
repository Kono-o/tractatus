#!/usr/bin/env fish
# Generate Android launcher icons from static/icon-*.svg at all mipmap densities.
# Called by build-release-apk.fish before cap:sync.

set -l root (builtin realpath (dirname (status filename))/..)
set -l res "$root/android/app/src/main/res"

# Density → pixel size mapping for full icons
set -l sizes mdpi/48 hdpi/72 xhdpi/96 xxhdpi/144 xxxhdpi/192

echo "[tractatus-icons] Generating light launcher icons (open eye, white bg)..."
for entry in $sizes
    set -l dir (string split / $entry)[1]
    set -l px (string split / $entry)[2]
    convert -background '#ffffff' -size {$px}x{$px} "$root/static/icon-light.svg" "$res/mipmap-$dir/ic_launcher_light.png"
    cp "$res/mipmap-$dir/ic_launcher_light.png" "$res/mipmap-$dir/ic_launcher.png"
    cp "$res/mipmap-$dir/ic_launcher_light.png" "$res/mipmap-$dir/ic_launcher_round.png"
end

echo "[tractatus-icons] Generating dark launcher icons (closed eye, black bg)..."
for entry in $sizes
    set -l dir (string split / $entry)[1]
    set -l px (string split / $entry)[2]
    convert -background '#000000' -size {$px}x{$px} "$root/static/icon-dark.svg" "$res/mipmap-$dir/ic_launcher_dark.png"
end

echo "[tractatus-icons] Generating adaptive icon foregrounds (108dp base)..."
convert -background transparent -size 108x108 "$root/static/icon-light-foreground.svg" "$res/mipmap-anydpi-v26/ic_launcher_light_foreground.png"
convert -background transparent -size 108x108 "$root/static/icon-dark-foreground.svg" "$res/mipmap-anydpi-v26/ic_launcher_dark_foreground.png"

echo "[tractatus-icons] Done."
exit 0
