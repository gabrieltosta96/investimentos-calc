// Table tennis ball physics. Pure, no DOM.
// Frame: x = server's right, y = from server toward receiver, z = up. Table top at z = 0,
// server end line at y = 0, receiver end line at y = 2.74. Receiver's right = -x.
// Model: gravity + quadratic drag + Magnus (lift coefficient grows with spin, saturates);
// impacts = restitution on the normal plus friction toward rolling, and past it on the
// rubber (it grips and "throws" spin back). Good for direction and intuition, not exact
// numbers: real rubbers/blades vary a lot.

export type Vec = [number, number, number];
export type Ball = { p: Vec; v: Vec; w: Vec };
export type Sample = { p: Vec; w: Vec };

export const R = 0.02; // ball radius (m)
const M = 0.0027; // mass (kg)
const I = (2 / 3) * M * R * R; // hollow sphere
const G = 9.81;
const K_AIR = 0.28; // ½ρA/m
const CD = 0.45;
export const DT = 0.001;
export const TABLE = { length: 2.74, halfWidth: 0.7625, netY: 1.37, netH: 0.1525, netHalfWidth: 0.9125 };
const TABLE_E = 0.9;
const TABLE_MU = 0.25;
const TABLE_ET = 0; // tangential restitution: 0 = stops slipping (rolls)
const RACKET_E = 0.85;
const RACKET_MU = 0.8;
const RACKET_ET = 0.4; // inverted rubber overshoots rolling: more spin out

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const rad = (deg: number) => (deg * Math.PI) / 180;
const rps = (rev: number) => rev * 2 * Math.PI;

const step = ({ p, v, w }: Ball): Ball => {
  const speed = norm(v);
  const spin = norm(w);
  const s = (R * spin) / Math.max(speed, 1e-6); // spin parameter
  const cl = s > 1e-6 ? 1 / (2 + 1 / s) : 0; // lift coefficient, saturates at 0.5
  const magnus = spin > 1e-6 ? scale(cross(w, v), (K_AIR * cl * speed) / spin) : ([0, 0, 0] as Vec); // |a| = K·CL·v²
  const acc = add(add(scale(v, -K_AIR * CD * speed), magnus), [0, 0, -G]);
  const v2 = add(v, scale(acc, DT));
  return { p: add(p, scale(v2, DT)), v: v2, w };
};

// Impact with a plane of normal n (pointing at the ball) moving at velocity u.
export const impact = (b: Ball, n: Vec, u: Vec, e: number, mu: number, et: number): Ball => {
  const vRel = add(b.v, scale(u, -1));
  const vn = dot(vRel, n);
  if (vn >= 0) return b; // already separating
  const rc = scale(n, -R); // contact point from ball center
  const vc = add(vRel, cross(b.w, rc));
  const vct = add(vc, scale(n, -dot(vc, n)));
  const slip = norm(vct);
  const jn = M * (1 + e) * -vn;
  const jt = Math.min(mu * jn, (1 + et) * 0.4 * M * slip); // 0.4·M·slip makes a hollow sphere roll
  const P = add(scale(n, jn), slip > 1e-9 ? scale(vct, -jt / slip) : [0, 0, 0]);
  return { p: b.p, v: add(b.v, scale(P, 1 / M)), w: add(b.w, scale(cross(rc, P), 1 / I)) };
};

const onTable = (p: Vec) => Math.abs(p[0]) <= TABLE.halfWidth && p[1] >= 0 && p[1] <= TABLE.length;

type FlightEvent = { kind: "table" | "net" | "floor" | "apex"; ball: Ball; index: number };

