/**
 * Ref that listens to a DOM event on a Polaris web component directly, so it works whether or not
 * the component's events bubble to React's root listener.
 */
export function listen(event, handler) {
  return (el) => {
    if (!el) return;
    const fn = () => handler(el);
    el.addEventListener(event, fn);
    return () => el.removeEventListener(event, fn);
  };
}
