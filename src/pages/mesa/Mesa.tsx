import { useEffect, useMemo, useRef, useState } from "react";
import { Section } from "../../components/Section";
import { usePersistedState } from "../../usePersistedState";
import { bestReturn, brushDir, cross, describeSpin, racketNormal, racketVelocity, serveSpin, simulateReturn, simulateServe, type Outcome, type Stroke } from "./physics";
import { createScene, type View } from "./scene";

const SERVES = [
  { name: "Cortado (backspin)", brushDeg: 180, spinRps: 40 },
  { name: "Topspin", brushDeg: 0, spinRps: 40 },
  { name: "Sem efeito", brushDeg: 0, spinRps: 0 },
  { name: "Pêndulo (sacador destro)", brushDeg: 90, spinRps: 40 },
  { name: "Pêndulo + corte", brushDeg: 135, spinRps: 40 },
  { name: "Pêndulo + top", brushDeg: 45, spinRps: 40 },
  { name: "Pêndulo reverso", brushDeg: 270, spinRps: 40 },
  { name: "Reverso + corte", brushDeg: 225, spinRps: 40 },
];

// Same swing every time; you adjust only racket angle and aim (as in a real rally).
const STROKES: Record<string, { name: string; speed: number; swingUpDeg: number; swingSideDeg: number; range: [number, number] }> = {
  bloqueio: { name: "Bloqueio", speed: 1.5, swingUpDeg: 0, swingSideDeg: 0, range: [-40, 40] },
  corte: { name: "Corte (push)", speed: 2.5, swingUpDeg: -15, swingSideDeg: 0, range: [0, 70] },
  flick: { name: "Flick", speed: 4, swingUpDeg: 30, swingSideDeg: 0, range: [-50, 30] },
  chiquita: { name: "Chiquita (backhand, raquete vai p/ direita)", speed: 4, swingUpDeg: 35, swingSideDeg: 40, range: [-50, 30] },
  drive: { name: "Drive", speed: 6, swingUpDeg: 15, swingSideDeg: 0, range: [-40, 20] },
  topspin: { name: "Topspin", speed: 7, swingUpDeg: 45, swingSideDeg: 0, range: [-50, 30] },
};

const OUTCOME: Record<Outcome, [string, boolean]> = {
  dentro: ["Dentro! Bola volta na mesa do sacador.", true],
  rede: ["Na rede.", false],
  longa: ["Longa: passou da mesa.", false],
  lateral: ["Fora pela lateral.", false],
  "seu-lado": ["Não passou: caiu do seu lado.", false],
};

const defaults = { brushDeg: 90, spinRps: 40, depth: 2.1, placeX: 0, stroke: "corte", angleDeg: 30, aimDeg: 0, slow: 0.15 };
const fmt = (n: number) => Math.round(n).toLocaleString("pt-BR");

const directionText = (up: number, right: number) => {
  const parts = [];
  if (up < -0.3) parts.push("para baixo (rede)");
  if (up > 0.3) parts.push("para cima (longa)");
  if (right > 0.3) parts.push("para a sua direita");
  if (right < -0.3) parts.push("para a sua esquerda");
  return parts.length ? parts.join(" e ") : "quase reta (pouco efeito)";
};

const fixText = (up: number, right: number) => {
  const parts = [];
  if (up < -0.3) parts.push("abra a raquete (face mais para cima) e bata mais por baixo");
  if (up > 0.3) parts.push("feche a raquete (face mais para baixo) e bata mais por cima");
  if (right > 0.3) parts.push("mire mais à esquerda");
  if (right < -0.3) parts.push("mire mais à direita");
  return parts.join("; ");
};

