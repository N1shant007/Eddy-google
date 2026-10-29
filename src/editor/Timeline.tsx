import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Group, Layer, Line, Rect, Shape, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { Clip, ProjectDoc } from '@eddy/rules';
import { useApp } from '../state/app';
import { useEditor } from '../state/editor';
import { getBuffer, getPeaks, onBuffersChanged, PEAK_RATE, projectEnd } from '../audio/engine';
import { clipBox, fmtTime, HEAD_W, KIND_COLOR, layoutLanes, RULER_H, type Lane } from './layout';
import { TrackHeaders } from './TrackHeaders';

const HANDLE = 7;
const SNAP_PX = 8;

interface Props {
  onClipMenu: (c: Clip, x: number, y: number) => void;
  onDropAsset: (hash: string, t: number) => void;
  /** live playhead reader while playing */
  livePos: () => number | null;
}

export function Timeline({ onClipMenu, onDropAsset, livePos }: Props) {
  const { doc, sel, pps, scrollX, playhead } = useEditor();
  const ed = useEditor.getState;
  const assets = useApp((s) => s.assets);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const { lanes, height } = useMemo(() => layoutLanes(doc), [doc]);
  const end = projectEnd(doc);
  const contentW = Math.max(w, (end + 30) * pps);

  useEffect(() => onBuffersChanged(bump), []);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(200, el.clientWidth - HEAD_W)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // keep the native horizontal scrollbar in sync with scrollX
  useEffect(() => { const h = hRef.current; if (h && Math.abs(h.scrollLeft - scrollX * pps) > 1) h.scrollLeft = scrollX * pps; }, [scrollX, pps]);

  const x = (t: number) => (t - scrollX) * pps;
  const tAt = (px: number) => scrollX + px / pps;

  /* wheel: ctrl/cmd = zoom around the pointer, shift or sideways = scroll in time */
  const onWheel = (e: React.WheelEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left - HEAD_W;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      ed().setZoom(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), tAt(px), px);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      ed().setScroll(scrollX + (e.deltaX || e.deltaY) / pps);
    }
  };
  useEffect(() => {
    // React's wheel listener is passive; block page zoom on ctrl+wheel over the timeline
    const el = wrapRef.current;
    const stop = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    el?.addEventListener('wheel', stop, { passive: false });
    return () => el?.removeEventListener('wheel', stop);
  }, []);

  /* ---------- live playhead (no React re-render per frame) ---------- */
  const phRef = useRef<Konva.Line>(null), phRuler = useRef<Konva.Line>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = livePos();
      if (p != null) {
        const s = useEditor.getState();
        const px = (p - s.scrollX) * s.pps;
        if (px > w - 40 || px < 0) s.setScroll(p - 40 / s.pps);
        phRef.current?.x(px); phRuler.current?.x(px);
        phRef.current?.getLayer()?.batchDraw(); phRuler.current?.getLayer()?.batchDraw();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [w, livePos]);

  /* ---------- snapping ---------- */
  const snapTo = (t: number, self: string, len = 0) => {
    const edges = [0, playhead];
    for (const c of doc.clips) if (c.id !== self) edges.push(c.start, c.start + c.dur);
    let best = t, bd = SNAP_PX / pps;
    for (const e of edges) {
      if (Math.abs(e - t) < bd) { bd = Math.abs(e - t); best = e; }
      if (len && Math.abs(e - (t + len)) < bd) { bd = Math.abs(e - (t + len)); best = e - len; }
    }
    return Math.max(0, best);
  };

  /* ---------- ruler ticks ---------- */
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 70) || 600;
  const ticks: number[] = [];
  for (let t = Math.floor(scrollX / step) * step; t < tAt(w); t += step) if (t >= 0) ticks.push(t);

  const visible = (c: Clip) => c.start + c.dur > scrollX - 1 && c.start < tAt(w) + 1;
  const name = (c: Clip) => assets.find((a) => a.hash === c.assetHash)?.name || (c.assetHash === doc.dialogueHash ? 'Main dialogue' : 'Audio');

  const seekFromStage = (stage: Konva.Stage | null) => {
    const p = stage?.getPointerPosition();
    if (p) ed().setPlayhead(tAt(p.x));
  };

  return (
    <div className="timeline" ref={wrapRef} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}>
      <div className="tl-top">
        <div className="tl-corner" style={{ width: HEAD_W }}>{fmtTime(playhead, true)}</div>
        <Stage width={w} height={RULER_H} onMouseDown={(e) => {
          const st = e.target.getStage();
          seekFromStage(st);
          const move = () => seekFromStage(st);
          const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); };
          addEventListener('mousemove', move); addEventListener('mouseup', up);
        }}>
          <Layer>
            <Rect width={w} height={RULER_H} fill="#f6f8fc" />
            {ticks.map((t) => (
              <Group key={t} x={x(t)}>
                <Line points={[0, RULER_H - 10, 0, RULER_H]} stroke="#9aa6bf" strokeWidth={1} />
                <Text x={4} y={6} text={fmtTime(t)} fontSize={11} fill="#64708a" />
              </Group>
            ))}
            <Line points={[0, RULER_H - 0.5, w, RULER_H - 0.5]} stroke="#dde3ee" />
          </Layer>
          <Layer listening={false}>
            <Line ref={phRuler} x={x(playhead)} points={[0, 0, 0, RULER_H]} stroke="#e8452c" strokeWidth={2} />
          </Layer>
        </Stage>
      </div>

      <div className="tl-body">
        <TrackHeaders lanes={lanes} />
        <div className="tl-lanes" style={{ height: Math.max(height, 120) }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('eddy/asset')) e.preventDefault(); }}
          onDrop={(e) => {
            const hash = e.dataTransfer.getData('eddy/asset');
            if (!hash) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            onDropAsset(hash, snapTo(tAt(e.clientX - r.left), ''));
          }}>
          {doc.tracks.length === 0 && <div className="tl-empty">Import the episode audio to start, or drag sounds here from the library.</div>}
          <Stage width={w} height={Math.max(height, 120)}
            onMouseDown={(e) => { if (e.target === e.target.getStage() || e.target.name() === 'lane') { ed().select(null); seekFromStage(e.target.getStage()); } }}>
            <Layer>
              {lanes.map((l, i) => <Rect key={l.track.id} name="lane" y={l.top} width={w} height={l.height} fill={i % 2 ? '#f7f9fc' : '#ffffff'} stroke="#e8ecf4" strokeWidth={0.5} />)}
              {ticks.map((t) => <Line key={t} points={[x(t), 0, x(t), height]} stroke="#eef1f7" listening={false} />)}
            </Layer>
            <Layer>
              {lanes.flatMap((l) => doc.clips.filter((c) => c.trackId === l.track.id && visible(c)).map((c) => (
                <ClipView key={c.id} c={c} lane={l} lanes={lanes} x={x} pps={pps} w={w} selected={sel === c.id} label={name(c)}
                  doc={doc} snapTo={snapTo} onMenu={onClipMenu} />
              )))}
            </Layer>
            <Layer listening={false}>
              <Line ref={phRef} x={x(playhead)} points={[0, 0, 0, Math.max(height, 120)]} stroke="#e8452c" strokeWidth={2} />
            </Layer>
          </Stage>
        </div>
      </div>

      <div className="tl-hscroll" ref={hRef} style={{ marginLeft: HEAD_W }} onScroll={(e) => ed().setScroll(e.currentTarget.scrollLeft / pps)}>
        <div style={{ width: contentW, height: 1 }} />
      </div>
    </div>
  );
}

