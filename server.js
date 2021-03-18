var https = require('http');
var fs   = require('fs');
var WebSocketServer = require('websocket').server;


var httpsServer = https.createServer(function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    response.writeHead(404);
    response.end();
});

//포트설정
httpsServer.listen(8080);

//ws 모듈이 내부적으로 없을경우 설치
var WebSocketServer = require('ws').Server;

//웹소켓 서버 생성
var wss = new WebSocketServer({
    server: httpsServer,
    // You should not use autoAcceptConnections for production
    // applications, as it defeats all standard cross-origin protection
    // facilities built into the protocol and the browser.  You should
    // *always* verify the connection's origin and decide whether or not
    // to accept it.
    autoAcceptConnections: false
});

function originIsAllowed(origin) {
  // put logic here to detect whether the specified origin is allowed.
  return true;
}

var pathFinding = require('pathfinding');
var mapData = require("../../html/shoot_game/map_office.js").mapData;
var mapGrid = new pathFinding.Grid(mapData.width, mapData.height);
var walkablePositions = [];

for(var y = 0; y < mapData.height; y++) {
    for(var x = 0; x < mapData.width; x++) {
        const walkable = !mapData.wall_tiles.includes(mapData.data[(y * mapData.width) + x]);
        mapGrid.setWalkableAt(x, y, walkable);
        if(walkable) {
            walkablePositions.push({ x: x, y: y });
        }
    }
}

var mapHitBoxes = findMapHitBoxes();
var mapSegments = createSegments(mapHitBoxes);

function createSegments(hitBoxes) {
    function getSlope(segment) {
        const dx = (segment.b.x - segment.a.x);
        const dy = (segment.b.y - segment.a.y);
        if(dx === 0) {
            return undefined;
        } else {
            return (dy / dx);
        }
    }

    var segments = [];
    if(hitBoxes) {
        var tempSegments = [];
        for(var i = 0; i < hitBoxes.length; i++) {
            const hitBox = hitBoxes[i];
            if(hitBox) {
                tempSegments.push(
                    { a: { x: hitBox.left, y: hitBox.top }, b: { x: hitBox.right, y: hitBox.top }, valid: true },
                    { a: { x: hitBox.right, y: hitBox.top }, b: { x: hitBox.right, y: hitBox.bottom }, valid: true },
                    { a: { x: hitBox.left, y: hitBox.bottom }, b: { x: hitBox.right, y: hitBox.bottom }, valid: true },
                    { a: { x: hitBox.left, y: hitBox.top }, b: { x: hitBox.left, y: hitBox.bottom }, valid: true }
                );
            }
        }

        for(var i = 0; i < tempSegments.length; i++) {
            if(tempSegments[i].valid) {
                const slopeSrc = getSlope(tempSegments[i]);
                const interceptYSrc = (tempSegments[i].a.y - (tempSegments[i].a.x * slopeSrc));
                const leftSrc = Math.min(tempSegments[i].a.x, tempSegments[i].b.x);
                const topSrc = Math.min(tempSegments[i].a.y, tempSegments[i].b.y);
                const rightSrc = Math.max(tempSegments[i].a.x, tempSegments[i].b.x);
                const bottomSrc = Math.max(tempSegments[i].a.y, tempSegments[i].b.y);

                for(var j = 0; j < tempSegments.length; j++) {
                    if(i !== j && tempSegments[j].valid) {
                        // tempSegments[i] 안에 tempSegments[j] 가 포함되는지 검사 후 valid 체크
                        const slopeDest = getSlope(tempSegments[j]);
                        if(slopeSrc === slopeDest) {
                            const interceptYDest = (tempSegments[j].a.y - (tempSegments[j].a.x * slopeSrc));
                            if(interceptYSrc === interceptYDest) {
                                const leftDest = Math.min(tempSegments[j].a.x, tempSegments[j].b.x);
                                const topDest = Math.min(tempSegments[j].a.y, tempSegments[j].b.y);
                                const rightDest = Math.max(tempSegments[j].a.x, tempSegments[j].b.x);
                                const bottomDest = Math.max(tempSegments[j].a.y, tempSegments[j].b.y);

                                if(leftSrc <= leftDest && rightSrc >= leftDest &&
                                    leftSrc <= rightDest && rightSrc >= rightDest &&
                                    topSrc <= topDest && topSrc >= topDest &&
                                    bottomSrc <= bottomDest && bottomSrc >= bottomDest) {
                                    
                                    tempSegments[j].valid = false;
                                }
                            }
                        }
                    }
                }
            }
        }

        for(var i = 0; i < tempSegments.length; i++) {
            if(tempSegments[i].valid) {
                segments.push(tempSegments[i]);
            }
        }
    }
    return segments;
}

