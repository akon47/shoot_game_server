"use strict";

// AI 봇: 사람처럼 보이도록 주기적으로 입퇴장하며, roam -> chase -> attack FSM 으로 행동한다.
// 모든 봇은 하나의 60fps 루프에서 처리한다 (봇마다 타이머를 만들지 않는다).

const config = require("./config");
const state = require("./state");
const net = require("./net");
const combat = require("./combat");
const chatStore = require("./chat-store");
const {
  getWalkableRandomPosition,
  setRandomDestinationPath,
  setDestinationPath,
  isWalkablePosition,
  getMapSegments,
} = require("./map-helper");
const {
  getDistance,
  getRayIntersection,
  normalizeAngleDeg,
} = require("./utils");

const aiPlayers = state.aiPlayers;
let aiIdCount = 0;

// 봇의 타겟은 사람/봇뿐 아니라 PvE 몬스터도 될 수 있다("봇도 함께 싸움").
// resolvePlayer 는 몬스터를 제외하므로(킬 크레딧 보호) 여기서 몬스터까지 확인한다.
function resolveTarget(id) {
  return state.resolvePlayer(id) || state.monsters[id];
}

// ---------------------------------------------------------------------------
// 입퇴장 (인구 관리)
// ---------------------------------------------------------------------------

// 다른 플레이어와 일정 거리 이상 떨어진 스폰 위치를 찾는다 (겹친 채 스폰 방지)
function getAiSpawnPosition() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const position = getWalkableRandomPosition();
    let tooClose = false;
    function checkDistance(player) {
      if (
        getDistance(position.x, position.y, player.x, player.y) <
        config.AI_SPAWN_MIN_DISTANCE
      ) {
        tooClose = true;
      }
    }
    state.forEachPlayer(state.clients, checkDistance);
    if (!tooClose) {
      state.forEachPlayer(aiPlayers, checkDistance);
    }
    if (!tooClose) {
      return position;
    }
  }
  return getWalkableRandomPosition();
}

