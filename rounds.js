"use strict";

// 라운드 시스템(주기적 우승자 발표 + 전적 리셋)과 킬스트릭 공지를 담당한다.
// 공지는 문자열이 아니라 server_notice(key + params)로 보내고,
// 클라이언트(locale_class.js)가 사용자의 언어 설정에 맞춰 렌더링한다.

const config = require("./config");
const state = require("./state");
const net = require("./net");

let roundEndTime = Date.now() + config.ROUND_DURATION;
let roundInfoTickCounter = 0;

function getDisplayName(player) {
  return player.name && player.name.trim() ? player.name : player.id;
}

// 킬 발생 시 킬스트릭 달성/저지 공지 (combat.applyDamage 에서 호출)
function announceKill(killer, victim, victimStreak) {
  if (config.KILLSTREAK_MILESTONES.indexOf(killer.streak) >= 0) {
    net.sendServerNotice("killstreak", {
      name: getDisplayName(killer),
      streak: killer.streak,
    });
  }
  // 3연속 킬 이상이던 플레이어가 처치되면 저지 공지
  if (victimStreak >= 3) {
    net.sendServerNotice("streak_stopped", {
      killer: getDisplayName(killer),
      victim: getDisplayName(victim),
      streak: victimStreak,
    });
  }
}

function getRemainMs() {
  return Math.max(0, roundEndTime - Date.now());
}

function broadcastRoundInfo() {
  net.sendAll("round_info", { remainMs: getRemainMs() });
}

function endRound() {
  let winner = undefined;
  function considerWinner(player) {
    if (!winner || player.kill > winner.kill) {
      winner = player;
    }
  }
  state.forEachPlayer(state.clients, considerWinner);
  state.forEachPlayer(state.aiPlayers, considerWinner);

  if (winner && winner.kill > 0) {
    net.sendServerNotice("round_end_winner", {
      name: getDisplayName(winner),
      kill: winner.kill,
      death: winner.death,
    });
  } else {
    net.sendServerNotice("round_end", {});
  }

  function resetRecord(player) {
    player.kill = 0;
    player.death = 0;
    player.streak = 0;
    net.sendAll("user_kill", { id: player.id, kill: 0 });
    net.sendAll("user_death", { id: player.id, death: 0 });
  }
  state.forEachPlayer(state.clients, resetRecord);
  state.forEachPlayer(state.aiPlayers, resetRecord);

  net.sendServerNotice("round_start", {
    minutes: config.ROUND_DURATION / 60000,
  });
}

// 라운드 타이머 시작. 10초마다 남은 시간을 동기화한다
// (사이사이는 클라이언트가 로컬로 카운트다운)
function start() {
  setInterval(function () {
    if (Date.now() >= roundEndTime) {
      endRound();
      roundEndTime = Date.now() + config.ROUND_DURATION;
      roundInfoTickCounter = 0;
      broadcastRoundInfo();
      return;
    }
    if (++roundInfoTickCounter >= 10) {
      roundInfoTickCounter = 0;
      broadcastRoundInfo();
    }
  }, 1000);
}

module.exports = {
  start,
  getRemainMs,
  announceKill,
};
