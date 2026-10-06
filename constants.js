'use strict';

// 게임 규칙과 배치 설정. 위치와 크기는 px, 시간은 초 단위입니다.
// 일반 스크립트로 제공하므로 index.html을 직접 열어도 동작합니다.
const GAME_CONSTANTS = Object.freeze({
  FLOOR_Y: 513,
  BALL_RADIUS: 5,
  BALL_SPEED: 510,
  SHOT_INTERVAL: 0.065,
  MAX_PHYSICS_STEP: 0.006,
  MAX_FRAME_DELTA: 0.033,
  // 참고 이미지처럼 가로:세로 약 1.5:1, 블록 사이 간격은 가로·세로 2px입니다.
  BRICK_WIDTH: 68,
  BRICK_HEIGHT: 46,
  BRICK_GAP: 2,
  COLUMN_COUNT: 7,
  ROW_STEP: 48,
  ROW_TOP: 24,
  // 7개 블록과 6개 간격을 502px 보드 중앙에 배치합니다.
  BOARD_LEFT: 7,
  PICKUP_HIT_DISTANCE: 17,
  BRICK_COLORS: Object.freeze(['#b19afa', '#83aaf7', '#edaa87', '#ee90ad', '#8dcfc5']),
  BEST_SCORE_KEY: 'brickblast-best-stage-v1',
});
