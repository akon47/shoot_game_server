"use strict";

// PvE 침공: 스켈레톤 떼가 주기적으로 난입해 가장 가까운 플레이어(사람+봇)를 추격·접촉 공격한다.
// 몬스터는 100% 서버 권위이며 전용 monster_* 프로토콜로만 전파한다(user_* 와 섞지 않는다).
//
// 의존 방향(순환 회피):
//  - combat 은 monsters 를 require 하지 않는다. 사격이 몬스터를 맞히면 combat 은
//    몬스터 객체에 붙은 takeDamage 훅만 호출한다(ai 의 onDamaged 와 같은 패턴).
//  - 몬스터의 접촉 공격은 monsters -> combat.applyDamage 단방향으로 플레이어에게 데미지를 준다.

const config = require("./config");
const state = require("./state");
const net = require("./net");
const rounds = require("./rounds");
const combat = require("./combat");
const {
  getWalkableRandomPosition,
  setDestinationPath,
  isWalkablePosition,
} = require("./map-helper");
const { getDistance } = require("./utils");

const monsters = state.monsters;
let monsterIdCount = 0;

// 침공 진행 상태
let invasionActive = false;
let invasionEndTime = 0;
let spawnedAllWaves = false;

// ---------------------------------------------------------------------------
// 스폰 / 제거 / 피격
// ---------------------------------------------------------------------------

// 살아있는 플레이어와 일정 거리 이상 떨어진 스폰 위치를 찾는다(눈앞에 솟지 않게)
function getMonsterSpawnPosition() {
  for (let attempt = 0; attempt < 24; attempt++) {
    const position = getWalkableRandomPosition();
    let tooClose = false;
    state.forEachPlayer(state.clients, function (player) {
      if (
        player.hp > 0 &&
        getDistance(position.x, position.y, player.x, player.y) <
          config.MONSTER_SPAWN_MIN_DISTANCE
      ) {
        tooClose = true;
      }
    });
    if (!tooClose) {
      return position;
    }
  }
  return getWalkableRandomPosition();
}

function spawnMonster() {
  if (state.countPlayers(monsters) >= config.INVASION_MAX_ALIVE) {
    return;
  }
  const position = getMonsterSpawnPosition();
  const id = "MONSTER_" + monsterIdCount++;
  const monster = {
    id: id,
    x: position.x,
    y: position.y,
    width: 32,
    height: 32,
    hp: config.MONSTER_HP,
    maxHp: config.MONSTER_HP,
    direction: Math.random() * 360 - 180,
    destinationX: position.x,
    destinationY: position.y,
    movingPath: [],
    currentMovingPathIndex: 0,
    isPathMovingActive: false,
    lastAttackTime: 0,
    lastRepathTime: 0,
  };
  // combat.shootProcess 가 몬스터를 맞혔을 때 호출하는 훅
  monster.takeDamage = function (damage, shooterId) {
    damageMonster(monster, damage, shooterId);
  };

  monsters[id] = monster;
  monsters.push(id);

  net.sendAll("monster_spawn", {
    id: monster.id,
    x: Math.round(monster.x),
    y: Math.round(monster.y),
    hp: monster.hp,
    maxHp: monster.maxHp,
    direction: Math.round(monster.direction),
  });
}

function removeMonster(id) {
  if (!monsters[id]) {
    return;
  }
  delete monsters[id];
  const index = monsters.indexOf(id);
  if (index >= 0) {
    monsters.splice(index, 1);
  }
}

function damageMonster(monster, damage, shooterId) {
  if (monster.hp <= 0) {
    return;
  }
  monster.hp -= damage;
  if (monster.hp > 0) {
    net.sendAll("monster_hp", { id: monster.id, hp: monster.hp });
    return;
  }
  killMonster(monster, shooterId);
}

function killMonster(monster, shooterId) {
  removeMonster(monster.id);
  net.sendAll("monster_die", { id: monster.id });

  // 처치자에게 킬 점수/킬스트릭을 가산한다(몬스터 처치도 리더보드에 기여).
  // resolvePlayer 는 몬스터를 제외하므로 사람/봇만 크레딧을 받는다.
  const killer = shooterId ? state.resolvePlayer(shooterId) : undefined;
  if (killer && killer.hp > 0) {
    killer.kill += config.MONSTER_KILL_SCORE;
    net.sendAll("user_kill", { id: killer.id, kill: killer.kill });
    killer.streak = (killer.streak || 0) + 1;
    rounds.announceKill(killer, monster, 0);
  }

  checkInvasionCleared();
}

