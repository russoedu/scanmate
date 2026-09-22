/**
 * What a session is given and what its pages are: shared by the session and by
 * every subfeature that runs sessions or prepares their pages. It depends on
 * nothing above it, so they can all point here without pointing at each other.
 */

export type { AlignedScanmatePage, EnhancedScanmatePage, ReadableScanmatePage, ScanmateOptions, ScanmatePageReport } from './scan-session.contract'
