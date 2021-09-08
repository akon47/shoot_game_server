const pathFinding = require("pathfinding");
const mapData = require("../../html/shoot_game/map_office.js").mapData;
const mapGrid = new pathFinding.Grid(mapData.width, mapData.height);
const walkablePositions = [];

for (let y = 0; y < mapData.height; y++) {
  for (let x = 0; x < mapData.width; x++) {
    const walkable = !mapData.wall_tiles.includes(
      mapData.data[y * mapData.width + x]
    );
    mapGrid.setWalkableAt(x, y, walkable);
    if (walkable) {
      walkablePositions.push({ x: x, y: y });
    }
  }
}

const mapSegments = createSegments(findMapHitBoxes());

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

  var segments = [];
  if (hitBoxes) {
    var tempSegments = [];
    for (var i = 0; i < hitBoxes.length; i++) {
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
          }
        );
      }
    }

    for (var i = 0; i < tempSegments.length; i++) {
      if (tempSegments[i].valid) {
        const slopeSrc = getSlope(tempSegments[i]);
        const interceptYSrc =
          tempSegments[i].a.y - tempSegments[i].a.x * slopeSrc;
        const leftSrc = Math.min(tempSegments[i].a.x, tempSegments[i].b.x);
        const topSrc = Math.min(tempSegments[i].a.y, tempSegments[i].b.y);
        const rightSrc = Math.max(tempSegments[i].a.x, tempSegments[i].b.x);
        const bottomSrc = Math.max(tempSegments[i].a.y, tempSegments[i].b.y);

        for (var j = 0; j < tempSegments.length; j++) {
          if (i !== j && tempSegments[j].valid) {
            // tempSegments[i] 안에 tempSegments[j] 가 포함되는지 검사 후 valid 체크
            const slopeDest = getSlope(tempSegments[j]);
            if (slopeSrc === slopeDest) {
              const interceptYDest =
                tempSegments[j].a.y - tempSegments[j].a.x * slopeSrc;
              if (interceptYSrc === interceptYDest) {
                const leftDest = Math.min(
                  tempSegments[j].a.x,
                  tempSegments[j].b.x
                );
                const topDest = Math.min(
                  tempSegments[j].a.y,
                  tempSegments[j].b.y
                );
                const rightDest = Math.max(
                  tempSegments[j].a.x,
                  tempSegments[j].b.x
                );
                const bottomDest = Math.max(
                  tempSegments[j].a.y,
                  tempSegments[j].b.y
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

    for (var i = 0; i < tempSegments.length; i++) {
      if (tempSegments[i].valid) {
        segments.push(tempSegments[i]);
      }
    }
  }
  return segments;
}

function findMapHitBoxes() {
  function isWall(x, y) {
    return mapData.wall_tiles.includes(mapData.data[y * mapData.width + x]);
  }

  function findLeftTopRight(findedHitbox) {
    function containsHitboxs(x, y) {
      for (var i = 0; i < findedHitbox.length; i++) {
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

    for (var y = 0; y < mapData.height; y++) {
      for (var x = 0; x < mapData.width; x++) {
        if (!containsHitboxs(x, y) && isWall(x, y)) {
          const left = x;
          const top = y;
          for (var r = x + 1; r < mapData.width; r++) {
            if (containsHitboxs(r, y) || !isWall(r, y)) {
              return { left: x, top: y, right: r - 1 };
            }

            //////////////////////////////////// 최대 가로 32 블럭으로 제한
            else {
              if (r - 1 - left >= 32) {
                return { left: x, top: y, right: r - 1 };
              }
            }
            /////////////////////////////////////
          }
          return { left: x, top: y, right: mapData.width - 1 };
        }
      }
    }
    return undefined;
  }

  function findBottom(leftTopRight) {
    for (var y = leftTopRight.top + 1; y < mapData.height; y++) {
      for (var x = leftTopRight.left; x <= leftTopRight.right; x++) {
        if (!isWall(x, y)) {
          return y - 1;
        }
      }

      //////////////////////////////////// 최대 세로 32 블럭으로 제한
      if (y - 1 - leftTopRight.top >= 32) {
        return y - 1;
      }
      /////////////////////////////////////
    }
    return mapData.height - 1;
  }

  var findedHitbox = [];
  var result = [];
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

var pathFinder = new pathFinding.AStarFinder({
  allowDiagonal: true,
  dontCrossCorners: true,
});

const findPath = (startX, startY, endX, endY) => {
  return pathFinder.findPath(startX, startY, endX, endY, mapGrid.clone());
};

module.exports = {
  getWalkableRandomPosition: () => {
    const point =
      walkablePositions[
        Math.floor(Math.random() * walkablePositions.length) %
          walkablePositions.length
      ];
    return {
      x: point.x * mapData.tile_width,
      y: point.y * mapData.tile_height,
    };
  },
  setRandomDestinationPath: (npc) => {
    if (npc) {
      const target =
        walkablePositions[
          Math.floor(Math.random() * walkablePositions.length) %
            walkablePositions.length
        ];
      const path = pathFinding.Util.compressPath(
        findPath(
          Math.floor(npc.x / mapData.tile_width),
          Math.floor(npc.y / mapData.tile_height),
          target.x,
          target.y
        )
      );

      npc.movingPath = [];
      for (let i = 0; i < path.length; i++) {
        npc.movingPath.push({
          x: path[i][0] * mapData.tile_width,
          y: path[i][1] * mapData.tile_height,
        });
      }
      npc.currentMovingPathIndex = 0;
      npc.isPathMovingActive = true;

      if (npc.movingPath.length > 0) {
        npc.destinationX = npc.movingPath[0].x;
        npc.destinationY = npc.movingPath[0].y;
      }
    }
  },
  mapSegments: mapSegments,
  setDestinationPath: (npc, target) => {
    if (npc && target) {
      const path = pathFinding.Util.compressPath(
        findPath(
          Math.floor(npc.x / mapData.tile_width),
          Math.floor(npc.y / mapData.tile_height),
          Math.floor(target.x / mapData.tile_width),
          Math.floor(target.y / mapData.tile_height)
        )
      );

      npc.movingPath = [];
      for (let i = 1; i < path.length; i++) {
        npc.movingPath.push({
          x: path[i][0] * mapData.tile_width,
          y: path[i][1] * mapData.tile_height,
        });
      }
      npc.currentMovingPathIndex = 0;
      npc.isPathMovingActive = true;

      if (npc.movingPath.length > 0) {
        npc.destinationX = npc.movingPath[0].x;
        npc.destinationY = npc.movingPath[0].y;
      }
    }
  },
};
