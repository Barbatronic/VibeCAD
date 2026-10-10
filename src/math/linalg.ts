/**
 * Algèbre linéaire dense minimale pour le solveur d'esquisse (systèmes de quelques centaines
 * d'inconnues au plus). Matrices stockées ligne par ligne dans des Float64Array.
 */

/** Résout A·x = b pour A symétrique définie positive (n × n). Renvoie null si A n'est pas SPD. */
export function choleskySolve(A: Float64Array, n: number, b: Float64Array): Float64Array | null {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j]!;
      for (let k = 0; k < j; k++) sum -= L[i * n + k]! * L[j * n + k]!;
      if (i === j) {
        if (!(sum > 0)) return null;
        L[i * n + i] = Math.sqrt(sum);
      } else {
        L[i * n + j] = sum / L[j * n + j]!;
      }
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let k = 0; k < i; k++) sum -= L[i * n + k]! * y[k]!;
    y[i] = sum / L[i * n + i]!;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]!;
    for (let k = i + 1; k < n; k++) sum -= L[k * n + i]! * x[k]!;
    x[i] = sum / L[i * n + i]!;
  }
  return x;
}

export interface RowReduction {
  rank: number;
  /** Colonnes pivots (variables déterminées par les équations). */
  pivotColumns: number[];
  /** Base du noyau : chaque vecteur décrit un mouvement libre (degré de liberté). */
  nullBasis: Float64Array[];
}

/**
 * Réduction de Gauss-Jordan avec pivot partiel d'une matrice m × n.
 * `relTol` est relative à la plus grande valeur absolue de la matrice.
 */
export function rowReduce(M: Float64Array, m: number, n: number, relTol = 1e-9): RowReduction {
  const A = Float64Array.from(M);
  let maxAbs = 0;
  for (const v of A) maxAbs = Math.max(maxAbs, Math.abs(v));
  const tol = Math.max(maxAbs * relTol, 1e-14);
  const pivotColumns: number[] = [];
  let row = 0;
  for (let col = 0; col < n && row < m; col++) {
    let best = row;
    let bestAbs = Math.abs(A[row * n + col]!);
    for (let r = row + 1; r < m; r++) {
      const v = Math.abs(A[r * n + col]!);
      if (v > bestAbs) {
        best = r;
        bestAbs = v;
      }
    }
    if (bestAbs <= tol) continue;
    if (best !== row) {
      for (let c = 0; c < n; c++) {
        const t = A[row * n + c]!;
        A[row * n + c] = A[best * n + c]!;
        A[best * n + c] = t;
      }
    }
    const p = A[row * n + col]!;
    for (let c = 0; c < n; c++) A[row * n + c] = A[row * n + c]! / p;
    for (let r = 0; r < m; r++) {
      if (r === row) continue;
      const f = A[r * n + col]!;
      if (f === 0) continue;
      for (let c = 0; c < n; c++) A[r * n + c] = A[r * n + c]! - f * A[row * n + c]!;
    }
    pivotColumns.push(col);
    row++;
  }
  const rank = pivotColumns.length;
  const pivotSet = new Set(pivotColumns);
  const nullBasis: Float64Array[] = [];
  for (let free = 0; free < n; free++) {
    if (pivotSet.has(free)) continue;
    const v = new Float64Array(n);
    v[free] = 1;
    pivotColumns.forEach((pc, r) => {
      v[pc] = -A[r * n + free]!;
    });
    nullBasis.push(v);
  }
  return { rank, pivotColumns, nullBasis };
}
