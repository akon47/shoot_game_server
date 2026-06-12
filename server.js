const fs = require("fs");
const path = require("path");
const { shootIntersection, getDistance } = require("./utils.js");
const {
  getWalkableRandomPosition,
  setRandomDestinationPath,
  setDestinationPath,
  isWalkablePosition,
  mapSegments,
} = require("./map-helper.js");

//웹소켓 서버 생성
const wss = require("./websocket-server")(8080);
const dataPath = path.join(__dirname, "datas");
const chatFilePath = path.join(dataPath, "user_chats.json");
if(!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath, { recursive: true });
}
if(!fs.existsSync(chatFilePath)) {
  fs.writeFileSync(chatFilePath, "");
}

var connectionCount = 0;
var clients = [];
var userCount = 0;

var aiPlayers = [];
var aiIdCount = 0;

// AI 동작 파라미터
const AI_SIGHT_RANGE = 700; // 시야 거리(px)
const AI_ATTACK_RANGE = 380; // 이 거리 안이면 정지 후 사격
const AI_ATTACK_RANGE_BUFFER = 80; // attack -> chase 전환 히스테리시스(px)
const AI_RETREAT_RANGE = 120; // 타겟이 이 거리보다 가까우면 거리 벌리기
const AI_REPATH_INTERVAL = 300; // A* 경로 재계산 최소 간격(ms)
const AI_TARGET_LOST_TIMEOUT = 2500; // 타겟을 시야에서 놓친 후 추격 포기까지(ms)
const AI_LAST_SEEN_ARRIVE_DISTANCE = 48; // 마지막 목격 지점 도착 판정 거리(px)
const AI_SHOOT_INTERVAL = 400; // 사격 간격(ms)
const AI_SHOOT_FACING_TOLERANCE = 25; // 타겟 방향과 이 각도(도) 이내일 때만 사격
const AI_MOVE_SPEED = 3; // 프레임당 이동량(px)
const AI_BODY_DISTANCE = 32; // 플레이어끼리 유지해야 하는 최소 중심 거리(px)
const AI_SPAWN_MIN_DISTANCE = 200; // 스폰 시 다른 플레이어와 최소 거리(px)

// AI 입퇴장(인구) 파라미터
const AI_MAX_COUNT = 10; // 동시 접속 AI 최대 수
const AI_MIN_COUNT = 2; // 방이 비지 않도록 유지할 최소 수
const AI_JOIN_INTERVAL_MIN = 20 * 1000; // 다음 입장 시도까지 최소 간격(ms)
const AI_JOIN_INTERVAL_MAX = 80 * 1000; // 다음 입장 시도까지 최대 간격(ms)
const AI_STAY_DURATION_MIN = 2 * 60 * 1000; // 입장 후 머무는 최소 시간(ms)
const AI_STAY_DURATION_MAX = 7 * 60 * 1000; // 입장 후 머무는 최대 시간(ms)
const AI_GREETING_CHANCE = 0.4; // 입장 시 인사 채팅 확률
const AI_FAREWELL_CHANCE = 0.35; // 퇴장 전 작별 채팅 확률

const aiNamePool = [
  "초코우유",
  "감자튀김",
  "야근중",
  "총잡이김씨",
  "옆집형",
  "고양이발바닥",
  "롤하다옴",
  "서울촌놈",
  "물복숭아",
  "겜잘알",
  "닉네임뭐하지",
  "불꽃남자",
  "피곤한직장인",
  "김밥천국",
  "달리는거북이",
  "Shadow",
  "nova7",
  "PewPew",
  "Ghost99",
  "mango",
  "Rookie",
  "headshot_kim",
  "ZeroCool",
  "BlueBerry",
  "xXSniperXx",
  "lucky",
  "DancingPotato",
  "Bro",
  "Ballmer",
];

const aiGreetings = [
  "ㅎㅇ",
  "ㅎㅇㅎㅇ",
  "안녕하세요",
  "hi",
  "hello~",
  "왔습니다",
  "다들 ㅎㅇ",
];

const aiFarewells = [
  "ㅂㅂ",
  "전 이만",
  "bye",
  "gg",
  "밥먹으러 갑니다",
  "잘있어요~",
  "나중에 또 봐요",
];

const aiWeapons = ["handgun", "rifle", "shotgun"];

let userChats = JSON.parse(`[${fs.readFileSync(chatFilePath).toString().trim().replace(/(^,)|(,$)/g, "")}]`);
userChats = userChats.splice(-100);