function findMapHitBoxes() {
    function isWall(x, y) {
        return mapData.wall_tiles.includes(mapData.data[(y * mapData.width) + x]);
    }

    function findLeftTopRight(findedHitbox) {
        function containsHitboxs(x, y) {
            for (var i = 0; i < findedHitbox.length; i++) {
                if (x >= findedHitbox[i].left && x <= findedHitbox[i].right && y >= findedHitbox[i].top && y <= findedHitbox[i].bottom) {
                    return true;
                }
            }
            return false;
        }

        for (var y = 0; y < mapData.height; y++) {
            for (var x = 0; x < mapData.width; x++) {
                if (!containsHitboxs(x, y) && isWall(x, y)) {
                    const left = x;
                    const top = y;
                    for (var r = (x + 1); r < mapData.width; r++) {
                        if (containsHitboxs(r, y) || !isWall(r, y)) {
                            return { left: x, top: y, right: (r - 1) };
                        }

                        //////////////////////////////////// 최대 가로 32 블럭으로 제한
                        else {
                            if (((r - 1) - left) >= 32) {
                                return { left: x, top: y, right: (r - 1) };
                            }
                        }
                        /////////////////////////////////////
                    }
                    return { left: x, top: y, right: (mapData.width - 1) };
                }
            }
        }
        return undefined;
    }

    function findBottom(leftTopRight) {
        for (var y = (leftTopRight.top + 1); y < mapData.height; y++) {
            for (var x = leftTopRight.left; x <= leftTopRight.right; x++) {
                if (!isWall(x, y)) {
                    return (y - 1);
                }
            }

            //////////////////////////////////// 최대 세로 32 블럭으로 제한
            if (((y - 1) - leftTopRight.top) >= 32) {
                return (y - 1);
            }
            /////////////////////////////////////
        }
        return (mapData.height - 1);
    }

    var findedHitbox = [];
    var result = [];
    while (true) {
        const leftTopRight = findLeftTopRight(findedHitbox);
        if (leftTopRight) {
            const bottom = findBottom(leftTopRight);
            findedHitbox.push({ left: leftTopRight.left, top: leftTopRight.top, right: leftTopRight.right, bottom: bottom });
            result.push(
                {
                    left: (leftTopRight.left * mapData.tile_width),
                    top: (leftTopRight.top * mapData.tile_height),
                    right: (leftTopRight.left * mapData.tile_width) + (((leftTopRight.right - leftTopRight.left) * mapData.tile_width) + mapData.tile_width),
                    bottom: (leftTopRight.top * mapData.tile_height) + (((bottom - leftTopRight.top) * mapData.tile_height) + mapData.tile_height)
                });
        } else {
            break;
        }
    }

    return result;
}










var pathFinder = new pathFinding.AStarFinder({
    allowDiagonal: true,
    dontCrossCorners: true
});

function findPath(startX, startY, endX, endY) {
    return pathFinder.findPath(startX, startY, endX, endY, mapGrid.clone());
}

var connectionCount = 0;
var clients = [];
var count = 0;

var aiPlayers = [];
var aiIdCount = 0;

var npcIdCount = 0;
var npcs = [];
var objects = [];

wss.on('connection', function connection(ws) {

	var id = ('USER_' + connectionCount++);

	console.log('connection is established : ' + id);
	clients[id] = [];
	clients[id].ws = ws;
	clients[id].id = id;
	clients[id].x = 0;
    clients[id].y = 0;
    clients[id].width = 32;
    clients[id].height = 32;
	clients[id].speedX = 0;
	clients[id].speedY = 0;
	clients[id].name = '';
	clients[id].direction = 0;
	clients[id].character = 0;
    clients[id].weapon = '';
    clients[id].kill = 0;
    clients[id].death = 0;
    clients[id].hp = 100.0;
	clients.push(id);

	ws.send(JSON.stringify({type: 'id', data: id}));
	//sendAll('user_connected', { id: id });

	ws.on('message', function incoming(message) {
		var msg = JSON.parse(message);
		//console.log('ID: ' + id + ' -> ' + message);
		switch(msg.type) {
            case 'echo':
                ws.send(message);
                break;
			case 'user_init':
				clients[id].x = msg.data.x;
				clients[id].y = msg.data.y;
				clients[id].speedX = msg.data.speedX;
				clients[id].speedY = msg.data.speedY;
				clients[id].name = msg.data.name;
				clients[id].direction = msg.data.direction;
				clients[id].character = msg.data.character;
                clients[id].weapon = msg.data.weapon;
                clients[id].hp = 100.0;
				sendAll('user_connected',
						{
							id: id,
							name: msg.data.name,
							x: msg.data.x, y: msg.data.y,
							speedX: msg.data.speedX, speedY: msg.data.speedY,
							direction: msg.data.direction,
							character: msg.data.character,
                            weapon: msg.data.weapon,
                            kill: clients[id].kill, death: clients[id].death,
                            hp: 100.0
						});

				for(var i = 0; i < clients.length; i++) {
					const client = clients[clients[i]];
					if(client !== undefined) {
						ws.send(JSON.stringify(
						{
							type: 'user_connected',
							data:
							{
								id: client.id,
								name: client.name,
								x: client.x, y: client.y,
								speedX: client.speedX, speedY: client.speedY,
								direction: client.direction, character: client.character,
								weapon: client.weapon, hp: client.hp, kill: client.kill, death: client.death
							}
						}));
					}
                }

                for(var i = 0; i < aiPlayers.length; i++) {
					const aiPlayer = aiPlayers[aiPlayers[i]];
					if(aiPlayer !== undefined) {
						ws.send(JSON.stringify(
						{
							type: 'user_connected',
							data:
							{
								id: aiPlayer.id,
								name: aiPlayer.name,
								x: aiPlayer.x, y: aiPlayer.y,
								speedX: aiPlayer.speedX, speedY: aiPlayer.speedY,
								direction: aiPlayer.direction, character: aiPlayer.character,
								weapon: aiPlayer.weapon, hp: aiPlayer.hp, kill: aiPlayer.kill, death: aiPlayer.death
							}
						}));
					}
                }
                
                for(var i = 0; i < npcs.length; i++) {
                    const npc = npcs[npcs[i]];
                    if(npc !== undefined) {
                        ws.send(JSON.stringify(
                        {
                            type: 'npc_created',
                            data:
                            {
                                id: npc.id,
                                x: npc.x, y: npc.y,
                                destinationX: npc.destinationX, destinationY: npc.destinationY,
                                speed: npc.speed, type: npc.type, hp: 100.0
                            }
                        }));
                    }
                }
			
                break;
			case 'user_position':
				clients[id].x = msg.data.x;
                clients[id].y = msg.data.y;
                if(clients[id].speedX === 0 && clients[id].speedY === 0) {
                    sendAll('user_position', { id: id, x: msg.data.x, y: msg.data.y });
                }
				break;
			case 'user_speed':
				clients[id].speedX = msg.data.speedX;
				clients[id].speedY = msg.data.speedY;
				sendAll('user_speed', { id: id, speedX: msg.data.speedX, speedY: msg.data.speedY });
				break;
			case 'user_name':
				clients[id].name = msg.data.name;
				sendAll('user_name', { id: id, name: msg.data.name });
				break;
			case 'user_chat':
				if(msg.data.chat.charAt(0) === '/') {
					runCommand(msg.data.chat.substring(1));
				} else {
					sendAll('user_chat', { id: id, chat: msg.data.chat });
				}
				break;
			case 'user_direction':
				clients[id].direction= msg.data.direction;
				sendAll('user_direction', { id: id, direction: msg.data.direction });
				break;
			case 'user_character':
				clients[id].character= msg.data.character;
				sendAll('user_character', { id: id, character: msg.data.character });
				break;
			case 'user_weapon':
				clients[id].weapon = msg.data.weapon;
				sendAll('user_weapon', { id: id, weapon: msg.data.weapon });
                break;
            case 'user_shoot':
                // 총알 충돌처리 필요
                console.log('ID: ' + id + ' -> ' + message);
                shootProcess(id, msg.data.weapon, 'user', msg.data.muzzlePoint.x, msg.data.muzzlePoint.y, msg.data.targetPoint.x, msg.data.targetPoint.y);
                sendAll('user_shoot', { id: id, weapon: msg.data.weapon, muzzlePoint: msg.data.muzzlePoint, targetPoint: msg.data.targetPoint, angle: msg.data.angle })
                break;
			case 'user_disconnected':
				sendAll('user_disconnected', { id: id });
				break;
		}
	});

	ws.on('close', function disconnection() {
		console.log('user ' + id + ' disconnected');
		delete clients[id];
		sendAll('user_count', --count);
		sendAll('user_disconnected', { id: id });
	});

	sendAll('user_count', ++count);
});

