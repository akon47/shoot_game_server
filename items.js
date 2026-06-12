"use strict";

// 아이템(메드킷/탄약 상자) 시스템. 스폰과 획득 판정 모두 서버 권위로 처리한다.
// 탄약은 클라이언트가 관리하므로 획득자에게 ammo_refill 신호만 보낸다.

const config = require("./config");
const state = require("./state");
const net = require("./net");
const { getWalkableRandomPosition } = require("./map-helper");
const { getDistance } = require("./utils");

const items = {}; // id -> { id, type, x, y }
let itemIdCount = 0;

// 접속 시 클라이언트에게 보낼 현재 아이템 목록
function getItemsSnapshot() {
  return Object.keys(items).map((id) => items[id]);
}

function spawnItem() {
  if (Object.keys(items).length >= config.ITEM_MAX_COUNT) {
    return;
  }
  const type = Math.random() < 0.5 ? "medkit" : "ammo";
  const position = getWalkableRandomPosition();
  const id = "ITEM_" + itemIdCount++;
  items[id] = { id: id, type: type, x: position.x, y: position.y };
  net.sendAll("item_spawn", items[id]);
}

function scheduleNextItemSpawn() {
  const delay =
    config.ITEM_SPAWN_INTERVAL_MIN +
    Math.random() *
      (config.ITEM_SPAWN_INTERVAL_MAX - config.ITEM_SPAWN_INTERVAL_MIN);
  setTimeout(function () {
    spawnItem();
    scheduleNextItemSpawn();
  }, delay);
}

function pickupItem(item, player, playerKind) {
  delete items[item.id];
  net.sendAll("item_picked", { id: item.id, by: player.id, type: item.type });

  if (item.type === "medkit") {
    player.hp = Math.min(100, player.hp + config.ITEM_MEDKIT_HEAL);
    net.sendAll("user_hp", { id: player.id, hp: player.hp });
  } else if (item.type === "ammo" && playerKind === "user") {
    net.sendTo(player, "ammo_refill", {});
  }
}

function isInPickupRange(item, player) {
  return (
    getDistance(
      item.x + 16,
      item.y + 16,
      player.x + player.width / 2,
      player.y + player.height / 2,
    ) < config.ITEM_PICKUP_DISTANCE
  );
}

function checkItemPickups() {
  const itemIds = Object.keys(items);
  for (let i = 0; i < itemIds.length; i++) {
    const item = items[itemIds[i]];
    if (!item) {
      continue;
    }

    let picked = false;
    state.forEachPlayer(state.clients, function (client) {
      if (picked || client.hp <= 0) {
        return;
      }
      // 메드킷은 체력이 닳은 플레이어만 획득한다 (만피 낭비 방지)
      if (item.type === "medkit" && client.hp >= 100) {
        return;
      }
      if (isInPickupRange(item, client)) {
        pickupItem(item, client, "user");
        picked = true;
      }
    });
    if (picked) {
      continue;
    }

    // AI는 체력이 닳았을 때 메드킷만 줍는다 (탄약은 의미 없음)
    if (item.type === "medkit") {
      state.forEachPlayer(state.aiPlayers, function (aiPlayer) {
        if (picked || aiPlayer.hp <= 0 || aiPlayer.hp >= 100) {
          return;
        }
        if (isInPickupRange(item, aiPlayer)) {
          pickupItem(item, aiPlayer, "ai");
          picked = true;
        }
      });
    }
  }
}

// 서버 시작 시 일부 아이템을 미리 깔아두고, 이후 랜덤 간격으로 보충한다
function start() {
  for (let i = 0; i < config.ITEM_INITIAL_COUNT; i++) {
    spawnItem();
  }
  scheduleNextItemSpawn();
  setInterval(checkItemPickups, 100);
}

module.exports = {
  start,
  getItemsSnapshot,
};
