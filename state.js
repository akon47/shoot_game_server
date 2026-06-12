"use strict";

// 서버 전역 공유 상태.
//
// clients/aiPlayers 는 "배열을 맵처럼 쓰는" 컬렉션이다:
//  - 숫자 인덱스: id 문자열 목록 (collection.push(id))
//  - 문자열 키: 플레이어 객체 (collection[id] = {...})
// 삭제 시 문자열 키만 지워질 수 있으므로 순회는 반드시 forEachPlayer 를 사용한다.

const clients = [];
const aiPlayers = [];

// 컬렉션의 살아있는 항목만 순회한다 (undefined 체크 포함)
function forEachPlayer(collection, callback) {
  for (let i = 0; i < collection.length; i++) {
    const player = collection[collection[i]];
    if (player) {
      callback(player);
    }
  }
}

function countPlayers(collection) {
  let count = 0;
  forEachPlayer(collection, function () {
    count++;
  });
  return count;
}

// id 로 사람/AI 구분 없이 플레이어를 찾는다 (id 접두사가 USER_/AI_ 로 달라 충돌 없음)
function resolvePlayer(id) {
  if (id === undefined) {
    return undefined;
  }
  return clients[id] || aiPlayers[id];
}

module.exports = {
  clients,
  aiPlayers,
  userCount: 0, // 실제 접속 유저 수 (AI 제외)
  forEachPlayer,
  countPlayers,
  resolvePlayer,
};
