import { describe, expect, test, beforeEach } from 'bun:test';
import { registerDom } from '../test/domEnv';

registerDom();

const { getSettings, saveSettings, rememberLandingLanguage } = await import('./storage');

/**
 * The app and the landing page share one language choice. The landing owns
 * detection (browser language) and the manual switch; the app reads that key
 * exactly once — on first run, before any stored choice exists. After that,
 * stored settings always win and the app writes back on every change.
 */
beforeEach(() => {
  localStorage.removeItem('sessionmap_settings');
  localStorage.removeItem('sessionmap_landing_lang');
});

describe('first-run language', () => {
  test('nothing stored anywhere: PT default stands', () => {
    expect(getSettings().language).toBe('pt');
  });

  test('landing choice is honored on first run', () => {
    rememberLandingLanguage('en');
    expect(getSettings().language).toBe('en');
  });

  test('a foreign value in the landing key falls back to PT', () => {
    localStorage.setItem('sessionmap_landing_lang', 'fr');
    expect(getSettings().language).toBe('pt');
  });

  test('stored settings outrank the landing key', () => {
    rememberLandingLanguage('en');
    saveSettings({ ...getSettings(), language: 'pt' });
    expect(getSettings().language).toBe('pt');
  });

  test('full cycle: landing EN, first run EN, in-app switch back to PT sticks', () => {
    // What HostView.handleUpdateSettings does on a language change.
    rememberLandingLanguage('en');
    expect(getSettings().language).toBe('en');
    saveSettings({ ...getSettings(), language: 'pt' });
    rememberLandingLanguage('pt');
    expect(getSettings().language).toBe('pt');
    expect(localStorage.getItem('sessionmap_landing_lang')).toBe('pt');
  });
});