wss.on("connection", function connection(ws) {
  const id = "USER_" + connectionCount++;

  console.log("connection is established : " + id);
  clients[id] = [];
  clients[id].ws = ws;
  clients[id].id = id;
  clients[id].x = 0;
  clients[id].y = 0;
  clients[id].width = 32;
  clients[id].height = 32;
  clients[id].speedX = 0;
  clients[id].speedY = 0;
  clients[id].name = "";
  clients[id].direction = 0;
  clients[id].character = 0;
  clients[id].weapon = "";
  clients[id].kill = 0;
  clients[id].death = 0;
  clients[id].hp = 100.0;
  clients.push(id);

  ws.send(JSON.stringify({ type: "id", data: id }));

  ws.send(
    JSON.stringify({
      type: "user_chat_history",
      data: userChats,
    })
  );

  ws.on("message", function incoming(message) {
    var msg = JSON.parse(message);
    switch (msg.type) {
      case "echo":
        ws.send(message);
        break;
      case "user_init":
        clients[id].x = msg.data.x;
        clients[id].y = msg.data.y;
        clients[id].speedX = msg.data.speedX;
        clients[id].speedY = msg.data.speedY;
        clients[id].name = msg.data.name;
        clients[id].direction = msg.data.direction;
        clients[id].character = msg.data.character;
        clients[id].weapon = msg.data.weapon;
        clients[id].hp = 100.0;
        sendAll("user_connected", {
          id: id,
          name: msg.data.name,
          x: msg.data.x,
          y: msg.data.y,
          speedX: msg.data.speedX,
          speedY: msg.data.speedY,
          direction: msg.data.direction,
          character: msg.data.character,
          weapon: msg.data.weapon,
          kill: clients[id].kill,
          death: clients[id].death,
          hp: 100.0,
        });

        for (let i = 0; i < clients.length; i++) {
          const client = clients[clients[i]];
          if (client !== undefined) {
            ws.send(
              JSON.stringify({
                type: "user_connected",
                data: {
                  id: client.id,
                  name: client.name,
                  x: client.x,
                  y: client.y,
                  speedX: client.speedX,
                  speedY: client.speedY,
                  direction: client.direction,
                  character: client.character,
                  weapon: client.weapon,
                  hp: client.hp,
                  kill: client.kill,
                  death: client.death,
                },
              })
            );
          }
        }

        for (let i = 0; i < aiPlayers.length; i++) {
          const aiPlayer = aiPlayers[aiPlayers[i]];
          if (aiPlayer !== undefined) {
            ws.send(
              JSON.stringify({
                type: "user_connected",
                data: {
                  id: aiPlayer.id,
                  name: aiPlayer.name,
                  x: aiPlayer.x,
                  y: aiPlayer.y,
                  speedX: aiPlayer.speedX,
                  speedY: aiPlayer.speedY,
                  direction: aiPlayer.direction,
                  character: aiPlayer.character,
                  weapon: aiPlayer.weapon,
                  hp: aiPlayer.hp,
                  kill: aiPlayer.kill,
                  death: aiPlayer.death,
                },
              })
            );
          }
        }

        break;
      case "user_position":
        clients[id].x = msg.data.x;
        clients[id].y = msg.data.y;
        if (clients[id].speedX === 0 && clients[id].speedY === 0) {
          sendAll("user_position", { id: id, x: msg.data.x, y: msg.data.y });
        }
        break;
      case "user_speed":
        clients[id].speedX = msg.data.speedX;
        clients[id].speedY = msg.data.speedY;
        sendAll("user_speed", {
          id: id,
          speedX: msg.data.speedX,
          speedY: msg.data.speedY,
        });
        break;
      case "user_name":
        clients[id].name = msg.data.name;
        sendAll("user_name", { id: id, name: msg.data.name });
        break;
      case "user_chat":
        msg.data.chat = msg.data.chat.replace(/</gi, "&lt;").replace(/>/gi, "&gt;");
        if (msg.data.chat.charAt(0) === "/") {
          //runCommand(msg.data.chat.substring(1));
        } else {
          const chatData = {
            id: id,
            name: clients[id].name,
            chat: msg.data.chat,
            date: Date.now(),
          };
          sendAll("user_chat", chatData);
          userChats.push(chatData);
          fs.appendFile(chatFilePath, `${JSON.stringify(chatData)},\n`, (err) => {
	  });
          if (userChats.length >= 100) {
            userChats = userChats.splice(-100);
          }
        }
        break;
      case "user_direction":
        clients[id].direction = msg.data.direction;
        sendAll("user_direction", { id: id, direction: msg.data.direction });
        break;
      case "user_character":
        clients[id].character = msg.data.character;
        sendAll("user_character", { id: id, character: msg.data.character });
        break;
      case "user_weapon":
        clients[id].weapon = msg.data.weapon;
        sendAll("user_weapon", { id: id, weapon: msg.data.weapon });
        break;
      case "user_shoot":
        //console.log("ID: " + id + " -> " + message);
        shootProcess(
          id,
          msg.data.weapon,
          "user",
          msg.data.muzzlePoint.x,
          msg.data.muzzlePoint.y,
          msg.data.targetPoint.x,
          msg.data.targetPoint.y
        );
        sendAll("user_shoot", {
          id: id,
          weapon: msg.data.weapon,
          muzzlePoint: msg.data.muzzlePoint,
          targetPoint: msg.data.targetPoint,
          angle: msg.data.angle,
        });
        break;
      case "user_disconnected":
        sendAll("user_disconnected", { id: id });
        break;
    }
  });

  ws.on("close", function disconnection() {
    console.log("user " + id + " disconnected");
    delete clients[id];
    userCount--;
    broadcastUserCount();
    sendAll("user_disconnected", { id: id });
  });

  userCount++;
  broadcastUserCount();
});

