/** Aligns two images and nothing else. Nothing here should pull in a reader or a PDF library. */
import { createRaster } from '@scanmate/ink'
import { Scanmate } from '@scanmate/scan'

const raster = createRaster(64, 64)
const scan = new Scanmate(raster, raster)
await scan.align()
await scan.dispose()
process.stdout.write('DONE\n')
