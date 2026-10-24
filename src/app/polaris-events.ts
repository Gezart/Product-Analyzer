/**
 * Ref that listens to a DOM event on a Polaris web component directly, so it works whether or not
 * the component's events bubble to React's root listener.
 */
export function listen(event: string, handler: (el: HTMLInputElement) => void) {
  return (el: HTMLElement | null) => {
    if (!el) return;
    const fn = () => handler(el as HTMLInputElement);
    el.addEventListener(event, fn);
    return () => el.removeEventListener(event, fn);
  };
}