function shootProcess(
  id,
  weapon,
  provider,
  muzzleX,
  muzzleY,
  targetX,
  targetY
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
  let minDistance = 1000000000;

  for (let j = 0; j < clients.length; j++) {
    const client = clients[clients[j]];
    if (client && client.id !== id) {
      if (
        bulletBox.left < client.x + client.width &&
        bulletBox.right > client.x &&
        bulletBox.top < client.y + client.height &&
        bulletBox.bottom > client.y
      ) {
        const intersection = shootIntersection(
          p1,
          p2,
          client.x + client.width / 2,
          client.y + client.height / 2,
          16
        );
        if (intersection) {
          const distance =
            Math.pow(intersection.x - p1.x, 2) +
            Math.pow(intersection.y - p1.y, 2);
          if (distance < minDistance) {
            minDistance = distance;
            hitObject = client;
            hitObjectType = "user";
          }
        }
      }
    }
  }

  for (let j = 0; j < aiPlayers.length; j++) {
    const aiPlayer = aiPlayers[aiPlayers[j]];
    if (aiPlayer) {
      if (
        bulletBox.left < aiPlayer.x + aiPlayer.width &&
        bulletBox.right > aiPlayer.x &&
        bulletBox.top < aiPlayer.y + aiPlayer.height &&
        bulletBox.bottom > aiPlayer.y
      ) {
        const intersection = shootIntersection(
          p1,
          p2,
          aiPlayer.x + aiPlayer.width / 2,
          aiPlayer.y + aiPlayer.height / 2,
          16
        );
        if (intersection) {
          const distance =
            Math.pow(intersection.x - p1.x, 2) +
            Math.pow(intersection.y - p1.y, 2);
          if (distance < minDistance) {
            minDistance = distance;
            hitObject = aiPlayer;
            hitObjectType = "ai";
          }
        }
      }
    }
  }

  if (hitObject && hitObjectType) {
    if (hitObject.hp) {
      switch (weapon) {
        case "handgun":
          hitObject.hp -= 10;
          break;
        case "rifle":
          hitObject.hp -= 15;
          break;
        case "shotgun":
          hitObject.hp -= 8;
          break;
      }
      if (hitObject.hp <= 0) {
        hitObject.hp = 0;

        switch (hitObjectType) {
          case "user":
            sendAll("user_die", {
              id: hitObject.id,
              reason: { provider: provider, provider_id: id, weapon: weapon },
            });
            console.log("user_die: " + hitObject.id);

            if (provider === "user" && clients[id]) {
              clients[id].kill++;
              sendAll("user_kill", { id: id, kill: clients[id].kill });
            } else if (provider === "ai" && aiPlayers[id]) {
              aiPlayers[id].kill++;
              resetToRoam(aiPlayers[id]);
              sendAll("user_kill", { id: id, kill: aiPlayers[id].kill });
            }
            hitObject.death++;
            sendAll("user_death", { id: hitObject.id, death: hitObject.death });

            break;
          case "ai":
            sendAll("user_die", {
              id: hitObject.id,
              reason: { provider: provider, provider_id: id, weapon: weapon },
            });
            console.log("ai_die: " + hitObject.id);

            if (provider === "user" && clients[id]) {
              clients[id].kill++;
              sendAll("user_kill", { id: id, kill: clients[id].kill });
            } else if (provider === "ai" && aiPlayers[id]) {
              aiPlayers[id].kill++;
              resetToRoam(aiPlayers[id]);
              sendAll("user_kill", { id: id, kill: aiPlayers[id].kill });
            }

            hitObject.hp = 100.0;
            const position = getAiSpawnPosition();
            hitObject.x = position.x;
            hitObject.y = position.y;
            hitObject.destinationX = position.x;
            hitObject.destinationY = position.y;
            hitObject.isPathMovingActive = false;
            hitObject.fsm.state = "roam";
            hitObject.fsm.targetId = undefined;
            hitObject.death++;
            sendAll("user_connected", {
              id: hitObject.id,
              name: hitObject.name,
              x: hitObject.x,
              y: hitObject.y,
              speedX: hitObject.speedX,
              speedY: hitObject.speedY,
              direction: hitObject.direction,
              character: hitObject.character,
              weapon: hitObject.weapon,
              kill: hitObject.kill,
              death: hitObject.death,
              hp: 100.0,
            });
            sendAll("user_death", { id: hitObject.id, death: hitObject.death });
            break;
        }
      } else {
        switch (hitObjectType) {
          case "user":
          case "ai":
            sendAll("user_hp", { id: hitObject.id, hp: hitObject.hp });
            break;
        }
        // AI가 공격받으면 공격자에게 어그로
        if (hitObjectType === "ai") {
          aiAggro(hitObject, id);
        }
      }
    }
  }
}

