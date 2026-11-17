import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DT, R, TABLE, type Sample, type Vec } from "./physics";

// Physics frame (x right of server, y toward you, z up) -> three (y up). Proper rotation, so spins keep their sense.
const v3 = (p: Vec) => new THREE.Vector3(p[0], p[2], -p[1]);

export type Shot = {
  samples: Sample[]; // serve up to contact + return
  contactIndex: number;
  returnColor: string;
  serveStart: Vec;
  brushDir: Vec; // server racket direction (physics frame)
  racketNormal: Vec | null;
  racketVel: Vec | null;
  kickDir: Vec | null;
};

export type View = "voce" | "lado" | "sacador" | "cima";
const VIEWS: Record<View, [Vec, Vec]> = {
  // [camera, target] in physics coords
  voce: [[0, 4.3, 1.0], [0, 1.1, 0]],
  lado: [[2.3, 1.37, 0.6], [0, 1.37, 0]],
  sacador: [[0, -1.3, 0.55], [0, 1.6, 0]],
  cima: [[0, 1.37, 3.3], [0, 1.369, 0]],
};

const ballTexture = () => {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ff8a1f";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#ffffff";
  g.fillRect(128, 0, 128, 128);
  g.fillStyle = "#222";
  g.fillRect(0, 58, 256, 12); // equator stripe: shows the spin axis
  return new THREE.CanvasTexture(c);
};

const line = (points: THREE.Vector3[], color: string) =>
  new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color }));

