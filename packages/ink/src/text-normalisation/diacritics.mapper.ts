/**
 * Letters with diacritics, ligatures and look-alike forms, folded to plain
 * Latin: `é` to `e`, `Æ` to `AE`, a circled or full-width `Ａ` to `A`.
 *
 * OCR drops and invents accents - a scanned `é` reads as `e` or `è` as the
 * print allows - so text is compared with them folded away. Some bases are two
 * letters, so folding can lengthen a string. The table is the project's own
 * diacritics map (86 bases, 874 letters), kept as escapes so every code point
 * is visible in review; it is expanded into a lookup once, on first use.
 */

/** [base, letters that fold to it] */
const TABLE: ReadonlyArray<readonly [string, string]> = [
  ['A', '\u{41}\u{24B6}\u{FF21}\u{C0}\u{C1}\u{C2}\u{1EA6}\u{1EA4}\u{1EAA}\u{1EA8}\u{C3}\u{100}\u{102}\u{1EB0}\u{1EAE}\u{1EB4}\u{1EB2}\u{226}\u{1E0}\u{C4}\u{1DE}\u{1EA2}\u{C5}\u{1FA}\u{1CD}\u{200}\u{202}\u{1EA0}\u{1EAC}\u{1EB6}\u{1E00}\u{104}\u{23A}\u{2C6F}'],
  ['AA', '\u{A732}'],
  ['AE', '\u{C6}\u{1FC}\u{1E2}'],
  ['AO', '\u{A734}'],
  ['AU', '\u{A736}'],
  ['AV', '\u{A738}\u{A73A}'],
  ['AY', '\u{A73C}'],
  ['B', '\u{42}\u{24B7}\u{FF22}\u{1E02}\u{1E04}\u{1E06}\u{243}\u{182}\u{181}'],
  ['C', '\u{43}\u{24B8}\u{FF23}\u{106}\u{108}\u{10A}\u{10C}\u{C7}\u{1E08}\u{187}\u{23B}\u{A73E}'],
  ['D', '\u{44}\u{24B9}\u{FF24}\u{1E0A}\u{10E}\u{1E0C}\u{1E10}\u{1E12}\u{1E0E}\u{110}\u{18B}\u{18A}\u{189}\u{A779}'],
  ['DZ', '\u{1F1}\u{1C4}'],
  ['Dz', '\u{1F2}\u{1C5}'],
  ['E', '\u{45}\u{24BA}\u{FF25}\u{C8}\u{C9}\u{CA}\u{1EC0}\u{1EBE}\u{1EC4}\u{1EC2}\u{1EBC}\u{112}\u{1E14}\u{1E16}\u{114}\u{116}\u{CB}\u{1EBA}\u{11A}\u{204}\u{206}\u{1EB8}\u{1EC6}\u{228}\u{1E1C}\u{118}\u{1E18}\u{1E1A}\u{190}\u{18E}'],
  ['F', '\u{46}\u{24BB}\u{FF26}\u{1E1E}\u{191}\u{A77B}'],
  ['G', '\u{47}\u{24BC}\u{FF27}\u{1F4}\u{11C}\u{1E20}\u{11E}\u{120}\u{1E6}\u{122}\u{1E4}\u{193}\u{A7A0}\u{A77D}\u{A77E}'],
  ['H', '\u{48}\u{24BD}\u{FF28}\u{124}\u{1E22}\u{1E26}\u{21E}\u{1E24}\u{1E28}\u{1E2A}\u{126}\u{2C67}\u{2C75}\u{A78D}'],
  ['I', '\u{49}\u{24BE}\u{FF29}\u{CC}\u{CD}\u{CE}\u{128}\u{12A}\u{12C}\u{130}\u{CF}\u{1E2E}\u{1EC8}\u{1CF}\u{208}\u{20A}\u{1ECA}\u{12E}\u{1E2C}\u{197}'],
  ['J', '\u{4A}\u{24BF}\u{FF2A}\u{134}\u{248}'],
  ['K', '\u{4B}\u{24C0}\u{FF2B}\u{1E30}\u{1E8}\u{1E32}\u{136}\u{1E34}\u{198}\u{2C69}\u{A740}\u{A742}\u{A744}\u{A7A2}'],
  ['L', '\u{4C}\u{24C1}\u{FF2C}\u{13F}\u{139}\u{13D}\u{1E36}\u{1E38}\u{13B}\u{1E3C}\u{1E3A}\u{141}\u{23D}\u{2C62}\u{2C60}\u{A748}\u{A746}\u{A780}'],
  ['LJ', '\u{1C7}'],
  ['Lj', '\u{1C8}'],
  ['M', '\u{4D}\u{24C2}\u{FF2D}\u{1E3E}\u{1E40}\u{1E42}\u{2C6E}\u{19C}'],
  ['N', '\u{4E}\u{24C3}\u{FF2E}\u{1F8}\u{143}\u{D1}\u{1E44}\u{147}\u{1E46}\u{145}\u{1E4A}\u{1E48}\u{220}\u{19D}\u{A790}\u{A7A4}'],
  ['NJ', '\u{1CA}'],
  ['Nj', '\u{1CB}'],
  ['O', '\u{4F}\u{24C4}\u{FF2F}\u{D2}\u{D3}\u{D4}\u{1ED2}\u{1ED0}\u{1ED6}\u{1ED4}\u{D5}\u{1E4C}\u{22C}\u{1E4E}\u{14C}\u{1E50}\u{1E52}\u{14E}\u{22E}\u{230}\u{D6}\u{22A}\u{1ECE}\u{150}\u{1D1}\u{20C}\u{20E}\u{1A0}\u{1EDC}\u{1EDA}\u{1EE0}\u{1EDE}\u{1EE2}\u{1ECC}\u{1ED8}\u{1EA}\u{1EC}\u{D8}\u{1FE}\u{186}\u{19F}\u{A74A}\u{A74C}'],
  ['OI', '\u{1A2}'],
  ['OO', '\u{A74E}'],
  ['OU', '\u{222}'],
  ['OE', '\u{8C}\u{152}'],
  ['oe', '\u{9C}\u{153}'],
  ['P', '\u{50}\u{24C5}\u{FF30}\u{1E54}\u{1E56}\u{1A4}\u{2C63}\u{A750}\u{A752}\u{A754}'],
  ['Q', '\u{51}\u{24C6}\u{FF31}\u{A756}\u{A758}\u{24A}'],
  ['R', '\u{52}\u{24C7}\u{FF32}\u{154}\u{1E58}\u{158}\u{210}\u{212}\u{1E5A}\u{1E5C}\u{156}\u{1E5E}\u{24C}\u{2C64}\u{A75A}\u{A7A6}\u{A782}'],
  ['S', '\u{53}\u{24C8}\u{FF33}\u{1E9E}\u{15A}\u{1E64}\u{15C}\u{1E60}\u{160}\u{1E66}\u{1E62}\u{1E68}\u{218}\u{15E}\u{2C7E}\u{A7A8}\u{A784}'],
  ['T', '\u{54}\u{24C9}\u{FF34}\u{1E6A}\u{164}\u{1E6C}\u{21A}\u{162}\u{1E70}\u{1E6E}\u{166}\u{1AC}\u{1AE}\u{23E}\u{A786}'],
  ['TZ', '\u{A728}'],
  ['U', '\u{55}\u{24CA}\u{FF35}\u{D9}\u{DA}\u{DB}\u{168}\u{1E78}\u{16A}\u{1E7A}\u{16C}\u{DC}\u{1DB}\u{1D7}\u{1D5}\u{1D9}\u{1EE6}\u{16E}\u{170}\u{1D3}\u{214}\u{216}\u{1AF}\u{1EEA}\u{1EE8}\u{1EEE}\u{1EEC}\u{1EF0}\u{1EE4}\u{1E72}\u{172}\u{1E76}\u{1E74}\u{244}'],
  ['V', '\u{56}\u{24CB}\u{FF36}\u{1E7C}\u{1E7E}\u{1B2}\u{A75E}\u{245}'],
  ['VY', '\u{A760}'],
  ['W', '\u{57}\u{24CC}\u{FF37}\u{1E80}\u{1E82}\u{174}\u{1E86}\u{1E84}\u{1E88}\u{2C72}'],
  ['X', '\u{58}\u{24CD}\u{FF38}\u{1E8A}\u{1E8C}'],
  ['Y', '\u{59}\u{24CE}\u{FF39}\u{1EF2}\u{DD}\u{176}\u{1EF8}\u{232}\u{1E8E}\u{178}\u{1EF6}\u{1EF4}\u{1B3}\u{24E}\u{1EFE}'],
  ['Z', '\u{5A}\u{24CF}\u{FF3A}\u{179}\u{1E90}\u{17B}\u{17D}\u{1E92}\u{1E94}\u{1B5}\u{224}\u{2C7F}\u{2C6B}\u{A762}'],
  ['a', '\u{61}\u{24D0}\u{FF41}\u{1E9A}\u{E0}\u{E1}\u{E2}\u{1EA7}\u{1EA5}\u{1EAB}\u{1EA9}\u{E3}\u{101}\u{103}\u{1EB1}\u{1EAF}\u{1EB5}\u{1EB3}\u{227}\u{1E1}\u{E4}\u{1DF}\u{1EA3}\u{E5}\u{1FB}\u{1CE}\u{201}\u{203}\u{1EA1}\u{1EAD}\u{1EB7}\u{1E01}\u{105}\u{2C65}\u{250}'],
  ['aa', '\u{A733}'],
  ['ae', '\u{E6}\u{1FD}\u{1E3}'],
  ['ao', '\u{A735}'],
  ['au', '\u{A737}'],
  ['av', '\u{A739}\u{A73B}'],
  ['ay', '\u{A73D}'],
  ['b', '\u{62}\u{24D1}\u{FF42}\u{1E03}\u{1E05}\u{1E07}\u{180}\u{183}\u{253}'],
  ['c', '\u{63}\u{24D2}\u{FF43}\u{107}\u{109}\u{10B}\u{10D}\u{E7}\u{1E09}\u{188}\u{23C}\u{A73F}\u{2184}'],
  ['d', '\u{64}\u{24D3}\u{FF44}\u{1E0B}\u{10F}\u{1E0D}\u{1E11}\u{1E13}\u{1E0F}\u{111}\u{18C}\u{256}\u{257}\u{A77A}'],
  ['dz', '\u{1F3}\u{1C6}'],
  ['e', '\u{65}\u{24D4}\u{FF45}\u{E8}\u{E9}\u{EA}\u{1EC1}\u{1EBF}\u{1EC5}\u{1EC3}\u{1EBD}\u{113}\u{1E15}\u{1E17}\u{115}\u{117}\u{EB}\u{1EBB}\u{11B}\u{205}\u{207}\u{1EB9}\u{1EC7}\u{229}\u{1E1D}\u{119}\u{1E19}\u{1E1B}\u{247}\u{25B}\u{1DD}'],
  ['f', '\u{66}\u{24D5}\u{FF46}\u{1E1F}\u{192}\u{A77C}'],
  ['g', '\u{67}\u{24D6}\u{FF47}\u{1F5}\u{11D}\u{1E21}\u{11F}\u{121}\u{1E7}\u{123}\u{1E5}\u{260}\u{A7A1}\u{1D79}\u{A77F}'],
  ['h', '\u{68}\u{24D7}\u{FF48}\u{125}\u{1E23}\u{1E27}\u{21F}\u{1E25}\u{1E29}\u{1E2B}\u{1E96}\u{127}\u{2C68}\u{2C76}\u{265}'],
  ['hv', '\u{195}'],
  ['i', '\u{69}\u{24D8}\u{FF49}\u{EC}\u{ED}\u{EE}\u{129}\u{12B}\u{12D}\u{EF}\u{1E2F}\u{1EC9}\u{1D0}\u{209}\u{20B}\u{1ECB}\u{12F}\u{1E2D}\u{268}\u{131}'],
  ['j', '\u{6A}\u{24D9}\u{FF4A}\u{135}\u{1F0}\u{249}'],
  ['k', '\u{6B}\u{24DA}\u{FF4B}\u{1E31}\u{1E9}\u{1E33}\u{137}\u{1E35}\u{199}\u{2C6A}\u{A741}\u{A743}\u{A745}\u{A7A3}'],
  ['l', '\u{6C}\u{24DB}\u{FF4C}\u{140}\u{13A}\u{13E}\u{1E37}\u{1E39}\u{13C}\u{1E3D}\u{1E3B}\u{17F}\u{142}\u{19A}\u{26B}\u{2C61}\u{A749}\u{A781}\u{A747}'],
  ['lj', '\u{1C9}'],
  ['m', '\u{6D}\u{24DC}\u{FF4D}\u{1E3F}\u{1E41}\u{1E43}\u{271}\u{26F}'],
  ['n', '\u{6E}\u{24DD}\u{FF4E}\u{1F9}\u{144}\u{F1}\u{1E45}\u{148}\u{1E47}\u{146}\u{1E4B}\u{1E49}\u{19E}\u{272}\u{149}\u{A791}\u{A7A5}'],
  ['nj', '\u{1CC}'],
  ['o', '\u{6F}\u{24DE}\u{FF4F}\u{F2}\u{F3}\u{F4}\u{1ED3}\u{1ED1}\u{1ED7}\u{1ED5}\u{F5}\u{1E4D}\u{22D}\u{1E4F}\u{14D}\u{1E51}\u{1E53}\u{14F}\u{22F}\u{231}\u{F6}\u{22B}\u{1ECF}\u{151}\u{1D2}\u{20D}\u{20F}\u{1A1}\u{1EDD}\u{1EDB}\u{1EE1}\u{1EDF}\u{1EE3}\u{1ECD}\u{1ED9}\u{1EB}\u{1ED}\u{F8}\u{1FF}\u{254}\u{A74B}\u{A74D}\u{275}'],
  ['oi', '\u{1A3}'],
  ['ou', '\u{223}'],
  ['oo', '\u{A74F}'],
  ['p', '\u{70}\u{24DF}\u{FF50}\u{1E55}\u{1E57}\u{1A5}\u{1D7D}\u{A751}\u{A753}\u{A755}'],
  ['q', '\u{71}\u{24E0}\u{FF51}\u{24B}\u{A757}\u{A759}'],
  ['r', '\u{72}\u{24E1}\u{FF52}\u{155}\u{1E59}\u{159}\u{211}\u{213}\u{1E5B}\u{1E5D}\u{157}\u{1E5F}\u{24D}\u{27D}\u{A75B}\u{A7A7}\u{A783}'],
  ['s', '\u{73}\u{24E2}\u{FF53}\u{DF}\u{15B}\u{1E65}\u{15D}\u{1E61}\u{161}\u{1E67}\u{1E63}\u{1E69}\u{219}\u{15F}\u{23F}\u{A7A9}\u{A785}\u{1E9B}'],
  ['t', '\u{74}\u{24E3}\u{FF54}\u{1E6B}\u{1E97}\u{165}\u{1E6D}\u{21B}\u{163}\u{1E71}\u{1E6F}\u{167}\u{1AD}\u{288}\u{2C66}\u{A787}'],
  ['tz', '\u{A729}'],
  ['u', '\u{75}\u{24E4}\u{FF55}\u{F9}\u{FA}\u{FB}\u{169}\u{1E79}\u{16B}\u{1E7B}\u{16D}\u{FC}\u{1DC}\u{1D8}\u{1D6}\u{1DA}\u{1EE7}\u{16F}\u{171}\u{1D4}\u{215}\u{217}\u{1B0}\u{1EEB}\u{1EE9}\u{1EEF}\u{1EED}\u{1EF1}\u{1EE5}\u{1E73}\u{173}\u{1E77}\u{1E75}\u{289}'],
  ['v', '\u{76}\u{24E5}\u{FF56}\u{1E7D}\u{1E7F}\u{28B}\u{A75F}\u{28C}'],
  ['vy', '\u{A761}'],
  ['w', '\u{77}\u{24E6}\u{FF57}\u{1E81}\u{1E83}\u{175}\u{1E87}\u{1E85}\u{1E98}\u{1E89}\u{2C73}'],
  ['x', '\u{78}\u{24E7}\u{FF58}\u{1E8B}\u{1E8D}'],
  ['y', '\u{79}\u{24E8}\u{FF59}\u{1EF3}\u{FD}\u{177}\u{1EF9}\u{233}\u{1E8F}\u{FF}\u{1EF7}\u{1E99}\u{1EF5}\u{1B4}\u{24F}\u{1EFF}'],
  ['z', '\u{7A}\u{24E9}\u{FF5A}\u{17A}\u{1E91}\u{17C}\u{17E}\u{1E93}\u{1E95}\u{1B6}\u{225}\u{240}\u{2C6C}\u{A763}'],
]

let lookup: Map<string, string> | undefined

/** Every folded letter and what it folds to. */
export function diacriticsMap (): ReadonlyMap<string, string> {
  if (lookup !== undefined) return lookup

  lookup = new Map()
  for (const [base, letters] of TABLE)
    for (const letter of letters)
      if (letter !== base) lookup.set(letter, base)

  return lookup
}

/** Replace every letter in the table by its plain base; everything else is kept as it is. */
export function foldDiacritics (text: string): string {
  const map = diacriticsMap()
  let out = ''
  for (const character of text) out += map.get(character) ?? character

  return out
}
