export function shouldEnableFlag(name) {
  const search = new URLSearchParams(window.location.search);
  const raw = search.get(name);
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  const cfg = window.ARENA_CONFIG || {};
  return cfg[name] === true || cfg[name] === 'true' || cfg[name] === 1 || cfg[name] === '1';
}
