/**
 * Original Lndry visuals that are safe for application UI use.
 * Keep exact supplied brand marks separate from generated illustrations.
 */
export const lndryBrand = {
  name: 'Lndry',
  accent: '#664CF0',
  officialMark: '/ui/app/brand/lndry-logo-source.png',
  mark: '/ui/app/brand/lndry-mark.png',
} as const

export const garmentVisuals = {
  foldedShirt: '/ui/app/garments/optimized/lndry-folded-shirt-v3.webp',
  foldedTrouser: '/ui/app/garments/optimized/lndry-folded-trouser-v1.webp',
  foldedSaree: '/ui/app/garments/optimized/lndry-folded-saree-v1.webp',
  foldedKurti: '/ui/app/garments/optimized/lndry-folded-kurti-v1.webp',
  foldedBlanket: '/ui/app/garments/optimized/lndry-folded-blanket-v1.webp',
  foldedBedsheet: '/ui/app/garments/optimized/lndry-folded-bedsheet-v1.webp',
  mixedClothes: '/ui/app/garments/optimized/lndry-mixed-clothes-v1.webp',
  shoePair: '/ui/app/garments/optimized/lndry-shoe-pair-v1.webp',
  foldedBlazer: '/ui/app/garments/optimized/lndry-folded-blazer-v1.webp',
  foldedDress: '/ui/app/garments/optimized/lndry-folded-dress-v1.webp',
  foldedJeans: '/ui/app/garments/optimized/lndry-folded-jeans-v1.webp',
  foldedHoodie: '/ui/app/garments/optimized/lndry-folded-hoodie-v1.webp',
  foldedKurta: '/ui/app/garments/optimized/lndry-folded-kurta-v1.webp',
  handbag: '/ui/app/garments/optimized/lndry-handbag-v1.webp',
  towel: '/ui/app/garments/optimized/lndry-towel-v1.webp',
  curtain: '/ui/app/garments/optimized/lndry-curtain-v1.webp',
  carpetRug: '/ui/app/garments/optimized/lndry-carpet-rug-v1.webp',
  softToy: '/ui/app/garments/optimized/lndry-soft-toy-v1.webp',
  socksPair: '/ui/app/garments/optimized/lndry-socks-pair-v1.webp',
} as const

export const generatedVisualManifest = {
  brand: lndryBrand,
  garments: garmentVisuals,
} as const
