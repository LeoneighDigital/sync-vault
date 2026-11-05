/**
 * Catalog + clearance metadata.
 * Phase 1 ships a single track record. Phase 2 replaces this with a
 * Cloudflare R2 / D1-backed catalog fetched at the edge.
 */

export const TRACK = {
  catalogId: 'LU-SV-001',
  title:     'Nightfall Protocol',
  artist:    'Leoneigh Unfiltered',
  bpm:       92,
  key:       'F minor',
  isrc:      'ZALUN2400001',
  samro:     'SAMRO-2024-00184',
  version:   'Instrumental + Vocal Stems',
  territory: 'Worldwide',
};

export const RIGHTS = [
  ['Master',     '100% — Leoneigh Unfiltered'],
  ['Publishing', '100% — Leoneigh Unfiltered'],
  ['PRO',        'SAMRO registered'],
  ['Samples',    'None — 100% original'],
  ['Sync',       'Pre-cleared, direct license'],
  ['Territory',  'Worldwide'],
];

export const TECH = [
  ['Format',   'WAV · 24-bit / 48 kHz'],
  ['Stems',    '4 (Master, Vocals, Bass, Drums)'],
  ['BPM',      String(TRACK.bpm)],
  ['Key',      TRACK.key],
  ['ISRC',     TRACK.isrc],
  ['Catalog',  TRACK.catalogId],
];

export const CONTACT = {
  email:   'sync@leoneighunfiltered.com',
  company: 'Leoneigh Unfiltered',
};