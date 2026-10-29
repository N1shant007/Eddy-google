/** Downloads a file the page made (an exported MP3).
    Inside a claude.ai artifact (the hosted test build) browsers can't start downloads themselves, so the file is
    offered through the viewer's save dialog, zipped because that dialog only accepts certain file types. */
export async function saveFile(filename: string, blob: Blob): Promise<'saved' | 'declined'> {
  const use = (window as any).claude?.use;
  const dl = typeof use === 'function'
    ? await Promise.race([Promise.resolve(use('downloads')).catch(() => null), new Promise((r) => setTimeout(() => r(null), 10000))]) as { save(o: { filename: string; data: Blob }): Promise<unknown> } | null
    : null;
  if (dl) {
    const { default: JSZip } = await import('jszip');
    const z = new JSZip();
    z.file(filename, blob);
    const zip = await z.generateAsync({ type: 'blob', compression: 'STORE' });
    try { await dl.save({ filename: filename.replace(/\.[^.]+$/, '') + '.zip', data: zip }); return 'saved'; }
    catch (e: any) { if (e?.code === 'declined') return 'declined'; throw new Error(e?.message || 'The file could not be saved here.'); }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return 'saved';
}