function shootProcess(id, weapon, provider, muzzleX, muzzleY, targetX, targetY) {
    const p1 = { x: muzzleX, y: muzzleY };
    const p2 = { x: targetX, y: targetY };
    const bulletBox = { left: Math.min(p1.x, p2.x), top: Math.min(p1.y, p2.y), right: Math.max(p1.x, p2.x), bottom: Math.max(p1.y, p2.y) };

    if (npcs) {
        var hitObject = undefined;
        var hitObjectType = undefined;
        var minDistance = 1000000000;
        for (var j = 0; j < npcs.length; j++) {
            const npc = npcs[npcs[j]];
            if (npc) {
                if (bulletBox.left < (npc.x + npc.width) && bulletBox.right > npc.x && bulletBox.top < (npc.y + npc.height) && bulletBox.bottom > npc.y) {
                    var intersection = shootIntersection(p1, p2, npc.x + (npc.width / 2), npc.y + (npc.height / 2), 16);
                    if (intersection) {
                        const distance = (Math.pow(intersection.x - p1.x, 2) + Math.pow(intersection.y - p1.y, 2));
                        if (distance < minDistance) {
                            minDistance = distance;
                            hitObject = npc;
                            hitObjectType = 'npc';
                        }
                    }
                }
            }
        }

        for (var j = 0; j < clients.length; j++) {
            const client = clients[clients[j]];
            if (client && client.id !== id) {
                if (bulletBox.left < (client.x + client.width) && bulletBox.right > client.x && bulletBox.top < (client.y + client.height) && bulletBox.bottom > client.y) {
                    var intersection = shootIntersection(p1, p2, client.x + (client.width / 2), client.y + (client.height / 2), 16);
                    if (intersection) {
                        const distance = (Math.pow(intersection.x - p1.x, 2) + Math.pow(intersection.y - p1.y, 2));
                        if (distance < minDistance) {
                            minDistance = distance;
                            hitObject = client;
                            hitObjectType = 'user';
                        }
                    }
                }
            }
        }

        for (var j = 0; j < aiPlayers.length; j++) {
            const aiPlayer = aiPlayers[aiPlayers[j]];
            if (aiPlayer) {
                if (bulletBox.left < (aiPlayer.x + aiPlayer.width) && bulletBox.right > aiPlayer.x && bulletBox.top < (aiPlayer.y + aiPlayer.height) && bulletBox.bottom > aiPlayer.y) {
                    var intersection = shootIntersection(p1, p2, aiPlayer.x + (aiPlayer.width / 2), aiPlayer.y + (aiPlayer.height / 2), 16);
                    if (intersection) {
                        const distance = (Math.pow(intersection.x - p1.x, 2) + Math.pow(intersection.y - p1.y, 2));
                        if (distance < minDistance) {
                            minDistance = distance;
                            hitObject = aiPlayer;
                            hitObjectType = 'ai';
                        }
                    }
                }
            }
        }

        if (hitObject && hitObjectType) {
            //console.log('shoot_hit: ' + hitObject.id);

            if (hitObject.hp) {

                switch (weapon) {
                    case 'handgun':
                        hitObject.hp -= 10;
                        break;
                    case 'rifle':
                        hitObject.hp -= 15;
                        break;
                    case 'shotgun':
                        hitObject.hp -= 8;
                        break;
                }
                if (hitObject.hp <= 0) {
                    hitObject.hp = 0;

                    switch (hitObjectType) {
                        case 'npc':
                            delete npcs[hitObject.id];
                            sendAll('npc_deleted', { id: hitObject.id, reason: { provider: provider, provider_id: id, weapon: weapon } });
                            console.log('npc_deleted: ' + hitObject.id);
                            break;
                        case 'user':
                            sendAll('user_die', { id: hitObject.id, reason: { provider: provider, provider_id: id, weapon: weapon } });
                            console.log('user_die: ' + hitObject.id);

                            if(provider === 'user' && clients[id]) {
                                clients[id].kill++;
                                sendAll('user_kill', { id: id, kill: clients[id].kill });
                            } else if(provider === 'ai' && aiPlayers[aiPlayers[id]]) {
                                aiPlayers[id].kill++;
                                aiPlayers[id].isPathMovingActive = false;
                                aiPlayers[id].fsm.state = 'roam';
                                sendAll('user_kill', { id: id, kill: aiPlayers[id].kill });
                            }
                            hitObject.death++;
                            sendAll('user_death', { id: hitObject.id, death: hitObject.death });
                            
                            break;
                        case 'ai':
                            sendAll('user_die', { id: hitObject.id, reason: { provider: provider, provider_id: id, weapon: weapon } });
                            console.log('ai_die: ' + hitObject.id);

                            if(provider === 'user' && clients[id]) {
                                clients[id].kill++;
                                sendAll('user_kill', { id: id, kill: clients[id].kill });
                            } else if(provider === 'ai' && aiPlayers[id]) {
                                aiPlayers[id].kill++;
                                aiPlayers[id].isPathMovingActive = false;
                                aiPlayers[id].fsm.state = 'roam';
                                
                                sendAll('user_kill', { id: id, kill: aiPlayers[id].kill });
                            }

                            hitObject.hp = 100.0;
                            const position = getWalkableRandomPosition();
                            hitObject.x = position.x;
                            hitObject.y = position.y;
                            hitObject.destinationX = position.x;
                            hitObject.destinationY = position.y;
                            hitObject.isPathMovingActive = false;
                            hitObject.fsm.state = 'roam';
                            hitObject.death++;
                            sendAll('user_connected',
                                {
                                    id: hitObject.id,
                                    name: hitObject.name,
                                    x: hitObject.x, y: hitObject.y,
                                    speedX: hitObject.speedX, speedY: hitObject.speedY,
                                    direction: hitObject.direction,
                                    character: hitObject.character,
                                    weapon: hitObject.weapon, kill: hitObject.kill, death: hitObject.death,
                                    hp: 100.0
                                });
                            sendAll('user_death', { id: hitObject.id, death: hitObject.death });
                            break;
                    }
                } else {
                    switch (hitObjectType) {
                        case 'npc':
                            sendAll('npc_hp', { id: hitObject.id, hp: hitObject.hp });
                            break;
                        case 'user':
                        case 'ai':
                            sendAll('user_hp', { id: hitObject.id, hp: hitObject.hp });
                            break;
                    }
                }
            }

        }
    }
}

