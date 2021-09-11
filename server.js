const { shootIntersection, getDistance } = require("./utils.js");
const {
  getWalkableRandomPosition,
  setRandomDestinationPath,
  setDestinationPath,
  mapSegments,
} = require("./map-helper.js");

//웹소켓 서버 생성
const wss = require("./websocket-server")(8081);

var connectionCount = 0;
var clients = [];
var userCount = 0;

var aiPlayers = [];
var aiIdCount = 0;

let userChats = [];

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
        if (msg.data.chat.charAt(0) === "/") {
          runCommand(msg.data.chat.substring(1));
        } else {
          const chatData = {
            id: id,
            name: clients[id].name,
            chat: msg.data.chat,
            date: Date.now(),
          };
          sendAll("user_chat", chatData);
          userChats.push(chatData);
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
    sendAll("user_count", --userCount);
    sendAll("user_disconnected", { id: id });
  });

  sendAll("user_count", ++userCount);
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
              aiPlayers[id].isPathMovingActive = false;
              aiPlayers[id].fsm.state = "roam";
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
              aiPlayers[id].isPathMovingActive = false;
              aiPlayers[id].fsm.state = "roam";

              sendAll("user_kill", { id: id, kill: aiPlayers[id].kill });
            }

            hitObject.hp = 100.0;
            const position = getWalkableRandomPosition();
            hitObject.x = position.x;
            hitObject.y = position.y;
            hitObject.destinationX = position.x;
            hitObject.destinationY = position.y;
            hitObject.isPathMovingActive = false;
            hitObject.fsm.state = "roam";
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

function createAiPlayer(name) {
  const position = getWalkableRandomPosition();

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
  aiPlayers[id].name = name ? name : id;
  aiPlayers[id].direction = 0;
  aiPlayers[id].character = 0;
  aiPlayers[id].weapon = "rifle";
  aiPlayers[id].hp = 100.0;
  aiPlayers[id].kill = 0;
  aiPlayers[id].death = 0;
  aiPlayers[id].fsm = [];
  aiPlayers[id].fsm.state = "roam"; // chase attack
  aiPlayers.push(id);

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
    hp: 100.0,
  });

  setInterval(function () {
    aiProcess(aiPlayers[id]);
  }, 1000 / 60);
}

createAiPlayer("Bro");
createAiPlayer("Ballmer");
//createAiPlayer("Luck");

//createAiPlayer("루리");
//createAiPlayer("라시");
//createAiPlayer("살인마");
//createAiPlayer("제임스");
//createAiPlayer("후아암");
//createAiPlayer("바보냥");
//createAiPlayer("이카");
//createAiPlayer("후하");

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
      backDelay = 200;
      muzzleOffsetX = 29;
      muzzleOffsetY = 8;

      deviationAngle = (Math.PI / 180) * (1 - Math.random() * 2);
      break;
    case "rifle":
      backDelay = 50;
      muzzleOffsetX = 38;
      muzzleOffsetY = 6.5;

      deviationAngle = (Math.PI / 180) * (2 - Math.random() * 4);
      break;
    case "shotgun":
      backDelay = 700;
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

function aiProcess(aiPlayer) {
  if (aiPlayer) {
    const aiCenterX = aiPlayer.x + aiPlayer.width / 2;
    const aiCenterY = aiPlayer.y + aiPlayer.height / 2;

    const inSightPlayers = getPlayersInSight(aiPlayer, 700);
    switch (aiPlayer.fsm.state) {
      case "roam":
        if (inSightPlayers) {
          aiPlayer.fsm.state = "attack";
          aiPlayer.fsm.attackTarget = inSightPlayers[0].target;
          setDestinationPath(aiPlayer, aiPlayer.fsm.attackTarget);
        }
        break;
      case "attack":
        var attackTargetVisible = false;
        if (inSightPlayers) {
          for (var j = 0; j < inSightPlayers.length; j++) {
            if (inSightPlayers[j].target.id === aiPlayer.fsm.attackTarget.id) {
              attackTargetVisible = true;
              break;
            }
          }
        }
        if (
          getDistance(
            aiCenterX,
            aiCenterY,
            aiPlayer.fsm.attackTarget.x,
            aiPlayer.fsm.attackTarget.y
          ) > 500 ||
          !attackTargetVisible
        ) {
          setDestinationPath(aiPlayer, aiPlayer.fsm.attackTarget);
        } else {
          if (
            aiPlayer.destinationX !== aiPlayer.x ||
            aiPlayer.destinationY !== aiPlayer.y
          ) {
            aiPlayer.destinationX = aiPlayer.x;
            aiPlayer.destinationY = aiPlayer.y;
            aiPlayer.isPathMovingActive = false;
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
            const newDirectionRadian = Math.atan2(
              aiPlayer.fsm.attackTarget.y - aiPlayer.y,
              aiPlayer.fsm.attackTarget.x - aiPlayer.x
            );
            const newDirection = (newDirectionRadian / Math.PI) * 180;
            if (aiPlayer.direction !== newDirection) {
              const dDirection = newDirection - aiPlayer.direction;
              if (Math.abs(dDirection) < 10) {
                aiPlayer.direction = newDirection;
              } else {
                aiPlayer.direction += dDirection / 3;
              }
              sendAll("user_direction", {
                id: aiPlayer.id,
                direction: aiPlayer.direction,
              });
            }
          }

          if (
            !aiPlayer.lastShootTime ||
            Date.now() - aiPlayer.lastShootTime > 400
          ) {
            aiPlayer.lastShootTime = Date.now();

            const shootInfo = getShootInfo(aiPlayer, {
              x: aiPlayer.fsm.attackTarget.x + aiPlayer.fsm.attackTarget.width / 2 + (Math.random() * 50),
              y: aiPlayer.fsm.attackTarget.y + aiPlayer.fsm.attackTarget.height / 2 + (Math.random() * 50),
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
        }
        break;
    }
    //

    // 이동처리
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
      if (3 >= distance) {
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
        const newDirectionRadian = Math.atan2(
          aiPlayer.destinationY - aiPlayer.y,
          aiPlayer.destinationX - aiPlayer.x
        );
        const newDirection = (newDirectionRadian / Math.PI) * 180;

        const newSpeedX = Math.cos(newDirectionRadian) * 3;
        const newSpeedY = Math.sin(newDirectionRadian) * 3;

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
        if (aiPlayer.direction !== newDirection) {
          const dDirection = newDirection - aiPlayer.direction;
          if (Math.abs(dDirection) < 10) {
            aiPlayer.direction = newDirection;
          } else {
            aiPlayer.direction += dDirection / 3;
          }
          sendAll("user_direction", {
            id: aiPlayer.id,
            direction: aiPlayer.direction,
          });
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
            aiPlayer.direction += 1;
            sendAll("user_direction", {
              id: aiPlayer.id,
              direction: aiPlayer.direction,
            });
          }
        }
      }
    }
  }
}
