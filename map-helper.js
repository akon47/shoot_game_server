"use strict";

// 클라이언트의 맵 데이터(map_*.js)를 전부 읽어 맵별 길찾기 그리드와
// 시야 레이캐스트용 세그먼트를 만들고, 라운드 로테이션에 따라 "활성 맵"을 전환한다.
// 주의: 좌표계가 두 가지다 — 길찾기는 타일 단위, 게임 로직은 픽셀 단위.
// findMapHitBoxes/createSegments 는 클라이언트 map_class.js 와 같은 알고리즘의 서버 사본이다.

const pathFinding = require("pathfinding");
const config = require("./config");

// config.MAP_ROTATION 의 이름으로 ../shoot_game/map_{name}.js 를 읽는다
const maps = {};
for (let i = 0; i < config.MAP_ROTATION.length; i++) {
  const name = config.MAP_ROTATION[i];
  maps[name] = buildMap(name);
}

let activeMapName = config.MAP_ROTATION[0];

function buildMap(name) {
  const mapData = require("../shoot_game/map_" + name + ".js").mapData;

  const grid = new pathFinding.Grid(mapData.width, mapData.height);
  const walkablePositions = [];
  for (let y = 0; y < mapData.height; y++) {
    for (let x = 0; x < mapData.width; x++) {
      const walkable = !mapData.wall_tiles.includes(
        mapData.data[y * mapData.width + x],
      );
      grid.setWalkableAt(x, y, walkable);
      if (walkable) {
        walkablePositions.push({ x: x, y: y });
      }
    }
  }

  const segments = createSegments(findMapHitBoxes(mapData));
  console.log(
    "map loaded: " +
      name +
      " (" +
      mapData.width +
      "x" +
      mapData.height +
      ", walkable " +
      walkablePositions.length +
      ", segments " +
      segments.length +
      ")",
  );

  return {
    mapData: mapData,
    grid: grid,
    walkablePositions: walkablePositions,
    segments: segments,
  };
}

function getActiveMap() {
  return maps[activeMapName];
}

function createSegments(hitBoxes) {
  function getSlope(segment) {
    const dx = segment.b.x - segment.a.x;
    const dy = segment.b.y - segment.a.y;
    if (dx === 0) {
      return undefined;
    } else {
      return dy / dx;
    }
  }

  const segments = [];
  if (hitBoxes) {
    const tempSegments = [];
    for (let i = 0; i < hitBoxes.length; i++) {
      const hitBox = hitBoxes[i];
      if (hitBox) {
        tempSegments.push(
          {
            a: { x: hitBox.left, y: hitBox.top },
            b: { x: hitBox.right, y: hitBox.top },
            valid: true,
          },
          {
            a: { x: hitBox.right, y: hitBox.top },
            b: { x: hitBox.right, y: hitBox.bottom },
            valid: true,
          },
          {
            a: { x: hitBox.left, y: hitBox.bottom },
            b: { x: hitBox.right, y: hitBox.bottom },
            valid: true,
          },
          {
            a: { x: hitBox.left, y: hitBox.top },
            b: { x: hitBox.left, y: hitBox.bottom },
            valid: true,
          },
        );
      }
    }

    for (let i = 0; i < tempSegments.length; i++) {
      if (tempSegments[i].valid) {
        const slopeSrc = getSlope(tempSegments[i]);
        const interceptYSrc =
          tempSegments[i].a.y - tempSegments[i].a.x * slopeSrc;
        const leftSrc = Math.min(tempSegments[i].a.x, tempSegments[i].b.x);
        const topSrc = Math.min(tempSegments[i].a.y, tempSegments[i].b.y);
        const rightSrc = Math.max(tempSegments[i].a.x, tempSegments[i].b.x);
        const bottomSrc = Math.max(tempSegments[i].a.y, tempSegments[i].b.y);

        for (let j = 0; j < tempSegments.length; j++) {
          if (i !== j && tempSegments[j].valid) {
            // tempSegments[i] 안에 tempSegments[j] 가 포함되는지 검사 후 valid 체크
            const slopeDest = getSlope(tempSegments[j]);
            if (slopeSrc === slopeDest) {
              const interceptYDest =
                tempSegments[j].a.y - tempSegments[j].a.x * slopeSrc;
              if (interceptYSrc === interceptYDest) {
                const leftDest = Math.min(
                  tempSegments[j].a.x,
                  tempSegments[j].b.x,
                );
                const topDest = Math.min(
                  tempSegments[j].a.y,
                  tempSegments[j].b.y,
                );
                const rightDest = Math.max(
                  tempSegments[j].a.x,
                  tempSegments[j].b.x,
                );
                const bottomDest = Math.max(
                  tempSegments[j].a.y,
                  tempSegments[j].b.y,
                );

                if (
                  leftSrc <= leftDest &&
                  rightSrc >= leftDest &&
                  leftSrc <= rightDest &&
                  rightSrc >= rightDest &&
                  topSrc <= topDest &&
                  topSrc >= topDest &&
                  bottomSrc <= bottomDest &&
                  bottomSrc >= bottomDest
                ) {
                  tempSegments[j].valid = false;
                }
              }
            }
          }
        }
      }
    }

    for (let i = 0; i < tempSegments.length; i++) {
      if (tempSegments[i].valid) {
        segments.push(tempSegments[i]);
      }
    }
  }
  return segments;
}

