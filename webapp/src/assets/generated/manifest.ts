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
  foldedShirt: '/ui/app/garments/lndry-folded-shirt-v3.png',
  foldedTrouser: '/ui/app/garments/lndry-folded-trouser-v1.png',
  foldedSaree: '/ui/app/garments/lndry-folded-saree-v1.png',
  foldedKurti: '/ui/app/garments/lndry-folded-kurti-v1.png',
  foldedBlanket: '/ui/app/garments/lndry-folded-blanket-v1.png',
  foldedBedsheet: '/ui/app/garments/lndry-folded-bedsheet-v1.png',
  mixedClothes: '/ui/app/garments/lndry-mixed-clothes-v1.png',
  shoePair: '/ui/app/garments/lndry-shoe-pair-v1.png',
  foldedBlazer: '/ui/app/garments/lndry-folded-blazer-v1.png',
  foldedDress: '/ui/app/garments/lndry-folded-dress-v1.png',
  foldedJeans: '/ui/app/garments/lndry-folded-jeans-v1.png',
  foldedHoodie: '/ui/app/garments/lndry-folded-hoodie-v1.png',
  foldedKurta: '/ui/app/garments/lndry-folded-kurta-v1.png',
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