export const createScene = (container: HTMLElement) => {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e9ece6");
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(1, 3, 1);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  // Mouse wheel adjusts the racket (zoom is Ctrl+wheel, see zoom()), but enableZoom also gates pinch:
  // turn it on only for touch. The first finger's pointerdown flips it before the pinch starts.
  controls.enableZoom = false;
  renderer.domElement.addEventListener("pointerdown", (e) => (controls.enableZoom = e.pointerType === "touch"));
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.mouseButtons.MIDDLE = null; // middle drag adjusts the racket (Mesa.tsx)

  // Space + drag pans (hand tool), plain drag rotates. Only while the mouse is over the scene,
  // so Space still works normally on buttons/inputs elsewhere.
  let hovered = false;
  const el = renderer.domElement;
  el.addEventListener("pointerenter", () => (hovered = true));
  el.addEventListener("pointerleave", () => (hovered = false));
  const setPan = (on: boolean) => {
    controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    el.style.cursor = on ? "grab" : "";
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== "Space") return;
    if (e.type === "keyup") {
      if (el.style.cursor) e.preventDefault(); // was panning: don't let Space "click" a focused button
      return setPan(false);
    }
    if (!hovered) return;
    e.preventDefault(); // no page scroll
    (document.activeElement as HTMLElement | null)?.blur(); // a focused button would fire on Space keyup (e.g. reset the view)
    setPan(true);
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);

  // Table, lines, net, floor
  const table = new THREE.Mesh(new THREE.BoxGeometry(TABLE.halfWidth * 2, 0.03, TABLE.length), new THREE.MeshLambertMaterial({ color: "#1f4f9c" }));
  table.position.set(0, -0.015, -TABLE.length / 2);
  scene.add(table);
  const w = TABLE.halfWidth;
  const L = TABLE.length;
  const y = 0.001;
  scene.add(line([new THREE.Vector3(-w, y, 0), new THREE.Vector3(w, y, 0), new THREE.Vector3(w, y, -L), new THREE.Vector3(-w, y, -L), new THREE.Vector3(-w, y, 0)], "#ffffff"));
  scene.add(line([new THREE.Vector3(0, y, 0), new THREE.Vector3(0, y, -L)], "#ffffff"));
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(TABLE.netHalfWidth * 2, TABLE.netH),
    new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  net.position.set(0, TABLE.netH / 2, -TABLE.netY);
  scene.add(net);
  const grid = new THREE.GridHelper(8, 16, "#c5cbc2", "#d6dbd3");
  grid.position.set(0, -0.76, -TABLE.length / 2);
  scene.add(grid);

  // Ball drawn 1.5x bigger so the spin is readable.
  const ball = new THREE.Mesh(new THREE.SphereGeometry(R * 1.5, 32, 16), new THREE.MeshLambertMaterial({ map: ballTexture() }));
  scene.add(ball);

  // Per-shot objects, rebuilt on every setShot
  const shotGroup = new THREE.Group();
  scene.add(shotGroup);
  let samples: Sample[] = [];
  let quats: THREE.Quaternion[] = [];
  let playing = true;
  let speed = 0.15;
  let t = 0; // sim time since the server's swing started
  let hold = 0;
  const PRE = 0.25; // server swing before contact (sim seconds)
  const SWING_SPEED = 1.2; // m/s, visual only
  let serverRacket: THREE.Group | null = null;
  let serverContact = new THREE.Vector3();
  let serverTangent = new THREE.Vector3();

  const arrow = (from: Vec, dir: Vec, color: string, length: number) => {
    const d = v3(dir);
    if (d.lengthSq() < 1e-12) return;
    shotGroup.add(new THREE.ArrowHelper(d.normalize(), v3(from), length, color, length * 0.3, length * 0.18));
  };

  const makeRacket = (color: string) => {
    const racket = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.008, 32), new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.8 }));
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.008, 0.1), new THREE.MeshLambertMaterial({ color: "#8a5a2b" }));
    handle.position.set(0, 0, 0.11);
    racket.add(face, handle);
    return racket;
  };

  const setShot = (shot: Shot) => {
    shotGroup.clear();
    samples = shot.samples;
    const q = new THREE.Quaternion();
    quats = samples.map((s) => {
      const wv = v3(s.w);
      const angle = wv.length() * DT;
      if (angle > 0) q.premultiply(new THREE.Quaternion().setFromAxisAngle(wv.normalize(), angle));
      return q.clone();
    });
    const pts = samples.map((s) => v3(s.p));
    shotGroup.add(line(pts.slice(0, shot.contactIndex + 1), "#ff8a1f"));
    if (shot.contactIndex < pts.length - 1) shotGroup.add(line(pts.slice(shot.contactIndex), shot.returnColor));

    arrow(shot.serveStart, shot.brushDir, "#0c8599", 0.18); // server's racket motion
    const contact = samples[shot.contactIndex].p;
    // Server racket brushes the ball: face normal (-d + forward) and motion (d + forward) are perpendicular,
    // so it slides across the back of the ball in direction d, which is what creates the spin.
    const d = v3(shot.brushDir).normalize();
    const fwd = v3([0, 1, 0]);
    const sn = d.clone().negate().add(fwd).normalize();
    serverTangent = d.clone().add(fwd).normalize();
    serverContact = v3(shot.serveStart).addScaledVector(sn, -(R * 1.5 + 0.006));
    serverRacket = makeRacket("#212529");
    serverRacket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sn);
    shotGroup.add(serverRacket);

    if (shot.racketNormal) {
      const n = v3(shot.racketNormal);
      const racket = makeRacket("#c92a2a");
      racket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      racket.position.copy(v3(contact)).addScaledVector(n, -(R + 0.006));
      shotGroup.add(racket);
    }
    if (shot.racketVel) arrow(contact, shot.racketVel, "#862e9c", 0.16); // your swing
    if (shot.kickDir) arrow(contact, shot.kickDir, "#f59f00", 0.14); // where the spin throws the ball
    // t is kept: tweaking your racket doesn't restart the serve.
  };

  const setView = (view: View) => {
    const [cam, target] = VIEWS[view];
    camera.position.copy(v3(cam));
    controls.target.copy(v3(target));
    controls.update();
  };

  const resize = () => {
    const { clientWidth: cw, clientHeight: ch } = container;
    renderer.setSize(cw, ch, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = cw / Math.max(ch, 1);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();
  setView("voce");

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (samples.length) {
      if (playing) {
        const i = Math.floor((t - PRE) / DT);
        if (i >= samples.length - 1) {
          hold += dt;
          if (hold > 1) {
            t = 0;
            hold = 0;
          }
        } else t += dt * speed;
      }
      const i = Math.max(0, Math.min(Math.floor((t - PRE) / DT), samples.length - 1));
      ball.position.copy(v3(samples[i].p));
      ball.quaternion.copy(quats[i]);
      if (serverRacket) {
        // Swing in, brush through the ball at t = PRE, follow through briefly, then disappear.
        serverRacket.visible = t < PRE + 0.15;
        serverRacket.position.copy(serverContact).addScaledVector(serverTangent, SWING_SPEED * (t - PRE));
      }
    }
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    setShot,
    setView,
    setSpeed: (s: number) => (speed = s),
    setPlaying: (p: boolean) => (playing = p),
    zoom: (factor: number) => {
      const offset = camera.position.clone().sub(controls.target).multiplyScalar(factor);
      if (offset.length() > 0.3 && offset.length() < 10) camera.position.copy(controls.target).add(offset);
    },
    restart: () => {
      t = 0;
      hold = 0;
    },
    dispose: () => {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
};
