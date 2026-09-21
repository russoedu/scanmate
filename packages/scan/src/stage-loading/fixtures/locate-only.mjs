/** Locates fields from a PDF's labels. The PDF reader must load; nothing else may. */
import { createSyntheticPdf } from '@scanmate/extract'
import { Scanmate } from '@scanmate/scan'

const pdf = await createSyntheticPdf([{ text: [{ x: 76, y: 200, size: 8, content: 'Signature' }] }])
process.stdout.write('LOCATING\n')
const { regions } = await Scanmate.locate(pdf, [{ anchor: 'Signature', fields: { signature: { dx: 44, dy: 0, width: 200, height: 20 } } }])
if (regions.length !== 1) throw new Error('the anchor was not found')
process.stdout.write('DONE\n')
