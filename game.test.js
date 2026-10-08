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
    if (!nodes.has(id)) nodes.set(id, { width: 492, height: 570, textContent: '', hidden: false, listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, focus() {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 492, height: 570 }), getContext: () => context });
    return nodes.get(id);
  }
  let nextFrame, time = 0;
  const memory = { ...saved };
  const sandbox = { document: { querySelector: id => node(id.slice(1)), getElementById: node, addEventListener() {} }, localStorage: { getItem: key => memory[key], setItem: (key, value) => { memory[key] = value; } }, requestAnimationFrame: callback => { nextFrame = callback; }, Math: Object.create(Math) };
  sandbox.Math.random = () => .5;
  const gameContext = vm.createContext(sandbox);
  // 브라우저와 같은 순서로 설정을 먼저 읽고 게임을 시작합니다.
  for (const script of ['constants.js', 'index.js']) {
    let source = fs.readFileSync(script, 'utf8');
    if (script === 'index.js') {
      // 테스트에서만 고정된 충돌 상황을 주입합니다. 브라우저에는 API를 노출하지 않습니다.
      source = source.replace(/  resetGame\(\);\r?\n  requestAnimationFrame\(animateFrame\);/, `
        globalThis.physics = {
          moveBall,
          setBricks(value) { bricks = value; },
          shootBall(ball, delta) {
            balls = [{ ...ball, active: true }];
            ballCount = firedBallCount = 1;
            shotElapsed = 0;
            phase = 'shooting';
            updateShooting(delta);
            return balls[0];
          },
        };
        resetGame();
        requestAnimationFrame(animateFrame);`);
    }
    vm.runInContext(source, gameContext, { filename: script });
  }
  return { node, memory, labels, dots, physics: sandbox.physics, frames(n) { for (let i = 0; i < n; i++) nextFrame(time += 16); }, shoot(x = 246) { const event = { clientX: x, clientY: 40, isPrimary: true, button: 0, pointerId: 1 }; node('game').listeners.pointerdown(event); node('game').listeners.pointerup(event); } };
}

test('a fast ball hits a brick even when its endpoint is beyond the brick', () => {
  const { physics } = setup();
  const brick = { x: 100, y: 100, hp: 2 };
  physics.setBricks([brick]);
  const ball = { x: 130, y: 200, vx: 0, vy: -20000 };
  physics.moveBall(ball, 0.006);
  assert.equal(ball.y, 152);
  assert.equal(ball.vy, 20000);
  assert.equal(brick.hp, 2); // 미리보기 경로 계산은 내구도를 바꾸지 않습니다.
});

test('a diagonal corner approach reflects on the face actually entered', () => {
  const { physics } = setup();
  const brick = { x: 100, y: 100, hp: 2 };
  physics.setBricks([brick]);
  const ball = physics.shootBall({ x: 93, y: 93, vx: 250, vy: 440 }, 0.006);
  assert.equal(ball.x, 94);
  assert.equal(ball.vx, -250);
  assert.equal(ball.vy, 440);
  assert.equal(brick.hp, 1);
  physics.moveBall(ball, 0.006);
  assert.ok(ball.x < 94);
});

test('a normal-speed ball cannot cut through a corner between physics steps', () => {
  const { physics } = setup();
  const brick = { x: 100, y: 100, hp: 2 };
  physics.setBricks([brick]);
  // 이동 전후에는 겹치지 않지만, 중간 경로는 벽돌 충돌 범위를 통과합니다.
  const ball = physics.shootBall({ x: 93, y: 95, vx: 408, vy: -306 }, 0.006);
  assert.equal(brick.hp, 1);
  assert.equal(ball.x, 94);
  assert.equal(ball.y, 94.25);
  assert.equal(ball.vx, -408);
  assert.equal(ball.vy, -306);
});

