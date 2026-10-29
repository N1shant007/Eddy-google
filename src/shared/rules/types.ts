/* Shared Eddy data model. Used by the editor, the storage layer and the rules engine. */

export type TrackKind =
  | 'disclaimer' | 'dialogue' | 'intro' | 'positioning' | 'bed' | 'transition' | 'sfx' | 'emotion';

/** How auto-edit uses a library category. */
export type CategoryRole =
  | 'intro' | 'outro' | 'positioning' | 'bed' | 'transition' | 'sfx' | 'emotion'
  | 'disclaimer' | 'pdisclaimer' | 'dialogue';

export interface Category {
  id: string;
  name: string;
  role: CategoryRole;
  sort?: number;
}

/** A sound in the library. Audio is stored once, addressed by the SHA-256 of its bytes. */
export interface Asset {
  hash: string;
  name: string;
  categoryId: string;
  role: CategoryRole;
  tags: string[];
  dur: number;
  size: number;
  mime: string;
  product?: string;
  createdAt?: string;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  vol: number;   // dB
  duck: number;  // dB the track dips while anyone speaks
  mute: boolean;
  solo: boolean;
}

export interface Clip {
  id: string;
  trackId: string;
  assetHash: string;
  start: number;   // seconds on the timeline
  offset: number;  // seconds into the asset
  dur: number;
  gain: number;    // dB
  fadeIn: number;
  fadeOut: number;
  loop: boolean;
  /** placed by auto-edit (replaced on the next auto-edit) */
  auto?: boolean;
  /** fixed disclaimer slot */
  fixed?: 'start' | 'product' | 'end';
  cueId?: string | null;
}

export type CueType = 'intro' | 'outro' | 'positioning' | 'bed' | 'transition' | 'sfx' | 'emotion';

export interface Cue {
  id: string;
  on: boolean;
  type: CueType;
  sound: string;
  fallback?: string;
  line: number;
  endLine?: number;
  position: 'before' | 'on' | 'after' | 'under';
  frac?: number | null;
  gainDb?: number;
  source: 'tag' | 'rule' | 'ai' | 'manual';
  must?: boolean;
  afterIntro?: boolean;
  ctaIntro?: boolean;
  reason?: string;
  note?: string | null;
  clipId?: string | null;
  at?: number | null;
}

export interface ScriptLine {
  speaker: string;
  text: string;
  mood?: string;
  /** seconds in the dialogue file */
  t0: number | null;
  t1: number | null;
  /** timings came from subtitles: keep them exactly */
  exact?: boolean;
}

export interface Settings {
  hosts: string;
  outroLen: number;
  outroLead: number;
  minSpacing: number;
  bedFadeIn: number;
  bedFadeOut: number;
  sfxGain: number;
  emoGain: number;
  transGain: number;
}

export const DEFAULT_SETTINGS: Settings = {
  hosts: '',
  outroLen: 7,
  outroLead: 2,
  minSpacing: 6,
  bedFadeIn: 1.5,
  bedFadeOut: 2,
  sfxGain: -6,
  emoGain: -6,
  transGain: -16,
};

/** Everything that makes up one episode edit. This is what each version stores. */
export interface ProjectDoc {
  schema: 2;
  product: string;
  scriptText: string;
  lines: ScriptLine[];
  dialogueHash: string | null;
  tracks: Track[];
  clips: Clip[];
  cues: Cue[];
  settings: Settings;
  guidelineId: string | null;
}

export const emptyDoc = (): ProjectDoc => ({
  schema: 2,
  product: '',
  scriptText: '',
  lines: [],
  dialogueHash: null,
  tracks: [],
  clips: [],
  cues: [],
  settings: { ...DEFAULT_SETTINGS },
  guidelineId: null,
});

export interface Guideline {
  id: string;
  name: string;
  text: string;
  isDefault?: boolean;
  updatedAt?: string;
}
