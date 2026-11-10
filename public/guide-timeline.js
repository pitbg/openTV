export const TIMELINE_PIXELS_PER_MINUTE = 4;
const HALF_HOUR_MS = 30 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function timelineRange(now = Date.now(), hours = 6) {
  // Media hora anterior al bloque actual para dar contexto al directo.
  const start = Math.floor(now / HALF_HOUR_MS) * HALF_HOUR_MS - HALF_HOUR_MS;
  const end = start + hours * HOUR_MS;
  return { start, end, now, width: hours * 60 * TIMELINE_PIXELS_PER_MINUTE };
}

export function timelinePosition(timestamp, range) {
  return (timestamp - range.start) / 60_000 * TIMELINE_PIXELS_PER_MINUTE;
}

export function timelineTicks(range) {
  const ticks = [];
  for (let time = range.start; time <= range.end; time += HALF_HOUR_MS) {
    ticks.push({ time, left: timelinePosition(time, range) });
  }
  return ticks;
}

export function timelinePrograms(guide, range) {
  const seen = new Set();
  const programmes = [guide?.now, guide?.next, ...(guide?.upcoming || [])]
    .filter(programme => programme && Number.isFinite(programme.start) && Number.isFinite(programme.stop))
    .filter(programme => programme.stop > programme.start)
    .filter(programme => {
      const key = `${programme.start}:${programme.stop}:${programme.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  return programmes
    .filter(programme => programme.stop > range.start && programme.start < range.end)
    .sort((a, b) => a.start - b.start)
    .map(programme => {
      const start = Math.max(programme.start, range.start);
      const stop = Math.min(programme.stop, range.end);
      return {
        ...programme,
        left: timelinePosition(start, range),
        width: timelinePosition(stop, range) - timelinePosition(start, range),
        current: programme.start <= range.now && range.now < programme.stop
      };
    });
}
