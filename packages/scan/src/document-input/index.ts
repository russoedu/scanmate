/** Turning what the caller has - a document, or things to assemble into one - into page pairs. */

export type { ResolvedDocument, ScanmateDocument, ScanmatePage } from './document-input.contract'
export { isPdfSource } from './pdf-sniff.policy'
export { resolveDocument } from './resolve-document.use-case'
export type { ResolveOptions } from './resolve-document.use-case'