function sendAll(type, data) {
	var msg = {
		type: type,
		data: data
	};

	for (var j = 0; j < clients.length; j++) {
		const client = clients[clients[j]];
		if(client) {
			client.ws.send(JSON.stringify(msg));
		}
	}
}

function runCommand(command) {
    console.log('command: ' + command);

    var args = command.split(' ');
    if(args && args.length > 0) {
        switch(args[0]) {
            case 'addnpc':
                if(args.length > 2) {
                    var x = parseInt(args[1]);
                    var y = parseInt(args[2]);
                    sendAll('user_chat', { id: 'server', chat: 'create npc (' + args[1] + ', ' + args[2] + ')' });

                    var id = ('NPC_' + npcIdCount++);
                    npcs[id] = [];
                    npcs[id].id = id;
                    npcs[id].x = x;
                    npcs[id].y = y;
                    npcs[id].destinationX = x;
                    npcs[id].destinationY = y;
                    npcs[id].speed = 1;
                    npcs[id].type = 0;
                    npcs[id].hp = 100.0;
                    npcs.push(id);
                    sendAll('npc_created',
					{
						id: npcs[id].id,
                        x: npcs[id].x, y: npcs[id].y,
                        destinationX: npcs[id].destinationX, destinationY: npcs[id].destinationY,
						speed: npcs[id].speed, type: npcs[id].type, hp: npcs[id].hp
					});
                }
                break;
            case 'deletenpc':
                if(args.length > 1) {
                    var id = args[1];
                    if(id === 'all') {
                        for(var i = 0; i < npcs.length; i++) {
                            if(npcs[npcs[i]]) {
                                delete npcs[npcs[i]];
                                sendAll('npc_deleted', { id: npcs[i] });
                            }
                        }
                    }
                    else if(npcs[id]) {
                        delete npcs[id];
                        sendAll('npc_deleted', { id: id });
                    }
                }
                break;
            case 'movenpc':
                if(args.length > 3) {
                    var id = args[1];
                    if(npcs[id]) {
                        var destX = parseInt(args[2]);
                        var destY = parseInt(args[3]);
                        npcs[id].destinationX = destX;
                        npcs[id].destinationY = destY;
                        sendAll('npc_destination', { id: id, x: npcs[id].x, y: npcs[id].y, destinationX: npcs[id].destinationX, destinationY: npcs[id].destinationY });
                    }
                }
                break;
        }
    }
}

function getDistance(x1, y1, x2, y2) {
    const dX = (x2 - x1);
    const dY = (y2 - y1);
    return Math.sqrt(Math.abs(dX*dX) + Math.abs(dY*dY));
}

function getWalkableRandomPosition() {
    const point = walkablePositions[Math.floor(Math.random() * walkablePositions.length) % walkablePositions.length];
    return { x: ((point.x * mapData.tile_width)), y: ((point.y * mapData.tile_height)) };
}

