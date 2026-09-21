import sharp from 'sharp'
import type { Sharp } from 'sharp'

import type { Raster } from './raster.model'
import type { ScanmateSource } from './source.contract'
import { asClamped, isRaster, toBytes } from './raster.model'

/**
 * Encoding and decoding, through libvips.
 *
 * ## Why this is native, and why it is asynchronous
 *
 * This package used to carry a pure-JavaScript codec - `pngjs` and `jpeg-js` -
 * on the grounds that a native binding is "the bytes that work on your laptop
 * are not the bytes that run in the function app". That reasoning described
 * building from source. `sharp` ships prebuilt libvips per platform as
 * `optionalDependencies`, so there is nothing to compile and no system libvips
 * to install, and a lockfile carries every platform's binary whether or not the
 * machine that wrote it could run them. The real constraint is narrower than
 * "no native bindings": a package must not need an *external* dependency
 * present on the host. sharp does not; `opencv4nodejs`, `node-poppler` and
 * `pdf2pic` do, and remain out.
 *
 * The cost is that sharp has no synchronous API, so this module is async and
 * everything downstream of it is too. That buys more than it costs. Measured on
 * a 1700x2200 page (A4 at 200 dpi) against `pngjs` 7 and `jpeg-js` 0.4:
 *
 * | Operation | Pure JS | libvips | Speedup |
 * |---|---|---|---|
 * | encode PNG | 136 ms | 6.8 ms | 20x |
 * | decode PNG | 65 ms | 11.8 ms | 5.6x |
 * | decode JPEG | 183 ms | 11.2 ms | 16x |
 *
 * The work also leaves the main thread: libvips runs on libuv's threadpool, so
 * the event loop really is free while a page is being decoded, which the old
 * synchronous codec could never claim.
 *
 * ## What it adds beyond speed
 *
 * TIFF, because sheet-fed scanners emit it and the pure-JavaScript codec could
 * not read it at all; HEIF, WebP and AVIF, because phone cameras emit them and
 * a photograph taken off-axis is exactly what the homography model is for; ICC
 * profiles and pixel density; and **EXIF orientation**, which `jpeg-js`
 * silently ignored - a phone photo tagged `orientation: 6` decoded 90 degrees
 * out of true, and `maxSkewDeg` defaults to 12, so alignment could not recover.
 *
 * ## Why no {@link GrayImage} crosses this boundary
 *
 * It cannot survive the trip. libvips tags a one-band float image as `grey16` -
 * a 16-bit *integer* colourspace - and truncates: a ramp of
 * `[0, 10.5, 20.25, 30.125]` returns as `[0, 10, 20, 30]`. Under any other
 * colourspace it returns zeros. {@link Raster} is `Uint8ClampedArray` RGBA,
 * libvips' native shape, and round-trips byte-exact - so the limit costs
 * nothing here, but it is why the float algorithms are hand-written.
 */

/** Formats this codec can write. Reading also accepts GIF, SVG and HEIF. */
export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'tiff' | 'avif'

export interface DecodeOptions {
  /**
   * Apply the EXIF orientation tag. On by default, because ignoring it is a
   * silent 90-degree error on any photograph taken in portrait.
   */
  autoOrient?:       boolean
  /** Page to read from a multi-page source such as a scanner's TIFF. Zero-based. */
  page?:             number
  /** Colour transparency is flattened onto before alpha is dropped. Default white. */
  background?:       { r: number, g: number, b: number }
  /** Decompression-bomb guard. `false` disables it, a number caps total pixels. */
  limitInputPixels?: number | false
}

export interface EncodeOptions {
  format?:           ImageFormat
  /** JPEG, WebP and AVIF quality, 1-100. Ignored for PNG, and for TIFF unless `tiffCompression` is lossy. */
  quality?:          number
  /**
   * TIFF compression. Defaults to lossless `deflate` - sharp's own default is
   * `jpeg`, which would quietly re-compress a scan and invent the artefacts this
   * pipeline exists to distinguish from real marks.
   */
  tiffCompression?:  'deflate' | 'lzw' | 'jpeg' | 'none'
  /** PNG only, 0-9. Higher is smaller and slower. */
  compressionLevel?: number
}

/** What the file says about itself, before any pixels are decoded. */
export interface ImageMetadata {
  format:      string
  width:       number
  height:      number
  channels:    number
  /** libvips colourspace, e.g. `srgb`, `b-w`, `cmyk`. */
  space:       string
  depth:       string
  hasAlpha:    boolean
  /** Pixels per inch as recorded in the file, or `null` when it records nothing. */
  density:     number | null
  /** EXIF orientation, 1-8, or `null`. Values above 4 swap width and height. */
  orientation: number | null
  /** Frames or pages. Above one for a multi-page TIFF - what a sheet-fed scanner emits. */
  pages:       number
}

/**
 * Decode anything libvips can read to RGBA.
 *
 * A {@link Raster} passes straight through, so this is safe to call on a value
 * that may already be decoded - which is what makes it cheap to align one page
 * against several scans: decode once, reuse.
 */
