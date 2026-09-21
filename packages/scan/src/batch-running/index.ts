/** A long document a few pages at a time: one session per batch, disposed before the next. */

export type { BatchInfo, BatchOptions } from './batch-running.contract'
export { runInBatches } from './run-in-batches.use-case'
export type { BatchSession } from './run-in-batches.use-case'
