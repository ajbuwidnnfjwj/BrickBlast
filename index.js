(() => {
  'use strict';
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const ui = Object.fromEntries(['score','best','recall','overlay','result'].map(id => [id, document.getElementById(id)]));
  const W = canvas.width, H = canvas.height, FLOOR = 513, R = 5, CELL = 60, LEFT = 16, SPEED = 510;
  const BRICK_W = 62, BRICK_H = 46, COLUMN_STEP = BRICK_W + 6;
  const palette = ['#b19afa','#83aaf7','#edaa87','#ee90ad','#8dcfc5'];
  const BEST_KEY = 'brickblast-best-stage-v1';
  let bricks, pickups, balls, particles, score, count, origin, phase, aim, dragging, fired, pending, shotTime, firstLanding, best = 0;
  try { best = Number(localStorage.getItem(BEST_KEY)) || 0; } catch {}
  function sync() {
    if (score > best) { best = score; try { localStorage.setItem(BEST_KEY, String(best)); } catch {} }
    ui.score.textContent = score; ui.best.textContent = best;
    ui.recall.disabled = phase !== 'shooting';
  }
  function row() {
    const columns = Array.from({ length: 7 }, (_, i) => i).sort(() => Math.random() - .5);
    const total = Math.min(5, 3 + Math.floor(score / 7));
    const color = palette[(score - 1) % palette.length];
    for (let n = 0; n < total; n++) {
      const hp = score
      bricks.push({ x: LEFT + columns[n] * COLUMN_STEP, y: 24, hp, max: hp, color, flash: 0 });
    }
    pickups.push({ x: LEFT + columns[total] * COLUMN_STEP + BRICK_W / 2, y: 24 + BRICK_H / 2 });
  }
  function reset() {
    bricks = []; pickups = []; balls = []; particles = []; score = 1; count = 1;
    origin = W / 2; phase = 'aim'; aim = { x: 0, y: -1 }; dragging = false; fired = 0; pending = 0; firstLanding = null;
    ui.overlay.hidden = true; row(); sync();
  }
  function launch() {
    if (phase !== 'aim') return;
    phase = 'shooting'; dragging = false; fired = 0; pending = 0; shotTime = 0; firstLanding = null; sync();
  }
  function finish() {
    count += pending; origin = firstLanding ?? origin; balls = [];
    for (const brick of bricks) brick.y += CELL;
    for (const pickup of pickups) pickup.y += CELL;
    pickups = pickups.filter(p => p.y < FLOOR - 15);
    if (bricks.some(b => b.y + BRICK_H >= FLOOR - R)) {
      phase = 'over'; ui.result.textContent = `${score.toLocaleString()}점`; ui.overlay.hidden = false;
      document.getElementById('play-again').focus();
    } else { score++; row(); phase = 'aim'; }
    sync();
  }
  function recall() {
    if (phase !== 'shooting') return;
    firstLanding ??= balls[0]?.x ?? origin;
    finish();
  }
  function burst(x, y, color, n = 9) {
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: (Math.random() - .5) * 150, vy: (Math.random() - .5) * 150, life: .5, color });
  }
  function hit(brick) {
    brick.hp--; brick.flash = .09;
    if (brick.hp === 0) burst(brick.x + BRICK_W / 2, brick.y + BRICK_H / 2, brick.color);
  }
  function moveBall(ball, delta) {
    let bounced = false;
    const oldX = ball.x, oldY = ball.y;
    ball.x += ball.vx * delta; ball.y += ball.vy * delta;
    if (ball.x < R) { bounced = true; ball.x = R; ball.vx = Math.abs(ball.vx); }
    if (ball.x > W - R) { bounced = true; ball.x = W - R; ball.vx = -Math.abs(ball.vx); }
    if (ball.y < R) { bounced = true; ball.y = R; ball.vy = Math.abs(ball.vy); }
    for (const brick of bricks) {
      if (brick.hp <= 0) continue;
      if (ball.x + R > brick.x && ball.x - R < brick.x + BRICK_W && ball.y + R > brick.y && ball.y - R < brick.y + BRICK_H) {
        if (oldY + R <= brick.y) { ball.y = brick.y - R; ball.vy = -Math.abs(ball.vy); }
        else if (oldY - R >= brick.y + BRICK_H) { ball.y = brick.y + BRICK_H + R; ball.vy = Math.abs(ball.vy); }
        else if (oldX < brick.x) { ball.x = brick.x - R; ball.vx = -Math.abs(ball.vx); }
        else { ball.x = brick.x + BRICK_W + R; ball.vx = Math.abs(ball.vx); }
        return { bounced: true, brick };
      }
    }
    return { bounced, brick: null };
  }
  function step(dt) {
    if (phase === 'shooting') {
      shotTime += dt;
      while (fired < count && shotTime >= fired * .065) {
        balls.push({ x: origin, y: FLOOR - R - 1, vx: aim.x * SPEED, vy: aim.y * SPEED, active: true }); fired++;
      }
      // Small simulation steps keep fast balls from passing through thin collision boundaries.
      const steps = Math.ceil(dt / .006), delta = dt / steps;
      for (let s = 0; s < steps; s++) for (const ball of balls) {
        if (!ball.active) continue;
        const collision = moveBall(ball, delta);
        if (collision.brick) hit(collision.brick);
        for (const pickup of pickups) if (!pickup.taken && Math.hypot(ball.x - pickup.x, ball.y - pickup.y) < 17) {
          pickup.taken = true; pending++; burst(pickup.x, pickup.y, '#a2efc3', 12);
        }
        if (ball.y >= FLOOR && ball.vy > 0) { ball.active = false; firstLanding ??= ball.x; }
      }
      bricks = bricks.filter(b => b.hp > 0); pickups = pickups.filter(p => !p.taken);
      if (fired === count && balls.every(b => !b.active)) finish();
    }
    particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }); particles = particles.filter(p => p.life > 0);
    bricks.forEach(b => { b.flash = Math.max(0, b.flash - dt); });
  }
  function rounded(x, y, w, h, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
  function label(text, x, y, size, color, weight = 600) { ctx.fillStyle = color; ctx.font = `${weight} ${size}px "DM Sans", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y); }
  function draw(time) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#252a3f';
    for (let x = 14; x < W; x += 20) for (let y = 14; y < FLOOR - 15; y += 20) { ctx.beginPath(); ctx.arc(x, y, .65, 0, Math.PI * 2); ctx.fill(); }
    for (const b of bricks) {
      ctx.fillStyle = '#0003'; ctx.fillRect(b.x, b.y + 3, BRICK_W, BRICK_H);
      ctx.fillStyle = b.flash ? '#fff' : b.color; ctx.fillRect(b.x, b.y, BRICK_W, BRICK_H);
      ctx.fillStyle = '#ffffff26'; ctx.fillRect(b.x + 7, b.y + 5, BRICK_W - 14, 2);
      label(b.hp, b.x + BRICK_W / 2, b.y + BRICK_H / 2 + 1, 21, '#222238', 700);
    }
    for (const p of pickups) {
      const pulse = Math.sin(time * .003) * 2;
      ctx.strokeStyle = '#9ce7ba33'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(p.x, p.y, 16 + pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fillStyle = '#a2efc3'; ctx.fill(); label('+', p.x, p.y, 18, '#1d493e');
    }
    ctx.strokeStyle = '#3d435d'; ctx.setLineDash([4, 6]); ctx.beginPath(); ctx.moveTo(12, FLOOR + 8); ctx.lineTo(W - 12, FLOOR + 8); ctx.stroke(); ctx.setLineDash([]);
    if (phase === 'aim') {
      if (dragging) {
        // Trace a temporary ball using the same collision rules as a real shot.
        // Include the first contact point, without drawing a reflected path.
        const preview = { x: origin, y: FLOOR - R - 1, vx: aim.x * SPEED, vy: aim.y * SPEED };
        let spacing = 0;
        for (let i = 0; i < 1600; i++) {
          const collision = moveBall(preview, 2 / SPEED);
          if (preview.y >= FLOOR && preview.vy > 0) break;
          spacing += 2;
          if (spacing < 13 && !collision.bounced) continue;
          spacing -= 13;
          ctx.globalAlpha = .8;
          ctx.fillStyle = '#c9b8ff'; ctx.beginPath(); ctx.arc(preview.x, preview.y, 2, 0, Math.PI * 2); ctx.fill();
          if (collision.bounced) break;
        }
        ctx.globalAlpha = 1;
      }
      ctx.shadowBlur = 16; ctx.shadowColor = '#c8b4ff'; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(origin, FLOOR - R, R + 1, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      label(`× ${count}`, origin, FLOOR + 26, 12, '#c0b3e6');
    }
    for (const ball of balls) if (ball.active) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ball.x, ball.y, R, 0, Math.PI * 2); ctx.fill(); }
    if (phase === 'shooting') label(`${count} BALLS${pending ? `  +${pending}` : ''}`, W / 2, FLOOR + 26, 11, '#9eabc7');
    for (const p of particles) { ctx.globalAlpha = p.life * 2; rounded(p.x, p.y, 3, 3, 1, p.color); } ctx.globalAlpha = 1;
  }
  function target(event) {
    const rect = canvas.getBoundingClientRect();
    const dx = (event.clientX - rect.left) / rect.width * W - origin;
    const dy = Math.min(-35, (event.clientY - rect.top) / rect.height * H - FLOOR);
    const length = Math.hypot(dx, dy); aim = { x: dx / length, y: dy / length };
  }
  canvas.addEventListener('pointerdown', event => {
    if (phase !== 'aim' || !event.isPrimary || event.button !== 0) return;
    canvas.focus(); dragging = true; canvas.setPointerCapture(event.pointerId); target(event);
  });
  canvas.addEventListener('pointermove', event => { if (dragging && event.isPrimary) target(event); });
  canvas.addEventListener('pointerup', event => { if (dragging && event.isPrimary) { target(event); launch(); } });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('lostpointercapture', () => { dragging = false; });
  document.getElementById('restart').addEventListener('click', reset);
  document.getElementById('play-again').addEventListener('click', () => { reset(); canvas.focus(); });
  ui.recall.addEventListener('click', recall);
  let last = 0;
  function frame(time) { const dt = Math.min((time - last) / 1000, .033); last = time; step(dt); draw(time); requestAnimationFrame(frame); }
  reset(); requestAnimationFrame(frame);
})();
