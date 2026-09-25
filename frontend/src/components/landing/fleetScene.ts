import * as THREE from 'three';
import { SCREEN_H, SCREEN_W, paintScreen, type ScreenKind } from './screens';
import { clamp, doneFrac, ease, fleetCount, lerp, type FleetState } from './fleetState';

/**
 * The landing page's WebGL still life: five detailed phones float in a light
 * studio, assemble into a grid, become the catalogued object, settle beside the
 * manifesto, then join a lattice of 1,000 instanced phones as the camera pulls
 * back. Everything is driven by `state.phase`, so it runs in both directions.
 *
 * Returns null when WebGL is unavailable; the page then shows its CSS fallback.
 */
export interface FleetScene {
  dispose: () => void;
  /** Puts a real screenshot on hero phone `index` (0 is the front phone), cropped to fill the screen. */
  setScreenImage: (index: number, img: HTMLImageElement) => void;
}

export function startFleetScene(canvas: HTMLCanvasElement, state: FleetState): FleetScene | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  const reduce = state.reduceMotion;
  let dpr = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const TAN = Math.tan(THREE.MathUtils.degToRad(15));

  // Studio environment for reflections: soft boxes and dark flags in a pale room.
  {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0xe9eef5);
    const add = (w: number, h: number, color: number, pos: [number, number, number], rot?: [number, number, number]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
      m.position.set(...pos);
      if (rot) m.rotation.set(...rot);
      env.add(m);
    };
    add(14, 8, 0xffffff, [0, 9, 0], [Math.PI / 2, 0, 0]);
    add(3, 12, 0xffffff, [-9, 1, 2], [0, Math.PI / 2, 0]);
    add(2, 12, 0xeef3fa, [9, 1, -2], [0, -Math.PI / 2, 0]);
    add(20, 3, 0x1f2937, [0, -6, -9]);
    add(4, 14, 0x334155, [6, 0, 9], [0, Math.PI, 0]);
    add(20, 20, 0xcbd5e1, [0, -9, 0], [-Math.PI / 2, 0, 0]);
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0.035).texture;
    pm.dispose();
    env.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcbd5e1, 0.35 * Math.PI));
  const key = new THREE.DirectionalLight(0xffffff, 0.55 * Math.PI);
  key.position.set(-3, 5, 6);
  scene.add(key);

  // Phone geometry, 71.6 × 147.5 mm proportions.
  const W = 0.78, H = 1.6, R = 0.12, D = 0.05, B = 0.02;
  const shape = (w: number, h: number, r: number) => {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  };
  const flatGeo = (w: number, h: number, r: number) => {
    const g = new THREE.ShapeGeometry(shape(w, h, r), 14);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5);
    return g;
  };
  const bodyGeo = new THREE.ExtrudeGeometry(shape(W - 2 * B, H - 2 * B, R - B), {
    depth: D, bevelEnabled: true, bevelThickness: B, bevelSize: B, bevelSegments: 4, curveSegments: 14,
  });
  bodyGeo.center();
  const FZ = D / 2 + B;
  const glassGeo = flatGeo(W - 0.028, H - 0.028, R - 0.016);
  const screenGeo = flatGeo(W - 0.075, H - 0.075, R - 0.04);
  const bumpGeo = new THREE.ExtrudeGeometry(shape(0.3, 0.3, 0.08), {
    depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 10,
  });
  bumpGeo.center();
  const lensGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.02, 28);
  lensGeo.rotateX(Math.PI / 2);
  const btnGeo = new THREE.BoxGeometry(0.014, 0.16, 0.026);
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x080808, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
  const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.1, metalness: 0.3, clearcoat: 1 });

  interface HeroPhone { group: THREE.Group; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; kind: ScreenKind; real: boolean; shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> }

  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(15,23,42,.55)');
    gr.addColorStop(0.45, 'rgba(15,23,42,.22)');
    gr.addColorStop(1, 'rgba(15,23,42,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const shadowGeo = new THREE.PlaneGeometry(1, 1);
  shadowGeo.rotateX(-Math.PI / 2);

  const makePhone = (bodyColor: number, kind: ScreenKind, metal: number): HeroPhone => {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: bodyColor, metalness: metal, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    group.add(new THREE.Mesh(bodyGeo, bodyMat));
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.z = FZ + 0.0008;
    group.add(glass);
    const cv = document.createElement('canvas');
    cv.width = SCREEN_W;
    cv.height = SCREEN_H;
    paintScreen(cv, kind);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const scr = new THREE.Mesh(screenGeo, new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, roughness: 0.12, metalness: 0 }));
    scr.position.z = FZ + 0.0018;
    group.add(scr);
    const bump = new THREE.Mesh(bumpGeo, bodyMat);
    bump.position.set(-W / 2 + 0.24, H / 2 - 0.24, -FZ - 0.01);
    group.add(bump);
    for (const [x, y] of [[-0.06, 0.06], [0.06, 0.06], [-0.06, -0.06]]) {
      const l = new THREE.Mesh(lensGeo, lensMat);
      l.position.set(bump.position.x + x, bump.position.y + y, -FZ - 0.024);
      group.add(l);
    }
    for (const [y, h] of [[0.36, 0.16], [0.1, 0.12]]) {
      const b = new THREE.Mesh(btnGeo, bodyMat);
      b.scale.y = h / 0.16;
      b.position.set(W / 2 + 0.004, y, 0);
      group.add(b);
    }
    const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0 }));
    scene.add(group, shadow);
    return { group, canvas: cv, tex, kind, real: false, shadow };
  };

  const HERO = [
    makePhone(0x1f2937, 'command', 0.55),
    makePhone(0xe5e7eb, 'checkout', 0.15),
    makePhone(0x2563eb, 'status', 0.45),
    makePhone(0xcbd5e1, 'apps', 0.85),
    makePhone(0x111827, 'monitor', 0.6),
  ];

  // The fleet lattice: 50 × 20 = 1,000 instanced phones, ranked from the centre out.
  const COLS = 50, ROWS = 20, SX = 0.46, SY = 0.8, US = 0.4, N = COLS * ROWS;
  interface Slot { x: number; y: number; d: number; h: number }
  const slots: Slot[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = (c - (COLS - 1) / 2) * SX, y = ((ROWS - 1) / 2 - r) * SY;
      slots.push({ x, y, d: Math.max(Math.abs(x) / (7 * SX), Math.abs(y) / (3 * SY)) + Math.hypot(x, y) * 0.001, h: 0 });
    }
  }
  slots.sort((a, b) => a.d - b.d);
  const ext: [number, number][] = [];
  {
    let mx = 0, my = 0;
    for (const s of slots) {
      mx = Math.max(mx, Math.abs(s.x));
      my = Math.max(my, Math.abs(s.y));
      ext.push([mx, my]);
    }
  }
  const uBody = new THREE.InstancedMesh(bodyGeo, new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.5, roughness: 0.34, clearcoat: 0.5 }), N);
  const uScr = new THREE.InstancedMesh(screenGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), N);
  uBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  uScr.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const bodyCols = [0x1f2937, 0x1f2937, 0x111827, 0xe5e7eb, 0xcbd5e1, 0x2563eb, 0x1f2937];
  const tmp = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const h = (i * 2654435761) >>> 0;
    uBody.setColorAt(i, tmp.setHex(bodyCols[h % bodyCols.length]));
    uScr.setColorAt(i, tmp.set('#111827'));
    slots[i].h = (h % 1000) / 1000;
  }
  {
    // Instances start hidden (zero scale); the frame loop grows them in.
    const zero = new THREE.Matrix4().makeScale(1e-5, 1e-5, 1e-5);
    for (let i = 0; i < N; i++) {
      uBody.setMatrixAt(i, zero);
      uScr.setMatrixAt(i, zero);
    }
  }
  uBody.frustumCulled = uScr.frustumCulled = false;
  scene.add(uBody, uScr);
  const idle = ['#111827', '#1E293B', '#DBEAFE', '#0F172A'].map((c) => new THREE.Color(c));
  const running = new THREE.Color('#2563EB');
  const done = new THREE.Color('#A7F3D0');

  // Poses per chapter.
  const FLOAT: { p: [number, number, number]; r: [number, number, number] }[] = [
    { p: [2.35, -0.3, 1.3], r: [0.04, -0.24, 0.03] },
    { p: [-3.35, 1.05, -1.3], r: [0.32, 0.95, -0.24] },
    { p: [-3.05, -1.7, 0.35], r: [-0.46, 0.5, 0.32] },
    { p: [4.05, 1.5, -2.3], r: [0.22, -1.15, 0.5] },
    { p: [0.35, 2.25, -3.3], r: [-0.3, 2.7, -0.15] },
  ];
  const EXIT: [number, number, number][] = [[0, 0, 0], [-7, 3, -2], [-6, -5, 2], [8, 4, -3], [2, 7, -4]];
  type V3 = [number, number, number];
  const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  let aspect = 1, sx = 1, Z0 = 10, narrow = false;
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    aspect = w / h;
    narrow = aspect < 0.9;
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    sx = Math.min(1, aspect / 1.55);
    Z0 = Math.max(10, (narrow ? 2.7 : 4.9) / (TAN * aspect));
  };
  window.addEventListener('resize', resize);
  resize();

  let mX = 0, mY = 0;
  const heroPose = (i: number, ph: number, t: number) => {
    const f = FLOAT[i], sl = slots[i];
    const bob = reduce ? 0 : Math.sin(t * 0.6 + i * 1.7) * 0.06;
    const slotP: V3 = [sl.x, sl.y, 0], slotR: V3 = [0, 0, 0];
    const sep = ease(ph / 0.3), asm = ease((ph - 0.3) / 0.6);
    let pos: V3 = [f.p[0] * sx * (1 + sep * 0.18), f.p[1] * (1 + sep * 0.12) + bob, f.p[2]];
    let rot: V3 = [f.r[0] + (reduce ? 0 : Math.sin(t * 0.4 + i) * 0.04), f.r[1] + (i % 2 ? 1 : -1) * sep * 0.9, f.r[2]];
    if (narrow) pos = [pos[0] * 0.95, pos[1] * 1.9, pos[2] - 1.2];
    let s = narrow ? 0.8 : 1;
    pos = lerp3(pos, slotP, asm);
    rot = lerp3(rot, slotR, asm);
    s = lerp(s, US, asm);
    if (ph < 1) return { pos, rot, s };
    const b = ease((ph - 1) / 0.28);
    if (i === 0) {
      const p1 = clamp(ph - 1);
      const sheetP: V3 = [0, narrow ? 1.9 : -0.05, 1.1];
      const sheetR: V3 = [0.1 + mY * 0.18, (reduce ? 0 : Math.sin(t * 0.35) * 0.75) + (p1 - 0.5) * 1.4 + mX * 0.55, 0];
      pos = lerp3(pos, sheetP, b);
      rot = lerp3(rot, sheetR, b);
      s = lerp(s, narrow ? 1.9 : 1.75, b);
      if (ph < 2) return { pos, rot, s };
      const c = ease((ph - 2) / 0.35);
      const manP: V3 = narrow ? [0, 3.4, 0] : [-2.35 * sx, -0.1, 0.8];
      const manR: V3 = narrow ? [-0.4, 0.5, 0.1] : [-0.42 + (reduce ? 0 : Math.sin(t * 0.3) * 0.05), 0.7, 0.14];
      pos = lerp3(pos, manP, c);
      rot = lerp3(rot, manR, c);
      s = lerp(s, narrow ? 1.3 : 1.35, c);
      if (ph < 3) return { pos, rot, s };
      const d = ease((ph - 3) / 0.12);
      return { pos: lerp3(pos, slotP, d), rot: lerp3(rot, slotR, d), s: lerp(s, US, d) };
    }
    pos = lerp3(pos, [sl.x + EXIT[i][0], sl.y + EXIT[i][1], EXIT[i][2]], b);
    s = lerp(s, 0, b);
    if (ph < 3) return { pos, rot, s };
    return { pos: slotP, rot: slotR, s: US * clamp((fleetCount(state.p3) - i) / 2) };
  };

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
  let camZ = Z0, camY = 0, raf = 0, frames = 0, slow = 0, last = performance.now(), degraded = false, n0 = 0;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = now - last;
    last = now;
    if (document.hidden || state.covered) return;
    // Weak GPUs: drop resolution once instead of stuttering all the way down the page.
    if (!degraded && ++frames > 30 && frames < 150 && dt > 45 && ++slow > 40) {
      degraded = true;
      dpr = 0.7;
      renderer.setPixelRatio(dpr);
      resize();
    }
    const t = now / 1000, ph = state.phase;
    mX += (state.mouseX - mX) * 0.06;
    mY += (state.mouseY - mY) * 0.06;

    HERO.forEach((hp, i) => {
      const { pos, rot, s } = heroPose(i, ph, t);
      hp.group.position.set(...pos);
      hp.group.rotation.set(...rot);
      hp.group.scale.setScalar(Math.max(s, 0.0001));
      hp.group.visible = s > 0.002;
      const floor = -2.15 + (narrow ? -0.3 : 0), lift = pos[1] - s * 0.85 - floor;
      const vis = ph < 3 ? clamp(s / 0.9) * clamp(1 - lift / 3.2) : 0;
      hp.shadow.position.set(pos[0], floor, pos[2]);
      hp.shadow.scale.set(s * 1.6 * (1 + lift * 0.25), 1, s * 0.8 * (1 + lift * 0.25));
      hp.shadow.material.opacity = vis * 0.7;
      hp.shadow.visible = vis > 0.01;
    });

    const cmd = ph >= 3;
    let shown = 0;
    if (ph < 1) shown = ease((ph - 0.42) / 0.52) * 84;
    else if (ph < 2) shown = (1 - ease((ph - 1) / 0.25)) * 84;
    else if (cmd) shown = fleetCount(state.p3) * clamp((ph - 3) / 0.05);
    const nDone = cmd ? fleetCount(state.p3) * doneFrac(state.p3) : 0;
    const lim = Math.min(N, Math.ceil(shown) + 3);
    // Only touch instances that are, or just were, visible.
    const upto = Math.max(lim, n0);
    n0 = lim;
    for (let i = 0; i < upto; i++) {
      const sl = slots[i];
      const k = i < 5 || i >= lim ? 0 : clamp(shown - i + 1);
      const kk = ease(k), wob = reduce ? 0 : Math.sin(t * 1.3 + sl.h * 6.28) * 0.015;
      V.set(sl.x, sl.y - (1 - kk) * 0.35, (1 - kk) * 1.2 + wob);
      E.set((1 - kk) * 0.9, (1 - kk) * (sl.h - 0.5) * 1.4, 0);
      Q.setFromEuler(E);
      S.setScalar(Math.max(US * kk, 1e-5));
      M.compose(V, Q, S);
      uBody.setMatrixAt(i, M);
      V.z += FZ * US * kk + 0.0008;
      M.compose(V, Q, S);
      uScr.setMatrixAt(i, M);
      if (k > 0) {
        let c = cmd ? (i < nDone ? done : running) : idle[Math.floor(sl.h * 4)];
        if (cmd && i >= nDone && !reduce && (i + Math.floor(t * 3)) % 9 === 0) c = idle[0];
        uScr.setColorAt(i, c);
      }
    }
    uBody.instanceMatrix.needsUpdate = uScr.instanceMatrix.needsUpdate = true;
    if (uScr.instanceColor) uScr.instanceColor.needsUpdate = true;

    let tz = Z0;
    if (cmd) {
      const e = ext[Math.min(N - 1, Math.max(1, Math.ceil(shown)) - 1)];
      tz = Math.max(5.2, Math.max((e[1] + 0.7) / TAN, (e[0] + 0.5) / (TAN * aspect)) * (narrow ? 1.7 : 1.75));
    }
    camZ += (tz - camZ) * (cmd ? 0.08 : 0.2);
    camY += (0 - camY) * 0.1;
    const par = cmd ? 0.1 : 0.35;
    camera.position.set(mX * par, camY - mY * par * 0.6, camZ);
    camera.lookAt(0, camY, 0);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  // Canvas text needs the real faces: repaint once web fonts have loaded.
  let alive = true;
  document.fonts?.ready.then(() => {
    if (!alive) return;
    for (const hp of HERO) {
      if (hp.real) continue;
      paintScreen(hp.canvas, hp.kind);
      hp.tex.needsUpdate = true;
    }
  });

  const setScreenImage = (index: number, img: HTMLImageElement) => {
    const hp = HERO[index];
    const ctx = hp?.canvas.getContext('2d');
    if (!hp || !ctx || !img.naturalWidth) return;
    const cw = hp.canvas.width, ch = hp.canvas.height;
    const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    hp.real = true;
    hp.tex.needsUpdate = true;
  };

  const dispose = () => {
    alive = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          (m as THREE.MeshStandardMaterial).emissiveMap?.dispose();
          m.dispose();
        }
      }
    });
    scene.environment?.dispose();
    shadowTex.dispose();
    renderer.dispose();
  };

  return { dispose, setScreenImage };
}
