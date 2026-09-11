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
  sherwani: '/ui/app/garments/optimized/lndry-sherwani-v1.webp',
  blouse: '/ui/app/garments/optimized/lndry-blouse-v1.webp',
  salwarSuit: '/ui/app/garments/optimized/lndry-salwar-suit-v1.webp',
  lehenga: '/ui/app/garments/optimized/lndry-lehenga-v1.webp',
  tieScarf: '/ui/app/garments/optimized/lndry-tie-scarf-v1.webp',
  pillowCover: '/ui/app/garments/optimized/lndry-pillow-cover-v1.webp',
  quiltDuvet: '/ui/app/garments/optimized/lndry-quilt-duvet-v1.webp',
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
  services: {
    // Original Epic Laundry service artwork, generated for the visual booking desk.
    // Functional service meaning continues to use the local catalogue and Lucide glyphs.
    washFold: '/ui/app/services/lndry-service-wash-fold-v1.webp',
    steamPress: '/ui/app/services/lndry-service-steam-press-v1.webp',
    dryClean: '/ui/app/services/lndry-service-dry-clean-v1.webp',
    shoeCare: '/ui/app/services/lndry-service-shoe-care-v1.webp',
  },
  illustrations: {
    // Original order-state illustration; used only as supporting context, never as a control icon.
    emptyOrder: '/ui/app/illustrations/lndry-empty-order-v1.webp',
    // Generated for calm, explanatory empty states in operational and finance work.
    // They are not used as functional icons or evidence of a business event.
    emptyOperations: '/ui/app/illustrations/lndry-empty-operations-v1.png',
    emptyFinance: '/ui/app/illustrations/lndry-empty-finance-v1.png',
    emptyDelivery: '/ui/app/illustrations/lndry-empty-delivery-v1.png',
    emptyQuality: '/ui/app/illustrations/lndry-empty-quality-v1.png',
    emptyCustomers: '/ui/app/illustrations/lndry-empty-customers-v1.png',
    // Decorative only: original generated lifecycle icon ribbon used beside
    // text-labelled customer lifecycle states. It never carries business meaning alone.
    customerLifecycleRibbon: '/ui/app/illustrations/lndry-customer-lifecycle-ribbon-v1.png',
  },
} as const