test('the nearest brick wins regardless of array order or a later wall hit', () => {
  for (const reverse of [false, true]) {
    const { physics } = setup();
    const near = { x: 100, y: 100, hp: 2 };
    const far = { x: 170, y: 100, hp: 2 };
    physics.setBricks(reverse ? [near, far] : [far, near]);
    const ball = physics.shootBall({ x: 80, y: 120, vx: 100000, vy: 0 }, 0.006);
    assert.equal(ball.x, 94);
    assert.equal(ball.vx, -100000);
    assert.equal(near.hp, 1);
    assert.equal(far.hp, 2);
  }
});

test('simultaneous adjacent brick contacts reflect once and damage each brick once', () => {
  const { physics } = setup();
  const bricks = [{ x: 100, y: 100, hp: 3 }, { x: 170, y: 100, hp: 3 }];
  physics.setBricks(bricks);
  const ball = physics.shootBall({ x: 169, y: 153, vx: 0, vy: -510 }, 0.006);
  assert.equal(ball.y, 152);
  assert.equal(ball.vy, 510);
  assert.deepEqual(bricks.map(brick => brick.hp), [2, 2]);
  physics.moveBall(ball, 0.006);
  assert.ok(ball.y > 152);
  assert.equal(ball.vy, 510);
});

test('exact corner contact reflects both axes without trapping the ball', () => {
  const { physics } = setup();
  physics.setBricks([{ x: 100, y: 100, hp: 2 }]);
  const ball = { x: 93, y: 93, vx: 300, vy: 300 };
  physics.moveBall(ball, 0.006);
  assert.deepEqual(ball, { x: 94, y: 94, vx: -300, vy: -300 });
  physics.moveBall(ball, 0.006);
  assert.ok(ball.x < 94 && ball.y < 94);
});

test('destroyed bricks and travel along a brick face do not bounce', () => {
  const { physics } = setup();
  physics.setBricks([{ x: 100, y: 100, hp: 0 }]);
  const ball = { x: 93, y: 120, vx: 510, vy: 0 };
  assert.equal(physics.moveBall(ball, 0.006).bounced, false);
  physics.setBricks([{ x: 100, y: 100, hp: 2 }]);
  const tangent = { x: 93, y: 94, vx: 510, vy: 0 };
  assert.equal(physics.moveBall(tangent, 0.006).bounced, false);
});

test('aim preview stops at first side wall contact without reflecting', () => {
  const game = setup();
  game.node('game').listeners.pointerdown({ clientX: 480, clientY: 480, isPrimary: true, button: 0, pointerId: 1 });
  game.frames(1);
  assert.ok(game.dots.length > 1);
  assert.ok(game.dots.slice(1).every((point, i) => point.x > game.dots[i].x));
  assert.equal(game.dots.at(-1).x, 486);
  assert.equal(game.node('score').textContent, 1);
  assert.equal(game.node('recall').disabled, true);
});

for (const [surface, x, minY] of [['ceiling', 246, 6], ['brick', 100, 97]]) {
  test(`aim preview stops at first ${surface} contact without changing the board`, () => {
    const game = setup();
    game.node('game').listeners.pointerdown({ clientX: x, clientY: 40, isPrimary: true, button: 0, pointerId: 1 });
    game.frames(1);
    assert.ok(game.dots.length > 1);
    assert.equal(game.dots.at(-1).y, minY);
    assert.ok(game.dots.slice(1).every((point, i) => point.y < game.dots[i].y));
    assert.ok(game.dots.every(point => point.y < 523));
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
  // 8번 내려온 9칸째까지 생존하고, 다음 이동으로 10칸째에 닿으면 종료합니다.
  for (let i = 0; i < 8; i++) {
    game.shoot();
    game.node('recall').listeners.click();
    assert.equal(game.node('overlay').hidden, true);
  }
  game.shoot();
  game.node('recall').listeners.click();
  assert.equal(game.node('overlay').hidden, false);
  assert.equal(game.node('recall').disabled, true);
  assert.equal(game.node('score').textContent, 9);
  assert.equal(game.node('result').textContent, '9점');
  game.node('play-again').listeners.click();
  assert.equal(game.node('overlay').hidden, true);
  assert.equal(game.node('score').textContent, 1);
  assert.equal(game.node('best').textContent, 9);
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

