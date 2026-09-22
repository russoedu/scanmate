import type { CheckboxReading, GroupReading } from '../checkbox-reading'
import type { ScanmateRect } from '@scanmate/ink'

import type { AuditFinding } from './audit-finding.contract'

const RULE_WORDS: Readonly<Record<GroupReading['rule'], string>> = {
  'exactly-one':  'exactly one box ticked',
  'at-least-one': 'at least one box ticked',
  'at-most-one':  'at most one box ticked',
}

/**
 * A group of boxes not answered as its rule asks, as a finding on one page:
 * boxed around the group's boxes that are on that page.
 */
export function groupFinding (group: GroupReading, boxes: readonly CheckboxReading[]): AuditFinding {
  const said = group.ticked.length === 0 ? 'none is' : `${group.ticked.length} ${group.ticked.length === 1 ? 'is' : 'are'}: ${group.ticked.join(', ')}`
  const struck = group.struck.length === 0 ? '' : `; inked over, so unreadable: ${group.struck.join(', ')}`

  return {
    kind:         'checkbox-group',
    box:          boxes.length === 0 ? null : around(boxes.map(box => box.box)),
    corroborated: false,
    summary:      `"${group.id}" must have ${RULE_WORDS[group.rule]}, and ${said}${struck}`,
    text:         [],
    pixels:       null,
    subject:      group.id,
    group,
  }
}

function around (rects: readonly ScanmateRect[]): ScanmateRect {
  const left = Math.min(...rects.map(r => r.x))
  const top = Math.min(...rects.map(r => r.y))

  return { x: left, y: top, width: Math.max(...rects.map(r => r.x + r.width)) - left, height: Math.max(...rects.map(r => r.y + r.height)) - top }
}
