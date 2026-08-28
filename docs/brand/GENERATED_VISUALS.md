# Lndry generated-visual standard

Source of truth: user-supplied `Lndry Delivery File.zip`, inspected 28 August 2026.

- Brand: **Lndry**.
- Primary brand purple: **`#664CF0`**.
- Mark: the supplied washing-machine/location-pin symbol. Use the supplied logo asset
  exactly wherever a precise logo is required; never redraw or approximate it in code.
- Type reference: Poppins SemiBold in the supplied guideline.

## Rule for generated project imagery

Every newly generated raster visual used by Epic Laundry must visibly carry the
Lndry brand treatment where the image has a suitable branding surface: garment care
tags, package labels, empty-state cards, rider/delivery equipment, and promotional
artwork. Use the official purple and mark; do not introduce a second competing
brand, generic logo, copied competitor asset, watermark, or unrelated colour system.

The official source export is stored at
`webapp/public/brand/lndry-logo-source.png`. Generated art is original but must be
reviewed visually before inclusion. The approved folded-shirt asset is now
`webapp/public/garments/lndry-folded-shirt-v3.png`; this revision carries the
Lndry mark on its care tag and as a small embroidered chest mark. The same binary is
mirrored under `server/public/app/garments/` so the packaged desktop server and the
web build resolve the identical branded visual.

The older `epic-folded-shirt-v1.png` file is retained only as an unreferenced
legacy artifacts for workspace history; catalogue defaults and all active UI paths
use the approved Lndry-branded `lndry-folded-shirt-v3.png` asset.

The catalogue now also ships approved generated visuals for every other seeded
garment: `lndry-folded-trouser-v1.png`, `lndry-folded-saree-v1.png`,
`lndry-folded-kurti-v1.png`, `lndry-folded-blanket-v1.png`,
`lndry-folded-bedsheet-v1.png`, `lndry-mixed-clothes-v1.png`, and
`lndry-shoe-pair-v1.png`. The parity expansion adds `lndry-folded-blazer-v1.png`,
`lndry-folded-dress-v1.png`, `lndry-folded-jeans-v1.png`,
`lndry-folded-hoodie-v1.png`, and `lndry-folded-kurta-v1.png` for the common
formalwear, westernwear, outerwear, and ethnicwear paths seen in larger
reference catalogues. Each is mirrored in `server/public/app/garments/`,
uses a distinct non-white colorway, visibly carries the purple Lndry care-tag
treatment, and was checked for genuine RGBA alpha before inclusion. The full
selection is exposed through the owner catalogue visual picker.

## Current approved visual review

- Regenerated 28 August 2026 with the supplied Lndry mark as the identity reference.
- Transparent PNG with a centered folded white dress shirt and generous padding.
- Brand placement is limited to suitable surfaces: the purple care tag and a small
  purple chest embroidery; no unrelated marks, watermark, or competing palette.
- Approved binary SHA-256: `923A03BEA59C311029D7B68004742B28F7AD9FF3978B399428722D5D37989223`.
- The approved PNG is RGBA (`1230 × 1278`) with genuine per-pixel alpha
  transparency; no checkerboard or matte is baked into the image.
- Future raster artwork (garments, package labels, delivery equipment, empty states,
  and promotional art) must follow the same placement rule and be reviewed before
  it is copied into the application.
