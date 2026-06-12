"use strict";

// 채팅 기록의 메모리 보관 + 파일 영속화.
// 파일 형식: `{...},\n` 을 누적한 JSON Lines 비슷한 형태 (로드 시 `[...]` 로 감싸 파싱)

const fs = require("fs");
const path = require("path");
const config = require("./config");

const dataPath = path.join(__dirname, "datas");
const chatFilePath = path.join(dataPath, "user_chats.json");

if (!fs.existsSync(dataPath)) {
  fs.mkdirSync(dataPath, { recursive: true });
}
if (!fs.existsSync(chatFilePath)) {
  fs.writeFileSync(chatFilePath, "");
}

let userChats = JSON.parse(
  `[${fs
    .readFileSync(chatFilePath)
    .toString()
    .trim()
    .replace(/(^,)|(,$)/g, "")}]`,
);
userChats = userChats.splice(-config.CHAT_HISTORY_LIMIT);

// 채팅 1건을 메모리에 추가하고 파일에도 append 한다
function append(chatData) {
  userChats.push(chatData);
  fs.appendFile(chatFilePath, `${JSON.stringify(chatData)},\n`, function (err) {
    if (err) {
      console.error("failed to append chat log:", err.message);
    }
  });
  if (userChats.length >= config.CHAT_HISTORY_LIMIT) {
    userChats = userChats.splice(-config.CHAT_HISTORY_LIMIT);
  }
}

// 접속 시 클라이언트에게 보낼 최근 채팅 목록
function getRecentChats() {
  return userChats;
}

module.exports = {
  append,
  getRecentChats,
};
