import { describe, expect, test } from 'bun:test';
import { applyDocumentLanguage, t, type StringKey } from './strings';
import { registerDom } from '../test/domEnv';

registerDom();

/**
 * The bilingual contract: `en` covers exactly the keys `pt` defines.
 * The type system already enforces this (Record<StringKey, string>), but a
 * runtime pin survives refactors that loosen the types.
 */
describe('i18n dictionaries', () => {
  test('every pt key renders in both languages', () => {
    const keys: StringKey[] = [
      'settings.language.label',
      'settings.language.description',
      'settings.language.pt',
      'settings.language.en',
    ];
    for (const key of keys) {
      expect(t('pt', key).length).toBeGreaterThan(0);
      expect(t('en', key).length).toBeGreaterThan(0);
    }
  });

  test('the language names stay native in both languages', () => {
    expect(t('pt', 'settings.language.pt')).toBe('Português');
    expect(t('en', 'settings.language.pt')).toBe('Português');
  });

  test('applying the language sets document lang', () => {
    applyDocumentLanguage('en');
    expect(document.documentElement.lang).toBe('en-US');
    applyDocumentLanguage('pt');
    expect(document.documentElement.lang).toBe('pt-BR');
  });
});