function sendAll(type, data) {
  var msg = {
    type: type,
    data: data,
  };

  for (var j = 0; j < clients.length; j++) {
    const client = clients[clients[j]];
    if (client) {
      client.ws.send(JSON.stringify(msg));
    }
  }
}

function runCommand(command) {
  console.log("command: " + command);

  var args = command.split(" ");
  if (args && args.length > 0) {
    switch (args[0]) {
    }
  }
}

// 다른 플레이어와 일정 거리 이상 떨어진 스폰 위치를 찾는다 (겹친 채 스폰 방지)
function getAiSpawnPosition() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const position = getWalkableRandomPosition();
    let tooClose = false;
    for (let i = 0; i < clients.length; i++) {
      const client = clients[clients[i]];
      if (
        client &&
        getDistance(position.x, position.y, client.x, client.y) <
          AI_SPAWN_MIN_DISTANCE
      ) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      for (let i = 0; i < aiPlayers.length; i++) {
        const aiPlayer = aiPlayers[aiPlayers[i]];
        if (
          aiPlayer &&
          getDistance(position.x, position.y, aiPlayer.x, aiPlayer.y) <
            AI_SPAWN_MIN_DISTANCE
        ) {
          tooClose = true;
          break;
        }
      }
    }
    if (!tooClose) {
      return position;
    }
  }
  return getWalkableRandomPosition();
}

function getAiCount() {
  let count = 0;
  for (let i = 0; i < aiPlayers.length; i++) {
    if (aiPlayers[aiPlayers[i]]) {
      count++;
    }
  }
  return count;
}

// 접속자 수는 실제 유저 + AI 합산으로 보내서 AI도 사람처럼 보이게 한다
function broadcastUserCount() {
  sendAll("user_count", userCount + getAiCount());
}

// 현재 사용 중이지 않은 이름을 랜덤으로 고른다
function pickAiName() {
  const inUse = {};
  for (let i = 0; i < aiPlayers.length; i++) {
    const aiPlayer = aiPlayers[aiPlayers[i]];
    if (aiPlayer) {
      inUse[aiPlayer.name] = true;
    }
  }
  const candidates = aiNamePool.filter((name) => !inUse[name]);
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
  sendAll("user_chat", chatData);
  userChats.push(chatData);
  fs.appendFile(chatFilePath, `${JSON.stringify(chatData)},\n`, (err) => {
  });
  if (userChats.length >= 100) {
    userChats = userChats.splice(-100);
  }
}

