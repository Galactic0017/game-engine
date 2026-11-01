/* ModLoader — JSON mod schemas for Cosmos BTD (Batch 7, Pillar 5).
 *
 * A mod is plain JSON, version 1:
 *   { "mod": { "name": "...", "version": "1.0" },
 *     "towers": [ { id, name, cost, range, rate, dmg, color, splash?, camo?, desc? } ],
 *     "enemies": [ { name, layers, speed, reward, color, camo?, armored?, fortified?, regen?, splits? } ],
 *     "waves": [ { "wave": 3, "composition": [0, 1, 0, 2] } ] }
 * Composition entries are BALLOON_TYPES indices (0 = Red, 1 = Blue,
 * ...); indices returned by registerCustomEnemy come after the
 * built-ins, so a mod that adds an enemy then references it in a wave
 * must list "enemies" before "waves" — apply() does towers, then
 * enemies, then waves, in that order.
 *
 * Validation never throws and never touches the DOM. Applying needs a
 * live BTD handle (its registerCustom* methods); mods are stored in
 * localStorage by the shell only — this module only parses/validates/
 * applies. No code execution: JSON only, no eval/Function.
 */
(function (global) {
  'use strict';

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }

  function validateTower(t, i, seen) {
    var errs = [], p = 'towers[' + i + ']';
    if (!t || typeof t !== 'object') return [p + ' must be an object'];
    if (typeof t.id !== 'string' || !/^[a-z0-9-]{2,20}$/.test(t.id)) errs.push(p + '.id must be 2-20 lowercase letters/digits/hyphens');
    else if (seen[t.id]) errs.push(p + '.id duplicates ' + t.id);
    else seen[t.id] = true;
    if (typeof t.name !== 'string' || !t.name.trim()) errs.push(p + '.name is required');
    if (!isNum(t.cost) || t.cost < 10 || t.cost > 2000) errs.push(p + '.cost must be 10-2000');
    if (!isNum(t.range) || t.range < 40 || t.range > 400) errs.push(p + '.range must be 40-400');
    if (!isNum(t.rate) || t.rate < 0.2 || t.rate > 4) errs.push(p + '.rate must be 0.2-4');
    if (!isNum(t.dmg) || t.dmg < 0 || t.dmg > 20) errs.push(p + '.dmg must be 0-20');
    if (!isHex(t.color)) errs.push(p + '.color must be #rrggbb');
    return errs;
  }
  function validateEnemy(e, i) {
    var errs = [], p = 'enemies[' + i + ']';
    if (!e || typeof e !== 'object') return [p + ' must be an object'];
    if (typeof e.name !== 'string' || !e.name.trim()) errs.push(p + '.name is required');
    if (!isNum(e.layers) || e.layers < 1 || e.layers > 20) errs.push(p + '.layers must be 1-20');
    if (!isNum(e.speed) || e.speed < 20 || e.speed > 200) errs.push(p + '.speed must be 20-200');
    if (!isNum(e.reward) || e.reward < 1 || e.reward > 100) errs.push(p + '.reward must be 1-100');
    if (!isHex(e.color)) errs.push(p + '.color must be #rrggbb');
    return errs;
  }
  function validate(mod) {
    var errors = [];
    if (!mod || typeof mod !== 'object' || Array.isArray(mod)) return { ok: false, errors: ['mod must be a JSON object'] };
    if (mod.version != null && mod.version !== 1) errors.push('version must be 1');
    var seen = {};
    (mod.towers || []).forEach(function (t, i) { errors = errors.concat(validateTower(t, i, seen)); });
    (mod.enemies || []).forEach(function (e, i) { errors = errors.concat(validateEnemy(e, i)); });
    var enemyCount = 10 + (mod.enemies || []).length; // 10 built-in balloon types
    (mod.waves || []).forEach(function (w, i) {
      var p = 'waves[' + i + ']';
      if (!w || typeof w !== 'object') { errors.push(p + ' must be an object'); return; }
      if (!isNum(w.wave) || w.wave < 1 || w.wave > 200 || Math.floor(w.wave) !== w.wave) errors.push(p + '.wave must be an integer 1-200');
      if (!Array.isArray(w.composition) || !w.composition.length || w.composition.length > 200) errors.push(p + '.composition must be 1-200 type indices');
      else w.composition.forEach(function (c, j) {
        if (!isNum(c) || c < -1 || c >= enemyCount || Math.floor(c) !== c) errors.push(p + '.composition[' + j + '] is not a valid enemy type index');
      });
    });
    if (!mod.towers && !mod.enemies && !mod.waves) errors.push('mod adds nothing: needs towers, enemies, or waves');
    return { ok: errors.length === 0, errors: errors };
  }
  function parse(text) {
    try {
      var mod = JSON.parse(String(text));
      var v = validate(mod);
      return { ok: v.ok, mod: mod, errors: v.errors };
    } catch (e) {
      return { ok: false, mod: null, errors: ['invalid JSON: ' + e.message] };
    }
  }
  function example() {
    return {
      mod: { name: 'Example mod', version: '1.0' },
      towers: [{ id: 'pulse', name: 'Pulse Tower', cost: 180, range: 120, rate: 0.7, dmg: 2, color: '#00f6ff', desc: 'Example custom tower.' }],
      enemies: [{ name: 'Violet', layers: 4, speed: 95, reward: 12, color: '#c792ea' }],
      waves: [{ wave: 3, composition: [0, 0, 10, 1, 10] }]
    };
  }
  /* Apply a validated mod to a live BTD handle. Returns per-kind
   * results; a tower/enemy the game rejects (e.g. id already taken)
   * is reported as skipped, it does not abort the rest. */
  function applyToGame(handle, mod) {
    var v = validate(mod);
    if (!v.ok) return { ok: false, errors: v.errors, applied: null };
    if (!handle || typeof handle.registerCustomTower !== 'function') return { ok: false, errors: ['no live Cosmos BTD handle — load Cosmos BTD first'], applied: null };
    var applied = { towers: [], enemies: [], waves: [], skipped: [] };
    (mod.towers || []).forEach(function (t) {
      var r = handle.registerCustomTower(t);
      if (r && r.ok) applied.towers.push(r.id); else applied.skipped.push({ kind: 'tower', id: t.id, errors: (r && r.errors) || ['rejected'] });
    });
    (mod.enemies || []).forEach(function (e) {
      var r = handle.registerCustomEnemy(e);
      if (r && r.ok) applied.enemies.push({ index: r.index, name: r.name }); else applied.skipped.push({ kind: 'enemy', id: e.name, errors: (r && r.errors) || ['rejected'] });
    });
    (mod.waves || []).forEach(function (w) {
      var r = handle.registerCustomWave(w.wave, w.composition);
      if (r && r.ok) applied.waves.push(r.wave); else applied.skipped.push({ kind: 'wave', id: String(w.wave), errors: (r && r.errors) || ['rejected'] });
    });
    return { ok: true, errors: [], applied: applied };
  }

  global.ModLoader = { validate: validate, parse: parse, example: example, applyToGame: applyToGame };
})(typeof window !== 'undefined' ? window : globalThis);
