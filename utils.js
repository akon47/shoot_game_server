"use strict";

// 기하 유틸리티 모음 (게임 로직과 무관한 순수 함수)

// 선분(p1->p2)과 원의 교차점 중 p1에 가까운 쪽을 반환. 교차하지 않으면 undefined
function shootIntersection(p1, p2, circleX, circleY, radius) {
  const dp = { x: p2.x - p1.x, y: p2.y - p1.y };

  const a = dp.x * dp.x + dp.y * dp.y;
  const b = 2 * (dp.x * (p1.x - circleX) + dp.y * (p1.y - circleY));
  let c = circleX * circleX + circleY * circleY;
  c += p1.x * p1.x + p1.y * p1.y;
  c -= 2 * (circleX * p1.x + circleY * p1.y);
  c -= radius * radius;

  const bb4ac = b * b - 4 * a * c;
  if (Math.abs(a) < Number.EPSILON || bb4ac < 0) {
    return undefined;
  }

  const mu1 = (-b + Math.sqrt(bb4ac)) / (2 * a);
  const mu2 = (-b - Math.sqrt(bb4ac)) / (2 * a);

  const result1 = {
    x: p1.x + mu1 * (p2.x - p1.x),
    y: p1.y + mu1 * (p2.y - p1.y),
  };
  const result2 = {
    x: p1.x + mu2 * (p2.x - p1.x),
    y: p1.y + mu2 * (p2.y - p1.y),
  };

  if (
    Math.pow(result1.x - p1.x, 2) + Math.pow(result1.y - p1.y, 2) <
    Math.pow(result2.x - p1.x, 2) + Math.pow(result2.y - p1.y, 2)
  ) {
    return result1;
  }
  return result2;
}

function getDistance(x1, y1, x2, y2) {
  const dX = x2 - x1;
  const dY = y2 - y1;
  return Math.sqrt(dX * dX + dY * dY);
}

// 반직선(ray: a->b 방향)과 선분(segment: a-b)의 교차점을 반환. 없으면 null
// 반환값의 param 은 ray 방향으로의 거리 비율 (작을수록 가까움)
function getRayIntersection(ray, segment) {
  const r_px = ray.a.x;
  const r_py = ray.a.y;
  const r_dx = ray.b.x - ray.a.x;
  const r_dy = ray.b.y - ray.a.y;

  const s_px = segment.a.x;
  const s_py = segment.a.y;
  const s_dx = segment.b.x - segment.a.x;
  const s_dy = segment.b.y - segment.a.y;

  // 두 선이 평행하면 교차점이 없다
  const r_mag = Math.sqrt(r_dx * r_dx + r_dy * r_dy);
  const s_mag = Math.sqrt(s_dx * s_dx + s_dy * s_dy);
  if (r_dx / r_mag === s_dx / s_mag && r_dy / r_mag === s_dy / s_mag) {
    return null;
  }

  const T2 =
    (r_dx * (s_py - r_py) + r_dy * (r_px - s_px)) / (s_dx * r_dy - s_dy * r_dx);
  const T1 = (s_px + s_dx * T2 - r_px) / r_dx;

  if (T1 < 0) {
    return null;
  }
  if (T2 < 0 || T2 > 1) {
    return null;
  }

  return {
    x: r_px + r_dx * T1,
    y: r_py + r_dy * T1,
    param: T1,
  };
}

// 각도를 [-180, 180] 범위로 정규화 (회전 시 가까운 쪽으로 돌게 하기 위함)
function normalizeAngleDeg(angle) {
  angle = angle % 360;
  if (angle > 180) {
    angle -= 360;
  }
  if (angle < -180) {
    angle += 360;
  }
  return angle;
}

module.exports = {
  shootIntersection,
  getDistance,
  getRayIntersection,
  normalizeAngleDeg,
};
