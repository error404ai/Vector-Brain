import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Vector, the mascot: a small real-time 3D robot drawn with three.js.
 *
 * Built from primitives (no model file) so it stays small and every part can
 * move on its own: the head follows the pointer, the eyes blink and change
 * with the mood, the left arm waves, the right hand holds a phone.
 *
 * Loaded only where it is shown (see VectorBot) and torn down completely on
 * dispose: geometries, materials, textures and the WebGL context itself. Tabs
 * on iPhone Safari have little memory, so nothing may outlive the component.
 */

export type BotMood = 'idle' | 'listen' | 'think' | 'work' | 'done';

export interface BotHandle {
  setMood(mood: BotMood): void;
  wave(): void;
  hop(): void;
  dispose(): void;
}

interface Options {
  /** Small docked robot: lower resolution, no pointer tracking. */
  compact?: boolean;
  onReady?: () => void;
}

const PORCELAIN = { body: '#F3F5FA', trim: '#DCE3EE', glow: '#3B82F6', ui: '#2563EB' };

export function startVectorBot(canvas: HTMLCanvasElement, opts: Options = {}): BotHandle {
  const compact = !!opts.compact;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !compact, alpha: true, powerPreference: 'low-power' });
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.5 : mobile ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  scene.environment = envTarget.texture;
  keep(envTarget);
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  // Docked, the robot is only a few dozen pixels: frame the face, not the body.
  if (compact) {
    camera.position.set(0, 0.95, 3.9);
    camera.lookAt(0, 0.66, 0);
  } else {
    camera.position.set(0, 0.55, 8.6);
  }
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 5, 5);
  const rim = new THREE.DirectionalLight(new THREE.Color(PORCELAIN.glow).lerp(new THREE.Color('#ffffff'), 0.5), 1.2);
  rim.position.set(-4, 2, -3);
  scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.25));

  const mat = {
    body: keep(new THREE.MeshPhysicalMaterial({ color: PORCELAIN.body, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12 })),
    trim: keep(new THREE.MeshPhysicalMaterial({ color: PORCELAIN.trim, roughness: 0.35, clearcoat: 0.6 })),
    visor: keep(new THREE.MeshPhysicalMaterial({ color: 0x06090f, roughness: 0.06, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 })),
    dark: keep(new THREE.MeshStandardMaterial({ color: 0x1b2230, roughness: 0.5, metalness: 0.4 })),
    glow: keep(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: PORCELAIN.glow, emissiveIntensity: 2.2 })),
  };
  const geo = <T extends THREE.BufferGeometry>(g: T): T => keep(g);
  const canvasTexture = (w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const t = keep(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    return { c, ctx: c.getContext('2d') as CanvasRenderingContext2D, t };
  };

  const rig = new THREE.Group();
  rig.position.y = 0.32;
  scene.add(rig);
  const float = new THREE.Group();
  rig.add(float);

  // Body, belt and chest light.
  const body = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.62, 0.5, 12, 32)), mat.body);
  body.scale.set(1, 0.95, 0.82);
  body.position.y = -1.05;
  const belt = new THREE.Mesh(geo(new THREE.TorusGeometry(0.6, 0.06, 16, 64)), mat.trim);
  belt.rotation.x = Math.PI / 2;
  belt.scale.set(1, 0.82, 1);
  belt.position.y = -1.22;
  const chestTex = canvasTexture(128, 128);
  const chestMat = keep(new THREE.MeshBasicMaterial({ map: chestTex.t, transparent: true, toneMapped: false }));
  const chest = new THREE.Mesh(geo(new THREE.CircleGeometry(0.2, 40)), chestMat);
  chest.position.set(0, -0.82, 0.52);
  const chestRing = new THREE.Mesh(geo(new THREE.TorusGeometry(0.22, 0.03, 12, 48)), mat.trim);
  chestRing.position.set(0, -0.82, 0.51);
  float.add(body, belt, chest, chestRing);

  // Hover ring, glow and floor shadow.
  const soft = canvasTexture(128, 128);
  const grad = soft.ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  soft.ctx.fillStyle = grad;
  soft.ctx.fillRect(0, 0, 128, 128);
  soft.t.needsUpdate = true;
  const ring = new THREE.Mesh(geo(new THREE.TorusGeometry(0.42, 0.045, 16, 64)), mat.glow);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -1.78;
  const glowMat = keep(new THREE.MeshBasicMaterial({ map: soft.t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: PORCELAIN.glow, opacity: 0.6 }));
  const glowDisc = new THREE.Mesh(geo(new THREE.PlaneGeometry(1.6, 1.6)), glowMat);
  glowDisc.rotation.x = -Math.PI / 2;
  glowDisc.position.y = -1.8;
  float.add(ring, glowDisc);
  const shadowMat = keep(new THREE.MeshBasicMaterial({ map: soft.t, transparent: true, depthWrite: false, color: 0x0b1220, opacity: 0.28 }));
  const shadow = new THREE.Mesh(geo(new THREE.PlaneGeometry(2.2, 2.2)), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -2.35;
  rig.add(shadow);

  // Neck and head with a glass visor; the face is a canvas redrawn per mood.
  const neck = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.16, 0.2, 0.22, 24)), mat.dark);
  neck.position.y = -0.33;
  const head = new THREE.Group();
  head.position.y = 0.32;
  float.add(neck, head);
  head.add(new THREE.Mesh(geo(new RoundedBoxGeometry(1.62, 1.22, 1.3, 8, 0.42)), mat.body));
  const visor = new THREE.Mesh(geo(new RoundedBoxGeometry(1.34, 0.84, 0.3, 8, 0.3)), mat.visor);
  visor.position.z = 0.55;
  head.add(visor);
  const faceTex = canvasTexture(512, 320);
  const faceMat = keep(new THREE.MeshBasicMaterial({ map: faceTex.t, transparent: true, toneMapped: false }));
  const face = new THREE.Mesh(geo(new THREE.PlaneGeometry(1.16, 0.72)), faceMat);
  face.position.z = 0.705;
  head.add(face);
  const earGeo = geo(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 32));
  const earRingGeo = geo(new THREE.TorusGeometry(0.12, 0.025, 12, 40));
  const ears = [-1, 1].map((s) => {
    const g = new THREE.Group();
    const e = new THREE.Mesh(earGeo, mat.trim);
    e.rotation.z = Math.PI / 2;
    const l = new THREE.Mesh(earRingGeo, mat.glow);
    l.rotation.y = Math.PI / 2;
    l.position.x = s * 0.085;
    g.add(e, l);
    g.position.set(s * 0.86, 0, 0);
    head.add(g);
    return g;
  });
  const ant = new THREE.Group();
  ant.position.set(0.28, 0.62, 0);
  ant.rotation.z = -0.25;
  const stalk = new THREE.Mesh(geo(new THREE.CylinderGeometry(0.03, 0.035, 0.42, 12)), mat.dark);
  stalk.position.y = 0.2;
  const bulb = new THREE.Mesh(geo(new THREE.SphereGeometry(0.09, 24, 16)), mat.glow);
  bulb.position.y = 0.44;
  ant.add(stalk, bulb);
  head.add(ant);

  // Arms; the right hand holds a phone whose screen shows the work.
  const armGeo = geo(new THREE.CapsuleGeometry(0.13, 0.42, 8, 16));
  const ballGeo = geo(new THREE.SphereGeometry(0.17, 24, 16));
  const handGeo = geo(new THREE.SphereGeometry(0.15, 24, 16));
  const mkArm = (s: number) => {
    const sh = new THREE.Group();
    sh.position.set(s * 0.72, -0.72, 0);
    const a = new THREE.Mesh(armGeo, mat.body);
    a.position.y = -0.34;
    const hand = new THREE.Mesh(handGeo, mat.trim);
    hand.position.y = -0.66;
    sh.add(new THREE.Mesh(ballGeo, mat.trim), a, hand);
    float.add(sh);
    return sh;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  armR.rotation.set(-0.9, 0, 0.5);
  const phone = new THREE.Group();
  phone.position.set(0, -0.78, 0.12);
  phone.rotation.set(1.2, 0, -0.1);
  armR.add(phone);
  phone.add(new THREE.Mesh(geo(new RoundedBoxGeometry(0.4, 0.78, 0.06, 4, 0.05)), mat.dark));
  const scrTex = canvasTexture(128, 256);
  const scrMat = keep(new THREE.MeshBasicMaterial({ map: scrTex.t, toneMapped: false }));
  const scr = new THREE.Mesh(geo(new THREE.PlaneGeometry(0.34, 0.7)), scrMat);
  scr.position.z = 0.032;
  phone.add(scr);

  // --- state ---
  let mood: BotMood = 'idle';
  let blink = 0;
  let nextBlink = 1.5;
  let waveT = -10;
  let hopT = -10;
  const look = { x: 0, y: 0 };
  const target = { x: 0, y: 0 };
  const glowColor = new THREE.Color(PORCELAIN.glow).getStyle();

  function drawFace(t: number) {
    const fx = faceTex.ctx;
    const W = 512;
    const H = 320;
    fx.clearRect(0, 0, W, H);
    fx.fillStyle = glowColor;
    fx.strokeStyle = glowColor;
    fx.shadowColor = glowColor;
    fx.shadowBlur = 28;
    fx.lineCap = 'round';
    const ox = look.x * 26;
    const oy = -look.y * 16;
    const eyes: [number, number][] = [
      [W / 2 - 92 + ox, H / 2 + oy],
      [W / 2 + 92 + ox, H / 2 + oy],
    ];
    if (mood === 'done') {
      fx.lineWidth = 22;
      eyes.forEach(([x, y]) => {
        fx.beginPath();
        fx.arc(x, y + 22, 40, Math.PI * 1.15, Math.PI * 1.85);
        fx.stroke();
      });
    } else if (mood === 'think') {
      for (let i = 0; i < 3; i++) {
        const a = (Math.sin(t * 5 - i * 0.8) + 1) / 2;
        fx.globalAlpha = 0.3 + a * 0.7;
        fx.beginPath();
        fx.arc(W / 2 - 80 + i * 80, H / 2 - a * 14, 22, 0, Math.PI * 2);
        fx.fill();
      }
      fx.globalAlpha = 1;
    } else if (mood === 'work') {
      eyes.forEach(([x, y]) => {
        fx.beginPath();
        fx.roundRect(x - 44, y - 12, 88, 24, 12);
        fx.fill();
      });
      const sx = ((t * 0.6) % 1) * W;
      fx.globalAlpha = 0.25;
      fx.fillRect(sx - 30, 40, 60, H - 80);
      fx.globalAlpha = 1;
    } else {
      const open = mood === 'listen' ? 1.25 : 1;
      const h = Math.max(6, 70 * open * (1 - blink));
      eyes.forEach(([x, y]) => {
        fx.beginPath();
        fx.roundRect(x - 30, y - h / 2, 60, h, 30);
        fx.fill();
      });
      if (mood === 'listen') {
        fx.lineWidth = 10;
        fx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6);
        fx.beginPath();
        fx.arc(W / 2, H / 2 + 92, 18, Math.PI * 0.15, Math.PI * 0.85);
        fx.stroke();
        fx.globalAlpha = 1;
      }
    }
    faceTex.t.needsUpdate = true;
  }

  function drawChest(t: number) {
    const cx = chestTex.ctx;
    cx.clearRect(0, 0, 128, 128);
    const r = cx.createRadialGradient(64, 64, 4, 64, 64, 64);
    r.addColorStop(0, '#ffffff');
    r.addColorStop(0.35, glowColor);
    r.addColorStop(1, 'rgba(0,0,0,0)');
    cx.globalAlpha = 0.65 + 0.35 * Math.sin(t * (mood === 'work' ? 8 : 2));
    cx.fillStyle = r;
    cx.fillRect(0, 0, 128, 128);
    cx.globalAlpha = 1;
    cx.fillStyle = '#0B1220';
    cx.font = '800 54px Onest, Inter, sans-serif';
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillText('V', 64, 68);
    chestTex.t.needsUpdate = true;
  }

  function drawPhone(t: number) {
    const c = scrTex.ctx;
    c.fillStyle = '#F8FAFC';
    c.fillRect(0, 0, 128, 256);
    c.fillStyle = PORCELAIN.ui;
    c.fillRect(0, 0, 128, 26);
    for (let i = 0; i < 5; i++) {
      const y = 40 + i * 40;
      c.fillStyle = '#E2E8F0';
      c.beginPath();
      c.roundRect(10, y, 108, 30, 6);
      c.fill();
      c.fillStyle = glowColor;
      c.beginPath();
      c.roundRect(16, y + 7, 16, 16, 4);
      c.fill();
    }
    if (mood === 'work') {
      const y = 40 + (Math.floor(t * 1.5) % 5) * 40;
      c.strokeStyle = PORCELAIN.ui;
      c.lineWidth = 3;
      c.beginPath();
      c.roundRect(8, y - 2, 112, 34, 7);
      c.stroke();
    }
    if (mood === 'done') {
      c.fillStyle = '#10B981';
      c.beginPath();
      c.arc(64, 128, 34, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#fff';
      c.lineWidth = 8;
      c.beginPath();
      c.moveTo(48, 128);
      c.lineTo(60, 140);
      c.lineTo(82, 116);
      c.stroke();
    }
    scrTex.t.needsUpdate = true;
  }

  // --- input ---
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    target.x = THREE.MathUtils.clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2), -1.4, 1.4);
    target.y = THREE.MathUtils.clamp((e.clientY - (r.top + r.height * 0.4)) / (r.height / 2), -1.2, 1.2);
  };
  if (!compact) window.addEventListener('pointermove', onMove, { passive: true });

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  let visible = true;
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
  });
  io.observe(canvas);

  // --- loop ---
  const clock = new THREE.Clock();
  let raf = 0;
  let frameNo = 0;
  let ready = false;
  const m = reduce ? 0 : 1;
  const frame = () => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    frameNo++;
    if (t > nextBlink) {
      blink = 1;
      nextBlink = t + 2.2 + Math.random() * 3;
    }
    blink = Math.max(0, blink - dt * 9);
    look.x += (target.x - look.x) * 0.08;
    look.y += (target.y - look.y) * 0.08;
    float.position.y = m * (Math.sin(t * 1.6) * 0.08 + (mood === 'work' ? Math.sin(t * 9) * 0.015 : 0));
    const hop = Math.max(0, 1 - (t - hopT) / 0.9);
    float.position.y += m * Math.sin((1 - hop) * Math.PI) * hop * 0.45;
    rig.rotation.y = look.x * 0.18 + (compact ? Math.sin(t * 0.6) * 0.15 * m : 0);
    head.rotation.y = look.x * 0.35;
    head.rotation.x = look.y * 0.18 + (mood === 'think' ? Math.sin(t * 2) * 0.05 * m : 0);
    head.rotation.z = mood === 'think' ? 0.12 : mood === 'listen' ? -0.08 : Math.sin(t * 1.2) * 0.02 * m;
    ant.rotation.z = -0.25 + Math.sin(t * 3) * (mood === 'think' ? 0.25 : 0.06) * m;
    mat.glow.emissiveIntensity = 1.6 + Math.sin(t * (mood === 'think' || mood === 'work' ? 7 : 2)) * 0.8 * m;
    ring.scale.setScalar(1 + Math.sin(t * 3) * 0.05 * m);
    glowMat.opacity = 0.45 + Math.sin(t * 3) * 0.15 * m;
    shadow.scale.setScalar(1 - float.position.y * 0.5);
    shadowMat.opacity = 0.28 - float.position.y * 0.2;
    const w = Math.max(0, 1 - (t - waveT) / 1.6);
    armL.rotation.z = -0.18 - (w > 0 ? Math.sin(w * 18) * 0.35 + 1.9 * Math.sin(w * Math.PI) : 0) + Math.sin(t * 1.6) * 0.04 * m;
    armL.rotation.x = w > 0 ? -0.3 : 0;
    armR.rotation.x = -0.9 + (mood === 'work' ? Math.sin(t * 6) * 0.05 : Math.sin(t * 1.6) * 0.03) * m;
    ears.forEach((e, i) => {
      e.rotation.x = mood === 'listen' ? Math.sin(t * 8 + i) * 0.2 * m : 0;
    });
    // The small docked robot redraws its canvases less often; nobody can tell.
    if (!compact || frameNo % 2 === 0) {
      drawFace(t);
      drawChest(t);
      drawPhone(t);
    }
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      opts.onReady?.();
    }
  };
  frame();

  return {
    setMood(next) {
      mood = next;
    },
    wave() {
      waveT = clock.elapsedTime;
    },
    hop() {
      hopT = clock.elapsedTime;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      if (!compact) window.removeEventListener('pointermove', onMove);
      disposables.forEach((d) => d.dispose());
      scene.environment = null;
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
