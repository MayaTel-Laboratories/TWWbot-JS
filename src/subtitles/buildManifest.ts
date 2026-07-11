import * as fs from 'fs';
import * as path from 'path';
import { parseSrt, findCueAtTime, toReadableCase, SrtCue } from './parseSrt';

interface FrameEntry {
  name: string;
  subtitleText: string | null;
}

interface Manifest {
  frames: FrameEntry[];
  episodeTotals: Record<string, number>;
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function frameNumberFromFilename(filename: string): number | null {
  const m = filename.match(/__(\d+)\.jpeg$/i);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function seasonEpisodeFromSrtFilename(filename: string): { season: string; episode: string } | null {
  const m = filename.match(/(\d+)\s*x\s*(\d{2})/i);
  if (!m) return null;
  return { season: m[1], episode: m[2] };
}

function loadManifest(manifestPath: string): Manifest {
  if (!fs.existsSync(manifestPath)) {
    return { frames: [], episodeTotals: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (Array.isArray(parsed)) {
      return { frames: parsed, episodeTotals: {} };
    }
    if (parsed && typeof parsed === 'object') {
      return {
        frames: Array.isArray(parsed.frames) ? parsed.frames : [],
        episodeTotals: parsed.episodeTotals && typeof parsed.episodeTotals === 'object' ? parsed.episodeTotals : {},
      };
    }
  } catch {
    console.error(`Warning: could not parse existing manifest at ${manifestPath}, starting fresh`);
  }
  return { frames: [], episodeTotals: {} };
}

function processEpisode(
  srtPath: string,
  season: string,
  episode: string,
  imagesDir: string,
  caseMode: 'raw' | 'readable',
  frameOffsetSeconds: number,
): { entries: FrameEntry[]; episodeKey: string; observedCount: number } {
  const srtRaw = fs.readFileSync(srtPath, 'utf8');
  const cues: SrtCue[] = parseSrt(srtRaw);
  console.error(`  Parsed ${cues.length} subtitle cues from ${path.basename(srtPath)}`);
  if (cues.length === 0) {
    console.error('  Warning: zero cues parsed — double check this is a plain SRT (not ASS/SSA).');
  }

  const episodePadded = episode.padStart(2, '0');
  const episodeKey = `${season}x${episodePadded}`;
  const fileRegex = new RegExp(`^TWW_${season}x${episodePadded}_.+__\\d+\\.jpeg$`, 'i');
  const allFiles = fs.readdirSync(imagesDir).filter(f => fileRegex.test(f));

  if (allFiles.length === 0) {
    console.error(`  No frame files matched pattern for season ${season} episode ${episodePadded} in ${imagesDir} — skipping.`);
    return { entries: [], episodeKey, observedCount: 0 };
  }

  let matched = 0;
  const entries: FrameEntry[] = [];
  for (const filename of allFiles) {
    const frameNumber = frameNumberFromFilename(filename);
    if (frameNumber === null) continue;
    const t = frameNumber - 1 + frameOffsetSeconds;
    const cue = findCueAtTime(cues, t);
    let subtitleText: string | null = cue ? cue.text : null;
    if (subtitleText && caseMode === 'readable') {
      subtitleText = toReadableCase(subtitleText);
    }
    if (subtitleText) matched++;
    entries.push({ name: filename, subtitleText });
  }

  console.error(`  Matched subtitle text to ${matched} / ${allFiles.length} frames for ${episodeKey}`);
  return { entries, episodeKey, observedCount: allFiles.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const imagesDir = args.images;
  const manifestPath = args.manifest || 'manifest.json';
  const caseMode = (args.case || 'raw') as 'raw' | 'readable';
  const frameOffsetSeconds = args.offset ? Number(args.offset) : 0;

  if (!imagesDir || (!args['srt-dir'] && !args.srt)) {
    console.error(
      'Usage:\n' +
        '  Batch mode:  buildManifest --srt-dir <folder-of-srts> --images <dir> [--manifest manifest.json] [--case raw|readable] [--offset 0]\n' +
        '  Single mode: buildManifest --srt <path.srt> --images <dir> --season <n> --episode <n> [--manifest manifest.json] [--case raw|readable] [--offset 0]',
    );
    process.exit(1);
  }

  const jobs: Array<{ srtPath: string; season: string; episode: string }> = [];

  if (args['srt-dir']) {
    const srtDir = args['srt-dir'];
    const srtFiles = fs.readdirSync(srtDir).filter(f => f.toLowerCase().endsWith('.srt'));
    if (srtFiles.length === 0) {
      console.error(`No .srt files found in ${srtDir}`);
      process.exit(1);
    }
    for (const f of srtFiles) {
      const parsed = seasonEpisodeFromSrtFilename(f);
      if (!parsed) {
        console.error(`Warning: couldn't parse season/episode out of "${f}", skipping. Expected something like "1x20" in the filename.`);
        continue;
      }
      jobs.push({ srtPath: path.join(srtDir, f), season: parsed.season, episode: parsed.episode });
    }
  } else {
    if (!args.season || !args.episode) {
      console.error('Single-episode mode requires --season and --episode.');
      process.exit(1);
    }
    jobs.push({ srtPath: args.srt, season: args.season, episode: args.episode });
  }

  if (jobs.length === 0) {
    console.error('No episodes to process.');
    process.exit(1);
  }

  console.error(`Processing ${jobs.length} episode(s)...`);

  const manifest = loadManifest(manifestPath);

  let allNewEntries: FrameEntry[] = [];
  const episodeRegexes: RegExp[] = [];

  for (const job of jobs) {
    const episodePadded = job.episode.padStart(2, '0');
    console.error(`\n${job.season}x${episodePadded} — ${path.basename(job.srtPath)}`);
    episodeRegexes.push(new RegExp(`^TWW_${job.season}x${episodePadded}_.+__\\d+\\.jpeg$`, 'i'));

    const { entries, episodeKey, observedCount } = processEpisode(
      job.srtPath,
      job.season,
      job.episode,
      imagesDir,
      caseMode,
      frameOffsetSeconds,
    );
    allNewEntries = allNewEntries.concat(entries);

    if (observedCount > 0) {
      const previousTotal = manifest.episodeTotals[episodeKey] || 0;
      const newTotal = Math.max(previousTotal, observedCount);
      if (previousTotal > 0 && observedCount < previousTotal) {
        console.error(
          `  Note: this run only found ${observedCount} frame(s) for ${episodeKey}, fewer than the ` +
            `previously recorded total of ${previousTotal} — keeping ${previousTotal} (frames were ` +
            `probably pruned since the last run; the total never gets lowered automatically).`,
        );
      }
      manifest.episodeTotals[episodeKey] = newTotal;
    }
  }

  const retainedFrames = manifest.frames.filter((e: any) => {
    const name = e && e.name ? e.name : '';
    return !episodeRegexes.some(re => re.test(name));
  });
  manifest.frames = [...retainedFrames, ...allNewEntries];

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.error(
    `\nWrote ${manifest.frames.length} frame entries and ${Object.keys(manifest.episodeTotals).length} ` +
      `episode total(s) to ${manifestPath} (${allNewEntries.length} frame entries new/updated across ${jobs.length} episode(s))`,
  );
}

main();