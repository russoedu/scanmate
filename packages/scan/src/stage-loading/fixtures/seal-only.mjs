/** Checks a signature and nothing else. No stage of the pipeline should load. */
import { Scanmate } from '@scanmate/scan'

const pdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
const report = await Scanmate.seal(pdf)
if (report.signed) throw new Error('an unsigned fixture reported a signature')
process.stdout.write('DONE\n')