export async function decodeImage (input: ScanmateSource, options: DecodeOptions = {}): Promise<Raster> {
  if (isRaster(input)) return input

  const { autoOrient = true, page, background = { r: 255, g: 255, b: 255 }, limitInputPixels } = options

  let pipeline = sharp(open(input), {
    ...(page !== undefined && { page }),
    ...(limitInputPixels !== undefined && { limitInputPixels }),
  })

  // `.rotate()` with no argument is what applies the EXIF tag. The `autoOrient`
  // constructor option does not: it reports corrected dimensions in metadata
  // but leaves the pixels where they were.
  if (autoOrient) pipeline = pipeline.rotate()

  const { data, info } = await pipeline
    .flatten({ background })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return { width: info.width, height: info.height, data: asClamped(new Uint8Array(data)) }
}

/** Encode a raster. PNG by default, because a scan re-encoded as JPEG is a scan with new artefacts. */
export async function encodeImage (image: Raster, options: EncodeOptions = {}): Promise<Uint8Array> {
  const { format = 'png', quality = 92, compressionLevel = 6, tiffCompression = 'deflate' } = options
  const pipeline = sharp(bytesOf(image), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })

  const encode: Record<ImageFormat, () => Sharp> = {
    png:  () => pipeline.png({ compressionLevel }),
    jpeg: () => pipeline.jpeg({ quality }),
    webp: () => pipeline.webp({ quality }),
    tiff: () => pipeline.tiff({ quality, compression: tiffCompression }),
    avif: () => pipeline.avif({ quality }),
  }

  return new Uint8Array(await encode[format]().toBuffer())
}

export interface ResampleOptions {
  /**
   * Interpolation. `lanczos3` (the default) keeps strokes sharpest when a page
   * is enlarged for OCR; `cubic` is softer; `nearest` copies pixels, for masks.
   */
  kernel?: 'nearest' | 'linear' | 'cubic' | 'mitchell' | 'lanczos2' | 'lanczos3'
}

/**
 * Resize a raster to exactly `width` x `height`, through libvips.
 *
 * For whole-page resampling - enlarging a 93-dpi scan to the 300 dpi OCR reads
 * best at - where libvips's kernels beat anything worth hand-writing. The pixel
 * kernels that must run synchronously resize with `resizeGray` instead.
 */
export async function resampleRaster (image: Raster, width: number, height: number, options: ResampleOptions = {}): Promise<Raster> {
  const { kernel = 'lanczos3' } = options
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw new RangeError(`cannot resample to ${width} x ${height}`)
  if (width === image.width && height === image.height) return { width, height, data: new Uint8ClampedArray(image.data) }

  const { data, info } = await sharp(bytesOf(image), { raw: { width: image.width, height: image.height, channels: 4 } })
    .resize({ width, height, fit: 'fill', kernel })
    .raw()
    .toBuffer({ resolveWithObject: true })

  return { width: info.width, height: info.height, data: asClamped(new Uint8Array(data)) }
}

/**
 * A Gaussian blur of a raster, through libvips.
 *
 * For whole-page blurs - the mask an unsharp sharpening subtracts. On an A4
 * page at 300 dpi, a sharpening built on it took 110 ms against 580-650 for
 * three box blurs in JavaScript. The kernels that must stay synchronous blur
 * with `boxBlur` / `boxBlurRaster` instead.
 *
 * @param sigma - Standard deviation, in pixels: at least 0.3, as libvips asks.
 */
export async function blurRaster (image: Raster, sigma: number): Promise<Raster> {
  if (!Number.isFinite(sigma) || sigma < 0.3) throw new RangeError(`a blur needs a sigma of at least 0.3 pixels: got ${sigma}`)

  const { data, info } = await sharp(bytesOf(image), { raw: { width: image.width, height: image.height, channels: 4 } })
    .blur(sigma)
    .raw()
    .toBuffer({ resolveWithObject: true })

  return { width: info.width, height: info.height, data: asClamped(new Uint8Array(data)) }
}

/** Read what a file claims about itself without decoding its pixels. */
export async function readImageMetadata (input: ScanmateSource): Promise<ImageMetadata> {
  if (isRaster(input))
    throw new TypeError('readImageMetadata needs an encoded image or a path, not a decoded raster')

  const m = await sharp(open(input)).metadata()

  return {
    format:      m.format ?? 'unknown',
    width:       m.width ?? 0,
    height:      m.height ?? 0,
    channels:    m.channels ?? 0,
    space:       m.space ?? 'unknown',
    depth:       m.depth ?? 'unknown',
    hasAlpha:    m.hasAlpha ?? false,
    density:     m.density ?? null,
    orientation: m.orientation ?? null,
    pages:       m.pages ?? 1,
  }
}

/** How many pages a source holds. One for an ordinary image, more for a scanner's TIFF. */
export async function countPages (input: ScanmateSource): Promise<number> {
  const metadata = await readImageMetadata(input)

  return metadata.pages
}

function open (input: Exclude<ScanmateSource, Raster>): Buffer | string {
  if (typeof input === 'string') return input

  const bytes = toBytes(input)
  if (bytes === null || bytes.length === 0) throw new Error('cannot decode an empty image buffer')

  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function bytesOf (image: Raster): Buffer {
  return Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength)
}