// Brush direction picker: what you SEE the server's racket do (0° = up, 90° = to your right).
const Dial = ({ deg, onChange }: { deg: number; onChange: (d: number) => void }) => {
  const a = (deg * Math.PI) / 180;
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.type === "pointermove" && !e.buttons) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left - r.width / 2;
    const y = e.clientY - r.top - r.height / 2;
    onChange((Math.round((Math.atan2(x, -y) * 180) / Math.PI / 15) * 15 + 360) % 360);
  };
  return (
    <svg viewBox="-60 -60 120 120" width="120" height="120" onPointerDown={pick} onPointerMove={pick} style={{ touchAction: "none", cursor: "pointer", flexShrink: 0 }} role="img" aria-label={`Raquete do sacador indo a ${deg}°`}>
      <circle r="52" fill="#fff" stroke="#c5cbc2" />
      <text y="-40" textAnchor="middle" fontSize="9" fill="#5f6862">top</text>
      <text y="47" textAnchor="middle" fontSize="9" fill="#5f6862">corte</text>
      <text x="44" y="3" textAnchor="middle" fontSize="9" fill="#5f6862">dir.</text>
      <text x="-44" y="3" textAnchor="middle" fontSize="9" fill="#5f6862">esq.</text>
      <circle r="9" fill="#ff8a1f" />
      <line x1={0} y1={0} x2={Math.sin(a) * 36} y2={-Math.cos(a) * 36} stroke="#0c8599" strokeWidth="4" strokeLinecap="round" />
      <circle cx={Math.sin(a) * 36} cy={-Math.cos(a) * 36} r="5" fill="#0c8599" />
    </svg>
  );
};

// Slider with −/+ buttons (2° steps): precise on touch screens.
const Stepper = ({ value, max, less, more, onChange }: { value: number; max: number; less: string; more: string; onChange: (v: number) => void }) => {
  const set = (v: number) => onChange(Math.max(-max, Math.min(max, v)));
  return (
    <span className="mesa-stepper">
      <button type="button" className="btn btn-small" aria-label={less} onClick={(e) => (e.preventDefault(), set(value - 2))}>−</button>
      <input type="range" min={-max} max={max} step={2} value={value} onChange={(e) => set(+e.target.value)} />
      <button type="button" className="btn btn-small" aria-label={more} onClick={(e) => (e.preventDefault(), set(value + 2))}>+</button>
    </span>
  );
};

