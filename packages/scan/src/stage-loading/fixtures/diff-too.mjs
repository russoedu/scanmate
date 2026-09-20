/** Aligns and diffs. The diff package must load; a reader still must not. */
import { createRaster } from '@scanmate/ink'
import { Scanmate } from '@scanmate/scan'

const raster = createRaster(64, 64)
const scan = new Scanmate(raster, raster)
await scan.diff()
await scan.dispose()
process.stdout.write('DONE\n')
