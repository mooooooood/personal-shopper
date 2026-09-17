// Poll at a start-to-start cadence: waiting a full interval after each reply
// otherwise leaves an RTT-sized hole between one-second animation segments.
export function createPollTiming(interval = 1000) {
  if (!Number.isFinite(interval) || interval < 100) throw new RangeError('Invalid poll interval');
  const clamp = value => Math.max(1000, Math.min(2500, value));
  let previousReply = null, gaps = [], interpolationDuration = null;
  const reset = () => { previousReply = null; gaps = []; interpolationDuration = null; };

  return {
    reset,
    begin(now) { return now; },
    complete(start, now) {
      const elapsed = now - start;
      if (!Number.isFinite(start) || !Number.isFinite(now) || start < 0 || elapsed < 0
        || (previousReply !== null && now <= previousReply)) {
        reset();
        return {delay: interval, interpolationDuration: clamp(interval + 250)};
      }
      const spacing = previousReply === null ? null : now - previousReply;
      // A hidden tab or failed connection is not the normal network cadence.
      if (spacing !== null && spacing > 5000) reset();
      const sample = previousReply === null ? interval + elapsed : spacing;
      previousReply = now;
      gaps.push(sample);
      if (gaps.length > 6) gaps.shift();
      // Reserve 100 ms for the final gait settle plus 150 ms of arrival jitter,
      // without extrapolating rabbits or events. Slow replies expand immediately; old
      // spikes leave gradually, so recovery does not abruptly speed the scene.
      const target = clamp(Math.max(interval, ...gaps) + 250);
      interpolationDuration = interpolationDuration === null ? target
        : Math.max(target, interpolationDuration - 100);
      return {
        delay: Math.max(100, interval - elapsed),
        interpolationDuration,
      };
    },
  };
}
