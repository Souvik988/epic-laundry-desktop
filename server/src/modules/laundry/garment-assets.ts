import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../../kernel/store.js';

const VISUAL_ASSETS: Record<string, string> = {
  foldedShirt: '/ui/app/garments/lndry-folded-shirt-v3.png', foldedTrouser: '/ui/app/garments/lndry-folded-trouser-v1.png', foldedSaree: '/ui/app/garments/lndry-folded-saree-v1.png', foldedKurti: '/ui/app/garments/lndry-folded-kurti-v1.png', foldedBlanket: '/ui/app/garments/lndry-folded-blanket-v1.png', foldedBedsheet: '/ui/app/garments/lndry-folded-bedsheet-v1.png', mixedClothes: '/ui/app/garments/lndry-mixed-clothes-v1.png', shoePair: '/ui/app/garments/lndry-shoe-pair-v1.png', foldedBlazer: '/ui/app/garments/lndry-folded-blazer-v1.png', foldedDress: '/ui/app/garments/lndry-folded-dress-v1.png', foldedJeans: '/ui/app/garments/lndry-folded-jeans-v1.png', foldedHoodie: '/ui/app/garments/lndry-folded-hoodie-v1.png', foldedKurta: '/ui/app/garments/lndry-folded-kurta-v1.png',
};
const publicRoot = resolve(process.env.EPIC_PUBLIC_ROOT || join(dirname(fileURLToPath(import.meta.url)), '../../../public/app'));
const localAsset = (asset: string) => { if (!asset.startsWith('/ui/app/')) return undefined; const target = resolve(publicRoot, asset.slice('/ui/app/'.length)); const rootPrefix = publicRoot.endsWith(sep) ? publicRoot : `${publicRoot}${sep}`; return target === publicRoot || target.startsWith(rootPrefix) ? target : undefined; };

export type GarmentAssetAuditItem = { id: string; name: string; category: string; visualKey: string; photo: string; classification: 'exact_visual' | 'intentional_shared_visual' | 'custom_image' | 'missing' | 'invalid_visual_key' | 'invalid_path' | 'broken_asset'; resolvedAsset?: string; bytes?: number; issue?: string };
export function auditGarmentAssets(tenant: string) {
  const items: GarmentAssetAuditItem[] = store.rowsOf(tenant, 'laundry_garment').filter((row) => row.data.active !== false).map((row) => {
    const visualKey = String(row.data.visual_key || '').trim(); const photo = String(row.data.photo || '').trim(); const base = { id: row.id, name: String(row.data.name || row.id), category: String(row.data.category || ''), visualKey, photo };
    if (!visualKey || !VISUAL_ASSETS[visualKey]) return { ...base, classification: visualKey ? 'invalid_visual_key' as const : 'missing' as const, issue: visualKey ? 'visual key is not in the approved taxonomy' : 'active garment has no explicit visual key' };
    if (!photo) { const fallback = localAsset(VISUAL_ASSETS[visualKey]); return fallback && existsSync(fallback) ? { ...base, classification: 'intentional_shared_visual' as const, resolvedAsset: VISUAL_ASSETS[visualKey], bytes: statSync(fallback).size } : { ...base, classification: 'broken_asset' as const, resolvedAsset: VISUAL_ASSETS[visualKey], issue: 'approved visual asset is missing from the packaged application' }; }
    if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(photo)) return { ...base, classification: 'custom_image' as const, resolvedAsset: 'inline-data-image', bytes: Buffer.byteLength(photo, 'utf8') };
    const target = localAsset(photo); if (!target) return { ...base, classification: 'invalid_path' as const, issue: 'photo is not an approved local application asset' };
    if (!existsSync(target)) return { ...base, classification: 'broken_asset' as const, issue: 'photo path does not exist in the packaged application' };
    return { ...base, classification: photo === VISUAL_ASSETS[visualKey] ? 'exact_visual' as const : 'intentional_shared_visual' as const, resolvedAsset: photo, bytes: statSync(target).size };
  });
  const counts = items.reduce<Record<string, number>>((result, item) => { result[item.classification] = (result[item.classification] || 0) + 1; return result; }, {});
  const failures = items.filter((item) => ['missing', 'invalid_visual_key', 'invalid_path', 'broken_asset'].includes(item.classification));
  return { tenant, generatedAt: new Date().toISOString(), root: '/ui/app', counts, total: items.length, failures: failures.length, ok: failures.length === 0, items };
}
