export interface SrtCue {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

const TIME_RE_SRC = '(\\d{2}):(\\d{2}):(\\d{2}),(\\d{3})';

function timeToSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

export function parseSrt(raw: string): SrtCue[] {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(Boolean);

  const cues: SrtCue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 2) continue;

    const index = parseInt(lines[0], 10);
    if (Number.isNaN(index)) continue;

    const timeLine = lines[1];
    const timeMatch = timeLine.match(new RegExp(`${TIME_RE_SRC}\\s*-->\\s*${TIME_RE_SRC}`));
    if (!timeMatch) continue;

    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = timeMatch;
    const startSeconds = timeToSeconds(h1, m1, s1, ms1);
    const endSeconds = timeToSeconds(h2, m2, s2, ms2);

    const textLines = lines.slice(2);
    const text = textLines
      .join(' ')
      .replace(/\{[^}]*\}/g, '') // strip ass...hmm...
      .replace(/<\/?[a-zA-Z][^>]*>/g, '') // strip HTML tags
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!text) continue;

    cues.push({ index, startSeconds, endSeconds, text });
  }

  return cues;
}

export function findCueAtTime(cues: SrtCue[], seconds: number): SrtCue | null {
  for (const cue of cues) {
    if (seconds >= cue.startSeconds && seconds < cue.endSeconds) {
      return cue;
    }
  }
  return null;
}

export function toReadableCase(text: string): string {
  const lower = text.toLowerCase();
  const sentenceCased = lower.replace(/(^\s*\w|[.!?]\s+\w)/g, c => c.toUpperCase());
  return sentenceCased.replace(/\bi\b/g, 'I');
}