// ---------------------------------------------------------------------------
// 추격 / 공격 / 이동
// ---------------------------------------------------------------------------

// 벽을 무시하고(냄새로 추적) 가장 가까운 살아있는 플레이어를 고른다. 경로만 A* 로 우회한다.
function findNearestTarget(monster) {
  const centerX = monster.x + monster.width / 2;
  const centerY = monster.y + monster.height / 2;
  let best = undefined;
  let bestDistance = config.MONSTER_SIGHT_RANGE;

  function consider(player) {
    if (player.hp <= 0) {
      return;
    }
    const distance = getDistance(
      centerX,
      centerY,
      player.x + player.width / 2,
      player.y + player.height / 2,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = player;
    }
  }
  state.forEachPlayer(state.clients, consider);
  state.forEachPlayer(state.aiPlayers, consider);
  return best;
}

function stepMonster(monster) {
  if (monster.x !== monster.destinationX || monster.y !== monster.destinationY) {
    const distance = getDistance(
      monster.x,
      monster.y,
      monster.destinationX,
      monster.destinationY,
    );
    if (config.MONSTER_MOVE_SPEED >= distance) {
      monster.x = monster.destinationX;
      monster.y = monster.destinationY;
    } else {
      const radian = Math.atan2(
        monster.destinationY - monster.y,
        monster.destinationX - monster.x,
      );
      monster.x += Math.cos(radian) * config.MONSTER_MOVE_SPEED;
      monster.y += Math.sin(radian) * config.MONSTER_MOVE_SPEED;
      monster.direction = (radian / Math.PI) * 180;
    }
  } else if (monster.isPathMovingActive) {
    monster.currentMovingPathIndex++;
    if (monster.currentMovingPathIndex < monster.movingPath.length) {
      monster.destinationX = monster.movingPath[monster.currentMovingPathIndex].x;
      monster.destinationY = monster.movingPath[monster.currentMovingPathIndex].y;
    } else {
      monster.isPathMovingActive = false;
    }
  }
}

// 몬스터끼리 완전히 겹치지 않도록 가볍게 밀어낸다
function separate(monster) {
  let pushX = 0;
  let pushY = 0;
  const centerX = monster.x + monster.width / 2;
  const centerY = monster.y + monster.height / 2;

  state.forEachPlayer(monsters, function (other) {
    if (other.id === monster.id) {
      return;
    }
    const distance = getDistance(
      centerX,
      centerY,
      other.x + other.width / 2,
      other.y + other.height / 2,
    );
    if (distance >= config.MONSTER_BODY_DISTANCE || distance < 0.001) {
      return;
    }
    const angle = Math.atan2(
      centerY - (other.y + other.height / 2),
      centerX - (other.x + other.width / 2),
    );
    const strength = (config.MONSTER_BODY_DISTANCE - distance) / 2;
    pushX += Math.cos(angle) * strength;
    pushY += Math.sin(angle) * strength;
  });

  if (pushX === 0 && pushY === 0) {
    return;
  }
  const newX = monster.x + pushX;
  const newY = monster.y + pushY;
  if (isWalkablePosition(newX + monster.width / 2, newY + monster.height / 2)) {
    monster.x = newX;
    monster.y = newY;
  }
}

function processMonster(monster, now) {
  const target = findNearestTarget(monster);
  if (!target) {
    return;
  }
  const centerX = monster.x + monster.width / 2;
  const centerY = monster.y + monster.height / 2;
  const targetX = target.x + target.width / 2;
  const targetY = target.y + target.height / 2;
  const distance = getDistance(centerX, centerY, targetX, targetY);

  if (distance <= config.MONSTER_ATTACK_RANGE) {
    // 사거리 안: 멈춰서 타겟을 보고 쿨다운마다 접촉 공격
    monster.destinationX = monster.x;
    monster.destinationY = monster.y;
    monster.isPathMovingActive = false;
    monster.direction =
      (Math.atan2(targetY - centerY, targetX - centerX) / Math.PI) * 180;

    if (now - monster.lastAttackTime >= config.MONSTER_ATTACK_INTERVAL) {
      monster.lastAttackTime = now;
      net.sendAll("monster_attack", { id: monster.id });
      combat.applyDamage(
        target,
        config.MONSTER_ATTACK_DAMAGE,
        "monster",
        monster.id,
        "melee",
      );
    }
    return;
  }

  // 사거리 밖: 주기적으로 타겟 위치로 경로를 다시 계산하며 추격
  if (
    now - monster.lastRepathTime >= config.MONSTER_REPATH_INTERVAL ||
    !monster.isPathMovingActive
  ) {
    monster.lastRepathTime = now;
    setDestinationPath(monster, { x: targetX, y: targetY });
    // 같은 타일이라 경로가 비면 직선으로 다가간다
    if (!monster.movingPath || monster.movingPath.length === 0) {
      monster.destinationX = targetX;
      monster.destinationY = targetY;
      monster.isPathMovingActive = false;
    }
  }
  stepMonster(monster);
}

