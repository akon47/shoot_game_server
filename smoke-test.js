// 신규 기능 프로토콜 스모크 테스트 (수동 실행용: node smoke-test.js)
// 서버가 8080 포트에서 실행 중이어야 한다.
const WebSocket = require("ws");

const received = {};
let myId = undefined;
const ws = new WebSocket("ws://localhost:8080");

function send(type, data) {
  ws.send(JSON.stringify({ type, data }));
}

ws.on("open", function () {
  console.log("[connected]");
});

ws.on("message", function (raw) {
  const msg = JSON.parse(raw);
  received[msg.type] = (received[msg.type] || 0) + 1;

  if (msg.type === "id") {
    myId = msg.data;
    console.log("[id]", myId);
    send("user_init", {
      name: "tester",
      x: 1000,
      y: 1000,
      speedX: 0,
      speedY: 0,
      direction: 0,
      character: 1,
      weapon: "shotgun",
      hp: 100,
    });

    setTimeout(function () {
      // 샷건 7펠릿 사격
      const targetPoints = [];
      for (let i = 0; i < 7; i++) {
        targetPoints.push({ x: 2000, y: 1000 + i * 10 });
      }
      send("user_shoot", {
        weapon: "shotgun",
        muzzlePoint: { x: 1016, y: 1016 },
        targetPoints: targetPoints,
        angle: 0,
      });
      // 근접 공격
      send("user_melee_attack", { weapon: "knife" });
      // 장전
      send("user_reload", { weapon: "shotgun" });
    }, 500);

    setTimeout(function () {
      console.log("\n--- received message types ---");
      console.log(received);
      const expected = [
        "id",
        "user_chat_history",
        "item_list",
        "monster_list",
        "round_info",
        "user_connected",
        "user_shoot",
        "user_melee_attack",
        "user_reload",
      ];
      let failed = false;
      for (const type of expected) {
        if (!received[type]) {
          console.log("MISSING:", type);
          failed = true;
        }
      }
      console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS");
      ws.close();
      process.exit(failed ? 1 : 0);
    }, 1500);
  }

  if (msg.type === "user_connected" && msg.data.id === myId) {
    console.log("[user_connected:self] protectedMs =", msg.data.protectedMs);
  }
  if (msg.type === "user_shoot" && msg.data.id === myId) {
    console.log(
      "[user_shoot:self] targetPoints.length =",
      msg.data.targetPoints ? msg.data.targetPoints.length : "(none)",
    );
  }
  if (msg.type === "item_list") {
    console.log("[item_list] count =", msg.data.length);
  }
  if (msg.type === "monster_list") {
    console.log("[monster_list] count =", msg.data.length);
  }
  if (msg.type === "round_info") {
    console.log("[round_info] remainMs =", msg.data.remainMs);
  }
});

ws.on("error", function (e) {
  console.error("error:", e.message);
  process.exit(1);
});
