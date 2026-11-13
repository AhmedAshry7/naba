/** The story script: what is said, and when. All times are seconds on the master clock. */

export interface Cue {
  start: number
  end: number
  text: string
  /** words (lowercase, no punctuation) to highlight in gold */
  hl?: string[]
  /** how long the recorded clip actually speaks (seconds); drives the reporter's lip-sync */
  say?: number
}

export const DURATION = 24

/** Key moments (seconds), shared by the script and the scene renderer so they can never drift apart. */
export const T = {
  satIn: 0.8,
  beamOn: 2.0,
  cloudStart: 4.6,
  cloudEnd: 6.4,
  blockStart: 5.2,
  nisarIn: 7.2,
  punch: 8.9,
  kick: 9.7,
  takeover: 10.5,
  waveStart: 11.5,
  waveHit: 12.6,
  radarShow: 11.7,
  radarReveal: 12.8,
  readout: 14.6,
  logoIn: 20.5,
}

const cue = (start: number, end: number, text: string, hl: string[], say: number): Cue => ({ start, end, text, hl, say })

/**
 * The narration, timed to the recorded clips (public/intro/voice/cue-N.mp3, made by scripts/make-voice.py).
 * Captions use normal spelling; scripts/make-voice.py respells NISAR / ISRO phonetically for the voice.
 * If you change a line or re-record it, adjust its window so the audio finishes before the next line starts.
 */
export const CUES: Cue[] = [
  cue(0.4, 2.2, 'Earth is changing every day.', ['changing'], 1.66),
  cue(2.3, 4.8, 'Optical satellites watch it using light.', ['light'], 2.35),
  cue(4.9, 7.85, 'But clouds block the light, and data is lost.', ['clouds', 'data'], 2.78),
  cue(7.95, 9.6, 'NISAR changes that.', ['nisar'], 1.49),
  cue(9.7, 13.95, 'NISAR, a NASA–ISRO radar satellite, sees through clouds.', ['nisar', 'radar'], 4.08),
  cue(14.05, 16.95, 'Its microwaves pass through clouds, day or night.', ['microwaves', 'through'], 2.76),
  cue(17.05, 20.2, 'It detects ground changes of just a few centimetres.', ['centimetres'], 3.0),
  cue(20.3, 23.6, "This turns radar into Earth's news, before it breaks.", ['radar', 'news'], 3.17),
]

export const CHAPTERS = [
  { t: 0, label: 'Our changing planet' },
  { t: 2.3, label: 'Optical eyes' },
  { t: 4.9, label: 'The cloud problem' },
  { t: 7.95, label: 'Enter NISAR' },
  { t: 14.05, label: 'Radar vision' },
  { t: 20.3, label: 'The solution' },
]

export function cueIndexAt(t: number): number {
  for (let i = 0; i < CUES.length; i++) if (t >= CUES[i].start && t < CUES[i].end) return i
  return -1
}