function ClipView({ c, lane, lanes, x, pps, w, selected, label, doc, snapTo, onMenu }: {
  c: Clip; lane: Lane; lanes: Lane[]; x: (t: number) => number; pps: number; w: number; selected: boolean; label: string;
  doc: ProjectDoc; snapTo: (t: number, self: string, len?: number) => number; onMenu: (c: Clip, x: number, y: number) => void;
}) {
  const ed = useEditor.getState;
  const { top, h } = clipBox(lane, c);
  const cx = x(c.start), cw = Math.max(3, c.dur * pps);
  const color = KIND_COLOR[lane.track.kind] || '#888';
  const buf = getBuffer(c.assetHash);
  const peaks = getPeaks(c.assetHash);
  const locked = !!c.fixed;

  const commitMove = (g: Konva.Group) => {
    const st = g.getStage();
    const p = st?.getPointerPosition();
    const ns = Math.round(snapTo(c.start + (g.x() - cx) / pps, c.id, c.dur) * 100) / 100;
    let trackId = c.trackId;
    if (p && lane.track.kind !== 'dialogue') {
      const to = lanes.find((l) => p.y >= l.top && p.y < l.top + l.height);
      if (to && to.track.kind !== 'dialogue' && to.track.kind !== 'disclaimer') trackId = to.track.id;
    }
    ed().edit((d) => { const k = d.clips.find((y) => y.id === c.id); if (k) { k.start = ns; k.trackId = trackId; k.auto = false; } }, false);
  };

  const trim = (side: 'l' | 'r', px: number) => {
    const t = c.start + (px - cx) / pps;
    ed().edit((d) => {
      const k = d.clips.find((y) => y.id === c.id);
      if (!k) return;
      const maxLen = k.loop || !buf ? Infinity : buf.duration;
      if (side === 'l') {
        const ns = snapTo(Math.min(t, c.start + c.dur - 0.1), c.id);
        const delta = ns - c.start;
        const off = c.offset + delta;
        if (off < 0 && !k.loop) return;
        k.start = Math.round(ns * 100) / 100; k.offset = Math.round(Math.max(0, off) * 100) / 100; k.dur = Math.round((c.dur - delta) * 100) / 100;
      } else {
        const ne = snapTo(Math.max(t, c.start + 0.1), c.id);
        k.dur = Math.round(Math.min(ne - c.start, maxLen - c.offset) * 100) / 100;
      }
      k.auto = false;
    }, false);
  };

  return (
    <Group x={cx} y={top} draggable={!locked}
      dragBoundFunc={function (this: Konva.Node, pos) { return { x: pos.x, y: this.absolutePosition().y }; }}
      onMouseDown={(e) => { if (e.evt.button === 0) ed().select(c.id); }}
      onContextMenu={(e) => { e.evt.preventDefault(); e.cancelBubble = true; ed().select(c.id); onMenu(c, e.evt.clientX, e.evt.clientY); }}
      onDragStart={() => { ed().checkpoint(); ed().select(c.id); }}
      onDragMove={(e) => { const g = e.target as Konva.Group; const t = snapTo(c.start + (g.x() - cx) / pps, c.id, c.dur); g.x(x(t)); }}
      onDragEnd={(e) => commitMove(e.target as Konva.Group)}
      onMouseEnter={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = locked ? 'default' : 'grab'; }}
      onMouseLeave={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = 'default'; }}>
      <Rect width={cw} height={h} cornerRadius={5} fill={color} opacity={selected ? 0.32 : 0.2} stroke={selected ? '#1d4fd6' : color} strokeWidth={selected ? 2 : 1} />
      {peaks && buf && (
        <Shape listening={false} sceneFunc={(kctx) => {
          const ctx = (kctx as any)._context as CanvasRenderingContext2D;
          const px0 = Math.max(0, -cx), px1 = Math.min(cw, w - cx);
          const mid = h / 2 + 6, amp = (h - 16) / 2;
          const per = PEAK_RATE / pps, nb = peaks.length / 2, g = Math.pow(10, c.gain / 20);
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.85;
          for (let px = Math.floor(px0); px < px1; px++) {
            let t = c.offset + px / pps;
            if (c.loop) t %= buf.duration; else if (t >= buf.duration) break;
            const b0 = Math.floor(t * PEAK_RATE), b1 = Math.min(nb, b0 + Math.max(1, Math.ceil(per)));
            let mn = 0, mx = 0;
            for (let b = b0; b < b1; b += Math.max(1, Math.floor((b1 - b0) / 8))) { if (peaks[b * 2] < mn) mn = peaks[b * 2]; if (peaks[b * 2 + 1] > mx) mx = peaks[b * 2 + 1]; }
            const y0 = mid - Math.min(1, mx * g) * amp, y1 = mid - Math.max(-1, mn * g) * amp;
            ctx.fillRect(px, y0, 1, Math.max(1, y1 - y0));
          }
          ctx.globalAlpha = 1;
        }} />
      )}
      {(c.fadeIn > 0 || c.fadeOut > 0) && (
        <Line listening={false} points={[0, h, Math.min(cw / 2, c.fadeIn * pps), 2, cw - Math.min(cw / 2, c.fadeOut * pps), 2, cw, h]} stroke="#1b2340" opacity={0.35} strokeWidth={1} />
      )}
      {cw > 26 && (
        <Text listening={false} x={6} y={4} width={cw - 12} height={14} wrap="none" ellipsis
          text={`${label}${c.gain ? `  ${c.gain > 0 ? '+' : ''}${c.gain} dB` : ''}${c.loop ? '  ⟳' : ''}${locked ? '  🔒' : ''}`}
          fontSize={11} fontStyle="600" fill="#1b2340" />
      )}
      {!locked && cw > 16 && (<>
        <Rect x={0} width={HANDLE} height={h} fill={selected ? '#1d4fd6' : 'transparent'} opacity={0.35} cornerRadius={[5, 0, 0, 5]}
          draggable dragBoundFunc={function (this: Konva.Node, pos) { return { x: pos.x, y: this.absolutePosition().y }; }}
          onMouseEnter={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = 'ew-resize'; }}
          onDragStart={(e) => { e.cancelBubble = true; ed().checkpoint(); }}
          onDragMove={(e) => { e.cancelBubble = true; trim('l', cx + e.target.x()); e.target.x(0); }}
          onDragEnd={(e) => { e.cancelBubble = true; e.target.x(0); }} />
        <Rect x={cw - HANDLE} width={HANDLE} height={h} fill={selected ? '#1d4fd6' : 'transparent'} opacity={0.35} cornerRadius={[0, 5, 5, 0]}
          draggable dragBoundFunc={function (this: Konva.Node, pos) { return { x: pos.x, y: this.absolutePosition().y }; }}
          onMouseEnter={(e) => { const s = e.target.getStage(); if (s) s.container().style.cursor = 'ew-resize'; }}
          onDragStart={(e) => { e.cancelBubble = true; ed().checkpoint(); }}
          onDragMove={(e) => { e.cancelBubble = true; trim('r', cx + e.target.x() + HANDLE); e.target.x(cw - HANDLE); }}
          onDragEnd={(e) => { e.cancelBubble = true; }} />
      </>)}
    </Group>
  );
}
