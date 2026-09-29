/**
 * Registers a happy-dom window as the global environment for DOM tests.
 *
 * Bun has no built-in jsdom/happy-dom preload, so this is wired through
 * `bunfig.toml` instead. It is scoped to test files that ask for it by
 * importing `registerDom()` themselves — see OutlineEditor.lift.test.tsx,
 * which is the first test to need a real document.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let registered = false;

export function registerDom(): void {
  if (registered) return;
  if (typeof document !== 'undefined') {
    registered = true;
    return;
  }
  GlobalRegistrator.register({ url: 'http://localhost:3000/sessionmap/' });
  registered = true;
}

if (typeof document === 'undefined') {
  registerDom();
}