function setRandomDestinationPath(npc) {
    if(npc) {
        const target = walkablePositions[Math.floor(Math.random() * walkablePositions.length) % walkablePositions.length];
        var path = pathFinding.Util.compressPath(findPath(Math.floor(npc.x / mapData.tile_width), Math.floor(npc.y / mapData.tile_height), target.x, target.y));
        //var path = pathFinding.Util.smoothenPath(mapGrid.clone(), findPath(Math.floor(npc.x / mapData.tile_width), Math.floor(npc.y / mapData.tile_height), target.x, target.y));
        
        npc.movingPath = [];
        for(var i = 0; i < path.length; i++) {
            npc.movingPath.push({
                x: ((path[i][0] * mapData.tile_width)),
                y: ((path[i][1] * mapData.tile_height))
            });
        }
        npc.currentMovingPathIndex = 0;
        npc.isPathMovingActive = true;

        if(npc.movingPath.length > 0) {
            npc.destinationX = npc.movingPath[0].x;
            npc.destinationY = npc.movingPath[0].y;
        }
        
    }
}

function setDestinationPath(npc, target) {
    if(npc && target) {
        var path = pathFinding.Util.compressPath(findPath(Math.floor(npc.x / mapData.tile_width), Math.floor(npc.y / mapData.tile_height), Math.floor(target.x / mapData.tile_width), Math.floor(target.y / mapData.tile_height)));
        //var path = pathFinding.Util.smoothenPath(mapGrid.clone(), findPath(Math.floor(npc.x / mapData.tile_width), Math.floor(npc.y / mapData.tile_height), target.x, target.y));
        
        npc.movingPath = [];
        for(var i = 1; i < path.length; i++) {
            npc.movingPath.push({
                x: ((path[i][0] * mapData.tile_width)),
                y: ((path[i][1] * mapData.tile_height))
            });
        }
        npc.currentMovingPathIndex = 0;
        npc.isPathMovingActive = true;

        if(npc.movingPath.length > 0) {
            npc.destinationX = npc.movingPath[0].x;
            npc.destinationY = npc.movingPath[0].y;
        }
        
    }
}

function createNpc(x, y, destX, destY, speed) {
    var id = ('NPC_' + npcIdCount++);
    npcs[id] = [];
    npcs[id].id = id;
    npcs[id].x = (x ? x : 0);
    npcs[id].y = (y ? y : 0);
    npcs[id].width = 32;
    npcs[id].height = 32;
    npcs[id].destinationX = (destX ? destX : npcs[id].x);
    npcs[id].destinationY = (destY ? destY : npcs[id].y);
    npcs[id].speed = Math.max(speed ? speed : 1, 1);
    npcs[id].type = 0;
    npcs[id].hp = 100.0;
    npcs.push(id);
    sendAll('npc_created',
    {
        id: npcs[id].id,
        x: npcs[id].x, y: npcs[id].y,
        destinationX: npcs[id].destinationX, destinationY: npcs[id].destinationY,
        speed: npcs[id].speed, type: npcs[id].type, hp: npcs[id].hp
    });
}

function addRandomNpcs(count) {
    for(var i = 0; i < count; i++) {
        const position = getWalkableRandomPosition();
        createNpc(position.x, position.y);
    }
}

function createAiPlayer(name) {
    const position = getWalkableRandomPosition();

    var id = ('AI_' + aiIdCount++);
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
	aiPlayers[id].name = (name ? name : id);
	aiPlayers[id].direction = 0;
	aiPlayers[id].character = 0;
    aiPlayers[id].weapon = 'rifle';
    aiPlayers[id].hp = 100.0;
    aiPlayers[id].kill = 0;
    aiPlayers[id].death = 0;
    aiPlayers[id].fsm = [];
    aiPlayers[id].fsm.state = 'roam'; // chase attack
    aiPlayers.push(id);
    
    sendAll('user_connected',
        {
            id: id,
            name: aiPlayers[id].name,
            x: aiPlayers[id].x, y: aiPlayers[id].y,
            speedX: aiPlayers[id].speedX, speedY: aiPlayers[id].speedY,
            direction: aiPlayers[id].direction,
            character: aiPlayers[id].character,
            weapon: aiPlayers[id].weapon,
            hp: 100.0
        });

    setInterval(function () {
        aiProcess(aiPlayers[id]);
    }, 1000 / 60);
}

function addAiPlayers(count) {
    for(var i = 0; i < count; i++) {
        createAiPlayer();
    }
}

function shootIntersection(p1, p2, circleX, circleY, radius) {
    const circle = { centerX: circleX, centerY: circleY, radius: radius };
    var dp = { x: p2.x - p1.x, y: p2.y - p1.y };
    var a, b, c, bb4ac, mu1, mu2;

    a = dp.x * dp.x + dp.y * dp.y;
    b = 2 * (dp.x * (p1.x - circle.centerX) + dp.y * (p1.y - circle.centerY));
    c = circle.centerX * circle.centerX + circle.centerY * circle.centerY;
    c += p1.x * p1.x + p1.y * p1.y;
    c -= 2 * (circle.centerX * p1.x + circle.centerY * p1.y);
    c -= circle.radius * circle.radius;
    bb4ac = b * b - 4 * a * c; 
    if (Math.abs(a) < Math.Epsilon || bb4ac < 0) {
        //  line does not intersect
        return undefined;
    }
    mu1 = (-b + Math.sqrt(bb4ac)) / (2 * a);
    mu2 = (-b - Math.sqrt(bb4ac)) / (2 * a);
    
    const result1 = { x: p1.x + mu1 * (p2.x - p1.x), y: p1.y + mu1 * (p2.y - p1.y) };
    const result2 = { x: p1.x + mu2 * (p2.x - p1.x), y: p1.y + mu2 * (p2.y - p1.y) };

    if( (Math.pow(result1.x - p1.x, 2) + Math.pow(result1.y - p1.y, 2)) < (Math.pow(result2.x - p1.x, 2) + Math.pow(result2.y - p1.y, 2)) ) {
        return result1;
    } else {
        return result2;
    }
}