function createAiPlayer(name) {
  const position = getAiSpawnPosition();

  var id = "AI_" + aiIdCount++;
  aiPlayers[id] = [];
  aiPlayers[id].id = id;
  aiPlayers[id].x = position.x;
  aiPlayers[id].y = position.y;
  aiPlayers[id].width = 32;
  aiPlayers[id].height = 32;
  aiPlayers[id].speedX = 0;
  aiPlayers[id].speedY = 0;
  aiPlayers[id].destinationX = aiPlayers[id].x;
  aiPlayers[id].destinationY = aiPlayers[id].y;
  aiPlayers[id].name = name ? name : pickAiName();
  aiPlayers[id].direction = 0;
  // 사람처럼 보이도록 캐릭터와 무기를 랜덤으로 고른다
  aiPlayers[id].character = Math.floor(Math.random() * 100);
  aiPlayers[id].weapon = aiWeapons[Math.floor(Math.random() * aiWeapons.length)];
  aiPlayers[id].hp = 100.0;
  aiPlayers[id].kill = 0;
  aiPlayers[id].death = 0;
  aiPlayers[id].lastShootTime = 0;
  aiPlayers[id].isLeaving = false;
  aiPlayers[id].leaveTime =
    Date.now() +
    AI_STAY_DURATION_MIN +
    Math.random() * (AI_STAY_DURATION_MAX - AI_STAY_DURATION_MIN);
  aiPlayers[id].fsm = {
    state: "roam", // roam: 배회, chase: 추격/수색, attack: 정지 후 사격
    targetId: undefined, // 타겟은 객체 참조 대신 id로 보관 (끊긴 유저 추격 방지)
    lastSeenX: position.x, // 타겟을 마지막으로 목격한 위치
    lastSeenY: position.y,
    lastSeenTime: 0,
    lastRepathTime: 0,
  };
  aiPlayers.push(id);

  console.log("ai " + id + " (" + aiPlayers[id].name + ") joined");

  sendAll("user_connected", {
    id: id,
    name: aiPlayers[id].name,
    x: aiPlayers[id].x,
    y: aiPlayers[id].y,
    speedX: aiPlayers[id].speedX,
    speedY: aiPlayers[id].speedY,
    direction: aiPlayers[id].direction,
    character: aiPlayers[id].character,
    weapon: aiPlayers[id].weapon,
    kill: aiPlayers[id].kill,
    death: aiPlayers[id].death,
    hp: 100.0,
  });
  broadcastUserCount();

  // 입장 후 잠시 뒤에 가끔 인사를 한다
  if (Math.random() < AI_GREETING_CHANCE) {
    setTimeout(function () {
      if (aiPlayers[id]) {
        sendAiChat(
          aiPlayers[id],
          aiGreetings[Math.floor(Math.random() * aiGreetings.length)]
        );
      }
    }, 1500 + Math.random() * 3000);
  }
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
  sendAll("user_disconnected", { id: id });
  broadcastUserCount();
}

// 머무는 시간이 끝난 AI를 퇴장시킨다 (가끔 작별 인사 후 잠시 뒤에 나간다)
function startAiLeave(aiPlayer) {
  aiPlayer.isLeaving = true;
  if (Math.random() < AI_FAREWELL_CHANCE) {
    sendAiChat(
      aiPlayer,
      aiFarewells[Math.floor(Math.random() * aiFarewells.length)]
    );
  }
  setTimeout(function () {
    removeAiPlayer(aiPlayer.id);
  }, 1000 + Math.random() * 2000);
}

// 랜덤 간격으로 새 AI 입장 시도
function scheduleNextAiJoin() {
  const delay =
    AI_JOIN_INTERVAL_MIN +
    Math.random() * (AI_JOIN_INTERVAL_MAX - AI_JOIN_INTERVAL_MIN);
  setTimeout(function () {
    if (getAiCount() < AI_MAX_COUNT) {
      createAiPlayer();
    }
    scheduleNextAiJoin();
  }, delay);
}

// 서버 시작 시 최소 인원으로 시작하고, 이후 랜덤하게 입퇴장한다
for (let i = 0; i < AI_MIN_COUNT; i++) {
  createAiPlayer();
}
scheduleNextAiJoin();

// AI 전체를 하나의 루프에서 처리 (봇마다 setInterval을 만들지 않는다)
setInterval(function () {
  const now = Date.now();
  for (let i = 0; i < aiPlayers.length; i++) {
    const aiPlayer = aiPlayers[aiPlayers[i]];
    if (aiPlayer) {
      if (!aiPlayer.isLeaving && now >= aiPlayer.leaveTime) {
        if (getAiCount() <= AI_MIN_COUNT) {
          // 방이 너무 비면 잠시 더 머무른다
          aiPlayer.leaveTime = now + 60 * 1000;
        } else {
          startAiLeave(aiPlayer);
        }
      }
      aiProcess(aiPlayer, now);
    }
  }
}, 1000 / 60);

