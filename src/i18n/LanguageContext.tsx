import React from 'react';
import type { Language } from './strings';

/**
 * UI language for the component tree.
 *
 * Default is 'pt', deliberately: the product is PT-first and every existing
 * test renders without a provider. Components under HostView /
 * ClientView get the real value from settings; bare renders in tests keep
 * asserting Portuguese with zero churn.
 */
export const LanguageContext = React.createContext<Language>('pt');

export const useLang = (): Language => React.useContext(LanguageContext);