//addRandomNpcs(100);

//createAiPlayer("루리");
//createAiPlayer("라시");
//createAiPlayer("살인마");
//createAiPlayer("제임스");
//createAiPlayer("후아암");
//createAiPlayer("바보냥");
//createAiPlayer("이카");
//createAiPlayer("후하");

setInterval(function() {
    for(var i = 0; i < npcs.length; i++) {
        const npc = npcs[npcs[i]];
        if(npc) {
            if(npc.x !== npc.destinationX || npc.y !== npc.destinationY) {
                const distance = getDistance(npc.x, npc.y, npc.destinationX, npc.destinationY);
                if(npc.speed >= distance) {
                    npc.x = npc.destinationX;
                    npc.y = npc.destinationY;
                    sendAll('npc_destination', { id: npc.id, x: npc.x, y: npc.y, destinationX: npc.destinationX, destinationY: npc.destinationY });
                } else {
                    const ratio = npc.speed / distance;
                    npc.x += ((npc.destinationX - npc.x) * ratio);
                    npc.y += ((npc.destinationY - npc.y) * ratio);
                }
            } else {
                if(npc.isPathMovingActive) {
                    npc.currentMovingPathIndex++;
                    if(npc.currentMovingPathIndex < npc.movingPath.length) {
                        npc.destinationX = npc.movingPath[npc.currentMovingPathIndex].x;
                        npc.destinationY = npc.movingPath[npc.currentMovingPathIndex].y;
                        sendAll('npc_destination', { id: npc.id, x: npc.x, y: npc.y, destinationX: npc.destinationX, destinationY: npc.destinationY });
                        //console.log('moveto: (' + npc.destinationX + ', ' + npc.destinationY + ')');
                    } else {
                        npc.isPathMovingActive = false;
                    }
                } else {
                    if(Math.random() < 0.005) {
                        setRandomDestinationPath(npc);
                        //setRandomDestination(npc, (Math.random() * 250) + 50);
                        sendAll('npc_destination', { id: npc.id, x: npc.x, y: npc.y, destinationX: npc.destinationX, destinationY: npc.destinationY });
                    }
                }
            }
        }
    }
}, 1000 / 60);

////////////////////////////////////////////////////////



function getPlayersInSight(player, range) {
    function getRayIntersection(ray, segment){
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
        if (r_dx / r_mag == s_dx / s_mag && r_dy / r_mag == s_dy / s_mag) { // 기울기 같음
            return null;
        }
    
        // SOLVE FOR T1 & T2
        // r_px+r_dx*T1 = s_px+s_dx*T2 && r_py+r_dy*T1 = s_py+s_dy*T2
        // ==> T1 = (s_px+s_dx*T2-r_px)/r_dx = (s_py+s_dy*T2-r_py)/r_dy
        // ==> s_px*r_dy + s_dx*T2*r_dy - r_px*r_dy = s_py*r_dx + s_dy*T2*r_dx - r_py*r_dx
        // ==> T2 = (r_dx*(s_py-r_py) + r_dy*(r_px-s_px))/(s_dx*r_dy - s_dy*r_dx)
        var T2 = (r_dx * (s_py - r_py) + r_dy * (r_px - s_px)) / (s_dx * r_dy - s_dy * r_dx);
        var T1 = (s_px + s_dx * T2 - r_px) / r_dx;
    
        // Must be within parametic whatevers for RAY/SEGMENT
        if (T1 < 0) return null;
        if (T2 < 0 || T2 > 1) return null;
    
        // Return the POINT OF INTERSECTION
        return {
            x: r_px + r_dx * T1,
            y: r_py + r_dy * T1,
            param: T1
        };
    }

    var rayX = player.x + (player.width / 2);
    var rayY = player.y + (player.height / 2);

    // Get all angles
    var uniqueAngles = [];

    var postEvent = undefined;

    var startAngle = (Math.PI / 180 * (-55 + (player.direction % 360)));
    var endAngle = (Math.PI / 180 * (55 + (player.direction % 360)));
    if(startAngle < -Math.PI) {
        startAngle += (Math.PI * 2);
        postEvent = function(intersects) {
            const offset = (Math.PI * 2);
            for (var j = 0; j < intersects.length; j++) {
                if(intersects[j].angle > 0) {
                    intersects[j].angle -= offset;
                }
            }
        }
   }
    if(endAngle > Math.PI) {
        endAngle -= (Math.PI * 2);
        postEvent = function(intersects) {
            const offset = (Math.PI * 2);
            for (var j = 0; j < intersects.length; j++) {
                if(intersects[j].angle < 0) {
                    intersects[j].angle += offset;
                }
            }
        }
    }

    // uniqueAngles.push(startAngle);
    // uniqueAngles.push(endAngle);

    for(var j = 0; j < clients.length; j++) {
        const client = clients[clients[j]];
        if(client && client.id !== player.id) {
            const clientCenterX = client.x + (client.width / 2);
            const clientCenterY = client.y + (client.height / 2);

            const distance = getDistance(rayX, rayY, clientCenterX, clientCenterY);
            if(distance < range) {
                const angle = Math.atan2(clientCenterY - rayY, clientCenterX - rayX);
                uniqueAngles.push({ angle: angle, distance: distance, target: client });
            }
        }
    }

    for(var j = 0; j < aiPlayers.length; j++) {
        const aiPlayer = aiPlayers[aiPlayers[j]];
        if(aiPlayer && aiPlayer.id !== player.id) {
            const clientCenterX = aiPlayer.x + (aiPlayer.width / 2);
            const clientCenterY = aiPlayer.y + (aiPlayer.height / 2);

            const distance = getDistance(rayX, rayY, clientCenterX, clientCenterY);
            if(distance < range) {
                const angle = Math.atan2(clientCenterY - rayY, clientCenterX - rayX);
                uniqueAngles.push({ angle: angle, distance: distance, target: aiPlayer });
            }
        }
    }

    var result = [];

    for (var j = 0; j < uniqueAngles.length; j++) {
        var angle = uniqueAngles[j].angle;

        if ((startAngle < endAngle ? (startAngle <= angle && angle <= endAngle) : (startAngle <= angle || angle <= endAngle))) {
            var dx = Math.cos(angle);
            var dy = Math.sin(angle);

            var ray = { a: { x: rayX, y: rayY }, b: { x: rayX + dx, y: rayY + dy } };

            var closestIntersect = null;
            
            for (var i = 0; i < mapSegments.length; i++) {
                var intersect = getRayIntersection(ray, mapSegments[i]);
                if (!intersect) continue;
                if (!closestIntersect || intersect.param < closestIntersect.param) {
                    closestIntersect = intersect;
                }
            }
            if (!closestIntersect) continue;
            closestIntersect.angle = angle;
            
            const distance = getDistance(rayX, rayY, closestIntersect.x, closestIntersect.y);
            if(uniqueAngles[j].distance < distance) {
                result.push(uniqueAngles[j]);
            } else {
                //console.log(uniqueAngles[j].distance + ", " + distance);
                //console.log(closestIntersect);
            }
        }
    }
    if(postEvent) {
        //postEvent(intersects);
    }
    
    result = result.sort(function (a, b) {
        return a.distance - b.distance;
    });

    return result.length > 0 ? result : undefined;
}


