/** The two image shapes everything speaks, and the bytes they come from. */

export { countPages, decodeImage, encodeImage, readImageMetadata, resampleRaster } from './image-codec.client'
export type { DecodeOptions, EncodeOptions, ImageFormat, ImageMetadata, ResampleOptions } from './image-codec.client'
export { asClamped, cloneRaster, createBinary, createGray, createRaster, isRaster, toBytes } from './raster.model'
export type { BinaryImage, GrayImage, ImageInput, Raster, Rgba } from './raster.model'
