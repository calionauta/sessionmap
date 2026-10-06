import { describe, expect, test, afterEach, beforeEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, screen, cleanup, fireEvent } = await import('@testing-library/react');
const React = await import('react');
const { SettingsModal } = await import('./SettingsModal');
const { getSettings } = await import('../../services/storage');
const { LanguageContext } = await import('../../i18n/LanguageContext');

afterEach(() => cleanup());

beforeEach(() => {
  localStorage.removeItem('sessionmap_settings');
});

/**
 * The language gateway: the toggle itself must work in both languages, and
 * switching must flow through onUpdateSettings so the provider value (and
 * document.lang) follows.
 */
describe('SettingsModal language', () => {
  test('PT renders the Idioma section first', () => {
    render(
      React.createElement(SettingsModal, {
        isOpen: true,
        onClose: () => {},
        settings: getSettings(),
        onUpdateSettings: () => {},
      })
    );
    expect(screen.getByText('Idioma')).toBeTruthy();
    expect(screen.getByText('Configurações da Sessão')).toBeTruthy();
  });

  test('EN renders the Language section first', () => {
    render(
      React.createElement(
        LanguageContext.Provider,
        { value: 'en' },
        React.createElement(SettingsModal, {
          isOpen: true,
          onClose: () => {},
          settings: { ...getSettings(), language: 'en' },
          onUpdateSettings: () => {},
        })
      )
    );
    expect(screen.getByText('Language')).toBeTruthy();
    expect(screen.getByText('Session Settings')).toBeTruthy();
    expect(screen.getByText('Visual Theme')).toBeTruthy();
  });

  test('switching language calls through with the new value', () => {
    const seen: string[] = [];
    render(
      React.createElement(SettingsModal, {
        isOpen: true,
        onClose: () => {},
        settings: getSettings(),
        onUpdateSettings: (s) => seen.push(s.language),
      })
    );
    fireEvent.click(screen.getByRole('radio', { name: 'English' }));
    expect(seen).toEqual(['en']);
  });
});
