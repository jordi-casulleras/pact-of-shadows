#!/usr/bin/env bash
# Turns the original illustrations in art/ into the optimised images the game ships.
# Needs ffmpeg and cwebp. Run with `npm run art` after adding or replacing a file in art/.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Cards: centre-cropped to 5:7 and sized for the largest a card is ever shown, at 2x.
for src in art/*; do
  name=$(basename "${src%.*}")
  case "$name" in
    board-desktop) filter="scale=1920:-2" out="src/assets/$name.webp" quality=72 ;;
    board-mobile) filter="scale=1080:-2" out="src/assets/$name.webp" quality=72 ;;
    # The generated back has its own rounded border painted in; trim it, the game draws the real one.
    back) filter="crop=iw*0.93:ih*0.93,crop='min(iw,ih*5/7)':'min(ih,iw*7/5)',scale=480:672" out="src/assets/cards/$name.webp" quality=80 ;;
    *) filter="crop='min(iw,ih*5/7)':'min(ih,iw*7/5)',scale=480:672" out="src/assets/cards/$name.webp" quality=80 ;;
  esac
  ffmpeg -v error -y -i "$src" -vf "$filter" "$tmp/$name.png"
  cwebp -quiet -q "$quality" "$tmp/$name.png" -o "$out"
done
du -ch src/assets/cards/*.webp src/assets/board-*.webp | tail -1
