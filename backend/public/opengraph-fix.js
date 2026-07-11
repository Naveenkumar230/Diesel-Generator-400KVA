
const GRAPH_KEY_MAP = {
  // Alternator
  'voltLL':       'alternator',
  'freq':         'alternator',
  'current':      'alternator',
  'calcAmps':     'alternator',
  'currPct':      'alternator',
  'kw':           'alternator',
  'kva':          'alternator',
  'kvar':         'alternator',
  'pf':           'alternator',
  // Engine
  'rpm':          'engine',
  'coolantTemp':  'engine',
  'oilPress':     'engine',
  'temps':        'engine',
  'pressures':    'engine',
  'battery':      'engine',
  // Fuel
  'fuel':         'fuel',
  // Utility / Mains
  'utilVoltLN':   'mains',
  'utilVoltLL':   'mains',
  'utilFreq':     'mains',
};

function openGraph(graphKey, title, unit) {
  // Resolve to a detail section; fall back to 'alternator'
  const section = GRAPH_KEY_MAP[graphKey] || 'alternator';
  if (window.gsDetail && window.gsDetail.open) {
    window.gsDetail.open(section);
  }
}