function getShootInfo(player, targetPoint) {
    var muzzlePoint =  { x: player.x + (player.width / 2), y: player.y + (player.height / 2) };

    var muzzleOffsetX = 0;
    var muzzleOffsetY = 0;
    var shootRange = 1000;
    var deviationAngle = 0;
    switch (player.weapon) {
        case 'handgun':
            backDelay = 200;
            muzzleOffsetX = 29;
            muzzleOffsetY = 8;

            deviationAngle = ((Math.PI / 180) * (1 - (Math.random() * 2)));
            break;
        case 'rifle':
            backDelay = 50;
            muzzleOffsetX = 38;
            muzzleOffsetY = 6.5;

            deviationAngle = ((Math.PI / 180) * (2 - (Math.random() * 4)));
            break;
        case 'shotgun':
            backDelay = 700;
            muzzleOffsetX = 38;
            muzzleOffsetY = 6.5;
            break;
    }

    if (player.speedX !== 0 || player.speedY !== 0) {
        deviationAngle *= 3;
    }

    const muzzleAngle = (Math.atan2(muzzleOffsetY, muzzleOffsetX) + (player.direction * Math.PI / 180));
    const muzzleDistance = Math.sqrt((muzzleOffsetX * muzzleOffsetX) + (muzzleOffsetY * muzzleOffsetY));
    muzzlePoint.x += (Math.cos(muzzleAngle) * muzzleDistance);
    muzzlePoint.y += (Math.sin(muzzleAngle) * muzzleDistance);

    var bulletAngle = 0.0;
    if (targetPoint !== undefined) {
        const bulletRadian = Math.atan2((targetPoint.y - muzzlePoint.y), (targetPoint.x - muzzlePoint.x)) + (deviationAngle);
        bulletAngle = (bulletRadian * 180 / Math.PI);
        targetPoint.x = muzzlePoint.x + (Math.cos(bulletRadian) * shootRange);
        targetPoint.y = muzzlePoint.y + (Math.sin(bulletRadian) * shootRange);
    } else {
        targetPoint = { x: muzzleOffsetY + shootRange, y: muzzleOffsetY };
        const targetAngle = (Math.atan2(targetPoint.y, targetPoint.x) + (player.direction * Math.PI / 180)) + deviationAngle;
        const targetDistance = Math.sqrt((targetPoint.x * targetPoint.x) + (targetPoint.y * targetPoint.y));
        targetPoint.x = (Math.cos(targetAngle) * targetDistance) + (player.x + (player.width / 2));
        targetPoint.y = (Math.sin(targetAngle) * targetDistance) + (player.y + (player.height / 2));

        bulletAngle = (targetAngle * 180 / Math.PI);
    }

    return {
        muzzle: muzzlePoint, target: targetPoint,
        angle: bulletAngle
    };
}


