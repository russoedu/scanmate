import { jacobiEigen, smallestEigenvector, solve } from './solve.algorithm'

describe('solve', () => {
  it('solves a well-conditioned 3x3 system', () => {
    // 2x +  y -  z =  8
    // -3x - y + 2z = -11
    // -2x + y + 2z = -3      ->  x = 2, y = 3, z = -1
    const a = Float64Array.from([2, 1, -1, -3, -1, 2, -2, 1, 2])
    const b = Float64Array.from([8, -11, -3])
    const x = solve(a, b, 3)

    expect(x).not.toBeNull()
    expect(x?.[0]).toBeCloseTo(2, 9)
    expect(x?.[1]).toBeCloseTo(3, 9)
    expect(x?.[2]).toBeCloseTo(-1, 9)
  })

  it('needs pivoting and still works when the first pivot is zero', () => {
    const a = Float64Array.from([0, 1, 1, 0, 1])
    const b = Float64Array.from([1, 2])
    const x = solve(a.subarray(0, 4), b, 2)

    expect(x).not.toBeNull()
  })

  it('reports a singular system instead of throwing', () => {
    const a = Float64Array.from([1, 2, 2, 4])
    const b = Float64Array.from([1, 2])

    expect(solve(a, b, 2)).toBeNull()
  })

  it('does not modify its inputs', () => {
    const a = Float64Array.from([2, 0, 0, 2])
    const b = Float64Array.from([4, 6])
    solve(a, b, 2)

    expect([...a]).toEqual([2, 0, 0, 2])
    expect([...b]).toEqual([4, 6])
  })
})

describe('jacobiEigen', () => {
  it('diagonalises a symmetric matrix', () => {
    const a = Float64Array.from([4, 1, 1, 3])
    const { values, vectors } = jacobiEigen(a, 2)

    // Eigenvalues of [[4,1],[1,3]] are (7 +/- sqrt(5)) / 2, in either order.
    expect(Math.min(...values)).toBeCloseTo((7 - Math.sqrt(5)) / 2, 9)
    expect(Math.max(...values)).toBeCloseTo((7 + Math.sqrt(5)) / 2, 9)

    // Each column must satisfy A v = lambda v.
    for (let col = 0; col < 2; col++) {
      const v = [vectors[col], vectors[2 + col]]
      const av = [a[0] * v[0] + a[1] * v[1], a[2] * v[0] + a[3] * v[1]]
      expect(av[0]).toBeCloseTo(values[col] * v[0], 9)
      expect(av[1]).toBeCloseTo(values[col] * v[1], 9)
    }
  })
})

describe('smallestEigenvector', () => {
  it('finds the direction the data constrains least', () => {
    // Diagonal matrix: the smallest eigenvalue sits on axis 1.
    const a = Float64Array.from([9, 0, 0, 0, 0.5, 0, 0, 0, 4])
    const v = smallestEigenvector(a, 3)

    expect(Math.abs(v[1])).toBeCloseTo(1, 6)
    expect(Math.abs(v[0])).toBeCloseTo(0, 6)
    expect(Math.abs(v[2])).toBeCloseTo(0, 6)
  })

  it('returns a unit vector', () => {
    const a = Float64Array.from([3, 1, 1, 2])
    const v = smallestEigenvector(a, 2)

    expect(Math.hypot(v[0], v[1])).toBeCloseTo(1, 9)
  })
})