function getPlayersInSight(player, range) {
  function getRayIntersection(ray, segment) {
    // RAY in parametric: Point + Direction*T1
    var r_px = ray.a.x;
    var r_py = ray.a.y;
    var r_dx = ray.b.x - ray.a.x;
    var r_dy = ray.b.y - ray.a.y;

    // SEGMENT in parametric: Point + Direction*T2
    var s_px = segment.a.x;
    var s_py = segment.a.y;
    var s_dx = segment.b.x - segment.a.x;
    var s_dy = segment.b.y - segment.a.y;

    // 두 선이 평행하다면 접점 존재하지 않음.
    var r_mag = Math.sqrt(r_dx * r_dx + r_dy * r_dy);
    var s_mag = Math.sqrt(s_dx * s_dx + s_dy * s_dy);
    if (r_dx / r_mag == s_dx / s_mag && r_dy / r_mag == s_dy / s_mag) {
      // 기울기 같음
      return null;
    }

    // SOLVE FOR T1 & T2
    var T2 =
      (r_dx * (s_py - r_py) + r_dy * (r_px - s_px)) /
      (s_dx * r_dy - s_dy * r_dx);
    var T1 = (s_px + s_dx * T2 - r_px) / r_dx;

    // Must be within parametic whatevers for RAY/SEGMENT
    if (T1 < 0) return null;
    if (T2 < 0 || T2 > 1) return null;

    // Return the POINT OF INTERSECTION
    return {
      x: r_px + r_dx * T1,
      y: r_py + r_dy * T1,
      param: T1,
    };
  }

  const rayX = player.x + player.width / 2;
  const rayY = player.y + player.height / 2;

  // Get all angles
  let uniqueAngles = [];

  let startAngle = (Math.PI / 180) * (-55 + (player.direction % 360));
  let endAngle = (Math.PI / 180) * (55 + (player.direction % 360));
  if (startAngle < -Math.PI) {
    startAngle += Math.PI * 2;
  }
  if (endAngle > Math.PI) {
    endAngle -= Math.PI * 2;
  }

  for (let j = 0; j < clients.length; j++) {
    const client = clients[clients[j]];
    if (client && client.id !== player.id) {
      const clientCenterX = client.x + client.width / 2;
      const clientCenterY = client.y + client.height / 2;

      const distance = getDistance(rayX, rayY, clientCenterX, clientCenterY);
      if (distance < range) {
        const angle = Math.atan2(clientCenterY - rayY, clientCenterX - rayX);
        uniqueAngles.push({ angle: angle, distance: distance, target: client });
      }
    }
  }

  for (let j = 0; j < aiPlayers.length; j++) {
    const aiPlayer = aiPlayers[aiPlayers[j]];
    if (aiPlayer && aiPlayer.id !== player.id) {
      const clientCenterX = aiPlayer.x + aiPlayer.width / 2;
      const clientCenterY = aiPlayer.y + aiPlayer.height / 2;

      const distance = getDistance(rayX, rayY, clientCenterX, clientCenterY);
      if (distance < range) {
        const angle = Math.atan2(clientCenterY - rayY, clientCenterX - rayX);
        uniqueAngles.push({
          angle: angle,
          distance: distance,
          target: aiPlayer,
        });
      }
    }
  }

  let result = [];

  for (let j = 0; j < uniqueAngles.length; j++) {
    const angle = uniqueAngles[j].angle;

    if (
      startAngle < endAngle
        ? startAngle <= angle && angle <= endAngle
        : startAngle <= angle || angle <= endAngle
    ) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);

      const ray = {
        a: { x: rayX, y: rayY },
        b: { x: rayX + dx, y: rayY + dy },
      };

      let closestIntersect = null;

      for (let i = 0; i < mapSegments.length; i++) {
        var intersect = getRayIntersection(ray, mapSegments[i]);
        if (!intersect) continue;
        if (!closestIntersect || intersect.param < closestIntersect.param) {
          closestIntersect = intersect;
        }
      }
      if (!closestIntersect) continue;
      closestIntersect.angle = angle;

      const distance = getDistance(
        rayX,
        rayY,
        closestIntersect.x,
        closestIntersect.y
      );
      if (uniqueAngles[j].distance < distance) {
        result.push(uniqueAngles[j]);
      }
    }
  }

  result = result.sort(function (a, b) {
    return a.distance - b.distance;
  });

  return result.length > 0 ? result : undefined;
}

