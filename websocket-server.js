

const fs = require('fs');
const WebSocketServer = require('ws').Server;

module.exports = (port) => {
    const https_options = {
        ca: fs.readFileSync("/etc/letsencrypt/live/kimhwan.kr/fullchain.pem"),
        key: fs.readFileSync("/etc/letsencrypt/live/kimhwan.kr/privkey.pem"),
        cert: fs.readFileSync("/etc/letsencrypt/live/kimhwan.kr/fullchain.pem")
    };

    const httpsServer = require('https').createServer(https_options, function (request, response) {
        console.log((new Date()) + ' Received request for ' + request.url);
        response.writeHead(404);
        response.end();
    });

    httpsServer.listen(port);

    //웹소켓 서버 생성
    const wss = new WebSocketServer({
        server: httpsServer,
        autoAcceptConnections: false
    });
    return wss;
};