export const Mesa = () => {
  const [s, setS] = usePersistedState("mesa", defaults);
  const set = (patch: Partial<typeof defaults>) => setS({ ...s, ...patch });
  const [view, setView] = useState<View>("voce");
  const [playing, setPlaying] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [tab, setTab] = useState<"saque" | "leitura" | "devolucao">("saque"); // phones show one panel at a time
  const pane = (name: typeof tab) => `mesa-pane${tab === name ? "" : " mesa-pane-hidden"}`;

  const stroke = STROKES[s.stroke] ?? STROKES.corte;
  const serve = useMemo(
    () => simulateServe({ brushDeg: s.brushDeg, spinRps: s.spinRps, startX: -0.3, targetX: -s.placeX, targetY: s.depth }),
    [s.brushDeg, s.spinRps, s.placeX, s.depth],
  );
  const contact = serve?.contact ?? null;
  const st: Stroke = { angleDeg: s.angleDeg, aimDeg: s.aimDeg, speed: stroke.speed, swingUpDeg: stroke.swingUpDeg, swingSideDeg: stroke.swingSideDeg };
  const ret = contact ? simulateReturn(contact, st) : null; // React Compiler memoizes it
  const spin = contact ? describeSpin(contact.w) : null;
  // Curve in the air (Magnus) for the serve: sideways component of ω×v, ball flying toward you.
  const curveRight = -cross(serveSpin(s.brushDeg, 1), [0, 1, 0])[0];

  const mount = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ReturnType<typeof createScene> | null>(null);
  useEffect(() => {
    const sc = createScene(mount.current!);
    sceneRef.current = sc;
    return () => sc.dispose();
  }, []);
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc || !serve) return;
    sc.setShot({
      samples: ret ? [...serve.samples, ...ret.samples.slice(1)] : serve.samples,
      contactIndex: serve.samples.length - 1, // serve flight ends at your contact
      returnColor: ret && OUTCOME[ret.outcome][1] ? "#2b8a3e" : "#c92a2a",
      serveStart: serve.samples[0].p,
      brushDir: brushDir(s.brushDeg),
      racketNormal: contact ? racketNormal(s.angleDeg, s.aimDeg) : null,
      racketVel: contact ? racketVelocity(st) : null,
      kickDir: spin ? [-spin.kick.right, 0, spin.kick.up] : null,
    });
  }, [serve, ret]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => sceneRef.current?.setView(view), [view]);
  useEffect(() => void sceneRef.current?.setSpeed(s.slow), [s.slow]);
  useEffect(() => void sceneRef.current?.setPlaying(playing), [playing]);

  // Mouse wheel over the scene: racket angle; Shift+wheel: aim; Ctrl+wheel: zoom.
  useEffect(() => {
    const el = mount.current!;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // no page scroll / browser zoom while over the scene
      const delta = e.deltaY || e.deltaX; // some browsers turn Shift+wheel into horizontal scroll
      if (e.ctrlKey) return sceneRef.current?.zoom(delta > 0 ? 1.1 : 1 / 1.1);
      acc += delta;
      if (Math.abs(acc) < 40) return; // trackpads send many tiny deltas
      const step = acc < 0 ? 2 : -2; // wheel up = open racket / aim right
      acc = 0;
      const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));
      setS((cur) => (e.shiftKey ? { ...cur, aimDeg: clamp(cur.aimDeg + step, 40) } : { ...cur, angleDeg: clamp(cur.angleDeg + step, 70) }));
      setHint(null);
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    // Middle button + drag: up/down = racket angle (up opens), left/right = aim. 2° per 8 px.
    let drag: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 1) return;
      e.preventDefault(); // no autoscroll icon
      drag = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const da = Math.trunc((drag.y - e.clientY) / 8) * 2;
      const dm = Math.trunc((e.clientX - drag.x) / 8) * 2;
      if (!da && !dm) return;
      if (da) drag.y -= (da / 2) * 8;
      if (dm) drag.x += (dm / 2) * 8;
      const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));
      setS((cur) => ({ ...cur, angleDeg: clamp(cur.angleDeg + da, 70), aimDeg: clamp(cur.aimDeg + dm, 40) }));
      setHint(null);
    };
    const onUp = (e: PointerEvent) => {
      if (e.button === 1) drag = null;
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [setS]);

  const showBest = () => {
    if (!contact) return;
    const b = bestReturn(contact, st, stroke.range);
    if (!b) {
      setHint(`Com ${stroke.name.toLowerCase()} esse saque não volta (ex.: bloqueio contra corte vai na rede). Tente outro golpe.`);
      return;
    }
    set({ angleDeg: b.angleDeg, aimDeg: b.aimDeg });
    setHint(`Raquete ${b.angleDeg >= 0 ? "aberta" : "fechada"} ${Math.abs(b.angleDeg)}°, mira ${b.aimDeg === 0 ? "reta" : `${Math.abs(b.aimDeg)}° à ${b.aimDeg > 0 ? "direita" : "esquerda"}`}. Funciona de ${b.window[0]}° a ${b.window[1]}° (janela de ${b.window[1] - b.window[0]}°).`);
  };

  const angleLabel = s.angleDeg === 0 ? "reta" : `${s.angleDeg > 0 ? "aberta" : "fechada"} ${Math.abs(s.angleDeg)}°`;
  const aimLabel = s.aimDeg === 0 ? "reto" : `${Math.abs(s.aimDeg)}° à ${s.aimDeg > 0 ? "direita" : "esquerda"}`;

  return (
    <main className="layout">
      <div>
        <h1>Simulador de efeito: tênis de mesa</h1>
        <p className="subtitle">
          Regra de ouro: <strong>a bola sai da sua raquete para onde a raquete do sacador estava indo.</strong> Arraste a cena para girar a câmera.
        </p>
      </div>
      <div className="columns">
        <div className="col-form">
          <div className="mesa-tabs actions" role="tablist">
            {(
              [
                ["saque", "1. Saque"],
                ["leitura", "2. Leitura"],
                ["devolucao", "3. Devolução"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={`btn ${tab === k ? "btn-primary" : ""}`} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className={pane("saque")}>
          <Section title="1. Saque">
            <label className="field">
              Tipo
              <select
                value={SERVES.find((x) => x.brushDeg === s.brushDeg && x.spinRps === s.spinRps)?.name ?? ""}
                onChange={(e) => {
                  const p = SERVES.find((x) => x.name === e.target.value);
                  if (p) set({ brushDeg: p.brushDeg, spinRps: p.spinRps });
                  setHint(null);
                }}
              >
                <option value="">Personalizado</option>
                {SERVES.map((x) => (
                  <option key={x.name}>{x.name}</option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
              <Dial deg={s.brushDeg} onChange={(d) => (set({ brushDeg: d }), setHint(null))} />
              <p className="small muted" style={{ margin: 0 }}>
                Para onde <strong>você vê</strong> a raquete do sacador se mover ao tocar a bola. Toque no círculo para mudar. Seta azul-piscina na cena = esse movimento.
              </p>
            </div>
            <label className="field">
              Quantidade de efeito: {s.spinRps} rotações/s
              <input type="range" min={0} max={80} step={5} value={s.spinRps} onChange={(e) => (set({ spinRps: +e.target.value }), setHint(null))} />
            </label>
            <div className="grid-2">
              <label className="field">
                Comprimento
                <select value={s.depth} onChange={(e) => (set({ depth: +e.target.value }), setHint(null))}>
                  <option value={2.1}>Curto (quica 2x)</option>
                  <option value={2.35}>Meia distância</option>
                  <option value={2.6}>Longo</option>
                </select>
              </label>
              <label className="field">
                Lado
                <select value={s.placeX} onChange={(e) => (set({ placeX: +e.target.value }), setHint(null))}>
                  <option value={-0.45}>Sua esquerda</option>
                  <option value={0}>Meio</option>
                  <option value={0.45}>Sua direita</option>
                </select>
              </label>
            </div>
          </Section>
          </div>

          <div className={pane("leitura")}>
          <Section title="2. Leitura">
            {!contact || !spin ? (
              <p className="alert alert-warn">Esse saque não fica válido{serve?.hitNet ? " (bate na rede)" : ""}. Mude comprimento ou efeito.</p>
            ) : (
              <>
                <p>
                  Chega na sua raquete com <strong>{fmt(spin.total)} rps</strong>
                  {Math.abs(spin.top) > 3 && <> ({spin.top > 0 ? "topspin" : "corte"} {fmt(Math.abs(spin.top))} rps)</>}. Parte do efeito se perde no quique.
                </p>
                <p>
                  Numa raquete reta, ela sai <strong>{directionText(spin.kick.up, spin.kick.right)}</strong> (seta amarela).
                </p>
                {fixText(spin.kick.up, spin.kick.right) && (
                  <p>
                    Compense: <strong>{fixText(spin.kick.up, spin.kick.right)}</strong>. Ou gere mais efeito que o dele (flick/topspin): seu efeito domina.
                  </p>
                )}
                {Math.abs(curveRight) > 0.3 && s.spinRps > 0 && (
                  <p className="small muted">
                    No ar ela curva para a sua {curveRight > 0 ? "direita" : "esquerda"}: o lado oposto de onde sai da raquete. Leia a raquete do sacador, não a curva.
                  </p>
                )}
              </>
            )}
          </Section>
          </div>

          <div className={pane("devolucao")}>
          <Section title="3. Sua devolução">
            <label className="field">
              Golpe
              <select value={s.stroke} onChange={(e) => (set({ stroke: e.target.value }), setHint(null))}>
                {Object.entries(STROKES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Ângulo da raquete: {angleLabel}
              <Stepper value={s.angleDeg} max={70} less="Fechar 2°" more="Abrir 2°" onChange={(v) => (set({ angleDeg: v }), setHint(null))} />
            </label>
            <label className="field">
              Mira: {aimLabel}
              <Stepper value={s.aimDeg} max={40} less="Mirar 2° à esquerda" more="Mirar 2° à direita" onChange={(v) => (set({ aimDeg: v }), setHint(null))} />
            </label>
            {ret && (
              <p className={`alert ${OUTCOME[ret.outcome][1] ? "badge-ok" : "alert-error"}`} style={{ marginTop: 10 }}>
                {OUTCOME[ret.outcome][0]}
              </p>
            )}
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" onClick={showBest} disabled={!contact}>
                Mostrar ângulo certo
              </button>
            </div>
            {hint && <p className="small">{hint}</p>}
            <p className="small muted">Raquete vermelha = sua face; seta roxa = direção do seu golpe. Tente acertar sozinho antes de pedir a resposta.</p>
          </Section>
          </div>
        </div>

        <div className="col-results mesa-scene">
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ position: "relative" }}>
              <div ref={mount} className="mesa-canvas" />
              <div className="mesa-status">
                {spin && <span className="badge badge-muted">Sai da raquete: {directionText(spin.kick.up, spin.kick.right)}</span>}
                {ret && <span className={`badge ${OUTCOME[ret.outcome][1] ? "badge-ok" : "badge-warn"}`}>{OUTCOME[ret.outcome][0]}</span>}
              </div>
              <ul className="mesa-legend mesa-keys mesa-touch" aria-label="Gestos">
                <li><kbd>1 dedo</kbd> girar</li>
                <li><kbd>pinça</kbd> zoom</li>
                <li><kbd>2 dedos</kbd> mover</li>
              </ul>
              <ul className="mesa-legend mesa-keys mesa-mouse" aria-label="Atalhos">
                <li><kbd>arrastar</kbd> girar</li>
                <li><kbd>Espaço</kbd>/<kbd>Ctrl</kbd> + <kbd>arrastar</kbd> mover</li>
                <li><kbd>roda</kbd> ângulo (↑ abre)</li>
                <li><kbd>Shift</kbd> + <kbd>roda</kbd> mira (↑ direita)</li>
                <li><kbd>Ctrl</kbd> + <kbd>roda</kbd> zoom</li>
                <li><kbd>botão do meio</kbd> + <kbd>arrastar</kbd> ↕ ângulo, ↔ mira</li>
              </ul>
              <ul className="mesa-legend" aria-label="Legenda">
                <li><i style={{ background: "#0c8599" }} />raquete do sacador</li>
                <li><i style={{ background: "#f59f00" }} />efeito joga a bola</li>
                <li><i style={{ background: "#862e9c" }} />seu golpe</li>
                <li><i style={{ background: "#ff8a1f", height: 2 }} />saque · <i style={{ background: "#2b8a3e", height: 2 }} />/<i style={{ background: "#c92a2a", height: 2 }} /> volta</li>
              </ul>
            </div>
            <div className="actions mesa-bar">
              {(
                [
                  ["voce", "Sua visão"],
                  ["sacador", "Do sacador"],
                  ["lado", "Lateral"],
                  ["cima", "De cima"],
                ] as [View, string][]
              ).map(([k, label]) => (
                <button key={k} className={`btn btn-small ${view === k ? "btn-primary" : ""}`} onClick={() => (setView(k), sceneRef.current?.setView(k))}>
                  {label}
                </button>
              ))}
              <button className="btn btn-small" onClick={() => setPlaying(!playing)}>
                {playing ? "Pausar" : "Continuar"}
              </button>
              <button className="btn btn-small" onClick={() => sceneRef.current?.restart()}>
                Repetir
              </button>
              <label className="small mesa-slow">
                Lenta
                <input type="range" min={0.03} max={1} step={0.01} value={s.slow} onChange={(e) => set({ slow: +e.target.value })} />
                {Math.round(s.slow * 100)}%
              </label>
            </div>
          </div>
          <p className="small muted">
            
            Modelo simplificado (gravidade, ar, efeito Magnus, atrito no quique). Serve para entender direções, não números exatos: borracha, madeira e força real mudam muito. Bola desenhada 1,5x maior.
          </p>
        </div>
      </div>
    </main>
  );
};