function findMapHitBoxes(mapData) {
  function isWall(x, y) {
    return mapData.wall_tiles.includes(mapData.data[y * mapData.width + x]);
  }

  function findLeftTopRight(findedHitbox) {
    function containsHitboxs(x, y) {
      for (let i = 0; i < findedHitbox.length; i++) {
        if (
          x >= findedHitbox[i].left &&
          x <= findedHitbox[i].right &&
          y >= findedHitbox[i].top &&
          y <= findedHitbox[i].bottom
        ) {
          return true;
        }
      }
      return false;
    }

    for (let y = 0; y < mapData.height; y++) {
      for (let x = 0; x < mapData.width; x++) {
        if (!containsHitboxs(x, y) && isWall(x, y)) {
          const left = x;
          for (let r = x + 1; r < mapData.width; r++) {
            if (containsHitboxs(r, y) || !isWall(r, y)) {
              return { left: x, top: y, right: r - 1 };
            }

            // 최대 가로 32 블럭으로 제한
            if (r - 1 - left >= 32) {
              return { left: x, top: y, right: r - 1 };
            }
          }
          return { left: x, top: y, right: mapData.width - 1 };
        }
      }
    }
    return undefined;
  }

  function findBottom(leftTopRight) {
    for (let y = leftTopRight.top + 1; y < mapData.height; y++) {
      for (let x = leftTopRight.left; x <= leftTopRight.right; x++) {
        if (!isWall(x, y)) {
          return y - 1;
        }
      }

      // 최대 세로 32 블럭으로 제한
      if (y - 1 - leftTopRight.top >= 32) {
        return y - 1;
      }
    }
    return mapData.height - 1;
  }

  const findedHitbox = [];
  const result = [];
  while (true) {
    const leftTopRight = findLeftTopRight(findedHitbox);
    if (leftTopRight) {
      const bottom = findBottom(leftTopRight);
      findedHitbox.push({
        left: leftTopRight.left,
        top: leftTopRight.top,
        right: leftTopRight.right,
        bottom: bottom,
      });
      result.push({
        left: leftTopRight.left * mapData.tile_width,
        top: leftTopRight.top * mapData.tile_height,
        right:
          leftTopRight.left * mapData.tile_width +
          ((leftTopRight.right - leftTopRight.left) * mapData.tile_width +
            mapData.tile_width),
        bottom:
          leftTopRight.top * mapData.tile_height +
          ((bottom - leftTopRight.top) * mapData.tile_height +
            mapData.tile_height),
      });
    } else {
      break;
    }
  }

  return result;
}

const pathFinder = new pathFinding.AStarFinder({
  allowDiagonal: true,
  dontCrossCorners: true,
});

// A* 가 그리드를 변형하므로 매번 clone 을 사용한다
function findPath(map, startX, startY, endX, endY) {
  return pathFinder.findPath(startX, startY, endX, endY, map.grid.clone());
}

function applyPath(npc, map, path) {
  npc.movingPath = [];
  for (let i = 1; i < path.length; i++) {
    npc.movingPath.push({
      x: path[i][0] * map.mapData.tile_width,
      y: path[i][1] * map.mapData.tile_height,
    });
  }
  npc.currentMovingPathIndex = 0;
  npc.isPathMovingActive = true;

  if (npc.movingPath.length > 0) {
    npc.destinationX = npc.movingPath[0].x;
    npc.destinationY = npc.movingPath[0].y;
  }
}

module.exports = {
  setActiveMap: (name) => {
    if (maps[name]) {
      activeMapName = name;
    }
  },
  getActiveMapName: () => activeMapName,
  getMapSegments: () => getActiveMap().segments,
  getWalkableRandomPosition: () => {
    const map = getActiveMap();
    const point =
      map.walkablePositions[
        Math.floor(Math.random() * map.walkablePositions.length) %
          map.walkablePositions.length
      ];
    return {
      x: point.x * map.mapData.tile_width,
      y: point.y * map.mapData.tile_height,
    };
  },
  setRandomDestinationPath: (npc) => {
    if (npc) {
      const map = getActiveMap();
      const target =
        map.walkablePositions[
          Math.floor(Math.random() * map.walkablePositions.length) %
            map.walkablePositions.length
        ];
      const path = pathFinding.Util.compressPath(
        findPath(
          map,
          Math.floor(npc.x / map.mapData.tile_width),
          Math.floor(npc.y / map.mapData.tile_height),
          target.x,
          target.y,
        ),
      );
      applyPath(npc, map, path);
    }
  },
  setDestinationPath: (npc, target) => {
    if (npc && target) {
      const map = getActiveMap();
      const path = pathFinding.Util.compressPath(
        findPath(
          map,
          Math.floor(npc.x / map.mapData.tile_width),
          Math.floor(npc.y / map.mapData.tile_height),
          Math.floor(target.x / map.mapData.tile_width),
          Math.floor(target.y / map.mapData.tile_height),
        ),
      );
      applyPath(npc, map, path);
    }
  },
  isWalkablePosition: (pixelX, pixelY) => {
    const map = getActiveMap();
    const tileX = Math.floor(pixelX / map.mapData.tile_width);
    const tileY = Math.floor(pixelY / map.mapData.tile_height);
    if (
      tileX < 0 ||
      tileY < 0 ||
      tileX >= map.mapData.width ||
      tileY >= map.mapData.height
    ) {
      return false;
    }
    return map.grid.isWalkableAt(tileX, tileY);
  },
};
