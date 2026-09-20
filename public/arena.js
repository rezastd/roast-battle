// 3D fight stage: two stylized bots trade roast-powered energy attacks.
// Loaded dynamically — if three.js or WebGL is unavailable the import fails
// and the game falls back to 2D mode. Uses stable three.js core APIs only.
import * as THREE from "three";
import { sfx } from "./sfx.js";

const SIDES = [
  { baseX: -2.6, facing: 1, rotY: Math.PI / 2, color: 0xff5a2a, name: "red" },
  { baseX: 2.6, facing: -1, rotY: -Math.PI / 2, color: 0x3fa9ff, name: "blue" },
];
const CHEST_Y = 1.45;

const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeIn = (k) => k * k * k;
const lerp = (a, b, k) => a + (b - a) * k;

export async function initArena(canvas) {
  const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const D = REDUCED ? 0.3 : 1; // duration scale

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x100d0a);
  scene.fog = new THREE.Fog(0x100d0a, 13, 28);

  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
  const camBase = new THREE.Vector3(0, 3.1, 10.6);
  camera.position.copy(camBase);
  camera.lookAt(0, 1.3, 0);

  // Lights: warm key + cool fill + per-side spots.
  scene.add(new THREE.AmbientLight(0xfff2df, 0.55));
  const key = new THREE.DirectionalLight(0xffe6c4, 1.4);
  key.position.set(4, 8, 6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x6a8cff, 0.4);
  fill.position.set(-6, 4, 4);
  scene.add(fill);
  for (const s of SIDES) {
    const spot = new THREE.SpotLight(s.color, 60, 20, 0.5, 0.6, 1.6);
    spot.position.set(s.baseX * 1.4, 8, 3);
    spot.target.position.set(s.baseX, 0, 0);
    scene.add(spot, spot.target);
  }
  const flash = new THREE.PointLight(0xffffff, 0, 14, 1.8);
  scene.add(flash);
  const chargeLight = new THREE.PointLight(0xffffff, 0, 9, 1.8);
  scene.add(chargeLight);

  // Platform + glow ring + fake arena crowd (cheap points).
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(6.2, 6.7, 0.5, 48),
    new THREE.MeshStandardMaterial({ color: 0x241d16, roughness: 0.9 }),
  );
  platform.position.y = -0.25;
  scene.add(platform);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(5.4, 0.06, 12, 80),
    new THREE.MeshStandardMaterial({ color: 0xc99a2e, emissive: 0xc99a2e, emissiveIntensity: 1.4 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  function makePoints(count, radius, y, size, hue) {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius + Math.random() * 4;
      pos.set([Math.cos(a) * r, y + Math.random() * 3, Math.sin(a) * r - 2], i * 3);
      c.setHSL(hue + Math.random() * 0.08, 0.9, 0.55 + Math.random() * 0.2);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const p = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, opacity: 0.9 }),
    );
    scene.add(p);
    return p;
  }
  const crowd = makePoints(220, 8, 1, 0.14, 0.09);
  const dust = makePoints(90, 3, 0.2, 0.06, 0.55);

  // --- Fighters -----------------------------------------------------------
  const bodyGeo = new THREE.CapsuleGeometry(0.32, 0.5, 6, 14);
  const headGeo = new THREE.SphereGeometry(0.27, 20, 16);
  const visorGeo = new THREE.BoxGeometry(0.34, 0.12, 0.1);
  const limbGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.62, 10);
  const fistGeo = new THREE.SphereGeometry(0.15, 14, 12);
  const legGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.95, 10);
  const plateGeo = new THREE.BoxGeometry(0.4, 0.5, 0.1);
  const blobGeo = new THREE.CircleGeometry(0.7, 24);

  function buildFighter(side) {
    const s = SIDES[side];
    const root = new THREE.Group();
    root.position.x = s.baseX;
    root.rotation.y = s.rotY;

    const shell = new THREE.MeshStandardMaterial({ color: 0x35322e, roughness: 0.5, metalness: 0.7 });
    const accent = new THREE.MeshStandardMaterial({
      color: s.color, roughness: 0.35, metalness: 0.3,
      emissive: s.color, emissiveIntensity: 0.55,
    });

    const legL = new THREE.Mesh(legGeo, shell);
    legL.position.set(-0.17, 0.48, 0.08);
    const legR = new THREE.Mesh(legGeo, shell);
    legR.position.set(0.17, 0.48, -0.08);
    root.add(legL, legR);

    const body = new THREE.Group();
    body.position.y = 1.0;
    root.add(body);
    const torso = new THREE.Mesh(bodyGeo, shell);
    torso.position.y = 0.45;
    const plate = new THREE.Mesh(plateGeo, accent);
    plate.position.set(0, 0.5, 0.3);
    body.add(torso, plate);

    const head = new THREE.Group();
    head.position.y = 1.12;
    const skull = new THREE.Mesh(headGeo, shell);
    const visor = new THREE.Mesh(visorGeo, accent);
    visor.position.z = 0.2;
    head.add(skull, visor);
    body.add(head);

    function arm(x) {
      const g = new THREE.Group();
      g.position.set(x, 0.72, 0);
      const upper = new THREE.Mesh(limbGeo, shell);
      upper.position.y = -0.3;
      const fist = new THREE.Mesh(fistGeo, accent);
      fist.position.y = -0.62;
      g.add(upper, fist);
      g.rotation.x = -0.35;
      body.add(g);
      return g;
    }
    const armL = arm(-0.46);
    const armR = arm(0.46);

    const blob = new THREE.Mesh(
      blobGeo,
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.015;
    scene.add(blob);

    scene.add(root);
    return {
      side, root, body, head, armL, armR, accent, blob,
      baseX: s.baseX, facing: s.facing, color: s.color,
      vel: 0, ko: false, phase: side * 2.1,
    };
  }
  const fighters = [buildFighter(0), buildFighter(1)];

  // --- FX pool --------------------------------------------------------------
  const fx = []; // { update(dt) -> alive }
  const sparkGeo = new THREE.SphereGeometry(0.07, 8, 8);
  let shake = 0;

  function burst(at, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(
        sparkGeo,
        new THREE.MeshBasicMaterial({ color, transparent: true }),
      );
      m.position.copy(at);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.9,
        (Math.random() - 0.5) * speed,
      );
      let life = 0.45 + Math.random() * 0.4;
      scene.add(m);
      fx.push({
        update(dt) {
          life -= dt;
          v.y -= 9 * dt;
          m.position.addScaledVector(v, dt);
          m.material.opacity = Math.max(0, life * 2);
          if (life <= 0) {
            scene.remove(m);
            m.material.dispose();
            return false;
          }
          return true;
        },
      });
    }
  }

  function shockwave(at, color, power) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.46, 40),
      new THREE.MeshBasicMaterial({
        color, transparent: true, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    m.position.copy(at);
    m.lookAt(camera.position);
    scene.add(m);
    const max = 2.5 + power * 4;
    let k = 0;
    fx.push({
      update(dt) {
        k += dt * 3.2;
        const s = 1 + k * max;
        m.scale.set(s, s, s);
        m.material.opacity = Math.max(0, 1 - k);
        if (k >= 1) {
          scene.remove(m);
          m.geometry.dispose();
          m.material.dispose();
          return false;
        }
        return true;
      },
    });
  }

  function flashAt(at, color, power) {
    flash.position.copy(at);
    flash.color.set(color);
    if (!REDUCED) flash.intensity = 60 + power * 120;
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.position.copy(at);
    scene.add(m);
    let k = 0;
    const max = 1.5 + power * 2.5;
    fx.push({
      update(dt) {
        k += dt * 4;
        const s = 1 + k * max;
        m.scale.set(s, s, s);
        m.material.opacity = Math.max(0, 1 - k);
        if (k >= 1) {
          scene.remove(m);
          m.geometry.dispose();
          m.material.dispose();
          return false;
        }
        return true;
      },
    });
  }

  // --- Main loop --------------------------------------------------------------
  const clock = new THREE.Clock();
  let running = true;
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    for (const f of fighters) {
      if (!f.ko) {
        f.root.position.y = Math.abs(Math.sin(t * 2.2 + f.phase)) * 0.07;
        const guard = -0.35 + Math.sin(t * 2.2 + f.phase) * 0.09;
        if (!f.armsBusy) {
          f.armL.rotation.x = guard;
          f.armR.rotation.x = guard;
        }
        f.head.rotation.y = Math.sin(t * 0.8 + f.phase) * 0.18;
      }
      // Knockback spring back to stance.
      f.root.position.x += f.vel * dt;
      f.vel *= Math.exp(-6 * dt);
      const pull = (f.baseX - f.root.position.x) * 8 * dt;
      f.root.position.x += pull;
      f.body.rotation.x *= Math.exp(-4 * dt);
      f.blob.position.x = f.root.position.x;
      f.blob.position.z = f.root.position.z;
    }

    flash.intensity *= Math.exp(-8 * dt);
    chargeLight.intensity *= Math.exp(-6 * dt);
    crowd.rotation.y += dt * 0.02;
    dust.rotation.y -= dt * 0.05;

    for (let i = fx.length - 1; i >= 0; i--) {
      if (!fx[i].update(dt)) fx.splice(i, 1);
    }

    if (shake > 0.001 && !REDUCED) {
      camera.position.set(
        camBase.x + (Math.random() - 0.5) * shake,
        camBase.y + (Math.random() - 0.5) * shake * 0.6,
        camBase.z,
      );
      camera.lookAt(0, 1.3, 0);
      shake *= Math.exp(-5 * dt);
    } else {
      camera.position.copy(camBase);
      camera.lookAt(0, 1.3, 0);
    }
    renderer.render(scene, camera);
  }

  function resize() {
    const w = canvas.clientWidth || 16;
    const h = canvas.clientHeight || 9;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();
  loop();

  // --- Tween + attack -----------------------------------------------------------
  let skipAll = false;
  const api = {};
  api.skip = () => {
    skipAll = true;
    shake = 0;
  };

  function tween(ms, fn) {
    return new Promise((resolve) => {
      const dur = Math.max(1, ms * D);
      const t0 = performance.now();
      function step(now) {
        const k = skipAll ? 1 : Math.min(1, (now - t0) / dur);
        fn(k);
        if (k < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  function handsOf(f) {
    return new THREE.Vector3(f.root.position.x + f.facing * 0.8, CHEST_Y, 0);
  }
  function chestOf(f) {
    return new THREE.Vector3(f.root.position.x, CHEST_Y, 0);
  }

  async function fireBall(A, B, spec) {
    const fizzle = spec.kind === "fizzle";
    if (fizzle) sfx.fizzle();
    else sfx.ball(spec.power);
    const color = fizzle ? 0x9a9a9a : A.color;
    const r = fizzle ? 0.14 : 0.2 + spec.power * 0.3;
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(r, 18, 14),
      new THREE.MeshBasicMaterial({ color }),
    );
    const glow = new THREE.PointLight(color, fizzle ? 4 : 10 + spec.power * 25, 8, 1.8);
    ball.add(glow);
    const from = handsOf(A);
    const to = chestOf(B);
    ball.position.copy(from);
    scene.add(ball);

    let lastTrail = 0;
    await tween(fizzle ? 850 : 620 - spec.power * 220, (k) => {
      const e = easeIn(k);
      ball.position.lerpVectors(from, to, e);
      if (fizzle) ball.position.y += Math.sin(k * 14) * 0.02;
      const now = performance.now();
      if (now - lastTrail > 40 && k < 1) {
        lastTrail = now;
        const s = new THREE.Mesh(
          sparkGeo,
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 }),
        );
        s.position.copy(ball.position);
        s.scale.setScalar(0.8);
        scene.add(s);
        let life = 0.25;
        fx.push({
          update(dt) {
            life -= dt;
            s.material.opacity = Math.max(0, life * 2.5);
            if (life <= 0) {
              scene.remove(s);
              s.material.dispose();
              return false;
            }
            return true;
          },
        });
      }
    });
    scene.remove(ball);
    ball.geometry.dispose();
    ball.material.dispose();
    return to;
  }

  async function fireBeam(A, B, spec) {
    sfx.beam();
    const from = handsOf(A);
    const to = chestOf(B);
    const dir = to.clone().sub(from);
    const len = dir.length();
    dir.normalize();
    const r = 0.14 + spec.power * 0.22;
    const group = new THREE.Group();
    const outer = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r * 1.5, 1, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: A.color, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    const inner = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.45, r * 0.6, 1, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    group.add(outer, inner);
    const up = new THREE.Vector3(0, 1, 0);
    group.quaternion.setFromUnitVectors(up, dir);
    group.position.copy(from).addScaledVector(dir, len / 2);
    scene.add(group);
    chargeLight.position.copy(from);
    if (!REDUCED) chargeLight.intensity = 50;

    await tween(130, (k) => group.scale.set(1, Math.max(0.01, easeOut(k) * len), 1));
    await tween(380, (k) => {
      const pulse = 1 + Math.sin(k * 25) * 0.12;
      group.scale.set(pulse, len, pulse);
    });
    await tween(160, (k) => {
      outer.material.opacity = 0.85 * (1 - k);
      inner.material.opacity = 0.95 * (1 - k);
    });
    scene.remove(group);
    outer.geometry.dispose();
    inner.geometry.dispose();
    outer.material.dispose();
    inner.material.dispose();
    return to;
  }

  api.attack = async function attack(side, spec, hooks = {}) {
    skipAll = false;
    const A = fighters[side];
    const B = fighters[1 - side];
    A.armsBusy = true;

    // Dash in + raise arms (the idle spring pulls the stance back after).
    const startX = A.root.position.x;
    const lungeX = A.baseX + A.facing * 0.55;
    await tween(140, (k) => {
      const e = easeOut(k);
      A.root.position.x = lerp(startX, lungeX, e);
      A.armL.rotation.x = lerp(-0.35, -1.5, e);
      A.armR.rotation.x = lerp(-0.35, -1.5, e);
    });

    // Charge.
    const fizzle = spec.kind === "fizzle";
    const chargeColor = fizzle ? 0x888888 : A.color;
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 12),
      new THREE.MeshBasicMaterial({ color: chargeColor, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    const handPos = handsOf(A);
    orb.position.copy(handPos);
    scene.add(orb);
    chargeLight.position.copy(handPos);
    chargeLight.color.set(chargeColor);
    const orbR = fizzle ? 0.5 : 0.7 + spec.power * 0.9;
    sfx.charge(fizzle ? 0.2 : spec.power);
    await tween(fizzle ? 260 : 480, (k) => {
      const s = Math.max(0.01, easeOut(k) * orbR);
      orb.scale.set(s, s, s);
      if (!REDUCED) chargeLight.intensity = k * (fizzle ? 6 : 14 + spec.power * 30);
    });
    scene.remove(orb);
    orb.geometry.dispose();
    orb.material.dispose();

    // Fire.
    const impactAt = spec.kind === "beam"
      ? await fireBeam(A, B, spec)
      : await fireBall(A, B, spec);

    // Impact.
    const fxColor = fizzle ? 0xbbbbbb : A.color;
    sfx.impact(fizzle ? 0.12 : spec.power);
    flashAt(impactAt, fxColor, spec.power);
    shockwave(impactAt, fxColor, spec.power);
    burst(impactAt, fxColor, Math.round(8 + spec.power * 26), 2 + spec.power * 5);
    B.vel = -B.facing * (1.5 + spec.power * 4.5);
    B.body.rotation.x = 0.35 + spec.power * 0.5;
    if (!REDUCED) shake = 0.12 + spec.power * 0.5;
    hooks.onImpact?.();

    await tween(420, (k) => {
      const e = easeOut(k);
      A.armL.rotation.x = lerp(-1.5, -0.35, e);
      A.armR.rotation.x = lerp(-1.5, -0.35, e);
      A.root.position.x = lerp(A.root.position.x, A.baseX, 0.2);
    });
    A.armsBusy = false;
  };

  api.knockout = async function knockout(side) {
    const f = fighters[side];
    f.ko = true;
    sfx.bell();
    burst(chestOf(f), 0xcfc3ab, 12, 3);
    await tween(500, (k) => {
      const e = easeOut(k);
      f.body.rotation.x = e * 1.35;
      f.root.position.y = -e * 0.55;
    });
  };

  api.celebrate = async function celebrate(side) {
    const f = fighters[side];
    if (f.ko) return;
    for (let i = 0; i < 3; i++) {
      await tween(220, (k) => {
        f.root.position.y = Math.sin(k * Math.PI) * 0.5;
      });
    }
    f.root.position.y = 0;
  };

  api.resetStance = function resetStance() {
    skipAll = false;
    for (const f of fighters) {
      f.ko = false;
      f.vel = 0;
      f.root.position.set(f.baseX, 0, 0);
      f.body.rotation.set(0, 0, 0);
      f.armL.rotation.x = -0.35;
      f.armR.rotation.x = -0.35;
      f.armsBusy = false;
    }
  };

  api.refresh = resize;

  api.dispose = function dispose() {
    running = false;
    window.removeEventListener("resize", resize);
    renderer.dispose();
  };

  // Warm up sizes once the canvas is laid out.
  requestAnimationFrame(resize);
  return api;
}