// ---------------------------------------------------------------------------
// 침공 디렉터
// ---------------------------------------------------------------------------

function combatantCount() {
  return state.userCount + state.countPlayers(state.aiPlayers);
}

function spawnWave(index) {
  if (!invasionActive) {
    return;
  }
  const count =
    config.INVASION_BASE_COUNT +
    combatantCount() * config.INVASION_PER_COMBATANT;
  for (let i = 0; i < count; i++) {
    spawnMonster();
  }
  if (index + 1 < config.INVASION_WAVES) {
    setTimeout(function () {
      spawnWave(index + 1);
    }, config.INVASION_WAVE_INTERVAL);
  } else {
    spawnedAllWaves = true;
  }
}

function startInvasion() {
  if (invasionActive) {
    return;
  }
  invasionActive = true;
  spawnedAllWaves = false;
  invasionEndTime =
    Date.now() + config.INVASION_WARN_DELAY + config.INVASION_DURATION_MAX;
  net.sendServerNotice("invasion_incoming", {});
  setTimeout(function () {
    spawnWave(0);
  }, config.INVASION_WARN_DELAY);
}

function clearAllMonsters() {
  const ids = monsters.slice(); // 숫자 인덱스 부분이 곧 id 목록
  for (let i = 0; i < ids.length; i++) {
    removeMonster(ids[i]);
    net.sendAll("monster_die", { id: ids[i] });
  }
}

function endInvasion(cleared) {
  if (!invasionActive) {
    return;
  }
  invasionActive = false;
  spawnedAllWaves = false;
  clearAllMonsters();
  if (cleared) {
    net.sendServerNotice("invasion_cleared", {});
  }
}

// 모든 웨이브가 등장한 뒤 몬스터가 전멸하면 침공을 종료한다(killMonster 에서 호출)
function checkInvasionCleared() {
  if (
    invasionActive &&
    spawnedAllWaves &&
    state.countPlayers(monsters) === 0
  ) {
    endInvasion(true);
  }
}

function scheduleNextInvasion() {
  const delay =
    config.INVASION_INTERVAL_MIN +
    Math.random() *
      (config.INVASION_INTERVAL_MAX - config.INVASION_INTERVAL_MIN);
  setTimeout(function () {
    startInvasion();
    scheduleNextInvasion();
  }, delay);
}

// ---------------------------------------------------------------------------
// 외부 인터페이스
// ---------------------------------------------------------------------------

// 접속 시 클라이언트에게 보낼 현재 몬스터 스냅샷
function getMonstersSnapshot() {
  const list = [];
  state.forEachPlayer(monsters, function (monster) {
    list.push({
      id: monster.id,
      x: Math.round(monster.x),
      y: Math.round(monster.y),
      hp: monster.hp,
      maxHp: monster.maxHp,
      direction: Math.round(monster.direction),
    });
  });
  return list;
}

// 라운드 맵 교체 시 침공을 중단하고 몬스터를 모두 정리한다(rounds 의 onRoundEnd 훅)
function resetForNewMap() {
  invasionActive = false;
  spawnedAllWaves = false;
  clearAllMonsters();
}

function start() {
  scheduleNextInvasion();

  // 모든 몬스터를 하나의 30fps 루프에서 처리하고, 위치는 한 번에 묶어 전파한다
  setInterval(function () {
    const now = Date.now();
    if (invasionActive && now >= invasionEndTime) {
      endInvasion(false);
    }
    if (state.countPlayers(monsters) === 0) {
      return;
    }
    const positions = [];
    state.forEachPlayer(monsters, function (monster) {
      processMonster(monster, now);
      separate(monster);
      positions.push({
        id: monster.id,
        x: Math.round(monster.x),
        y: Math.round(monster.y),
        direction: Math.round(monster.direction),
      });
    });
    if (positions.length > 0) {
      net.sendAll("monster_positions", positions);
    }
  }, 1000 / 30);
}

module.exports = {
  start,
  getMonstersSnapshot,
  resetForNewMap,
};
