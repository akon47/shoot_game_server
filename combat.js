"use strict";

// 서버 권위 전투 판정: 사격(펠릿 포함)/근접 공격/데미지/사망/킬스트릭/스폰 무적.
//
// AI 고유 동작(어그로, 리스폰, 킬 후 배회 복귀)은 이 모듈이 직접 알지 못한다.
// 대신 플레이어 객체에 붙은 훅을 호출한다 (ai.js 의 createAiPlayer 에서 설정):
//  - player.onDamaged(attackerId): 피격 후 생존했을 때
//  - player.onScoredKill(): 킬을 올렸을 때
//  - player.respawn(): 사망했을 때 (있으면 서버가 직접 리스폰시키는 플레이어라는 뜻)

const config = require("./config");
const state = require("./state");
const net = require("./net");
const rounds = require("./rounds");
const {
  shootIntersection,
  getDistance,
  normalizeAngleDeg,
} = require("./utils");

function isProtected(player) {
  return (
    player.invincibleUntil !== undefined && Date.now() < player.invincibleUntil
  );
}

function getProtectedMs(player) {
  return Math.max(0, (player.invincibleUntil || 0) - Date.now());
}

function grantSpawnProtection(player) {
  player.invincibleUntil = Date.now() + config.SPAWN_PROTECTION_DURATION;
}

// 탄도(선분 muzzle->target) 위에서 가장 가까운 피격 대상을 찾아 데미지를 적용한다
function shootProcess(
  id,
  weapon,
  provider,
  muzzleX,
  muzzleY,
  targetX,
  targetY,
) {
  const p1 = { x: muzzleX, y: muzzleY };
  const p2 = { x: targetX, y: targetY };
  const bulletBox = {
    left: Math.min(p1.x, p2.x),
    top: Math.min(p1.y, p2.y),
    right: Math.max(p1.x, p2.x),
    bottom: Math.max(p1.y, p2.y),
  };

  let hitObject = undefined;
  let hitObjectType = undefined;
  let minDistance = Number.MAX_SAFE_INTEGER;

  function considerTarget(target, type) {
    if (target.id === id || isProtected(target)) {
      return;
    }
    // AABB 1차 필터 후 선분-원 교차로 최종 판정
    if (
      bulletBox.left >= target.x + target.width ||
      bulletBox.right <= target.x ||
      bulletBox.top >= target.y + target.height ||
      bulletBox.bottom <= target.y
    ) {
      return;
    }
    const intersection = shootIntersection(
      p1,
      p2,
      target.x + target.width / 2,
      target.y + target.height / 2,
      config.HIT_RADIUS,
    );
    if (!intersection) {
      return;
    }
    const distance =
      Math.pow(intersection.x - p1.x, 2) + Math.pow(intersection.y - p1.y, 2);
    if (distance < minDistance) {
      minDistance = distance;
      hitObject = target;
      hitObjectType = type;
    }
  }

  state.forEachPlayer(state.clients, function (client) {
    considerTarget(client, "user");
  });
  state.forEachPlayer(state.aiPlayers, function (aiPlayer) {
    considerTarget(aiPlayer, "ai");
  });
  // PvE 몬스터도 탄도 위에 있으면 피격 대상이 된다
  state.forEachPlayer(state.monsters, function (monster) {
    considerTarget(monster, "monster");
  });

  if (hitObject && hitObjectType) {
    const damage = config.WEAPON_DAMAGE[weapon];
    if (damage) {
      if (hitObjectType === "monster") {
        // 몬스터 피격은 monsters.js 가 설정한 훅으로 위임한다(monster_* 프로토콜·킬 크레딧).
        // combat 은 monsters 모듈을 require 하지 않는다(순환 의존 회피).
        if (hitObject.takeDamage) {
          hitObject.takeDamage(damage, id);
        }
      } else {
        applyDamage(hitObject, damage, provider, id, weapon);
      }
    }
  }
}

// 근접 공격: 공격자 전방 부채꼴 안의 가장 가까운 대상 하나에게 데미지
function meleeAttackProcess(id, provider, weapon) {
  const attacker = state.resolvePlayer(id);
  if (!attacker) {
    return;
  }
  const attackerX = attacker.x + attacker.width / 2;
  const attackerY = attacker.y + attacker.height / 2;

  let hitObject = undefined;
  let minDistance = config.MELEE_RANGE;

  function considerTarget(target) {
    if (target.id === id || target.hp <= 0 || isProtected(target)) {
      return;
    }
    const targetX = target.x + target.width / 2;
    const targetY = target.y + target.height / 2;
    const distance = getDistance(attackerX, attackerY, targetX, targetY);
    if (distance > config.MELEE_RANGE) {
      return;
    }
    const angleTo =
      (Math.atan2(targetY - attackerY, targetX - attackerX) / Math.PI) * 180;
    if (
      Math.abs(normalizeAngleDeg(angleTo - attacker.direction)) >
      config.MELEE_ANGLE_TOLERANCE
    ) {
      return;
    }
    if (distance <= minDistance) {
      minDistance = distance;
      hitObject = target;
    }
  }

  state.forEachPlayer(state.clients, considerTarget);
  state.forEachPlayer(state.aiPlayers, considerTarget);

  if (hitObject) {
    const damage =
      weapon === "knife" ? config.MELEE_KNIFE_DAMAGE : config.MELEE_BASH_DAMAGE;
    applyDamage(hitObject, damage, provider, id, weapon);
  }
}