// Fly until `stop` says so (or 3 s). Bounces on the table; net hit/floor end the flight.
const fly = (start: Ball, stop: (e: FlightEvent, bounces: FlightEvent[]) => boolean, net = true) => {
  const samples: Sample[] = [{ p: start.p, w: start.w }];
  const bounces: FlightEvent[] = [];
  let b = start;
  for (let i = 0; i < 3000; i++) {
    const prev = b;
    b = step(b);
    const crossedNet = (prev.p[1] - TABLE.netY) * (b.p[1] - TABLE.netY) <= 0 && prev.p[1] !== b.p[1];
    if (net && crossedNet && b.p[2] < TABLE.netH + R && b.p[2] > -R && Math.abs(b.p[0]) < TABLE.netHalfWidth) {
      samples.push({ p: b.p, w: b.w });
      return { samples, bounces, end: { kind: "net", ball: b, index: samples.length - 1 } as FlightEvent };
    }
    if (b.p[2] - R <= 0 && b.v[2] < 0 && onTable(b.p)) {
      b = impact({ ...b, p: [b.p[0], b.p[1], R] }, [0, 0, 1], [0, 0, 0], TABLE_E, TABLE_MU, TABLE_ET);
      const ev: FlightEvent = { kind: "table", ball: b, index: samples.length };
      bounces.push(ev);
      samples.push({ p: b.p, w: b.w });
      if (stop(ev, bounces)) return { samples, bounces, end: ev };
      continue;
    }
    samples.push({ p: b.p, w: b.w });
    if (prev.v[2] > 0 && b.v[2] <= 0) {
      const ev: FlightEvent = { kind: "apex", ball: b, index: samples.length - 1 };
      if (stop(ev, bounces)) return { samples, bounces, end: ev };
    }
    if (b.p[2] < -0.76 + R) return { samples, bounces, end: { kind: "floor", ball: b, index: samples.length - 1 } as FlightEvent };
  }
  return { samples, bounces, end: { kind: "floor", ball: b, index: samples.length - 1 } as FlightEvent };
};

// ---------- Serve ----------

export type ServeInput = {
  brushDeg: number; // server racket direction as the RECEIVER sees it: 0 = up (top), 90 = to your right, 180 = down (back)
  spinRps: number;
  startX: number; // where the server stands (x, server's right)
  targetX: number; // landing x on your side (negative = your right)
  targetY: number; // landing depth on your side (1.37..2.74)
};

// Spin from brushing the back of the ball (side facing the server) in direction d.
export const brushDir = (brushDeg: number): Vec => [-Math.sin(rad(brushDeg)), 0, Math.cos(rad(brushDeg))]; // receiver's right = -x
export const serveSpin = (brushDeg: number, spinRps: number): Vec => {
  const w = cross([0, -1, 0], brushDir(brushDeg)); // unit spin axis
  return scale(w, rps(spinRps));
};

// Serve flies until the receiver side bounce, then up to the apex, where you hit it.
const serveFlight = (s: ServeInput, v0: Vec, net: boolean) =>
  fly(
    { p: [s.startX, -0.15, 0.2], v: v0, w: serveSpin(s.brushDeg, s.spinRps) },
    (e, bounces) => e.kind === "apex" && bounces.length >= 2,
    net,
  );

// Find v0 so the 1st bounce is on the server side and the 2nd lands on the target (Newton, FD jacobian).
export const solveServe = (s: ServeInput, b1y: number) => {
  const residual = (v0: Vec): Vec | null => {
    const { bounces } = fly({ p: [s.startX, -0.15, 0.2], v: v0, w: serveSpin(s.brushDeg, s.spinRps) }, (_e, bs) => bs.length >= 2, false);
    if (bounces.length < 2) return null;
    const [a, b] = bounces;
    return [a.ball.p[1] - b1y, b.ball.p[0] - s.targetX, b.ball.p[1] - s.targetY];
  };
  let v: Vec = [(s.targetX - s.startX) / 0.8, (s.targetY + 0.15) / 0.8, -1];
  for (let it = 0; it < 40; it++) {
    const r = residual(v);
    if (!r) {
      v = [v[0], v[1], v[2] + 0.3];
      continue;
    }
    if (norm(r) < 0.005) return v;
    const h = 0.05; // bounces are resolved at DT, so tiny steps give a noisy jacobian
    const J = [0, 1, 2].map((k) => {
      const vk: Vec = [...v];
      vk[k] += h;
      const rk = residual(vk) ?? r;
      return scale(add(rk, scale(r, -1)), 1 / h); // column k
    });
    const dx = solve3(J, scale(r, -1));
    if (!dx) return null;
    const len = norm(dx);
    v = add(v, len > 1 ? scale(dx, 1 / len) : dx); // damped
  }
  return null;
};

// Solve [c0 c1 c2]·x = b by Cramer's rule.
const solve3 = (cols: Vec[], b: Vec): Vec | null => {
  const det = (a: Vec, bb: Vec, c: Vec) => dot(a, cross(bb, c));
  const D = det(cols[0], cols[1], cols[2]);
  if (Math.abs(D) < 1e-12) return null;
  return [det(b, cols[1], cols[2]) / D, det(cols[0], b, cols[2]) / D, det(cols[0], cols[1], b) / D];
};

