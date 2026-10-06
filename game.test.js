const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup(saved = {}) {
  const nodes = new Map();
  const labels = new Set();
  const dots = [];
  const context = new Proxy({}, { get: (_, key) => key === 'fillText' ? text => labels.add(text) : key === 'arc' ? (x, y, radius) => { if (radius === 2) dots.push({ x, y }); } : () => {}, set: () => true });
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { width: 502, height: 560, textContent: '', hidden: false, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 502, height: 560 }), getContext: () => context });
    return nodes.get(id);
  }
  let nextFrame, time = 0;
  const memory = { ...saved };
  const sandbox = { document: { querySelector: id => node(id.slice(1)), getElementById: node, addEventListener() {} }, localStorage: { getItem: key => memory[key], setItem: (key, value) => { memory[key] = value; } }, requestAnimationFrame: callback => { nextFrame = callback; }, Math: Object.create(Math) };
  sandbox.Math.random = () => .5;
  const gameContext = vm.createContext(sandbox);
  // 브라우저와 같은 순서로 설정을 먼저 읽고 게임을 시작합니다.
  for (const script of ['constants.js', 'index.js']) {
    vm.runInContext(fs.readFileSync(script, 'utf8'), gameContext, { filename: script });
  }
  return { node, memory, labels, dots, frames(n) { for (let i = 0; i < n; i++) nextFrame(time += 16); }, shoot(x = 251) { const event = { clientX: x, clientY: 40, isPrimary: true, button: 0, pointerId: 1 }; node('game').listeners.pointerdown(event); node('game').listeners.pointerup(event); } };
}

test('aim preview stops at first side wall contact without reflecting', () => {
  const game = setup();
  game.node('game').listeners.pointerdown({ clientX: 494, clientY: 480, isPrimary: true, button: 0, pointerId: 1 });
  game.frames(1);
  assert.ok(game.dots.length > 1);
  assert.ok(game.dots.slice(1).every((point, i) => point.x > game.dots[i].x));
  assert.equal(game.dots.at(-1).x, 497);
  assert.equal(game.node('score').textContent, 1);
  assert.equal(game.node('recall').disabled, true);
});

for (const [surface, x, minY] of [['ceiling', 251, 5], ['brick', 100, 75]]) {
  test(`aim preview stops at first ${surface} contact without changing the board`, () => {
    const game = setup();
    game.node('game').listeners.pointerdown({ clientX: x, clientY: 40, isPrimary: true, button: 0, pointerId: 1 });
    game.frames(1);
    assert.ok(game.dots.length > 1);
    assert.equal(game.dots.at(-1).y, minY);
    assert.ok(game.dots.slice(1).every((point, i) => point.y < game.dots[i].y));
    assert.ok(game.dots.every(point => point.y < 513));
    const firstPath = [...game.dots];
    game.dots.length = 0;
    game.frames(1);
    assert.deepEqual(game.dots, firstPath);
  });
}

test('volley returns, pickup is collected, and score advances', () => {
  const game = setup();
  assert.equal(game.node('score').textContent, 1);
  game.shoot();
  assert.equal(game.node('recall').disabled, false);
  game.frames(2000);
  assert.equal(game.node('score').textContent, 2);
  assert.equal(game.node('recall').disabled, true);
  assert.equal(game.node('overlay').hidden, true);
  assert.ok(game.labels.has('× 2'));
});

test('brick hits do not award bonus points and progress saves the best score', () => {
  const game = setup();
  game.shoot(100); game.frames(2000);
  assert.equal(game.node('score').textContent, 2);
  assert.equal(Number(game.memory['brickblast-best-stage-v1']), 2);
});

test('recall progresses to game over and restart resets the board', () => {
  const game = setup();
  for (let i = 0; i < 10; i++) { game.shoot(); game.node('recall').listeners.click(); }
  assert.equal(game.node('overlay').hidden, false);
  assert.equal(game.node('recall').disabled, true);
  assert.equal(game.node('score').textContent, 10);
  assert.equal(game.node('result').textContent, '10점');
  game.node('play-again').listeners.click();
  assert.equal(game.node('overlay').hidden, true);
  assert.equal(game.node('score').textContent, 1);
  assert.equal(game.node('best').textContent, 10);
});

test('new scoring ignores old hit-based records and restores stage records', () => {
  const fresh = setup({ 'brickblast-best': '9999' });
  assert.equal(fresh.node('best').textContent, 1);
  assert.equal(fresh.memory['brickblast-best'], '9999');
  const returning = setup({ 'brickblast-best-stage-v1': '12' });
  assert.equal(returning.node('best').textContent, 12);
});

test('cancelled touch does not fire', () => {
  const game = setup();
  const event = { clientX: 180, clientY: 80, isPrimary: true, button: 0, pointerId: 1 };
  game.node('game').listeners.pointerdown(event);
  game.node('game').listeners.pointercancel(event);
  game.node('game').listeners.pointerup(event);
  assert.equal(game.node('recall').disabled, true);
});

