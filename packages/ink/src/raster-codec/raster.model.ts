/**
 * Core data types.
 *
 * Everything in this library speaks two image shapes and nothing else:
 *
 * - {@link Raster} — what you get in and out: 8-bit RGBA, the same memory
 *   layout a `<canvas>` `ImageData` uses, so it needs no conversion to be
 *   re-encoded, handed to an OCR engine, or drawn.
 * - {@link GrayImage} — what the algorithms work on: one float per pixel.
 *   Float, not byte, because the pipeline divides by an estimated background
 *   and then correlates the result; doing that in 8 bits throws away the
 *   faint strokes that OCR cares about.
 */

/** One colour, in the same order and range as a raster's bytes: red, green, blue, alpha. */
export type Rgba = readonly [number, number, number, number]

/** A decoded image: 8-bit RGBA, row-major, 4 bytes per pixel, no padding. */
export interface Raster {
  width:  number
  height: number
  /** `width * height * 4` bytes, in R, G, B, A order. */
  data:   Uint8ClampedArray
}

/** A single-channel image. Values are normally in `[0, 1]` but are not clamped. */
export interface GrayImage {
  width:  number
  height: number
  data:   Float32Array
}

/** A single-channel mask. Every value is exactly `0` or `1`. */
export interface BinaryImage {
  width:  number
  height: number
  data:   Uint8Array
}

/**
 * Anything the library accepts as an image: encoded bytes in any format libvips
 * reads, a path to such a file, or an already-decoded raster.
 */
export type ImageInput = Raster | Uint8Array | ArrayBuffer | string

/** Allocate an opaque RGBA raster, filled with `fill` (white by default). */
export function createRaster (width: number, height: number, fill: [number, number, number, number] = [255, 255, 255, 255]): Raster {
  assertDimensions(width, height)
  const data = new Uint8ClampedArray(width * height * 4)
  const [r, g, b, a] = fill
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = a
  }

  return { width, height, data }
}

export function createGray (width: number, height: number): GrayImage {
  assertDimensions(width, height)

  return { width, height, data: new Float32Array(width * height) }
}

export function createBinary (width: number, height: number): BinaryImage {
  assertDimensions(width, height)

  return { width, height, data: new Uint8Array(width * height) }
}

export function cloneRaster (image: Raster): Raster {
  return { width: image.width, height: image.height, data: Uint8ClampedArray.from(image.data) }
}

/**
 * True when the value is already a decoded raster.
 *
 * The check is structural rather than `instanceof` because a raster is a plain
 * object on purpose: callers should be able to hand us a canvas `ImageData`,
 * or something they built themselves, without importing anything from here.
 */
export function isRaster (value: unknown): value is Raster {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Raster>

  return (
    typeof candidate.width === 'number' &&
    typeof candidate.height === 'number' &&
    ArrayBuffer.isView(candidate.data) &&
    candidate.data.byteLength === candidate.width * candidate.height * 4
  )
}

/** Narrow any accepted input to the bytes of an encoded image, or `null` if it is already decoded. */
export function toBytes (input: ImageInput): Uint8Array | null {
  if (isRaster(input)) return null
  if (typeof input === 'string')
    throw new TypeError('a path is not bytes; the codec opens paths itself')
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)

  throw new TypeError('expected a Raster, a Uint8Array/Buffer, or an ArrayBuffer')
}

/** Wrap bytes as a `Uint8ClampedArray` without copying when the alignment allows it. */
export function asClamped (data: Uint8Array): Uint8ClampedArray {
  return data instanceof Uint8ClampedArray
    ? data
    : new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
}

function assertDimensions (width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw new RangeError(`image dimensions must be positive integers, got ${width}x${height}`)
}
