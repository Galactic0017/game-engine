/* Cosmos BTD — real-3D renderer (Stage 1 foundation).
 * Classic script, no modules, no bundler. Requires window.THREE (the
 * vendored UMD build at /engine/vendor/three.min.js, r147) and WebGL.
 * The 2D Canvas game in btd.js stays the fallback: when THREE is
 * missing or WebGL is unavailable, isAvailable() is false and
 * createRenderer() throws a clear Error so the caller keeps 2D.
 *
 * Board mapping: 2D board coords (960x600, y down) map to 3D as
 * X = x - 480, Z = y - 300, Y up. The camera sits south of the board
 * looking north-down, matching the 2D top-down-ish view. All art is
 * procedural primitives — no copied assets. Lane geometry comes only
 * from the caller-injected opts.sampleLane(d) sampler (the exact
 * Catmull-Rom lane from btd.js); this module invents no path.
 */
(function (global) {
  'use strict';

  var W = 960, H = 600;
  var ORB_X = 918, ORB_Y = 420;

  /* Jungle prop layout, copied from the 2D painter's fixed positions
   * in btd.js (paintJungleBackground) so the 3D scene matches the 2D
   * map exactly: same trees, ponds, cliffs, bushes, rocks. */
  var JUNGLE_TREES = [[76, 306], [392, 108], [640, 528], [884, 84], [306, 548], [700, 540], [472, 566], [908, 540], [52, 214], [560, 72]];
  var JUNGLE_PONDS = [[790, 55, 55, 30], [100, 530, 45, 26], [770, 550, 35, 24]];
  var JUNGLE_CLIFFS_TOP = [80, 200, 320, 440, 560, 680, 800, 920];
  var JUNGLE_CLIFFS_LEFT = [60, 250, 340, 430, 520];
  var JUNGLE_BUSHES = [[40, 40], [180, 24], [340, 36], [520, 26], [700, 38], [860, 30], [930, 90], [24, 200], [30, 420], [40, 560], [920, 180], [935, 540], [240, 575], [480, 580], [660, 575], [800, 570]];
  var JUNGLE_ROCKS = [[250, 540], [640, 84], [830, 540], [430, 520], [180, 556]];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function hash2(x, z) {
    var s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return s - Math.floor(s);
  }
  /* Deterministic ground bump, shared by the ground mesh and props so
   * trees/rocks sit on the terrain instead of floating or sinking. */
  function groundBump(x, z) { return hash2(x * 0.11, z * 0.11) * 0.5; }

  function webglSupported() {
    try {
      if (typeof document === 'undefined') return false;
      var c = document.createElement('canvas');
      if (!c || typeof c.getContext !== 'function') return false;
      return !!(c.getContext('webgl') || c.getContext('experimental-webgl'));
    } catch (e) { return false; }
  }

  function isAvailable() {
    try {
      return !!(global.THREE && webglSupported());
    } catch (e) { return false; }
  }

  /* ---- path ribbon: triangle strip along the injected lane sampler ---- */
  function buildPathRibbon(sampleLane, laneLength, opts) {
    opts = opts || {};
    var width = opts.width || 46;
    var step = opts.step || 24;
    var y = (opts.y != null ? opts.y : 0.8);
    var pts = [];
    var d;
    for (d = 0; d < laneLength; d += step) pts.push(sampleLane(Math.min(d, laneLength)));
    var last = sampleLane(laneLength);
    if (!pts.length || pts[pts.length - 1][0] !== last[0] || pts[pts.length - 1][1] !== last[1]) pts.push(last);
    var n = pts.length;
    var pos = new Float32Array(n * 2 * 3);
    var uv = new Float32Array(n * 2 * 2);
    var idx = [];
    var i, p, q, tx, tz, tl, nx, nz, cum = 0;
    for (i = 0; i < n; i++) {
      p = pts[i];
      q = pts[Math.min(n - 1, i + 1)];
      var pPrev = pts[Math.max(0, i - 1)];
      tx = q[0] - pPrev[0]; tz = q[1] - pPrev[1];
      tl = Math.sqrt(tx * tx + tz * tz) || 1; tx /= tl; tz /= tl;
      nx = -tz; nz = tx;
      if (i > 0) cum += Math.sqrt(Math.pow(p[0] - pts[i - 1][0], 2) + Math.pow(p[1] - pts[i - 1][1], 2));
      var hw = width / 2;
      var lx = p[0] - W / 2 + nx * hw, lz = p[1] - H / 2 + nz * hw;
      var rx = p[0] - W / 2 - nx * hw, rz = p[1] - H / 2 - nz * hw;
      pos[(i * 2) * 3] = lx; pos[(i * 2) * 3 + 1] = y; pos[(i * 2) * 3 + 2] = lz;
      pos[(i * 2 + 1) * 3] = rx; pos[(i * 2 + 1) * 3 + 1] = y; pos[(i * 2 + 1) * 3 + 2] = rz;
      uv[(i * 2) * 2] = cum / 48; uv[(i * 2) * 2 + 1] = 0;
      uv[(i * 2 + 1) * 2] = cum / 48; uv[(i * 2 + 1) * 2 + 1] = 1;
      if (i < n - 1) {
        var a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    var geo = new global.THREE.BufferGeometry();
    geo.setAttribute('position', new global.THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new global.THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /* ---- shared geometry / material caches (no per-frame allocation) ---- */
  function makeCaches(THREE) {
    var geos = {};
    var mats = {};
    function geo(key, make) {
      if (!geos[key]) geos[key] = make();
      return geos[key];
    }
    function mat(key, make) {
      if (!mats[key]) mats[key] = make();
      return mats[key];
    }
    return {
      geo: geo, mat: mat,
      dispose: function () {
        var k;
        for (k in geos) { try { geos[k].dispose(); } catch (e) {} }
        for (k in mats) { try { mats[k].dispose(); } catch (e) {} }
      }
    };
  }

  function stdMat(THREE, caches, color, extra) {
    var key = 'std:' + color + ':' + JSON.stringify(extra || {});
    return caches.mat(key, function () {
      var p = { color: color, roughness: 0.85, metalness: 0.05 };
      if (extra) for (var k in extra) p[k] = extra[k];
      return new THREE.MeshStandardMaterial(p);
    });
  }
  function phongMat(THREE, caches, color, extra) {
    var key = 'ph:' + color + ':' + JSON.stringify(extra || {});
    return caches.mat(key, function () {
      var p = { color: color, shininess: 80, specular: 0xffffff };
      if (extra) for (var k in extra) p[k] = extra[k];
      return new THREE.MeshPhongMaterial(p);
    });
  }

  /* ---- tower assemblies: kind-specific primitives + stone pedestal ---- */
  function createTowerMesh(THREE, caches, kind, color) {
    var g = new THREE.Group();
    var pedGeo = caches.geo('pedestal', function () { return new THREE.CylinderGeometry(20, 23, 4, 20); });
    var ped = new THREE.Mesh(pedGeo, stdMat(THREE, caches, '#8a8578', { roughness: 1 }));
    ped.position.y = 2; ped.receiveShadow = true; g.add(ped);
    /* Soft contact disc: grounds the tower with a visible contact
     * shadow even where the shadow map is soft. */
    var disc = new THREE.Mesh(caches.geo('circle', function () { return new THREE.CircleGeometry(1, 28); }),
      caches.mat('contactDisc', function () { return new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }); }));
    disc.rotation.x = -Math.PI / 2;
    disc.scale.set(24, 24, 24);
    disc.position.y = 0.6;
    g.add(disc);
    var body = stdMat(THREE, caches, color || '#888888', { roughness: 0.6, metalness: 0.25 });
    var dark = stdMat(THREE, caches, '#2b3240', { roughness: 0.7, metalness: 0.3 });
    function box(w, h, d, m, x, y, z) {
      var mesh = new THREE.Mesh(caches.geo('box:' + w + ':' + h + ':' + d, function () { return new THREE.BoxGeometry(w, h, d); }), m);
      mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh;
    }
    function cyl(rt, rb, h, m, x, y, z, seg) {
      var mesh = new THREE.Mesh(caches.geo('cyl:' + rt + ':' + rb + ':' + h, function () { return new THREE.CylinderGeometry(rt, rb, h, seg || 14); }), m);
      mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh;
    }
    if (kind === 'dart') {
      box(12, 14, 12, body, 0, 11, 0);
      var arm = box(4, 4, 26, dark, 0, 20, 8); arm.rotation.x = -0.35;
      box(16, 3, 4, dark, 0, 24, -2);
    } else if (kind === 'cannon') {
      cyl(13, 15, 10, dark, 0, 9, 0);
      var barrel = cyl(6, 7, 30, body, 0, 18, 10, 12); barrel.rotation.x = Math.PI / 2 - 0.25;
    } else if (kind === 'mortar') {
      cyl(16, 18, 9, dark, 0, 8, 0);
      var tube = cyl(10, 12, 20, body, 0, 20, 4, 14); tube.rotation.x = Math.PI / 2 - 0.5;
    } else if (kind === 'frost') {
      cyl(10, 12, 6, dark, 0, 7, 0);
      var cry = new THREE.Mesh(caches.geo('octa', function () { return new THREE.OctahedronGeometry(11, 0); }),
        stdMat(THREE, caches, color || '#7bdff2', { roughness: 0.15, metalness: 0.1, emissive: 0x1d4ed8, emissiveIntensity: 0.55 }));
      cry.position.y = 22; cry.castShadow = true; g.add(cry);
    } else if (kind === 'sniper') {
      box(10, 10, 10, dark, 0, 9, 0);
      var scope = box(4, 4, 40, body, 0, 20, 10); scope.rotation.x = -0.08;
      box(3, 6, 6, dark, 0, 24, -4);
    } else if (kind === 'tesla') {
      cyl(9, 11, 16, dark, 0, 12, 0);
      var orb = new THREE.Mesh(caches.geo('sphere', function () { return new THREE.SphereGeometry(1, 20, 14); }),
        stdMat(THREE, caches, color || '#facc15', { roughness: 0.3, emissive: 0x8a6d00, emissiveIntensity: 0.6 }));
      orb.scale.set(9, 9, 9); orb.position.y = 27; orb.castShadow = true; g.add(orb);
      var spikeGeo = caches.geo('cone', function () { return new THREE.ConeGeometry(2.5, 8, 6); });
      for (var s = 0; s < 4; s++) {
        var sp = new THREE.Mesh(spikeGeo, dark);
        var a = s * Math.PI / 2;
        sp.position.set(Math.cos(a) * 9, 27, Math.sin(a) * 9);
        sp.rotation.z = -Math.cos(a) * 1.2; sp.rotation.x = Math.sin(a) * 1.2;
        g.add(sp);
      }
    } else if (kind === 'spikes') {
      var pyr = new THREE.Mesh(caches.geo('pyr', function () { return new THREE.ConeGeometry(15, 16, 4); }), body);
      pyr.position.y = 12; pyr.rotation.y = Math.PI / 4; pyr.castShadow = true; g.add(pyr);
      var tip = new THREE.Mesh(caches.geo('coneSm', function () { return new THREE.ConeGeometry(4, 8, 6); }), dark);
      tip.position.y = 23; g.add(tip);
    } else if (kind === 'beacon') {
      cyl(7, 9, 30, dark, 0, 19, 0);
      var tipB = new THREE.Mesh(caches.geo('sphere', function () { return new THREE.SphereGeometry(1, 20, 14); }),
        stdMat(THREE, caches, color || '#22d3ee', { roughness: 0.3, emissive: 0x22d3ee, emissiveIntensity: 0.9 }));
      tipB.scale.set(7, 7, 7); tipB.position.y = 38; g.add(tipB);
    } else {
      box(14, 16, 14, body, 0, 12, 0);
    }
    g.userData.kind = kind;
    return g;
  }

  /* ---- balloon mesh: glossy sphere + highlight dot (+ boss ring) ---- */
  function createBalloonMesh(THREE, caches, color, boss) {
    var g = new THREE.Group();
    var sphere = new THREE.Mesh(caches.geo('sphere', function () { return new THREE.SphereGeometry(1, 20, 14); }),
      phongMat(THREE, caches, color));
    sphere.castShadow = true;
    g.add(sphere);
    var hi = new THREE.Mesh(caches.geo('sphereSm', function () { return new THREE.SphereGeometry(1, 10, 8); }),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }));
    hi.scale.set(0.28, 0.28, 0.28);
    hi.position.set(-0.35, 0.42, 0.55);
    g.add(hi);
    if (boss) {
      var ring = new THREE.Mesh(caches.geo('torusBoss', function () { return new THREE.TorusGeometry(1.08, 0.1, 8, 32); }),
        stdMat(THREE, caches, '#c62828', { roughness: 0.6 }));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    g.userData.sphere = sphere;
    g.userData.highlight = hi;
    g.userData.boss = !!boss;
    return g;
  }

  /* ---- static scene: ground + ribbon + props, rebuilt per map skin ---- */
  function buildStatics(THREE, caches, opts, skin) {
    var group = new THREE.Group();
    var jungle = skin !== 'space';
    // Ground plane with per-vertex color variation.
    var gg = new THREE.PlaneGeometry(W, H, 48, 30);
    gg.rotateX(-Math.PI / 2);
    var posAttr = gg.attributes.position;
    var colors = new Float32Array(posAttr.count * 3);
    var base = new THREE.Color(jungle ? 0x4f9338 : 0x141a2e);
    var c = new THREE.Color();
    for (var vi = 0; vi < posAttr.count; vi++) {
      var vx = posAttr.getX(vi), vz = posAttr.getZ(vi);
      posAttr.setY(vi, groundBump(vx, vz));
      c.copy(base).offsetHSL(0, 0, (hash2(vx * 0.37, vz * 0.37) - 0.5) * 0.12);
      colors[vi * 3] = c.r; colors[vi * 3 + 1] = c.g; colors[vi * 3 + 2] = c.b;
    }
    gg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    gg.computeVertexNormals();
    var ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    ground.receiveShadow = true;
    group.add(ground);
    // Path ribbon from the exact injected lane sampler.
    if (opts && typeof opts.sampleLane === 'function' && opts.laneLength > 0) {
      var underGeo = buildPathRibbon(opts.sampleLane, opts.laneLength, { width: 58, step: 24, y: 0.55 });
      var under = new THREE.Mesh(underGeo, stdMat(THREE, caches, jungle ? '#6b5b3e' : '#0e2a3e', { roughness: 1 }));
      under.receiveShadow = true;
      group.add(under);
      var ribbonGeo = buildPathRibbon(opts.sampleLane, opts.laneLength, { width: 46, step: 24, y: 0.8 });
      var ribbonMat = jungle
        ? stdMat(THREE, caches, '#cfc3a4', { roughness: 1 })
        : stdMat(THREE, caches, '#123f57', { roughness: 0.6, emissive: 0x00f6ff, emissiveIntensity: 0.55 });
      var ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
      ribbon.receiveShadow = true;
      group.add(ribbon);
    }
    function place(x, z, mesh) {
      mesh.position.set(x - W / 2, groundBump(x - W / 2, z - H / 2), z - H / 2);
      group.add(mesh);
    }
    function tree(x, z, s) {
      var tg = new THREE.Group();
      var trunk = new THREE.Mesh(caches.geo('trunk', function () { return new THREE.CylinderGeometry(3, 4, 16, 8); }),
        stdMat(THREE, caches, '#7a5230', { roughness: 1 }));
      trunk.position.y = 8; trunk.castShadow = true; tg.add(trunk);
      var leafMat = jungle
        ? stdMat(THREE, caches, '#2f7a2e', { roughness: 0.9 })
        : stdMat(THREE, caches, '#7b2fbf', { roughness: 0.6, emissive: 0x3b0f6e, emissiveIntensity: 0.5 });
      var leafMat2 = jungle
        ? stdMat(THREE, caches, '#57b04a', { roughness: 0.9 })
        : stdMat(THREE, caches, '#22d3ee', { roughness: 0.6, emissive: 0x0e7490, emissiveIntensity: 0.5 });
      var c1 = new THREE.Mesh(caches.geo('icosa', function () { return new THREE.IcosahedronGeometry(16, 0); }), leafMat);
      c1.position.y = 26; c1.scale.y = 0.85; c1.castShadow = true; tg.add(c1);
      var c2 = new THREE.Mesh(caches.geo('icosa', function () { return new THREE.IcosahedronGeometry(11, 0); }), leafMat2);
      c2.position.set(-4, 36, -2); c2.castShadow = true; tg.add(c2);
      tg.scale.setScalar(s || 1);
      tg.userData.sway = true;
      return tg;
    }
    function rock(x, z, r) {
      var m = new THREE.Mesh(caches.geo('dodec', function () { return new THREE.DodecahedronGeometry(1, 0); }),
        stdMat(THREE, caches, jungle ? '#8a8578' : '#3a4152', { roughness: 1 }));
      m.scale.set(r, r * 0.7, r);
      m.rotation.y = hash2(x, z) * Math.PI;
      m.position.y = r * 0.3; m.castShadow = true; m.receiveShadow = true;
      var wrap = new THREE.Group(); wrap.add(m);
      place(x, z, wrap);
      return wrap;
    }
    function pond(x, z, rx, rz) {
      var m = new THREE.Mesh(caches.geo('circle', function () { return new THREE.CircleGeometry(1, 28); }),
        stdMat(THREE, caches, jungle ? '#4a9ec2' : '#00f6ff', { roughness: 0.15, metalness: 0.1, emissive: jungle ? 0x0b3550 : 0x00f6ff, emissiveIntensity: jungle ? 0.25 : 0.7 }));
      m.rotation.x = -Math.PI / 2;
      m.scale.set(rx, rz, 1);
      m.position.y = 0.9;
      var wrap = new THREE.Group(); wrap.add(m);
      place(x, z, wrap);
      return wrap;
    }
    function bush(x, z, r) {
      var m = new THREE.Mesh(caches.geo('icosa', function () { return new THREE.IcosahedronGeometry(1, 0); }),
        stdMat(THREE, caches, jungle ? '#3f9a3a' : '#155e75', { roughness: 0.9 }));
      m.scale.set(r, r * 0.7, r);
      m.position.y = r * 0.45; m.castShadow = true;
      var wrap = new THREE.Group(); wrap.add(m);
      place(x, z, wrap);
      return wrap;
    }
    var i;
    for (i = 0; i < JUNGLE_TREES.length; i++) place(JUNGLE_TREES[i][0], JUNGLE_TREES[i][1], tree(JUNGLE_TREES[i][0], JUNGLE_TREES[i][1], 0.9 + hash2(i, 7) * 0.35));
    for (i = 0; i < JUNGLE_PONDS.length; i++) pond(JUNGLE_PONDS[i][0], JUNGLE_PONDS[i][1], JUNGLE_PONDS[i][2], JUNGLE_PONDS[i][3]);
    for (i = 0; i < JUNGLE_CLIFFS_TOP.length; i++) rock(JUNGLE_CLIFFS_TOP[i], 14, 20 + hash2(i, 3) * 10);
    for (i = 0; i < JUNGLE_CLIFFS_LEFT.length; i++) rock(14, JUNGLE_CLIFFS_LEFT[i], 18 + hash2(i, 11) * 8);
    for (i = 0; i < JUNGLE_BUSHES.length; i++) bush(JUNGLE_BUSHES[i][0], JUNGLE_BUSHES[i][1], 13 + hash2(i, 5) * 7);
    for (i = 0; i < JUNGLE_ROCKS.length; i++) rock(JUNGLE_ROCKS[i][0], JUNGLE_ROCKS[i][1], 12 + hash2(i, 9) * 6);
    return group;
  }

  /* ---- ATOM orb ---- */
  function buildOrb(THREE, caches) {
    var g = new THREE.Group();
    var ped = new THREE.Mesh(caches.geo('pedCyl', function () { return new THREE.CylinderGeometry(30, 34, 8, 24); }),
      stdMat(THREE, caches, '#0b1124', { roughness: 0.5, metalness: 0.4 }));
    ped.position.y = 4; ped.receiveShadow = true; g.add(ped);
    var trim = new THREE.Mesh(caches.geo('torusTrim', function () { return new THREE.TorusGeometry(30, 1.6, 8, 40); }),
      stdMat(THREE, caches, '#00f6ff', { roughness: 0.4, emissive: 0x00f6ff, emissiveIntensity: 0.8 }));
    trim.rotation.x = Math.PI / 2; trim.position.y = 8; g.add(trim);
    var core = new THREE.Mesh(caches.geo('sphere', function () { return new THREE.SphereGeometry(1, 28, 20); }),
      stdMat(THREE, caches, '#7bdff2', { roughness: 0.2, metalness: 0.6, emissive: 0x00f6ff, emissiveIntensity: 1.25 }));
    core.scale.set(22, 22, 22); core.position.y = 30; core.castShadow = true; g.add(core);
    var pivots = [];
    var ringDefs = [{ r: 34, tilt: 0.5, speed: 0.7 }, { r: 28, tilt: -0.5, speed: -0.9 }, { r: 40, tilt: 1.1, speed: 0.5 }];
    for (var i = 0; i < ringDefs.length; i++) {
      (function (rd, idx) {
        var pivot = new THREE.Group();
        pivot.position.y = 30;
        pivot.rotation.x = rd.tilt;
        var ring = new THREE.Mesh(caches.geo('torusOrb', function () { return new THREE.TorusGeometry(1, 0.035, 8, 48); }),
          new THREE.MeshBasicMaterial({ color: idx === 1 ? 0xa78bfa : 0x00f6ff, transparent: true, opacity: 0.8 }));
        ring.scale.set(rd.r, rd.r, rd.r);
        ring.rotation.x = Math.PI / 2;
        pivot.add(ring);
        var electron = new THREE.Mesh(caches.geo('sphereSm', function () { return new THREE.SphereGeometry(1, 10, 8); }),
          new THREE.MeshBasicMaterial({ color: 0xffffff }));
        electron.scale.set(3, 3, 3);
        electron.position.set(rd.r, 0, 0);
        pivot.add(electron);
        pivot.userData.speed = rd.speed;
        pivot.userData.phase = idx * 2.1;
        pivots.push(pivot);
        g.add(pivot);
      })(ringDefs[i], i);
    }
    var light = new THREE.PointLight(0x00f6ff, 1.4, 340, 2);
    light.position.set(0, 46, 0);
    g.add(light);
    // Shield ring on the ground: theta length tracks shield fraction.
    var shield = new THREE.Mesh(
      new THREE.RingGeometry(32, 38, 48, 1, -Math.PI / 2, Math.PI * 2),
      new THREE.MeshBasicMaterial({ color: 0x00f6ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    shield.rotation.x = -Math.PI / 2;
    shield.position.y = 1.2;
    g.add(shield);
    g.userData.core = core;
    g.userData.pivots = pivots;
    g.userData.light = light;
    g.userData.shield = shield;
    g.userData.shieldQuant = -1;
    g.position.set(ORB_X - W / 2, 0, ORB_Y - H / 2);
    return g;
  }

  function updateShieldRing(THREE, orb, frac, time) {
    var q = Math.round(clamp(frac, 0, 1) * 20);
    if (q !== orb.userData.shieldQuant) {
      orb.userData.shieldQuant = q;
      var old = orb.userData.shield.geometry;
      orb.userData.shield.geometry = new THREE.RingGeometry(32, 38, 48, 1, -Math.PI / 2, (Math.PI * 2 * q) / 20);
      try { old.dispose(); } catch (e) {}
    }
    orb.userData.shield.material.color.setHex(frac > 0.25 ? 0x00f6ff : 0xff5a5a);
    var s = 1 + 0.03 * Math.sin(time * 2.4);
    orb.userData.shield.scale.set(s, s, s);
  }

  function createRenderer(container, opts) {
    opts = opts || {};
    var THREE = global.THREE;
    if (!THREE) throw new Error('Three.js (THREE) is not loaded — 3D unavailable, use the 2D game.');
    if (!webglSupported()) throw new Error('WebGL is not supported in this browser — 3D unavailable, use the 2D game.');
    if (!container || typeof container.appendChild !== 'function') throw new Error('3D renderer needs a container element.');
    var caches = makeCaches(THREE);

    var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    var dom = renderer.domElement;
    var anchor = null;
    try { anchor = container.querySelector ? container.querySelector('canvas') : null; } catch (e) { anchor = null; }
    if (anchor === dom) anchor = null;
    dom.style.display = 'block';
    /* Overlay the 2D canvas exactly (same box): absolute positioning so
     * the WebGL view covers the 2D frame instead of stacking below it.
     * The exact box comes from the 2D canvas (anchorBox/syncDomBox),
     * never from width:100% with an unset height — that made the
     * canvas buffer-height tall and clipped the scene. Input keeps
     * working because clicks land on this canvas and the wiring
     * forwards them to the 2D handlers. */
    dom.style.position = 'absolute';
    dom.style.top = '0px';
    dom.style.left = '0px';
    if (!container.style.position) container.style.position = 'relative';
    container.appendChild(dom);

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f22);
    scene.fog = new THREE.Fog(0x0a0f22, 1100, 1900);

    var camera = new THREE.PerspectiveCamera(40, W / H, 10, 3000);
    camera.position.set(0, 700, 580);
    camera.lookAt(0, 0, 0);

    /* Strong directional key light + hemisphere fill + a soft ambient
     * lift, so forms read as 3D instead of flat. */
    var hemi = new THREE.HemisphereLight(0xbfe3ff, 0x2a4a22, 0.6);
    scene.add(hemi);
    var fill = new THREE.AmbientLight(0x334455, 0.35);
    scene.add(fill);
    var sun = new THREE.DirectionalLight(0xfff2cc, 1.35);
    sun.position.set(300, 500, 200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -540; sun.shadow.camera.right = 540;
    sun.shadow.camera.top = 380; sun.shadow.camera.bottom = -380;
    sun.shadow.camera.near = 50; sun.shadow.camera.far = 1400;
    sun.shadow.bias = -0.0005;
    scene.add(sun);
    scene.add(sun.target);

    var skin = opts.mapSkin || 'jungle';
    var statics = buildStatics(THREE, caches, opts, skin);
    scene.add(statics);
    var orb = buildOrb(THREE, caches);
    scene.add(orb);

    // Selection ring + placement ghost (persistent meshes, no reallocation).
    var selRing = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0x00f6ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    selRing.rotation.x = -Math.PI / 2;
    selRing.position.y = 1.4;
    selRing.visible = false;
    scene.add(selRing);
    var ghostGroup = new THREE.Group();
    var ghostDisc = new THREE.Mesh(caches.geo('circle', function () { return new THREE.CircleGeometry(1, 28); }),
      new THREE.MeshBasicMaterial({ color: 0x3ddc5f, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    ghostDisc.rotation.x = -Math.PI / 2;
    ghostGroup.add(ghostDisc);
    var ghostRing = new THREE.Mesh(caches.geo('torusGhost', function () { return new THREE.TorusGeometry(1, 0.03, 8, 40); }),
      new THREE.MeshBasicMaterial({ color: 0x3ddc5f, transparent: true, opacity: 0.85 }));
    ghostRing.rotation.x = Math.PI / 2;
    ghostGroup.add(ghostRing);
    ghostGroup.visible = false;
    scene.add(ghostGroup);

    // Hero marker (Stage 1: simple gold octahedron).
    var heroMesh = new THREE.Mesh(caches.geo('octa', function () { return new THREE.OctahedronGeometry(1, 0); }),
      stdMat(THREE, caches, '#ffd166', { roughness: 0.35 }));
    heroMesh.visible = false;
    scene.add(heroMesh);

    // Particles as one THREE.Points cloud, preallocated.
    var PMAX = 800;
    var pPos = new Float32Array(PMAX * 3);
    var pCol = new Float32Array(PMAX * 3);
    var pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    var points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 7, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true }));
    points.frustumCulled = false;
    scene.add(points);

    // Pooled balloons + towers (free lists, no per-frame allocation).
    var balloonSlots = [];
    var towerSlots = [];
    var _c = new THREE.Color();
    var swayGroups = [];
    statics.traverse(function (o) { if (o.userData && o.userData.sway) swayGroups.push(o); });

    function syncBalloons(list, time) {
      var i, b, slot;
      for (i = 0; i < list.length; i++) {
        b = list[i];
        slot = balloonSlots[i];
        var colorKey = b.color || '#ff5a5a';
        if (!slot) {
          slot = { group: null, colorKey: null, boss: null };
          balloonSlots.push(slot);
        }
        if (!slot.group || slot.colorKey !== colorKey || slot.boss !== !!b.boss) {
          if (slot.group) scene.remove(slot.group);
          slot.group = createBalloonMesh(THREE, caches, colorKey, !!b.boss);
          scene.add(slot.group);
          slot.colorKey = colorKey;
          slot.boss = !!b.boss;
        }
        var r = Math.max(6, b.r || 14);
        slot.group.position.set(b.x - W / 2, r * 0.95 + Math.sin(time * 3 + i * 1.7) * 2, b.y - H / 2);
        slot.group.userData.sphere.scale.set(r, r, r);
        slot.group.visible = true;
      }
      for (i = list.length; i < balloonSlots.length; i++) {
        if (balloonSlots[i].group) balloonSlots[i].group.visible = false;
      }
    }

    function syncTowers(list) {
      var i, t, slot;
      for (i = 0; i < list.length; i++) {
        t = list[i];
        slot = towerSlots[i];
        if (!slot) { slot = { group: null, kind: null }; towerSlots.push(slot); }
        if (!slot.group || slot.kind !== t.kind) {
          if (slot.group) scene.remove(slot.group);
          slot.group = createTowerMesh(THREE, caches, t.kind, null);
          scene.add(slot.group);
          slot.kind = t.kind;
        }
        slot.group.position.set(t.x - W / 2, 0, t.y - H / 2);
        slot.group.rotation.y = -(t.angle || 0);
        var s = 1 + ((t.level || 1) - 1) * 0.06;
        slot.group.scale.set(s, s, s);
        slot.group.visible = true;
      }
      for (i = list.length; i < towerSlots.length; i++) {
        if (towerSlots[i].group) towerSlots[i].group.visible = false;
      }
    }

    function syncParticles(list) {
      var n = Math.min(list.length, PMAX);
      for (var i = 0; i < n; i++) {
        var p = list[i];
        pPos[i * 3] = p.x - W / 2;
        pPos[i * 3 + 1] = 6 + (1 - clamp((p.life || 0) / Math.max(0.01, p.max || 0.7), 0, 1)) * 10;
        pPos[i * 3 + 2] = p.y - H / 2;
        _c.set(p.color || '#ffffff');
        var f = 0.2 + 0.8 * clamp((p.life || 0) / Math.max(0.01, p.max || 0.7), 0, 1);
        pCol[i * 3] = _c.r * f; pCol[i * 3 + 1] = _c.g * f; pCol[i * 3 + 2] = _c.b * f;
      }
      pGeo.setDrawRange(0, n);
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;
    }

    function anchorBox() {
      if (anchor && anchor.clientWidth > 0) {
        return { w: anchor.clientWidth, h: anchor.clientHeight > 0 ? anchor.clientHeight : Math.round(anchor.clientWidth * H / W), l: anchor.offsetLeft || 0, t: anchor.offsetTop || 0 };
      }
      var cw0 = container.clientWidth || W;
      return { w: cw0, h: Math.round(cw0 * H / W), l: 0, t: 0 };
    }
    function resize(w, h) {
      var box = anchorBox();
      var cw = w || box.w;
      var ch = h || box.h;
      dom.style.left = box.l + 'px';
      dom.style.top = box.t + 'px';
      dom.style.width = cw + 'px';
      dom.style.height = ch + 'px';
      renderer.setSize(cw, ch, false);
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
    }

    var onWinResize = function () { resize(); };
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', onWinResize);
    var ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      try {
        ro = new ResizeObserver(function () { resize(); });
        ro.observe(container);
      } catch (e) { ro = null; }
    }
    resize();

    var disposed = false;
    var quality = 'high';

    function render(snapshot, dt) {
      if (disposed) return;
      snapshot = snapshot || {};
      var time = snapshot.time || 0;
      var newSkin = snapshot.mapSkin || 'jungle';
      if (newSkin !== skin) {
        skin = newSkin;
        scene.remove(statics);
        statics = buildStatics(THREE, caches, opts, skin);
        scene.add(statics);
        swayGroups = [];
        statics.traverse(function (o) { if (o.userData && o.userData.sway) swayGroups.push(o); });
      }
      syncBalloons(snapshot.balloons || [], time);
      syncTowers(snapshot.towers || []);
      syncParticles(snapshot.particles || []);
      // Orb animation.
      var pivots = orb.userData.pivots;
      for (var pi = 0; pi < pivots.length; pi++) {
        pivots[pi].rotation.y = time * pivots[pi].userData.speed + pivots[pi].userData.phase;
      }
      orb.userData.core.scale.setScalar(22 * (1 + 0.04 * Math.sin(time * 2.4)));
      orb.userData.light.intensity = 1.3 + 0.3 * Math.sin(time * 2.4) + (snapshot.orbHit ? 0.8 : 0);
      updateShieldRing(THREE, orb, (snapshot.orbShield != null ? snapshot.orbShield : 1), time);
      // Tree sway (cheap: rotate a few groups).
      for (var si = 0; si < swayGroups.length; si++) {
        swayGroups[si].rotation.z = Math.sin(time * 1.1 + si) * 0.02;
      }
      // Selection ring.
      if (snapshot.selected) {
        selRing.visible = true;
        selRing.position.set(snapshot.selected.x - W / 2, 1.4, snapshot.selected.y - H / 2);
        var rr = Math.max(10, snapshot.selected.range || 100);
        selRing.scale.set(rr, rr, rr);
      } else selRing.visible = false;
      // Placement ghost.
      if (snapshot.placing && snapshot.ghost) {
        ghostGroup.visible = true;
        ghostGroup.position.set(snapshot.ghost.x - W / 2, 1.1, snapshot.ghost.y - H / 2);
        ghostDisc.scale.set(16, 16, 16);
        ghostRing.scale.set(Math.max(10, snapshot.ghost.range || 100), Math.max(10, snapshot.ghost.range || 100), Math.max(10, snapshot.ghost.range || 100));
        var gcol = snapshot.ghost.valid === false ? 0xff5a5a : 0x3ddc5f;
        ghostDisc.material.color.setHex(gcol);
        ghostRing.material.color.setHex(gcol);
      } else ghostGroup.visible = false;
      // Hero marker.
      if (snapshot.hero) {
        heroMesh.visible = true;
        var hs = 12 + ((snapshot.hero.level || 1) - 1) * 0.4;
        heroMesh.scale.set(hs, hs, hs);
        heroMesh.position.set(snapshot.hero.x - W / 2, 18, snapshot.hero.y - H / 2);
        heroMesh.rotation.y = time * 0.8;
        heroMesh.material.color.set(snapshot.hero.color || '#ffd166');
      } else heroMesh.visible = false;
      renderer.render(scene, camera);
    }

    function setQuality(q) {
      quality = q === 'low' ? 'low' : 'high';
      if (quality === 'low') {
        renderer.setPixelRatio(1);
        renderer.shadowMap.enabled = false;
      } else {
        renderer.setPixelRatio(Math.min(typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1, 1.5));
        renderer.shadowMap.enabled = true;
      }
      if (scene) scene.traverse(function (o) { if (o.material) o.material.needsUpdate = true; });
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', onWinResize);
      if (ro) { try { ro.disconnect(); } catch (e) {} }
      try { if (dom.parentNode) dom.parentNode.removeChild(dom); } catch (e) {}
      try { renderer.dispose(); } catch (e) {}
      caches.dispose();
    }

    return {
      render: render,
      resize: resize,
      dispose: dispose,
      setQuality: setQuality,
      canvas: dom,
      _internals: { scene: scene, camera: camera, statics: statics, orb: orb }
    };
  }

  global.CosmosBTD3D = {
    isAvailable: isAvailable,
    createRenderer: createRenderer,
    _internals: {
      buildPathRibbon: buildPathRibbon,
      createTowerMesh: createTowerMesh,
      createBalloonMesh: createBalloonMesh,
      JUNGLE_TREES: JUNGLE_TREES,
      JUNGLE_PONDS: JUNGLE_PONDS,
      JUNGLE_CLIFFS_TOP: JUNGLE_CLIFFS_TOP,
      JUNGLE_CLIFFS_LEFT: JUNGLE_CLIFFS_LEFT,
      JUNGLE_BUSHES: JUNGLE_BUSHES,
      JUNGLE_ROCKS: JUNGLE_ROCKS,
      BOARD_W: W,
      BOARD_H: H,
      ORB: { x: ORB_X, y: ORB_Y }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
