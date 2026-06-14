"use strict";

// 메인 진입점: WebSocket 연결 수락과 클라이언트 메시지 라우팅만 담당한다.
//
// 모듈 구성:
//  - config.js     모든 튜닝 상수
//  - state.js      공유 컬렉션(clients/aiPlayers)과 순회 헬퍼
//  - net.js        브로드캐스트/개별 전송
//  - chat-store.js 채팅 기록 보관/영속화
//  - combat.js     사격/근접/데미지/스폰 무적 (서버 권위)
//  - ai.js         AI 봇 FSM/입퇴장/이동
//  - items.js      아이템 스폰/획득
//  - rounds.js     라운드 타이머/킬스트릭 공지

const config = require("./config");
const state = require("./state");
const net = require("./net");
const chatStore = require("./chat-store");
const combat = require("./combat");
const ai = require("./ai");
const items = require("./items");
const monsters = require("./monsters");
const rounds = require("./rounds");
const mapHelper = require("./map-helper");

const wss = require("./websocket-server")(config.PORT);

let connectionCount = 0;

wss.on("connection", function connection(ws) {
  const id = "USER_" + connectionCount++;
  console.log("connection is established : " + id);

  const client = {
    ws: ws,
    id: id,
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    speedX: 0,
    speedY: 0,
    name: "",
    direction: 0,
    character: 0,
    weapon: "",
    kill: 0,
    death: 0,
    hp: 100.0,
    streak: 0,
    invincibleUntil: 0,
  };
  state.clients[id] = client;
  state.clients.push(id);

  // 접속 직후 스냅샷 전송.
  // round_info(현재 맵 포함)를 id보다 먼저 보내야 클라이언트가
  // 올바른 맵 위에서 첫 스폰(user_init)을 한다.
  net.sendTo(client, "round_info", {
    remainMs: rounds.getRemainMs(),
    map: mapHelper.getActiveMapName(),
  });
  net.sendTo(client, "user_chat_history", chatStore.getRecentChats());
  net.sendTo(client, "item_list", items.getItemsSnapshot());
  net.sendTo(client, "monster_list", monsters.getMonstersSnapshot());
  net.sendTo(client, "id", id);

  ws.on("message", function incoming(message) {
    let msg;
    try {
      msg = JSON.parse(message);
    } catch (error) {
      console.error("invalid message from " + id + ": " + error.message);
      return;
    }
    if (!msg || typeof msg.type !== "string") {
      return;
    }
    handleMessage(client, msg, message);
  });

  ws.on("close", function disconnection() {
    console.log("user " + id + " disconnected");
    delete state.clients[id];
    const index = state.clients.indexOf(id);
    if (index >= 0) {
      state.clients.splice(index, 1);
    }
    state.userCount--;
    net.broadcastUserCount();
    net.sendAll("user_disconnected", { id: id });
  });

  state.userCount++;
  net.broadcastUserCount();
});

// 접속 스냅샷/입장 알림에 쓰는 user_connected 페이로드
function buildPlayerSnapshot(player) {
  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    speedX: player.speedX,
    speedY: player.speedY,
    direction: player.direction,
    character: player.character,
    weapon: player.weapon,
    hp: player.hp,
    kill: player.kill,
    death: player.death,
    protectedMs: combat.getProtectedMs(player),
  };
}

