# Catalogue media audit

Current asset handling is local-only and rejects remote URLs. V4 migration 20 records explicit `visual_key` values for known packaged artwork and the booking UI resolves only the saved custom image or saved key. Unknown/missing visuals render an intentional non-image state; they never become a shirt through text matching.

The audit is now executable with `npm run audit:garment-assets`; the current T1 fixture reports 32 active rows, 24 exact visuals, 8 explicitly intentional shared visuals, zero missing/invalid/broken paths, and zero derivative-budget warnings. `npm run audit:garment-assets:contact-sheet` generates [the review sheet](./CATALOGUE_MEDIA_CONTACT_SHEET.html), containing every active garment, visual key, resolved asset and thumbnail.

Six previously incorrect mappings (handbag, towel, curtain, carpet/rug, soft toy and socks) now use original Epic/Lndry artwork. Every active runtime image now uses a 256px WebP derivative; PNG masters have moved to `assets/garments/masters/` and are no longer packaged with the runtime. Tie/scarf and several Indian multi-piece garments remain intentionally shared/generic visual decisions requiring visual-owner review. Therefore catalogue media readiness remains **PARTIAL** for semantic review, not delivery size or broken-path reasons.
