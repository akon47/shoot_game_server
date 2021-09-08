module.exports = {
  shootIntersection: (p1, p2, circleX, circleY, radius) => {
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

    const result1 = {
      x: p1.x + mu1 * (p2.x - p1.x),
      y: p1.y + mu1 * (p2.y - p1.y),
    };
    const result2 = {
      x: p1.x + mu2 * (p2.x - p1.x),
      y: p1.y + mu2 * (p2.y - p1.y),
    };

    if (
      Math.pow(result1.x - p1.x, 2) + Math.pow(result1.y - p1.y, 2) <
      Math.pow(result2.x - p1.x, 2) + Math.pow(result2.y - p1.y, 2)
    ) {
      return result1;
    } else {
      return result2;
    }
  },
  getDistance: (x1, y1, x2, y2) => {
    const dX = x2 - x1;
    const dY = y2 - y1;
    return Math.sqrt(Math.abs(dX * dX) + Math.abs(dY * dY));
  },
};
