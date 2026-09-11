// Rendering only: pose timing follows the shared server clock and rabbit ID.
// Positive reach brings a paw forward; negative reach extends it behind.
const TAU = Math.PI * 2;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const x = clamp(value); return x * x * (3 - 2 * x); };
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const wrap = (value, length = 1) => ((value % length) + length) % length;

// Stance → crouch → push-off → flight → forepaw landing → soft recovery.
// Smooth joins keep the cycle continuous, including its wrap back to stance.
const frames = [
  [0,    0, 1,    1,     0,     0,     0,    0,     0,    0],
  [.13,  0, 1.09, .90,   .025,  .12,   .70, -.12,  -.90, .13],
  [.24,  2, 1.17, .94,  -.11,   .80, -1,    -.28,   .50, .24],
  [.47, 12, 1.10, 1.02, -.06,  -.70,   .62, -.18,   .15, .15],
  [.66,  6, 1.04, 1.03,  .09,  1,     .78, -.08,  -.30, .05],
  [.78,  0, 1.08, .91,   .08,   .38,   .10,  .20,  -.85, -.08],
  [.89,  0, .98,  1.025,-.025, -.06,   .08, -.03,   .20, .025],
  [1,    0, 1,    1,     0,     0,     0,    0,     0,    0],
];

function idleWave(time, period, offset = 0) {
  // Reduce before multiplying to keep even unusually large finite times safe.
  return Math.sin((wrap(time, period) / period + offset) * TAU);
}

function twitch(time, period, width, offset) {
  const phase = wrap(wrap(time, period) / period + offset);
  if (phase >= width) return 0;
  const local = phase / width;
  return Math.sin(Math.PI * local) ** 2 * Math.sin(TAU * local * 1.5);
}

export function getRabbitPose(rabbit, time) {
  rabbit = rabbit || {};
  time = finite(time);
  const individual = wrap((finite(rabbit.id) % 997) * .61803398875);
  const amount = Number.isFinite(rabbit.motionAmount)
    ? clamp(rabbit.motionAmount) : (rabbit.moving ? 1 : 0);
  const phase = wrap(finite(rabbit.hopProgress, wrap(time, .48) / .48 + individual));
  const index = frames.findIndex((frame, i) => i > 0 && phase <= frame[0]);
  const from = frames[index - 1], to = frames[index];
  const progress = smooth((phase - from[0]) / (to[0] - from[0]));
  const value = column => from[column] + (to[column] - from[column]) * progress;
  const movingValue = column => amount ? value(column) * amount : 0;
  const breathing = idleWave(time, 3.2 + individual * .6, individual);
  const earFlick = twitch(time, 7.7 + individual * 4, .14, individual);
  const nose = twitch(time, 3.1 + individual, .34, individual);
  return {
    lift: movingValue(1),
    stretchX: 1 + (value(2) - 1) * amount,
    stretchY: 1 + (value(3) - 1) * amount,
    pitch: movingValue(4),
    foreReach: movingValue(5),
    hindReach: movingValue(6),
    earTilt: value(7) * amount + earFlick * .18 * (1 - amount * .7),
    headBob: value(8) * amount + breathing * .18 * (1 - amount),
    noseTwitch: nose * .38 * (1 - amount * .6),
    breath: 1 + breathing * .014 * (1 - amount * .6),
    tailTilt: value(9) * amount + breathing * .025 * (1 - amount),
  };
}
