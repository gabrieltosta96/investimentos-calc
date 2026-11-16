import assert from "node:assert/strict";
import { bestReturn, kick, serveSpin, simulateReturn, simulateServe, type ServeInput, type Stroke } from "./physics.ts";

const serve = (brushDeg: number, spinRps = 40): ServeInput => ({ brushDeg, spinRps, startX: 0.3, targetX: 0, targetY: 2.1 });
const block: Stroke = { angleDeg: 0, aimDeg: 0, speed: 1, swingUpDeg: 0, swingSideDeg: 0 };

// The rule: ball leaves your racket toward where the server's racket moved.
const k = (deg: number) => kick(serveSpin(deg, 40));
assert.ok(k(0).up > 0.5, "topspin kicks up");
assert.ok(k(180).up < -0.5, "backspin kicks down");
assert.ok(k(90).right > 0.5, "brush to your right kicks right");
assert.ok(k(270).right < -0.5, "brush to your left kicks left");

for (const deg of [0, 90, 135, 180, 270]) {
  const s = simulateServe(serve(deg));
  assert.ok(s && s.contact, `serve ${deg}° solves`);
  const last = s.bounces[1];
  assert.ok(Math.abs(last[0]) < 0.01 && Math.abs(last[1] - 2.1) < 0.01, `serve ${deg}° lands on target`);
}

const contact = (deg: number) => simulateServe(serve(deg))!.contact!;
// Flat block: backspin goes down, sidespin goes sideways, no-spin barely deviates.
const back = simulateReturn(contact(180), block);
assert.ok(back.outcome === "rede" || back.outcome === "seu-lado", `backspin block: ${back.outcome}`);
const right = simulateReturn(contact(90), block);
const left = simulateReturn(contact(270), block);
assert.ok(right.landing[0] < left.landing[0] - 0.2, "brush-right serve returns to your right (-x)");
// A solution exists for a push against backspin.
const push: Stroke = { angleDeg: 0, aimDeg: 0, speed: 2.5, swingUpDeg: -15, swingSideDeg: 0 };
const best = bestReturn(contact(180), push);
assert.ok(best && best.angleDeg > 10, `push vs backspin needs open racket: ${JSON.stringify(best)}`);
console.log("mesa physics ok", { back: back.outcome, rightX: right.landing[0].toFixed(2), leftX: left.landing[0].toFixed(2), best });