// 현재 사용 중이지 않은 이름을 랜덤으로 고른다
function pickAiName() {
  const inUse = {};
  state.forEachPlayer(aiPlayers, function (aiPlayer) {
    inUse[aiPlayer.name] = true;
  });
  const candidates = config.AI_NAME_POOL.filter((name) => !inUse[name]);
  if (candidates.length === 0) {
    return "Guest" + Math.floor(Math.random() * 1000);
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// AI가 보내는 채팅도 유저 채팅과 동일하게 브로드캐스트하고 기록에 남긴다
function sendAiChat(aiPlayer, text) {
  const chatData = {
    id: aiPlayer.id,
    name: aiPlayer.name,
    chat: text,
    date: Date.now(),
  };
  net.sendAll("user_chat", chatData);
  chatStore.append(chatData);
}

function pickRandom(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

function createAiPlayer(name) {
  const position = getAiSpawnPosition();
  const id = "AI_" + aiIdCount++;

  const aiPlayer = {
    id: id,
    x: position.x,
    y: position.y,
    width: 32,
    height: 32,
    speedX: 0,
    speedY: 0,
    destinationX: position.x,
    destinationY: position.y,
    name: name ? name : pickAiName(),
    direction: 0,
    // 사람처럼 보이도록 캐릭터와 무기를 랜덤으로 고른다
    character: Math.floor(Math.random() * 100),
    weapon: pickRandom(config.AI_WEAPONS),
    hp: 100.0,
    kill: 0,
    death: 0,
    streak: 0,
    lastShootTime: 0,
    isLeaving: false,
    leaveTime:
      Date.now() +
      config.AI_STAY_DURATION_MIN +
      Math.random() *
        (config.AI_STAY_DURATION_MAX - config.AI_STAY_DURATION_MIN),
    fsm: {
      state: "roam", // roam: 배회, chase: 추격/수색, attack: 정지 후 사격
      targetId: undefined, // 타겟은 객체 참조 대신 id로 보관 (끊긴 유저 추격 방지)
      lastSeenX: position.x, // 타겟을 마지막으로 목격한 위치
      lastSeenY: position.y,
      lastSeenTime: 0,
      lastRepathTime: 0,
    },
  };
  combat.grantSpawnProtection(aiPlayer);

  // combat.applyDamage 가 호출하는 훅: AI 고유의 전투 반응을 여기서 정의한다
  aiPlayer.onDamaged = function (attackerId) {
    aiAggro(aiPlayer, attackerId);
  };
  aiPlayer.onScoredKill = function () {
    resetToRoam(aiPlayer);
  };
  aiPlayer.respawn = function () {
    respawnAiPlayer(aiPlayer);
  };

  aiPlayers[id] = aiPlayer;
  aiPlayers.push(id);

  console.log("ai " + id + " (" + aiPlayer.name + ") joined");

  net.sendAll("user_connected", buildUserConnectedData(aiPlayer));
  net.broadcastUserCount();

  // 입장 후 잠시 뒤에 가끔 인사를 한다
  if (Math.random() < config.AI_GREETING_CHANCE) {
    setTimeout(
      function () {
        if (aiPlayers[id]) {
          sendAiChat(aiPlayer, pickRandom(config.AI_GREETINGS));
        }
      },
      1500 + Math.random() * 3000,
    );
  }
}

function buildUserConnectedData(aiPlayer) {
  return {
    id: aiPlayer.id,
    name: aiPlayer.name,
    x: aiPlayer.x,
    y: aiPlayer.y,
    speedX: aiPlayer.speedX,
    speedY: aiPlayer.speedY,
    direction: aiPlayer.direction,
    character: aiPlayer.character,
    weapon: aiPlayer.weapon,
    kill: aiPlayer.kill,
    death: aiPlayer.death,
    hp: aiPlayer.hp,
    protectedMs: combat.getProtectedMs(aiPlayer),
  };
}

// 사망한 AI를 즉시 다른 위치에 리스폰시킨다 (combat 의 respawn 훅)
function respawnAiPlayer(aiPlayer) {
  aiPlayer.hp = 100.0;
  const position = getAiSpawnPosition();
  aiPlayer.x = position.x;
  aiPlayer.y = position.y;
  aiPlayer.destinationX = position.x;
  aiPlayer.destinationY = position.y;
  aiPlayer.isPathMovingActive = false;
  aiPlayer.fsm.state = "roam";
  aiPlayer.fsm.targetId = undefined;
  combat.grantSpawnProtection(aiPlayer);
  net.sendAll("user_connected", buildUserConnectedData(aiPlayer));
}

function removeAiPlayer(id) {
  if (!aiPlayers[id]) {
    return;
  }
  console.log("ai " + id + " (" + aiPlayers[id].name + ") left");
  delete aiPlayers[id];
  const index = aiPlayers.indexOf(id);
  if (index >= 0) {
    aiPlayers.splice(index, 1);
  }
  net.sendAll("user_disconnected", { id: id });
  net.broadcastUserCount();
}

// 머무는 시간이 끝난 AI를 퇴장시킨다 (가끔 작별 인사 후 잠시 뒤에 나간다)
function startAiLeave(aiPlayer) {
  aiPlayer.isLeaving = true;
  if (Math.random() < config.AI_FAREWELL_CHANCE) {
    sendAiChat(aiPlayer, pickRandom(config.AI_FAREWELLS));
  }
  setTimeout(
    function () {
      removeAiPlayer(aiPlayer.id);
    },
    1000 + Math.random() * 2000,
  );
}

// 랜덤 간격으로 새 AI 입장 시도
function scheduleNextAiJoin() {
  const delay =
    config.AI_JOIN_INTERVAL_MIN +
    Math.random() * (config.AI_JOIN_INTERVAL_MAX - config.AI_JOIN_INTERVAL_MIN);
  setTimeout(function () {
    if (state.countPlayers(aiPlayers) < config.AI_MAX_COUNT) {
      createAiPlayer();
    }
    scheduleNextAiJoin();
  }, delay);
}

// ---------------------------------------------------------------------------
// 시야 / 타겟팅
// ---------------------------------------------------------------------------

// 전방 ±55도 부채꼴 + 거리 + 벽 차폐(mapSegments 레이 교차)를 통과한 플레이어를
// 거리순으로 반환한다. 없으면 undefined
function getPlayersInSight(player, range) {
  const rayX = player.x + player.width / 2;
  const rayY = player.y + player.height / 2;

  let startAngle = (Math.PI / 180) * (-55 + (player.direction % 360));
  let endAngle = (Math.PI / 180) * (55 + (player.direction % 360));
  if (startAngle < -Math.PI) {
    startAngle += Math.PI * 2;
  }
  if (endAngle > Math.PI) {
    endAngle -= Math.PI * 2;
  }

  const candidates = [];
  function addCandidate(target) {
    if (target.id === player.id) {
      return;
    }
    const targetCenterX = target.x + target.width / 2;
    const targetCenterY = target.y + target.height / 2;
    const distance = getDistance(rayX, rayY, targetCenterX, targetCenterY);
    if (distance < range) {
      const angle = Math.atan2(targetCenterY - rayY, targetCenterX - rayX);
      candidates.push({ angle: angle, distance: distance, target: target });
    }
  }
  state.forEachPlayer(state.clients, addCandidate);
  state.forEachPlayer(aiPlayers, addCandidate);
  state.forEachPlayer(state.monsters, addCandidate);

  let result = [];
  for (let j = 0; j < candidates.length; j++) {
    const angle = candidates[j].angle;

    const inSightAngle =
      startAngle < endAngle
        ? startAngle <= angle && angle <= endAngle
        : startAngle <= angle || angle <= endAngle;
    if (!inSightAngle) {
      continue;
    }

    // 후보 방향으로 레이를 쏘아 가장 가까운 벽보다 후보가 가까우면 보인다
    const mapSegments = getMapSegments();
    const ray = {
      a: { x: rayX, y: rayY },
      b: { x: rayX + Math.cos(angle), y: rayY + Math.sin(angle) },
    };
    let closestIntersect = null;
    for (let i = 0; i < mapSegments.length; i++) {
      const intersect = getRayIntersection(ray, mapSegments[i]);
      if (!intersect) {
        continue;
      }
      if (!closestIntersect || intersect.param < closestIntersect.param) {
        closestIntersect = intersect;
      }
    }
    if (!closestIntersect) {
      continue;
    }

    const wallDistance = getDistance(
      rayX,
      rayY,
      closestIntersect.x,
      closestIntersect.y,
    );
    if (candidates[j].distance < wallDistance) {
      result.push(candidates[j]);
    }
  }

  result = result.sort(function (a, b) {
    return a.distance - b.distance;
  });

  return result.length > 0 ? result : undefined;
}

function pickTarget(inSightPlayers) {
  if (!inSightPlayers) {
    return undefined;
  }
  // 거리순 정렬되어 있으므로 살아있는 가장 가까운 플레이어 선택
  for (let i = 0; i < inSightPlayers.length; i++) {
    if (inSightPlayers[i].target.hp > 0) {
      return inSightPlayers[i].target;
    }
  }
  return undefined;
}

function isTargetVisible(inSightPlayers, targetId) {
  if (!inSightPlayers) {
    return false;
  }
  for (let i = 0; i < inSightPlayers.length; i++) {
    if (inSightPlayers[i].target.id === targetId) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 이동
// ---------------------------------------------------------------------------

function turnToward(aiPlayer, targetDirection) {
  const diff = normalizeAngleDeg(targetDirection - aiPlayer.direction);
  if (diff === 0) {
    return;
  }
  if (Math.abs(diff) < 6) {
    aiPlayer.direction = normalizeAngleDeg(targetDirection);
  } else {
    aiPlayer.direction = normalizeAngleDeg(aiPlayer.direction + diff / 4);
  }
  net.sendAll("user_direction", {
    id: aiPlayer.id,
    direction: aiPlayer.direction,
  });
}

function stopMoving(aiPlayer) {
  aiPlayer.destinationX = aiPlayer.x;
  aiPlayer.destinationY = aiPlayer.y;
  aiPlayer.isPathMovingActive = false;
  if (aiPlayer.speedX !== 0 || aiPlayer.speedY !== 0) {
    aiPlayer.speedX = 0;
    aiPlayer.speedY = 0;
    net.sendAll("user_speed", { id: aiPlayer.id, speedX: 0, speedY: 0 });
    net.sendAll("user_position", {
      id: aiPlayer.id,
      x: aiPlayer.x,
      y: aiPlayer.y,
    });
  }
}

function resetToRoam(aiPlayer) {
  aiPlayer.fsm.state = "roam";
  aiPlayer.fsm.targetId = undefined;
  stopMoving(aiPlayer);
}

function repathToPoint(aiPlayer, x, y, now) {
  if (now - aiPlayer.fsm.lastRepathTime < config.AI_REPATH_INTERVAL) {
    return;
  }
  aiPlayer.fsm.lastRepathTime = now;
  setDestinationPath(aiPlayer, { x: x, y: y });
}

// 타겟 반대 방향으로 한 발 물러날 지점을 찾아 이동 (붙어서 겹치는 것 방지)
function retreatFrom(aiPlayer, threatX, threatY, now) {
  if (now - aiPlayer.fsm.lastRepathTime < config.AI_REPATH_INTERVAL) {
    return;
  }
  const centerX = aiPlayer.x + aiPlayer.width / 2;
  const centerY = aiPlayer.y + aiPlayer.height / 2;
  const awayAngle = Math.atan2(centerY - threatY, centerX - threatX);
  const candidateOffsets = [
    0,
    Math.PI / 4,
    -Math.PI / 4,
    Math.PI / 2,
    -Math.PI / 2,
  ];
  for (let i = 0; i < candidateOffsets.length; i++) {
    const angle = awayAngle + candidateOffsets[i];
    const candidateX = centerX + Math.cos(angle) * 128;
    const candidateY = centerY + Math.sin(angle) * 128;
    if (isWalkablePosition(candidateX, candidateY)) {
      aiPlayer.fsm.lastRepathTime = now;
      setDestinationPath(aiPlayer, { x: candidateX, y: candidateY });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// FSM
// ---------------------------------------------------------------------------

// 공격받았을 때 시야 밖 공격자에게도 반응하도록 어그로 부여
function aiAggro(aiPlayer, attackerId) {
  if (
    aiPlayer.fsm.state !== "roam" &&
    resolveTarget(aiPlayer.fsm.targetId) !== undefined
  ) {
    return;
  }
  const attacker = resolveTarget(attackerId);
  if (!attacker || attacker.hp <= 0) {
    return;
  }
  const attackerX = attacker.x + attacker.width / 2;
  const attackerY = attacker.y + attacker.height / 2;
  aiPlayer.fsm.state = "chase";
  aiPlayer.fsm.targetId = attackerId;
  aiPlayer.fsm.lastSeenX = attackerX;
  aiPlayer.fsm.lastSeenY = attackerY;
  aiPlayer.fsm.lastSeenTime = Date.now();
  aiPlayer.fsm.lastRepathTime = 0;

  // 공격받은 방향으로 즉시 돌아본다 (시야각 안에 들어오도록)
  const centerX = aiPlayer.x + aiPlayer.width / 2;
  const centerY = aiPlayer.y + aiPlayer.height / 2;
  aiPlayer.direction = normalizeAngleDeg(
    (Math.atan2(attackerY - centerY, attackerX - centerX) / Math.PI) * 180,
  );
  net.sendAll("user_direction", {
    id: aiPlayer.id,
    direction: aiPlayer.direction,
  });
}

function aiProcess(aiPlayer, now) {
  const centerX = aiPlayer.x + aiPlayer.width / 2;
  const centerY = aiPlayer.y + aiPlayer.height / 2;
  const inSightPlayers = getPlayersInSight(aiPlayer, config.AI_SIGHT_RANGE);
  const fsm = aiPlayer.fsm;

  switch (fsm.state) {
    case "roam": {
      const target = pickTarget(inSightPlayers);
      if (target) {
        fsm.state = "chase";
        fsm.targetId = target.id;
        fsm.lastSeenX = target.x + target.width / 2;
        fsm.lastSeenY = target.y + target.height / 2;
        fsm.lastSeenTime = now;
        fsm.lastRepathTime = 0;
      }
      break;
    }
    case "chase": {
      const target = resolveTarget(fsm.targetId);
      if (!target || target.hp <= 0) {
        resetToRoam(aiPlayer);
        break;
      }
      const targetX = target.x + target.width / 2;
      const targetY = target.y + target.height / 2;

      if (isTargetVisible(inSightPlayers, fsm.targetId)) {
        fsm.lastSeenX = targetX;
        fsm.lastSeenY = targetY;
        fsm.lastSeenTime = now;

        if (
          getDistance(centerX, centerY, targetX, targetY) <=
          config.AI_ATTACK_RANGE
        ) {
          fsm.state = "attack";
          stopMoving(aiPlayer);
          break;
        }
        repathToPoint(aiPlayer, targetX, targetY, now);
      } else {
        // 시야에서 놓침: 마지막 목격 지점까지 수색하고 그래도 없으면 포기
        if (
          now - fsm.lastSeenTime > config.AI_TARGET_LOST_TIMEOUT ||
          getDistance(centerX, centerY, fsm.lastSeenX, fsm.lastSeenY) <
            config.AI_LAST_SEEN_ARRIVE_DISTANCE
        ) {
          resetToRoam(aiPlayer);
          break;
        }
        repathToPoint(aiPlayer, fsm.lastSeenX, fsm.lastSeenY, now);
      }
      break;
    }
    case "attack": {
      const target = resolveTarget(fsm.targetId);
      if (!target || target.hp <= 0) {
        resetToRoam(aiPlayer);
        break;
      }
      if (!isTargetVisible(inSightPlayers, fsm.targetId)) {
        fsm.state = "chase";
        fsm.lastRepathTime = 0;
        break;
      }
      const targetX = target.x + target.width / 2;
      const targetY = target.y + target.height / 2;
      fsm.lastSeenX = targetX;
      fsm.lastSeenY = targetY;
      fsm.lastSeenTime = now;

      const distance = getDistance(centerX, centerY, targetX, targetY);
      if (distance > config.AI_ATTACK_RANGE + config.AI_ATTACK_RANGE_BUFFER) {
        fsm.state = "chase";
        fsm.lastRepathTime = 0;
        break;
      }

      if (distance < config.AI_RETREAT_RANGE) {
        retreatFrom(aiPlayer, targetX, targetY, now);
      } else if (!aiPlayer.isPathMovingActive) {
        stopMoving(aiPlayer);
      }

      // 사격 중에는 이동 방향이 아니라 타겟을 조준한다
      const targetDirection =
        (Math.atan2(targetY - centerY, targetX - centerX) / Math.PI) * 180;
      turnToward(aiPlayer, targetDirection);

      if (
        now - aiPlayer.lastShootTime > config.AI_SHOOT_INTERVAL &&
        Math.abs(normalizeAngleDeg(targetDirection - aiPlayer.direction)) <
          config.AI_SHOOT_FACING_TOLERANCE
      ) {
        aiPlayer.lastShootTime = now;
        aiShoot(aiPlayer, targetX, targetY);
      }
      break;
    }
  }

  aiMove(aiPlayer);
  applySeparation(aiPlayer);
}

function aiShoot(aiPlayer, targetX, targetY) {
  // 정확히 중앙을 노리지 않도록 약간의 조준 오차를 준다
  const shootInfo = combat.getShootInfo(aiPlayer, {
    x: targetX + (Math.random() - 0.5) * 24,
    y: targetY + (Math.random() - 0.5) * 24,
  });
  const targetPoints = combat.getPelletTargetPoints(aiPlayer.weapon, shootInfo);
  for (let i = 0; i < targetPoints.length; i++) {
    combat.shootProcess(
      aiPlayer.id,
      aiPlayer.weapon,
      "ai",
      shootInfo.muzzle.x,
      shootInfo.muzzle.y,
      targetPoints[i].x,
      targetPoints[i].y,
    );
  }
  net.sendAll("user_shoot", {
    id: aiPlayer.id,
    weapon: aiPlayer.weapon,
    muzzlePoint: shootInfo.muzzle,
    targetPoints: targetPoints,
    angle: shootInfo.angle,
  });
}

// 경로 따라가기 + roam 배회
function aiMove(aiPlayer) {
  if (
    aiPlayer.x !== aiPlayer.destinationX ||
    aiPlayer.y !== aiPlayer.destinationY
  ) {
    const distance = getDistance(
      aiPlayer.x,
      aiPlayer.y,
      aiPlayer.destinationX,
      aiPlayer.destinationY,
    );
    if (config.AI_MOVE_SPEED >= distance) {
      aiPlayer.x = aiPlayer.destinationX;
      aiPlayer.y = aiPlayer.destinationY;

      aiPlayer.speedX = 0;
      aiPlayer.speedY = 0;
      net.sendAll("user_speed", { id: aiPlayer.id, speedX: 0, speedY: 0 });
      net.sendAll("user_position", {
        id: aiPlayer.id,
        x: aiPlayer.x,
        y: aiPlayer.y,
      });
    } else {
      const moveRadian = Math.atan2(
        aiPlayer.destinationY - aiPlayer.y,
        aiPlayer.destinationX - aiPlayer.x,
      );

      const newSpeedX = Math.cos(moveRadian) * config.AI_MOVE_SPEED;
      const newSpeedY = Math.sin(moveRadian) * config.AI_MOVE_SPEED;

      aiPlayer.x += newSpeedX;
      aiPlayer.y += newSpeedY;

      if (aiPlayer.speedX !== newSpeedX || aiPlayer.speedY !== newSpeedY) {
        aiPlayer.speedX = newSpeedX;
        aiPlayer.speedY = newSpeedY;
        net.sendAll("user_speed", {
          id: aiPlayer.id,
          speedX: aiPlayer.speedX,
          speedY: aiPlayer.speedY,
        });
        net.sendAll("user_position", {
          id: aiPlayer.id,
          x: aiPlayer.x,
          y: aiPlayer.y,
        });
      }
      // attack 상태에서는 조준이 우선이므로 이동 방향으로 돌리지 않는다
      if (aiPlayer.fsm.state !== "attack") {
        turnToward(aiPlayer, (moveRadian / Math.PI) * 180);
      }
    }
  } else if (aiPlayer.isPathMovingActive) {
    aiPlayer.currentMovingPathIndex++;
    if (aiPlayer.currentMovingPathIndex < aiPlayer.movingPath.length) {
      aiPlayer.destinationX =
        aiPlayer.movingPath[aiPlayer.currentMovingPathIndex].x;
      aiPlayer.destinationY =
        aiPlayer.movingPath[aiPlayer.currentMovingPathIndex].y;
    } else {
      aiPlayer.isPathMovingActive = false;
    }
  } else if (aiPlayer.fsm.state === "roam") {
    if (Math.random() < 0.005) {
      setRandomDestinationPath(aiPlayer);
    } else {
      // 제자리에서 천천히 회전하며 주변을 살핀다
      aiPlayer.direction = normalizeAngleDeg(aiPlayer.direction + 1);
      net.sendAll("user_direction", {
        id: aiPlayer.id,
        direction: aiPlayer.direction,
      });
    }
  }
}

// 플레이어끼리 겹치지 않게 밀어내는 처리 (AI 본인만 밀려난다)
function applySeparation(aiPlayer) {
  let pushX = 0;
  let pushY = 0;
  const centerX = aiPlayer.x + aiPlayer.width / 2;
  const centerY = aiPlayer.y + aiPlayer.height / 2;

  function accumulatePush(other) {
    if (other.id === aiPlayer.id) {
      return;
    }
    const otherX = other.x + other.width / 2;
    const otherY = other.y + other.height / 2;
    const distance = getDistance(centerX, centerY, otherX, otherY);
    if (distance >= config.AI_BODY_DISTANCE) {
      return;
    }
    let angle;
    if (distance < 1) {
      // 완전히 겹친 경우 방향을 정할 수 없으므로 임의 방향을 정하되,
      // 매 틱 바꾸면 랜덤워크가 되어 못 빠져나가므로 정한 방향을 유지한다
      if (aiPlayer.separationEscapeAngle === undefined) {
        aiPlayer.separationEscapeAngle = Math.random() * Math.PI * 2;
      }
      angle = aiPlayer.separationEscapeAngle;
    } else {
      angle = Math.atan2(centerY - otherY, centerX - otherX);
    }
    const strength = Math.min((config.AI_BODY_DISTANCE - distance) / 2, 2);
    pushX += Math.cos(angle) * strength;
    pushY += Math.sin(angle) * strength;
  }

  state.forEachPlayer(state.clients, accumulatePush);
  state.forEachPlayer(aiPlayers, accumulatePush);

  if (pushX === 0 && pushY === 0) {
    aiPlayer.separationEscapeAngle = undefined;
    return;
  }

  // 밀어내기 전에 판정해야 한다. 밀린 후에는 x !== destinationX 가 되어
  // 다음 틱에 aiMove 가 봇을 겹친 자리로 도로 끌어당긴다
  const wasIdle =
    !aiPlayer.isPathMovingActive &&
    aiPlayer.x === aiPlayer.destinationX &&
    aiPlayer.y === aiPlayer.destinationY;

  const newX = aiPlayer.x + pushX;
  const newY = aiPlayer.y + pushY;
  if (
    isWalkablePosition(newX + aiPlayer.width / 2, newY + aiPlayer.height / 2)
  ) {
    aiPlayer.x = newX;
    aiPlayer.y = newY;
    if (wasIdle) {
      aiPlayer.destinationX = aiPlayer.x;
      aiPlayer.destinationY = aiPlayer.y;
    }
    net.sendAll("user_position", {
      id: aiPlayer.id,
      x: aiPlayer.x,
      y: aiPlayer.y,
    });
  }

  // 겹친 채 가만히 서 있으면 밀어내기만으로는 느리므로 직접 걸어서 벗어난다
  if (wasIdle) {
    const escapeAngle = Math.atan2(pushY, pushX);
    const escapeX = aiPlayer.x + Math.cos(escapeAngle) * 64;
    const escapeY = aiPlayer.y + Math.sin(escapeAngle) * 64;
    if (
      isWalkablePosition(
        escapeX + aiPlayer.width / 2,
        escapeY + aiPlayer.height / 2,
      ) &&
      isWalkablePosition(
        aiPlayer.x + Math.cos(escapeAngle) * 32 + aiPlayer.width / 2,
        aiPlayer.y + Math.sin(escapeAngle) * 32 + aiPlayer.height / 2,
      )
    ) {
      aiPlayer.destinationX = escapeX;
      aiPlayer.destinationY = escapeY;
    }
  }
}

// 라운드 맵 교체 시 모든 봇을 새 활성 맵 위로 리스폰시킨다 (rounds 의 onRoundEnd 훅)
function resetForNewMap() {
  state.forEachPlayer(aiPlayers, function (aiPlayer) {
    respawnAiPlayer(aiPlayer);
  });
}

// ---------------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------------

// 서버 시작 시 최소 인원으로 시작하고, 이후 랜덤하게 입퇴장한다
function start() {
  for (let i = 0; i < config.AI_MIN_COUNT; i++) {
    createAiPlayer();
  }
  scheduleNextAiJoin();

  // AI 전체를 하나의 루프에서 처리 (봇마다 setInterval을 만들지 않는다)
  setInterval(function () {
    const now = Date.now();
    state.forEachPlayer(aiPlayers, function (aiPlayer) {
      if (!aiPlayer.isLeaving && now >= aiPlayer.leaveTime) {
        if (state.countPlayers(aiPlayers) <= config.AI_MIN_COUNT) {
          // 방이 너무 비면 잠시 더 머무른다
          aiPlayer.leaveTime = now + 60 * 1000;
        } else {
          startAiLeave(aiPlayer);
        }
      }
      aiProcess(aiPlayer, now);
    });
  }, 1000 / 60);
}

module.exports = {
  start,
  resetForNewMap,
};
