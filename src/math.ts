import type { Matrix4, Pose, Quaternion, Vector3 } from "./types.js";

const EPSILON = 1e-8;

export function assertMatrix4(matrix: Matrix4): void {
  if (matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value))) {
    throw new Error("Expected a finite 4x4 matrix with 16 values.");
  }
}

export function subtract(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

export function normalize(vector: Vector3): Vector3 {
  const magnitude = length(vector);
  if (magnitude < EPSILON) {
    throw new Error("Cannot normalize a near-zero vector.");
  }

  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  };
}

export function multiplyMatrix4(a: Matrix4, b: Matrix4): number[] {
  assertMatrix4(a);
  assertMatrix4(b);

  const out = Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let k = 0; k < 4; k += 1) {
        value += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      }
      out[column * 4 + row] = value;
    }
  }

  return out;
}

export function transformPoint(matrix: Matrix4, point: Vector3): Vector3 {
  assertMatrix4(matrix);
  return {
    x:
      (matrix[0] ?? 0) * point.x +
      (matrix[4] ?? 0) * point.y +
      (matrix[8] ?? 0) * point.z +
      (matrix[12] ?? 0),
    y:
      (matrix[1] ?? 0) * point.x +
      (matrix[5] ?? 0) * point.y +
      (matrix[9] ?? 0) * point.z +
      (matrix[13] ?? 0),
    z:
      (matrix[2] ?? 0) * point.x +
      (matrix[6] ?? 0) * point.y +
      (matrix[10] ?? 0) * point.z +
      (matrix[14] ?? 0),
  };
}

export function quaternionFromMatrix(matrix: Matrix4): Quaternion {
  assertMatrix4(matrix);

  const m00 = matrix[0] ?? 1;
  const m01 = matrix[4] ?? 0;
  const m02 = matrix[8] ?? 0;
  const m10 = matrix[1] ?? 0;
  const m11 = matrix[5] ?? 1;
  const m12 = matrix[9] ?? 0;
  const m20 = matrix[2] ?? 0;
  const m21 = matrix[6] ?? 0;
  const m22 = matrix[10] ?? 1;
  const trace = m00 + m11 + m22;

  let x: number;
  let y: number;
  let z: number;
  let w: number;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }

  const magnitude = Math.hypot(x, y, z, w);
  if (magnitude < EPSILON) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  return {
    x: x / magnitude,
    y: y / magnitude,
    z: z / magnitude,
    w: w / magnitude,
  };
}

export function poseFromMatrix(matrix: Matrix4): Pose {
  assertMatrix4(matrix);
  return {
    position: {
      x: matrix[12] ?? 0,
      y: matrix[13] ?? 0,
      z: matrix[14] ?? 0,
    },
    orientation: quaternionFromMatrix(matrix),
    matrix: [...matrix],
  };
}
