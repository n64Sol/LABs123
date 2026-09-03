---
name: LPC sprite composition gotchas
description: Non-obvious layer/alignment rules when composing Universal-LPC sprite sheets for Labyrinths
---

# Universal-LPC sprite composition

## The body sheet is HEADLESS — head is a separate layer
- `body/bodies/<sex>/<tone>.png` contains torso + limbs only, **no head/face**. The head is a separate
  category: `head/heads/<race>/<sex>/<tone>.png` (e.g. `head/heads/human/male/light.png`).
- **Why it matters:** composing body + eyes + hair without a head leaves an empty neck stump; hair floats
  above the gap and the empty face reads as a "black/dark face." This bug shipped silently because the hair
  hid the top of the head at small scale.
- **How to apply:** any composed LPC character MUST include a head layer, z-ordered right after `body`
  (order: shadow, weapon_behind, cape, body, **head**, eyes, hair, legs, feet, torso, shield, weapon_fg).
- The `eyes` layer is tiny (~2 iris pixels) — it is never the cause of a large dark face band.

## Sheet alignment / frame layout
- Expanded universal sheets are 832x2944 (46 rows); classic are 832x1344 (21 rows). Walk = rows 8-11 on
  both (`base = 8 if rows > 11 else 0` works because both have >11 rows... classic has 21).
- Oversize weapons (e.g. katana 1664x512) use 128px frames, walk_row_base 0, centered with offset (64-128)/2 = -32.
- The `hair_split/` pack is a SEPARATE root the user added; it aligns to the head position, so it only looks
  right once the head layer is present.

## Katana weapon sheets — animation coverage
- Katana only ships walk and slash sheets (walk/katana.png, slash/katana.png + behind/ variants); NO spellcast/thrust/shoot/hurt.
- Layer order for multi-animation weapons: weapon_behind_walk (rows 8-11), weapon_behind_slash (rows 12-15), ...cape, body, head...shield, weapon_fg_walk, weapon_fg_slash.
- For rows with no weapon sheet (spellcast, thrust, shoot, hurt), simply omit the weapon layer — don't error.

## LPC source is NOT committed to git — always re-download
- The LPC asset pack is at Google Drive file id `1_SlDDh8c5UlCpUEeFtl-w-Iu9mWxfI4L` (~557 MB).
- Use `gdown` to fetch: `gdown.download(f'https://drive.google.com/uc?id={file_id}', ...)`.
- The pack is a zip of per-category zips (e.g. body_bodies.zip, head_heads.zip, etc.). Extract per-category.
- Only composed output PNGs are committed; raw source is never in git.
