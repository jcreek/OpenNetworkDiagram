// Simple grid-based A* pathfinding for orthogonal routing
// Returns a list of [x, y] points from start to end, or [] if no path found

export type Point = [number, number];

interface Node {
  x: number;
  y: number;
  g: number;
  h: number;
  f: number;
  parent?: Node;
}

export function astar(grid: number[][], start: Point, end: Point): Point[] {
  const height = grid.length;
  const width = grid[0].length;
  const open: Node[] = [];
  const closed: boolean[][] = Array.from({ length: height }, () => Array(width).fill(false));

  function heuristic([x, y]: Point): number {
    // Manhattan distance
    return Math.abs(x - end[0]) + Math.abs(y - end[1]);
  }

  open.push({ x: start[0], y: start[1], g: 0, h: heuristic(start), f: heuristic(start) });

  while (open.length > 0) {
    // Get node with lowest f
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    if (current.x === end[0] && current.y === end[1]) {
      // Reconstruct path
      const path: Point[] = [];
      let node: Node | undefined = current;
      while (node) {
        path.push([node.x, node.y]);
        node = node.parent;
      }
      return path.reverse();
    }
    closed[current.y][current.x] = true;
    // Explore neighbors (orthogonal only)
    for (const [dx, dy] of [[1,0], [-1,0], [0,1], [0,-1]]) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (grid[ny][nx] === 1 || closed[ny][nx]) continue; // Obstacle or closed
      const g = current.g + 1;
      const h = heuristic([nx, ny]);
      const existing = open.find(n => n.x === nx && n.y === ny);
      if (!existing) {
        open.push({ x: nx, y: ny, g, h, f: g + h, parent: current });
      } else if (g < existing.g) {
        existing.g = g;
        existing.f = g + h;
        existing.parent = current;
      }
    }
  }
  return [];
}