function aiProcess(aiPlayer) {
    if (aiPlayer) {
        const aiCenterX = aiPlayer.x + (aiPlayer.width / 2);
        const aiCenterY = aiPlayer.y + (aiPlayer.height / 2);
        //
        const inSightPlayers = getPlayersInSight(aiPlayer, 900);
        if (inSightPlayers) {

        }

        switch (aiPlayer.fsm.state) {
            case 'roam':
                if (inSightPlayers) {
                    aiPlayer.fsm.state = 'attack';
                    aiPlayer.fsm.attackTarget = inSightPlayers[0].target;
                    setDestinationPath(aiPlayer, aiPlayer.fsm.attackTarget);
                }
                break;
            case 'attack':
                var attackTargetVisible = false;
                if (inSightPlayers) {
                    for (var j = 0; j < inSightPlayers.length; j++) {
                        if (inSightPlayers[j].target.id === aiPlayer.fsm.attackTarget.id) {
                            attackTargetVisible = true;
                            break;
                        }
                    }
                }
                if (getDistance(aiCenterX, aiCenterY, aiPlayer.fsm.attackTarget.x, aiPlayer.fsm.attackTarget.y) > 500 || !attackTargetVisible) {
                    //console.log("chase");
                    setDestinationPath(aiPlayer, aiPlayer.fsm.attackTarget);
                } else {
                    if (aiPlayer.destinationX !== aiPlayer.x || aiPlayer.destinationY !== aiPlayer.y) {
                        aiPlayer.destinationX = aiPlayer.x;
                        aiPlayer.destinationY = aiPlayer.y;
                        aiPlayer.isPathMovingActive = false;
                        aiPlayer.speedX = 0;
                        aiPlayer.speedY = 0;
                        sendAll('user_speed', { id: aiPlayer.id, speedX: aiPlayer.speedX, speedY: aiPlayer.speedY });
                        sendAll('user_position', { id: aiPlayer.id, x: aiPlayer.x, y: aiPlayer.y });
                    } else {
                        const newDirectionRadian = Math.atan2(aiPlayer.fsm.attackTarget.y - aiPlayer.y, aiPlayer.fsm.attackTarget.x - aiPlayer.x);
                        const newDirection = newDirectionRadian / Math.PI * 180;
                        if (aiPlayer.direction !== newDirection) {
                            const dDirection = (newDirection - aiPlayer.direction);
                            if (Math.abs(dDirection) < 10) {
                                aiPlayer.direction = newDirection;
                            } else {
                                aiPlayer.direction += (dDirection / 3);
                            }
                            sendAll('user_direction', { id: aiPlayer.id, direction: aiPlayer.direction });
                        }
                    }

                    if (!aiPlayer.lastShootTime || (Date.now() - aiPlayer.lastShootTime) > 200) {
                        aiPlayer.lastShootTime = Date.now();

                        const shootInfo = getShootInfo(aiPlayer, { x: aiPlayer.fsm.attackTarget.x, y: aiPlayer.fsm.attackTarget.y });
                        shootProcess(aiPlayer.id, aiPlayer.weapon, 'ai', shootInfo.muzzle.x, shootInfo.muzzle.y, shootInfo.target.x, shootInfo.target.y);
                        sendAll('user_shoot', { id: aiPlayer.id, weapon: aiPlayer.weapon, muzzlePoint: shootInfo.muzzle, targetPoint: shootInfo.target, angle: shootInfo.angle });
                    }
                }
                break;
        }
        //

        // 이동처리
        if (aiPlayer.x !== aiPlayer.destinationX || aiPlayer.y !== aiPlayer.destinationY) {
            const distance = getDistance(aiPlayer.x, aiPlayer.y, aiPlayer.destinationX, aiPlayer.destinationY);
            if (3 >= distance) {
                aiPlayer.x = aiPlayer.destinationX;
                aiPlayer.y = aiPlayer.destinationY;

                aiPlayer.speedX = 0;
                aiPlayer.speedY = 0;
                sendAll('user_speed', { id: aiPlayer.id, speedX: aiPlayer.speedX, speedY: aiPlayer.speedY });
                sendAll('user_position', { id: aiPlayer.id, x: aiPlayer.x, y: aiPlayer.y });
            } else {
                const newDirectionRadian = Math.atan2(aiPlayer.destinationY - aiPlayer.y, aiPlayer.destinationX - aiPlayer.x);
                const newDirection = newDirectionRadian / Math.PI * 180;

                const newSpeedX = (Math.cos(newDirectionRadian) * 3);
                const newSpeedY = (Math.sin(newDirectionRadian) * 3);

                aiPlayer.x += newSpeedX;
                aiPlayer.y += newSpeedY;

                if (aiPlayer.speedX !== newSpeedX || aiPlayer.speedY !== newSpeedY) {
                    aiPlayer.speedX = newSpeedX;
                    aiPlayer.speedY = newSpeedY;
                    sendAll('user_speed', { id: aiPlayer.id, speedX: aiPlayer.speedX, speedY: aiPlayer.speedY });
                    sendAll('user_position', { id: aiPlayer.id, x: aiPlayer.x, y: aiPlayer.y });
                }
                if (aiPlayer.direction !== newDirection) {
                    const dDirection = (newDirection - aiPlayer.direction);
                    if (Math.abs(dDirection) < 10) {
                        aiPlayer.direction = newDirection;
                    } else {
                        aiPlayer.direction += (dDirection / 3);
                    }
                    sendAll('user_direction', { id: aiPlayer.id, direction: aiPlayer.direction });
                }
            }
        } else {
            if (aiPlayer.isPathMovingActive) {
                aiPlayer.currentMovingPathIndex++;
                if (aiPlayer.currentMovingPathIndex < aiPlayer.movingPath.length) {
                    aiPlayer.destinationX = aiPlayer.movingPath[aiPlayer.currentMovingPathIndex].x;
                    aiPlayer.destinationY = aiPlayer.movingPath[aiPlayer.currentMovingPathIndex].y;
                } else {
                    aiPlayer.isPathMovingActive = false;
                }
            } else {
                if (aiPlayer.fsm.state === 'roam') {
                    if (Math.random() < 0.005) {
                        setRandomDestinationPath(aiPlayer);
                    } else {
                        aiPlayer.direction += 1;
                        sendAll('user_direction', { id: aiPlayer.id, direction: aiPlayer.direction });
                    }
                }
            }
        }
    }
}



// setInterval(function() {

//     for(var i = 0; i < aiPlayers.length; i++) {
//         const aiPlayer = aiPlayers[aiPlayers[i]];
//         aiProcess(aiPlayer);
//     }
// }, 1000 / 60);

////////////////////////////////////////////////////////

// setInterval(function() {
//     for(var i = 0; i < clients.length; i++) {
//         const client = clients[clients[i]];
//         if(client) {
//             if(client.speedX !== 0 || client.speedY !== 0) {

//             } 
//         }
//     }
// }, 1000 / 60);
