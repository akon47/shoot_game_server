"use strict";

// 접속 중인 모든 클라이언트로의 메시지 전송을 담당한다.

const state = require("./state");

// 모든 클라이언트에게 브로드캐스트
function sendAll(type, data) {
  const message = JSON.stringify({ type: type, data: data });
  state.forEachPlayer(state.clients, function (client) {
    client.ws.send(message);
  });
}

// 특정 클라이언트에게만 전송 (player 는 ws 를 가진 사람 플레이어)
function sendTo(player, type, data) {
  player.ws.send(JSON.stringify({ type: type, data: data }));
}

// 서버 공지. 문자열 대신 key+params 를 보내고 클라이언트(locale_class.js)가
// 사용자의 언어 설정에 맞춰 렌더링한다. 채팅 기록 파일에는 남기지 않는다.
function sendServerNotice(key, params) {
  sendAll("server_notice", { key: key, params: params });
}

// 접속자 수는 실제 유저 + AI 합산으로 보내서 AI도 사람처럼 보이게 한다
function broadcastUserCount() {
  sendAll("user_count", state.userCount + state.countPlayers(state.aiPlayers));
}

module.exports = {
  sendAll,
  sendTo,
  sendServerNotice,
  broadcastUserCount,
};