// 사격/근접 공통 데미지 처리: hp 차감, 사망/킬/데스/킬스트릭 전파
function applyDamage(hitObject, damage, provider, providerId, weapon) {
  if (!hitObject.hp || hitObject.hp <= 0) {
    return;
  }
  if (isProtected(hitObject)) {
    return;
  }

  hitObject.hp -= damage;

  if (hitObject.hp > 0) {
    net.sendAll("user_hp", { id: hitObject.id, hp: hitObject.hp });
    if (hitObject.onDamaged) {
      hitObject.onDamaged(providerId);
    }
    return;
  }

  // 사망 처리
  hitObject.hp = 0;
  net.sendAll("user_die", {
    id: hitObject.id,
    reason: { provider: provider, provider_id: providerId, weapon: weapon },
  });
  console.log("die: " + hitObject.id + " (by " + providerId + ")");

  const providerObject = state.resolvePlayer(providerId);
  if (providerObject) {
    providerObject.kill++;
    net.sendAll("user_kill", { id: providerId, kill: providerObject.kill });
    if (providerObject.onScoredKill) {
      providerObject.onScoredKill();
    }

    providerObject.streak = (providerObject.streak || 0) + 1;
    const victimStreak = hitObject.streak || 0;
    hitObject.streak = 0;
    rounds.announceKill(providerObject, hitObject, victimStreak);
  } else {
    hitObject.streak = 0;
  }

  hitObject.death++;

  // AI 등 서버가 직접 리스폰시키는 플레이어 (사람은 클라이언트가 user_init 으로 리스폰)
  if (hitObject.respawn) {
    hitObject.respawn();
  }
  net.sendAll("user_death", { id: hitObject.id, death: hitObject.death });
}

// 사격 정보 계산 (무기별 총구 오프셋/탄퍼짐 반영)
function getShootInfo(player, targetPoint) {
  const muzzlePoint = {
    x: player.x + player.width / 2,
    y: player.y + player.height / 2,
  };

  let muzzleOffsetX = 0;
  let muzzleOffsetY = 0;
  let deviationAngle = 0;
  switch (player.weapon) {
    case "handgun":
      muzzleOffsetX = 29;
      muzzleOffsetY = 8;
      deviationAngle = (Math.PI / 180) * (1 - Math.random() * 2);
      break;
    case "rifle":
      muzzleOffsetX = 38;
      muzzleOffsetY = 6.5;
      deviationAngle = (Math.PI / 180) * (2 - Math.random() * 4);
      break;
    case "shotgun":
      muzzleOffsetX = 38;
      muzzleOffsetY = 6.5;
      break;
  }

  if (player.speedX !== 0 || player.speedY !== 0) {
    deviationAngle *= 3;
  }

  const muzzleAngle =
    Math.atan2(muzzleOffsetY, muzzleOffsetX) +
    (player.direction * Math.PI) / 180;
  const muzzleDistance = Math.sqrt(
    muzzleOffsetX * muzzleOffsetX + muzzleOffsetY * muzzleOffsetY,
  );
  muzzlePoint.x += Math.cos(muzzleAngle) * muzzleDistance;
  muzzlePoint.y += Math.sin(muzzleAngle) * muzzleDistance;

  let bulletAngle = 0.0;
  if (targetPoint !== undefined) {
    const bulletRadian =
      Math.atan2(targetPoint.y - muzzlePoint.y, targetPoint.x - muzzlePoint.x) +
      deviationAngle;
    bulletAngle = (bulletRadian * 180) / Math.PI;
    targetPoint.x = muzzlePoint.x + Math.cos(bulletRadian) * config.SHOOT_RANGE;
    targetPoint.y = muzzlePoint.y + Math.sin(bulletRadian) * config.SHOOT_RANGE;
  } else {
    targetPoint = { x: muzzleOffsetY + config.SHOOT_RANGE, y: muzzleOffsetY };
    const targetAngle =
      Math.atan2(targetPoint.y, targetPoint.x) +
      (player.direction * Math.PI) / 180 +
      deviationAngle;
    const targetDistance = Math.sqrt(
      targetPoint.x * targetPoint.x + targetPoint.y * targetPoint.y,
    );
    targetPoint.x =
      Math.cos(targetAngle) * targetDistance + (player.x + player.width / 2);
    targetPoint.y =
      Math.sin(targetAngle) * targetDistance + (player.y + player.height / 2);

    bulletAngle = (targetAngle * 180) / Math.PI;
  }

  return {
    muzzle: muzzlePoint,
    target: targetPoint,
    angle: bulletAngle,
  };
}

// 샷건이면 기준 각도 주변으로 펠릿 탄도를 펼치고, 그 외 무기는 단일 탄도를 반환
function getPelletTargetPoints(weapon, shootInfo) {
  if (weapon !== "shotgun") {
    return [shootInfo.target];
  }
  const baseRadian = (shootInfo.angle * Math.PI) / 180;
  const targetPoints = [];
  for (let i = 0; i < config.SHOTGUN_PELLET_COUNT; i++) {
    const pelletRadian =
      baseRadian + (Math.random() - 0.5) * config.SHOTGUN_SPREAD_ANGLE;
    targetPoints.push({
      x: shootInfo.muzzle.x + Math.cos(pelletRadian) * config.SHOOT_RANGE,
      y: shootInfo.muzzle.y + Math.sin(pelletRadian) * config.SHOOT_RANGE,
    });
  }
  return targetPoints;
}

module.exports = {
  isProtected,
  getProtectedMs,
  grantSpawnProtection,
  shootProcess,
  meleeAttackProcess,
  applyDamage, // monsters.js 의 접촉 공격이 플레이어에게 데미지를 줄 때 사용
  getShootInfo,
  getPelletTargetPoints,
};
