"use strict";

// HTTP 서버 위에 ws WebSocketServer 를 올려 반환하는 팩토리.
// 사용법: const wss = require("./websocket-server")(port);

const http = require("http");
const WebSocketServer = require("ws").Server;

module.exports = function createWebSocketServer(port) {
  // 운영 배포(HTTPS/WSS) 시 letsencrypt 인증서를 사용한다:
  // const fs = require("fs");
  // const options = {
  //   ca: fs.readFileSync("/etc/letsencrypt/live/kimhwan.kr/fullchain.pem"),
  //   key: fs.readFileSync("/etc/letsencrypt/live/kimhwan.kr/privkey.pem"),
  //   cert: fs.readFileSync("/etc/letsencrypt/live/kimhwan.kr/fullchain.pem"),
  // };
  // const server = require("https").createServer(options, requestHandler);

  const server = http.createServer(function (request, response) {
    console.log(new Date() + " Received request for " + request.url);
    response.writeHead(404);
    response.end();
  });

  server.listen(port);
  console.log("websocket server listening on port " + port);

  return new WebSocketServer({ server: server });
};
