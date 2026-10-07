import { describe, expect, test, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, screen, cleanup } = await import('@testing-library/react');
const React = await import('react');
const { CatalogPanel } = await import('./CatalogPanel');

afterEach(() => cleanup());

/**
 * An edit requested from the new-session picker.
 *
 * Pins: a matching editRequestId opens that card's editor (list context
 * stays around it) and the request is reported back as handled, so the
 * parent clears it and it never replays.
 */

const NOW = '2026-01-01T00:00:00.000Z';

function renderPanel(editRequestId: string | null, onEditRequestHandled?: () => void) {
  return render(
    React.createElement(CatalogPanel, {
      modalities: [{ id: 'mod_a', name: 'A', color: null, createdAt: NOW }],
      templates: [
        {
          id: 'tpl_1',
          modalityId: 'mod_a',
          title: 'Primeiro',
          markdown: '- Um',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      maps: [],
      onModalitiesChange: () => {},
      onTemplatesChange: () => {},
      onDeleteModalityRequest: () => {},
      editRequestId,
      onEditRequestHandled,
    })
  );
}

describe('CatalogPanel edit request', () => {
  test('no request leaves every editor closed', () => {
    renderPanel(null);
    expect(screen.queryByLabelText('Título do roteiro')).toBeNull();
  });

  test('a request opens that template editor and reports handled', () => {
    let handled = 0;
    renderPanel('tpl_1', () => {
      handled += 1;
    });
    // The draft form for "Primeiro" is open: title field pre-filled.
    const title = screen.getByLabelText('Título do roteiro') as HTMLInputElement;
    expect(title.value).toBe('Primeiro');
    expect(handled).toBe(1);
  });

  test('an unknown id opens nothing and still clears', () => {
    let handled = 0;
    renderPanel('tpl_missing', () => {
      handled += 1;
    });
    expect(screen.queryByLabelText('Título do roteiro')).toBeNull();
    expect(handled).toBe(1);
  });
});
