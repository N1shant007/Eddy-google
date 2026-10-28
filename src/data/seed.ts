import type { Backend } from './types';
import type { CategoryRole } from '@eddy/rules';
import { audioDuration } from './util';

/* Imports the Bajaj starter library (the v1 team library: categories, 24 sounds, storytelling guidelines). */
export async function importStarterLibrary(be: Backend, onProgress?: (done: number, total: number, name: string) => void) {
  const base = import.meta.env.BASE_URL + 'seed/';
  const lib = await (await fetch(base + 'library.json')).json();
  const cats: { id: string; name: string; role: CategoryRole }[] = lib.categories || [];
  const have = new Set((await be.listCategories()).map((c) => c.id));
  for (const [i, c] of cats.entries()) if (!have.has(c.id)) await be.saveCategory({ id: c.id, name: c.name, role: c.role, sort: i });

  const existing = new Set((await be.listAssets()).map((a) => a.name.toLowerCase()));
  const assets: any[] = lib.assets || [];
  let done = 0;
  for (const a of assets) {
    onProgress?.(done, assets.length, a.name);
    if (!existing.has(String(a.name).toLowerCase())) {
      const blob = await (await fetch(base + a.file)).blob();
      const cat = cats.find((c) => c.id === a.ucat);
      await be.putAsset(
        { name: a.name, categoryId: a.ucat, role: (cat?.role || a.cat) as CategoryRole, tags: a.tags || [], dur: await audioDuration(blob), product: a.product || undefined },
        blob,
      );
    }
    done++;
  }
  onProgress?.(done, assets.length, '');

  const gl = await be.listGuidelines();
  for (const g of lib.guidePresets || []) {
    if (!gl.some((x) => x.id === g.id)) await be.saveGuideline({ id: g.id, name: g.name, text: g.text, isDefault: g.id === (lib.defaultGuide || lib.activeGuide) });
  }
}
