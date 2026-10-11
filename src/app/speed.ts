/** `?speed=4` in the URL shortens every wait; used by automated checks. */
export const speed = (() => {
  const value = Number(new URLSearchParams(window.location.search).get('speed'));
  return Number.isFinite(value) && value > 0 ? value : 1;
})();

export const scaled = (ms: number) => ms / speed;
