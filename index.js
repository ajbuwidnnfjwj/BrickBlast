(() => {
  'use strict';

  const canvas = document.querySelector('#game');
  const context = canvas.getContext('2d');
  const ui = {
    score: document.getElementById('score'),
    best: document.getElementById('best'),
    recall: document.getElementById('recall'),
    overlay: document.getElementById('overlay'),
    result: document.getElementById('result'),
    restart: document.getElementById('restart'),
    playAgain: document.getElementById('play-again'),
  };

  const {
    FLOOR_Y,
    BALL_RADIUS,
    BALL_SPEED,
    SHOT_INTERVAL,
    MAX_PHYSICS_STEP,
    MAX_FRAME_DELTA,
    BRICK_WIDTH,
    BRICK_HEIGHT,
    BRICK_GAP,
    COLUMN_COUNT,
    ROW_STEP,
    ROW_TOP,
    BOARD_LEFT,
    PICKUP_HIT_DISTANCE,
    BRICK_COLORS,
    BEST_SCORE_KEY,
  } = GAME_CONSTANTS;

  // 설정값이 아니라 실제 Canvas와 설정으로부터 계산한 값입니다.
  const BOARD_WIDTH = canvas.width;
  const BOARD_HEIGHT = canvas.height;
  const COLUMN_STEP = BRICK_WIDTH + BRICK_GAP;

  // 여러 이벤트와 프레임에 걸쳐 유지하고 공유하는 게임 상태입니다.
  // 한 함수에서만 사용하는 임시 값은 해당 함수 안에서 선언합니다.
  let bricks;
  let pickups;
  let balls;
  let particles;
  let score;
  let ballCount;
  let launchX;
  let phase; // aim: 조준, shooting: 발사 중, over: 게임 종료
  let aimDirection;
  let isDragging;
  let firedBallCount;
  let collectedBallCount;
  let shotElapsed;
  let firstLandingX;
  let bestScore = loadBestScore();

  function loadBestScore() {
    try {
      return Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
    } catch {
      // 저장소가 차단되어도 게임은 계속 진행합니다.
      return 0;
    }
  }

  function updateScoreboard() {
    if (score > bestScore) {
      bestScore = score;
      try {
        localStorage.setItem(BEST_SCORE_KEY, String(bestScore));
      } catch {
        // 저장하지 못한 경우 현재 실행 중의 최고 점수만 유지합니다.
      }
    }
    ui.score.textContent = score;
    ui.best.textContent = bestScore;
    ui.recall.disabled = phase !== 'shooting';
  }

  // 턴 진행: 조준 → 공 발사 → 모두 귀환 → 벽돌 하강 → 다음 단계
  function addBrickRow() {
    const columns = Array.from({ length: COLUMN_COUNT }, (_, index) => index)
      .sort(() => Math.random() - 0.5);
    const brickCount = Math.min(5, 3 + Math.floor(score / 7));
    const color = BRICK_COLORS[(score - 1) % BRICK_COLORS.length];

    for (let index = 0; index < brickCount; index++) {
      bricks.push({
        x: BOARD_LEFT + columns[index] * COLUMN_STEP,
        y: ROW_TOP,
        hp: score,
        color,
        flash: 0,
      });
    }
    pickups.push({
      x: BOARD_LEFT + columns[brickCount] * COLUMN_STEP + BRICK_WIDTH / 2,
      y: ROW_TOP + BRICK_HEIGHT / 2,
    });
  }

  function resetGame() {
    bricks = [];
    pickups = [];
    balls = [];
    particles = [];
    score = 1;
    ballCount = 1;
    launchX = BOARD_WIDTH / 2;
    phase = 'aim';
    aimDirection = { x: 0, y: -1 };
    isDragging = false;
    firedBallCount = 0;
    collectedBallCount = 0;
    firstLandingX = null;
    ui.overlay.hidden = true;
    addBrickRow();
    updateScoreboard();
  }

  function launchBalls() {
    if (phase !== 'aim') return;

    phase = 'shooting';
    isDragging = false;
    firedBallCount = 0;
    collectedBallCount = 0;
    shotElapsed = 0;
    firstLandingX = null;
    updateScoreboard();
  }

  function finishTurn() {
    // 획득한 공은 다음 턴부터 사용하며, 첫 귀환 위치에서 다시 발사합니다.
    ballCount += collectedBallCount;
    launchX = firstLandingX ?? launchX;
    balls = [];
    for (const brick of bricks) brick.y += ROW_STEP;
    for (const pickup of pickups) pickup.y += ROW_STEP;
    // 바닥까지 내려온 공 추가 아이템도 자동으로 획득합니다.
    ballCount += pickups.filter(pickup => pickup.y >= FLOOR_Y - 15).length;
    pickups = pickups.filter(pickup => pickup.y < FLOOR_Y - 15);

    const hasReachedFloor = bricks.some(brick =>
      brick.y + BRICK_HEIGHT >= FLOOR_Y
    );
    if (hasReachedFloor) {
      phase = 'over';
      ui.result.textContent = `${score.toLocaleString()}점`;
      ui.overlay.hidden = false;
    } else {
      score++;
      addBrickRow();
      phase = 'aim';
    }
    updateScoreboard();
  }

  function recallBalls() {
    if (phase !== 'shooting') return;

    firstLandingX ??= balls[0]?.x ?? launchX;
    finishTurn();
  }

  function createParticles(x, y, color, particleCount = 9) {
    for (let index = 0; index < particleCount; index++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 150,
        vy: (Math.random() - 0.5) * 150,
        life: 0.5,
        color,
      });
    }
  }

  function damageBrick(brick) {
    brick.hp--;
    brick.flash = 0.09;
    if (brick.hp === 0) {
      createParticles(brick.x + BRICK_WIDTH / 2, brick.y + BRICK_HEIGHT / 2, brick.color);
    }
  }

  function overlapsBrick(ball, brick) {
    return ball.x + BALL_RADIUS > brick.x
      && ball.x - BALL_RADIUS < brick.x + BRICK_WIDTH
      && ball.y + BALL_RADIUS > brick.y
      && ball.y - BALL_RADIUS < brick.y + BRICK_HEIGHT;
  }

  function bounceOffBrick(ball, brick, previousX, previousY) {
    // 이동 전 위치로 부딪힌 면을 판단하고, 공을 벽돌 바깥으로 밀어냅니다.
    if (previousY + BALL_RADIUS <= brick.y) {
      ball.y = brick.y - BALL_RADIUS;
      ball.vy = -Math.abs(ball.vy);
    } else if (previousY - BALL_RADIUS >= brick.y + BRICK_HEIGHT) {
      ball.y = brick.y + BRICK_HEIGHT + BALL_RADIUS;
      ball.vy = Math.abs(ball.vy);
    } else if (previousX < brick.x) {
      ball.x = brick.x - BALL_RADIUS;
      ball.vx = -Math.abs(ball.vx);
    } else {
      ball.x = brick.x + BRICK_WIDTH + BALL_RADIUS;
      ball.vx = Math.abs(ball.vx);
    }
  }

  // 실제 공과 조준 미리보기가 공유합니다. 벽돌의 내구도는 여기서 바꾸지 않습니다.
  function moveBall(ball, deltaSeconds) {
    let bounced = false;
    const previousX = ball.x;
    const previousY = ball.y;
    ball.x += ball.vx * deltaSeconds;
    ball.y += ball.vy * deltaSeconds;

    if (ball.x < BALL_RADIUS) {
      bounced = true;
      ball.x = BALL_RADIUS;
      ball.vx = Math.abs(ball.vx);
    }
    if (ball.x > BOARD_WIDTH - BALL_RADIUS) {
      bounced = true;
      ball.x = BOARD_WIDTH - BALL_RADIUS;
      ball.vx = -Math.abs(ball.vx);
    }
    if (ball.y < BALL_RADIUS) {
      bounced = true;
      ball.y = BALL_RADIUS;
      ball.vy = Math.abs(ball.vy);
    }

    for (const brick of bricks) {
      if (brick.hp <= 0 || !overlapsBrick(ball, brick)) continue;

      bounceOffBrick(ball, brick, previousX, previousY);
      return { bounced: true, brick };
    }
    return { bounced, brick: null };
  }

  function createLaunchBall() {
    return {
      x: launchX,
      y: FLOOR_Y - BALL_RADIUS - 1,
      vx: aimDirection.x * BALL_SPEED,
      vy: aimDirection.y * BALL_SPEED,
    };
  }

  function collectPickups(ball) {
    for (const pickup of pickups) {
      const distance = Math.hypot(ball.x - pickup.x, ball.y - pickup.y);
      if (pickup.taken || distance >= PICKUP_HIT_DISTANCE) continue;

      pickup.taken = true;
      collectedBallCount++;
      createParticles(pickup.x, pickup.y, '#a2efc3', 12);
    }
  }

  function updateShooting(deltaSeconds) {
    shotElapsed += deltaSeconds;
    while (firedBallCount < ballCount && shotElapsed >= firedBallCount * SHOT_INTERVAL) {
      balls.push({ ...createLaunchBall(), active: true });
      firedBallCount++;
    }

    // 한 프레임을 작은 간격으로 나눠 빠른 공이 벽돌을 통과하지 않게 합니다.
    const stepCount = Math.ceil(deltaSeconds / MAX_PHYSICS_STEP);
    const stepSeconds = deltaSeconds / stepCount;
    for (let step = 0; step < stepCount; step++) {
      for (const ball of balls) {
        if (!ball.active) continue;

        // 바닥에 닿은 공은 충돌 계산 없이 첫 착지 위치로 모입니다.
        if (ball.returning) {
          const distance = firstLandingX - ball.x;
          const travel = BALL_SPEED * stepSeconds;
          if (Math.abs(distance) <= travel) {
            ball.x = firstLandingX;
            ball.active = false;
          } else {
            ball.x += Math.sign(distance) * travel;
          }
          continue;
        }

        const collision = moveBall(ball, stepSeconds);
        if (collision.brick) damageBrick(collision.brick);
        collectPickups(ball);
        if (ball.y + BALL_RADIUS >= FLOOR_Y && ball.vy > 0) {
          firstLandingX ??= ball.x;
          ball.y = FLOOR_Y - BALL_RADIUS;
          ball.vx = 0;
          ball.vy = 0;
          ball.returning = true;
          ball.active = ball.x !== firstLandingX;
        }
      }
    }

    bricks = bricks.filter(brick => brick.hp > 0);
    pickups = pickups.filter(pickup => !pickup.taken);
    if (firedBallCount === ballCount && balls.every(ball => !ball.active)) {
      finishTurn();
    }
  }

  function updateEffects(deltaSeconds) {
    for (const particle of particles) {
      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      particle.life -= deltaSeconds;
    }
    particles = particles.filter(particle => particle.life > 0);
    for (const brick of bricks) {
      brick.flash = Math.max(0, brick.flash - deltaSeconds);
    }
  }

  // 화면 그리기
  function drawCircle(x, y, radius, color) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  function drawLabel(text, x, y, size, color, weight = 600) {
    context.fillStyle = color;
    context.font = `${weight} ${size}px "DM Sans", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, x, y);
  }

  function drawBackground() {
    for (let x = 14; x < BOARD_WIDTH; x += 20) {
      for (let y = 14; y < FLOOR_Y - 15; y += 20) {
        drawCircle(x, y, 0.65, '#252a3f');
      }
    }
  }

  function drawBricks() {
    for (const brick of bricks) {
      context.fillStyle = brick.flash ? '#fff' : brick.color;
      context.fillRect(brick.x, brick.y, BRICK_WIDTH, BRICK_HEIGHT);

      drawLabel(
        brick.hp,
        brick.x + BRICK_WIDTH / 2,
        brick.y + BRICK_HEIGHT / 2 + 1,
        21,
        '#222238',
        700
      );
    }
  }

  function drawPickups(timeMs) {
    for (const pickup of pickups) {
      const pulse = Math.sin(timeMs * 0.003) * 2;
      context.strokeStyle = '#9ce7ba33';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(pickup.x, pickup.y, 16 + pulse, 0, Math.PI * 2);
      context.stroke();
      drawCircle(pickup.x, pickup.y, 10, '#a2efc3');
      drawLabel('+', pickup.x, pickup.y, 18, '#1d493e');
    }
  }

  function drawFloor() {
    context.strokeStyle = '#3d435d';
    context.setLineDash([4, 6]);
    context.beginPath();
    context.moveTo(12, FLOOR_Y);
    context.lineTo(BOARD_WIDTH - 12, FLOOR_Y);
    context.stroke();
    context.setLineDash([]);
  }

  function drawAimPreview() {
    const previewBall = createLaunchBall();
    let dotSpacing = 0;

    // 임시 공을 2px씩 이동시켜 첫 충돌 지점까지만 표시합니다.
    for (let step = 0; step < 1600; step++) {
      const collision = moveBall(previewBall, 2 / BALL_SPEED);
      if (previewBall.y + BALL_RADIUS >= FLOOR_Y && previewBall.vy > 0) break;

      dotSpacing += 2;
      if (dotSpacing < 13 && !collision.bounced) continue;

      dotSpacing -= 13;
      context.globalAlpha = 0.8;
      drawCircle(previewBall.x, previewBall.y, 2, '#c9b8ff');
      if (collision.bounced) {
        // 첫 충돌 위치에 실제 공 크기를 겹쳐 표시합니다.
        context.globalAlpha = 1;
        drawCircle(previewBall.x, previewBall.y, BALL_RADIUS, '#c9b8ff');
        break;
      }
    }
    context.globalAlpha = 1;
  }

  function drawBalls() {
    if (phase === 'aim') {
      if (isDragging) drawAimPreview();

      context.shadowBlur = 16;
      context.shadowColor = '#c8b4ff';
      drawCircle(launchX, FLOOR_Y - BALL_RADIUS, BALL_RADIUS, '#fff');
      context.shadowBlur = 0;
      drawLabel(`× ${ballCount}`, launchX, FLOOR_Y + 26, 12, '#c0b3e6');
    }
    for (const ball of balls) {
      // 모인 공도 표시해서 첫 착지 위치에 쌓이는 모습을 유지합니다.
      drawCircle(ball.x, ball.y, BALL_RADIUS, '#fff');
    }
    if (phase === 'shooting') {
      const extraBalls = collectedBallCount ? `  +${collectedBallCount}` : '';
      drawLabel(`${ballCount} BALLS${extraBalls}`, BOARD_WIDTH / 2, FLOOR_Y + 26, 11, '#9eabc7');
    }
  }

  function drawParticles() {
    for (const particle of particles) {
      context.globalAlpha = particle.life * 2;
      context.fillStyle = particle.color;
      context.beginPath();
      context.roundRect(particle.x, particle.y, 3, 3, 1);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function drawGame(timeMs) {
    context.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    drawBackground();
    drawBricks();
    drawPickups(timeMs);
    drawFloor();
    drawBalls();
    drawParticles();
  }

  // 입력 처리: 화면 좌표를 Canvas 좌표로 바꾸고 위쪽으로만 조준합니다.
  function updateAim(event) {
    const bounds = canvas.getBoundingClientRect();
    const pointerX = (event.clientX - bounds.left) / bounds.width * BOARD_WIDTH;
    const pointerY = (event.clientY - bounds.top) / bounds.height * BOARD_HEIGHT;
    const directionX = pointerX - launchX;
    const directionY = Math.min(-35, pointerY - FLOOR_Y);
    const length = Math.hypot(directionX, directionY);
    aimDirection = { x: directionX / length, y: directionY / length };
  }

  canvas.addEventListener('pointerdown', event => {
    if (phase !== 'aim' || !event.isPrimary || event.button !== 0) return;
    isDragging = true;
    canvas.setPointerCapture(event.pointerId);
    updateAim(event);
  });
  canvas.addEventListener('pointermove', event => {
    if (isDragging && event.isPrimary) updateAim(event);
  });
  canvas.addEventListener('pointerup', event => {
    if (!isDragging || !event.isPrimary) return;

    updateAim(event);
    launchBalls();
  });
  canvas.addEventListener('pointercancel', () => {
    isDragging = false;
  });
  canvas.addEventListener('lostpointercapture', () => {
    isDragging = false;
  });
  ui.restart.addEventListener('click', resetGame);
  ui.playAgain.addEventListener('click', () => {
    resetGame();
  });
  ui.recall.addEventListener('click', recallBalls);

  let lastFrameTime = 0;
  function animateFrame(timeMs) {
    const deltaSeconds = Math.min((timeMs - lastFrameTime) / 1000, MAX_FRAME_DELTA);
    lastFrameTime = timeMs;
    if (phase === 'shooting') updateShooting(deltaSeconds);
    updateEffects(deltaSeconds);
    drawGame(timeMs);
    requestAnimationFrame(animateFrame);
  }

  resetGame();
  requestAnimationFrame(animateFrame);
})();
