# Catalogue media audit

Current asset handling is local-only and rejects remote URLs. V4 migration 20 records explicit `visual_key` values for known packaged artwork and the booking UI resolves only the saved custom image or saved key. Unknown/missing visuals render an intentional non-image state; they never become a shirt through text matching.

The audit is now executable with `npm run audit:garment-assets`; the current T1 fixture reports 32 active rows, 24 exact visuals, 8 explicitly intentional shared visuals, and zero missing/invalid/broken paths. `npm run audit:garment-assets:contact-sheet` generates [the review sheet](./CATALOGUE_MEDIA_CONTACT_SHEET.html), containing every active garment, visual key, resolved asset and thumbnail.

Six previously incorrect mappings (handbag, towel, curtain, carpet/rug, soft toy and socks) now use original Epic/Lndry artwork and are migrated to 256px WebP derivatives. The audit still reports 26 oversized legacy PNG warnings, and tie/scarf plus several Indian multi-piece garments remain shared/generic visual decisions requiring visual-owner review. Therefore catalogue media readiness remains **PARTIAL**, despite the zero-path-failure result.