// The first bounce spot is free: try nearer/farther ones until the serve clears the net.
export const simulateServe = (s: ServeInput) => {
  let last = null;
  for (const b1y of [0.6, 0.45, 0.75, 0.3, 0.9, 0.2]) {
    const v0 = solveServe(s, b1y);
    if (!v0) continue;
    const f = serveFlight(s, v0, true);
    const ok = f.end.kind === "apex" && f.bounces.length >= 2;
    last = { samples: f.samples, contact: ok ? f.end.ball : null, hitNet: f.end.kind === "net", bounces: f.bounces.map((b) => b.ball.p), v0 };
    if (ok) return last;
  }
  return last;
};

// ---------- Return ----------

export type Stroke = {
  angleDeg: number; // racket face: + open (facing up), - closed
  aimDeg: number; // + aims to your right
  speed: number; // racket speed (m/s)
  swingUpDeg: number; // swing direction: + brushing up, - chopping down
  swingSideDeg: number; // + swinging to your right
};

export const racketNormal = (angleDeg: number, aimDeg: number): Vec => {
  const a = rad(angleDeg);
  const b = rad(aimDeg);
  return [-Math.cos(a) * Math.sin(b), -Math.cos(a) * Math.cos(b), Math.sin(a)];
};

export const racketVelocity = (st: Stroke): Vec => {
  const up = rad(st.swingUpDeg);
  const side = rad(st.swingSideDeg);
  return scale([-Math.cos(up) * Math.sin(side), -Math.cos(up) * Math.cos(side), Math.sin(up)], st.speed);
};

export type Outcome = "dentro" | "rede" | "longa" | "lateral" | "seu-lado";

export const simulateReturn = (contact: Ball, st: Stroke) => {
  const hit = impact(contact, racketNormal(st.angleDeg, st.aimDeg), racketVelocity(st), RACKET_E, RACKET_MU, RACKET_ET);
  const f = fly(hit, (e) => e.kind === "table");
  let outcome: Outcome;
  if (f.end.kind === "net") outcome = "rede";
  else if (f.end.kind === "table") outcome = f.end.ball.p[1] < TABLE.netY ? "dentro" : "seu-lado";
  else outcome = Math.abs(f.end.ball.p[0]) > TABLE.halfWidth && f.end.ball.p[1] > 0 ? "lateral" : "longa";
  if (outcome === "longa" && f.end.ball.p[1] > TABLE.netY) outcome = "seu-lado"; // never crossed the net
  return { samples: f.samples, outcome, landing: f.end.ball.p, out: hit };
};

// Most forgiving angle/aim for this swing: the middle of the widest "lands inside" angle window.
export const bestReturn = (contact: Ball, st: Stroke, [lo, hi]: [number, number] = [-70, 70]) => {
  let best: { angleDeg: number; aimDeg: number; window: [number, number]; score: number } | null = null;
  for (let aimDeg = -40; aimDeg <= 40; aimDeg += 2) {
    let run: number[] = [];
    let landingX = 0;
    const flush = () => {
      if (!run.length) return;
      const width = run[run.length - 1] - run[0];
      const score = width - Math.abs(landingX) * 20; // prefer wide windows that land near the middle
      if (!best || score > best.score) best = { angleDeg: run[Math.floor(run.length / 2)], aimDeg, window: [run[0], run[run.length - 1]], score };
      run = [];
    };
    for (let angleDeg = lo; angleDeg <= hi; angleDeg += 2) {
      const r = simulateReturn(contact, { ...st, angleDeg, aimDeg });
      if (r.outcome === "dentro") {
        if (!run.length) landingX = r.landing[0];
        run.push(angleDeg);
      } else flush();
    }
    flush();
  }
  return best as { angleDeg: number; aimDeg: number; window: [number, number]; score: number } | null;
};

// ---------- Reading the spin ----------

// Where the ball jumps off a flat vertical racket (receiver terms), from the spin alone.
// The face of the ball toward you moves with ω×r; friction pushes the ball the opposite way.
export const kick = (w: Vec) => {
  const k = scale(cross(w, [0, R, 0]), -1);
  return { up: k[2], right: -k[0] }; // m/s of surface speed
};

export const describeSpin = (w: Vec) => {
  const total = norm(w) / (2 * Math.PI);
  const top = -w[0] / (2 * Math.PI); // + topspin, - backspin (ball moving toward you)
  return { total, top, kick: kick(w) };
};