function handleMessage(client, msg, rawMessage) {
  const id = client.id;

  switch (msg.type) {
    case "echo":
      client.ws.send(rawMessage);
      break;

    case "user_init":
      client.x = msg.data.x;
      client.y = msg.data.y;
      client.speedX = msg.data.speedX;
      client.speedY = msg.data.speedY;
      client.name = msg.data.name;
      client.direction = msg.data.direction;
      client.character = msg.data.character;
      client.weapon = msg.data.weapon;
      client.hp = 100.0;
      // 접속/리스폰 직후 스폰 무적 부여
      combat.grantSpawnProtection(client);

      net.sendAll("user_connected", buildPlayerSnapshot(client));

      // 본인에게 현재 접속 중인 모든 플레이어(사람 + AI) 스냅샷 전송
      state.forEachPlayer(state.clients, function (other) {
        net.sendTo(client, "user_connected", buildPlayerSnapshot(other));
      });
      state.forEachPlayer(state.aiPlayers, function (aiPlayer) {
        net.sendTo(client, "user_connected", buildPlayerSnapshot(aiPlayer));
      });
      break;

    case "user_position":
      client.x = msg.data.x;
      client.y = msg.data.y;
      // 이동 중에는 speed 로 보간하므로 멈췄을 때만 위치를 확정 전파한다
      if (client.speedX === 0 && client.speedY === 0) {
        net.sendAll("user_position", { id: id, x: client.x, y: client.y });
      }
      break;

    case "user_speed":
      client.speedX = msg.data.speedX;
      client.speedY = msg.data.speedY;
      net.sendAll("user_speed", {
        id: id,
        speedX: client.speedX,
        speedY: client.speedY,
      });
      break;

    case "user_name":
      client.name = msg.data.name;
      net.sendAll("user_name", { id: id, name: client.name });
      break;

    case "user_chat": {
      // XSS 방지를 위해 브로드캐스트 전에 이스케이프한다
      const chat = msg.data.chat.replace(/</gi, "&lt;").replace(/>/gi, "&gt;");
      if (chat.charAt(0) === "/") {
        // "/" 로 시작하는 메시지는 명령어로 예약 (아직 미구현)
        break;
      }
      const chatData = {
        id: id,
        name: client.name,
        chat: chat,
        date: Date.now(),
      };
      net.sendAll("user_chat", chatData);
      chatStore.append(chatData);
      break;
    }

    case "user_direction":
      client.direction = msg.data.direction;
      net.sendAll("user_direction", { id: id, direction: client.direction });
      break;

    case "user_character":
      client.character = msg.data.character;
      net.sendAll("user_character", { id: id, character: client.character });
      break;

    case "user_weapon":
      client.weapon = msg.data.weapon;
      net.sendAll("user_weapon", { id: id, weapon: client.weapon });
      break;

    case "user_shoot": {
      // targetPoints: 샷건은 펠릿별 탄도 배열, 그 외 무기는 1개짜리 배열
      const targetPoints = msg.data.targetPoints
        ? msg.data.targetPoints
        : [msg.data.targetPoint];
      for (let i = 0; i < targetPoints.length; i++) {
        combat.shootProcess(
          id,
          msg.data.weapon,
          "user",
          msg.data.muzzlePoint.x,
          msg.data.muzzlePoint.y,
          targetPoints[i].x,
          targetPoints[i].y,
        );
      }
      net.sendAll("user_shoot", {
        id: id,
        weapon: msg.data.weapon,
        muzzlePoint: msg.data.muzzlePoint,
        targetPoints: targetPoints,
        angle: msg.data.angle,
      });
      break;
    }

    case "user_melee_attack":
      combat.meleeAttackProcess(id, "user", msg.data.weapon);
      net.sendAll("user_melee_attack", { id: id, weapon: msg.data.weapon });
      break;

    case "user_reload":
      net.sendAll("user_reload", { id: id, weapon: msg.data.weapon });
      break;

    case "user_disconnected":
      net.sendAll("user_disconnected", { id: id });
      break;
  }
}

// 라운드가 끝나 활성 맵이 바뀌면 AI와 아이템을 새 맵 위로 재배치하고
// 진행 중이던 침공은 중단·정리한다(몬스터는 이전 맵 좌표계라 새 맵에 둘 수 없다)
rounds.onRoundEnd(function () {
  ai.resetForNewMap();
  items.resetForNewMap();
  monsters.resetForNewMap();
});

// 서브시스템 시작
ai.start();
items.start();
monsters.start();
rounds.start();