function getShootInfo(player, targetPoint) {
  var muzzlePoint = {
    x: player.x + player.width / 2,
    y: player.y + player.height / 2,
  };

  let muzzleOffsetX = 0;
  let muzzleOffsetY = 0;
  const shootRange = 1000;
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
    muzzleOffsetX * muzzleOffsetX + muzzleOffsetY * muzzleOffsetY
  );
  muzzlePoint.x += Math.cos(muzzleAngle) * muzzleDistance;
  muzzlePoint.y += Math.sin(muzzleAngle) * muzzleDistance;

  let bulletAngle = 0.0;
  if (targetPoint !== undefined) {
    const bulletRadian =
      Math.atan2(targetPoint.y - muzzlePoint.y, targetPoint.x - muzzlePoint.x) +
      deviationAngle;
    bulletAngle = (bulletRadian * 180) / Math.PI;
    targetPoint.x = muzzlePoint.x + Math.cos(bulletRadian) * shootRange;
    targetPoint.y = muzzlePoint.y + Math.sin(bulletRadian) * shootRange;
  } else {
    targetPoint = { x: muzzleOffsetY + shootRange, y: muzzleOffsetY };
    const targetAngle =
      Math.atan2(targetPoint.y, targetPoint.x) +
      (player.direction * Math.PI) / 180 +
      deviationAngle;
    const targetDistance = Math.sqrt(
      targetPoint.x * targetPoint.x + targetPoint.y * targetPoint.y
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
  sendAll("user_direction", {
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
    sendAll("user_speed", {
      id: aiPlayer.id,
      speedX: aiPlayer.speedX,
      speedY: aiPlayer.speedY,
    });
    sendAll("user_position", {
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

// id로 타겟을 매번 다시 찾는다. 접속 종료/사망한 타겟은 자연스럽게 무효화된다.
function resolveTarget(targetId) {
  if (targetId === undefined) {
    return undefined;
  }
  return clients[targetId] || aiPlayers[targetId];
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

function repathToPoint(aiPlayer, x, y, now) {
  if (now - aiPlayer.fsm.lastRepathTime < AI_REPATH_INTERVAL) {
    return;
  }
  aiPlayer.fsm.lastRepathTime = now;
  setDestinationPath(aiPlayer, { x: x, y: y });
}

// 타겟 반대 방향으로 한 발 물러날 지점을 찾아 이동 (붙어서 겹치는 것 방지)
function retreatFrom(aiPlayer, threatX, threatY, now) {
  if (now - aiPlayer.fsm.lastRepathTime < AI_REPATH_INTERVAL) {
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
    (Math.atan2(attackerY - centerY, attackerX - centerX) / Math.PI) * 180
  );
  sendAll("user_direction", {
    id: aiPlayer.id,
    direction: aiPlayer.direction,
  });
}

function aiProcess(aiPlayer, now) {
  if (!aiPlayer) {
    return;
  }

  const centerX = aiPlayer.x + aiPlayer.width / 2;
  const centerY = aiPlayer.y + aiPlayer.height / 2;
  const inSightPlayers = getPlayersInSight(aiPlayer, AI_SIGHT_RANGE);
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

        if (getDistance(centerX, centerY, targetX, targetY) <= AI_ATTACK_RANGE) {
          fsm.state = "attack";
          stopMoving(aiPlayer);
          break;
        }
        repathToPoint(aiPlayer, targetX, targetY, now);
      } else {
        // 시야에서 놓침: 마지막 목격 지점까지 수색하고 그래도 없으면 포기
        if (
          now - fsm.lastSeenTime > AI_TARGET_LOST_TIMEOUT ||
          getDistance(centerX, centerY, fsm.lastSeenX, fsm.lastSeenY) <
            AI_LAST_SEEN_ARRIVE_DISTANCE
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
      if (distance > AI_ATTACK_RANGE + AI_ATTACK_RANGE_BUFFER) {
        fsm.state = "chase";
        fsm.lastRepathTime = 0;
        break;
      }

      if (distance < AI_RETREAT_RANGE) {
        retreatFrom(aiPlayer, targetX, targetY, now);
      } else if (!aiPlayer.isPathMovingActive) {
        stopMoving(aiPlayer);
      }

      // 사격 중에는 이동 방향이 아니라 타겟을 조준한다
      const targetDirection =
        (Math.atan2(targetY - centerY, targetX - centerX) / Math.PI) * 180;
      turnToward(aiPlayer, targetDirection);

      if (
        now - aiPlayer.lastShootTime > AI_SHOOT_INTERVAL &&
        Math.abs(normalizeAngleDeg(targetDirection - aiPlayer.direction)) <
          AI_SHOOT_FACING_TOLERANCE
      ) {
        aiPlayer.lastShootTime = now;
        const shootInfo = getShootInfo(aiPlayer, {
          x: targetX + (Math.random() - 0.5) * 24,
          y: targetY + (Math.random() - 0.5) * 24,
        });
        shootProcess(
          aiPlayer.id,
          aiPlayer.weapon,
          "ai",
          shootInfo.muzzle.x,
          shootInfo.muzzle.y,
          shootInfo.target.x,
          shootInfo.target.y
        );
        sendAll("user_shoot", {
          id: aiPlayer.id,
          weapon: aiPlayer.weapon,
          muzzlePoint: shootInfo.muzzle,
          targetPoint: shootInfo.target,
          angle: shootInfo.angle,
        });
      }
      break;
    }
  }

  aiMove(aiPlayer);
  applySeparation(aiPlayer);
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
      aiPlayer.destinationY
    );
    if (AI_MOVE_SPEED >= distance) {
      aiPlayer.x = aiPlayer.destinationX;
      aiPlayer.y = aiPlayer.destinationY;

      aiPlayer.speedX = 0;
      aiPlayer.speedY = 0;
      sendAll("user_speed", {
        id: aiPlayer.id,
        speedX: aiPlayer.speedX,
        speedY: aiPlayer.speedY,
      });
      sendAll("user_position", {
        id: aiPlayer.id,
        x: aiPlayer.x,
        y: aiPlayer.y,
      });
    } else {
      const moveRadian = Math.atan2(
        aiPlayer.destinationY - aiPlayer.y,
        aiPlayer.destinationX - aiPlayer.x
      );

      const newSpeedX = Math.cos(moveRadian) * AI_MOVE_SPEED;
      const newSpeedY = Math.sin(moveRadian) * AI_MOVE_SPEED;

      aiPlayer.x += newSpeedX;
      aiPlayer.y += newSpeedY;

      if (aiPlayer.speedX !== newSpeedX || aiPlayer.speedY !== newSpeedY) {
        aiPlayer.speedX = newSpeedX;
        aiPlayer.speedY = newSpeedY;
        sendAll("user_speed", {
          id: aiPlayer.id,
          speedX: aiPlayer.speedX,
          speedY: aiPlayer.speedY,
        });
        sendAll("user_position", {
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
  } else {
    if (aiPlayer.isPathMovingActive) {
      aiPlayer.currentMovingPathIndex++;
      if (aiPlayer.currentMovingPathIndex < aiPlayer.movingPath.length) {
        aiPlayer.destinationX =
          aiPlayer.movingPath[aiPlayer.currentMovingPathIndex].x;
        aiPlayer.destinationY =
          aiPlayer.movingPath[aiPlayer.currentMovingPathIndex].y;
      } else {
        aiPlayer.isPathMovingActive = false;
      }
    } else {
      if (aiPlayer.fsm.state === "roam") {
        if (Math.random() < 0.005) {
          setRandomDestinationPath(aiPlayer);
        } else {
          // 제자리에서 천천히 회전하며 주변을 살핀다
          aiPlayer.direction = normalizeAngleDeg(aiPlayer.direction + 1);
          sendAll("user_direction", {
            id: aiPlayer.id,
            direction: aiPlayer.direction,
          });
        }
      }
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
    if (!other || other.id === aiPlayer.id) {
      return;
    }
    const otherX = other.x + other.width / 2;
    const otherY = other.y + other.height / 2;
    const distance = getDistance(centerX, centerY, otherX, otherY);
    if (distance >= AI_BODY_DISTANCE) {
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
    const strength = Math.min((AI_BODY_DISTANCE - distance) / 2, 2);
    pushX += Math.cos(angle) * strength;
    pushY += Math.sin(angle) * strength;
  }

  for (let i = 0; i < clients.length; i++) {
    accumulatePush(clients[clients[i]]);
  }
  for (let i = 0; i < aiPlayers.length; i++) {
    accumulatePush(aiPlayers[aiPlayers[i]]);
  }

  if (pushX !== 0 || pushY !== 0) {
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
      sendAll("user_position", {
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
          escapeY + aiPlayer.height / 2
        ) &&
        isWalkablePosition(
          aiPlayer.x + Math.cos(escapeAngle) * 32 + aiPlayer.width / 2,
          aiPlayer.y + Math.sin(escapeAngle) * 32 + aiPlayer.height / 2
        )
      ) {
        aiPlayer.destinationX = escapeX;
        aiPlayer.destinationY = escapeY;
      }
    }
  } else {
    aiPlayer.separationEscapeAngle = undefined;
  }
}
