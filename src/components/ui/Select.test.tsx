import { describe, expect, test, afterEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, fireEvent, screen, cleanup } = await import('@testing-library/react');
const React = await import('react');
const { Select } = await import('./Select');

afterEach(() => cleanup());

/**
 * The shared dropdown.
 *
 * Pins the contract: it stays a native select (label association, option
 * list, change events), the OS arrow is gone (appearance-none) and exactly
 * one pinned chevron replaces it — the double/misplaced arrow complaint.
 */

describe('Select', () => {
  test('behaves like the native select it wraps', () => {
    render(
      React.createElement('div', null,
        React.createElement('label', { htmlFor: 's-kind' }, 'Tipo'),
        React.createElement(Select, {
          id: 's-kind',
          defaultValue: '',
          onChange: () => {},
          children: [
            React.createElement('option', { key: '', value: '' }, 'Sem tipo'),
            React.createElement('option', { key: 'a', value: 'a' }, 'A'),
          ],
        })
      )
    );
    const box = screen.getByLabelText('Tipo') as HTMLSelectElement;
    expect(box.tagName).toBe('SELECT');
    expect(box.className).toContain('appearance-none');
    fireEvent.change(box, { target: { value: 'a' } });
    expect(box.value).toBe('a');
  });

  test('exactly one chevron, decorative and click-through', () => {
    const { container } = render(
      React.createElement(Select, {
        id: 's-one',
        'aria-label': 'one',
        children: React.createElement('option', { value: '' }, 'x'),
      })
    );
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(1);
    expect(svgs[0].getAttribute('aria-hidden')).toBe('true');
    expect(svgs[0].classList.contains('pointer-events-none')).toBe(true);
  });
});
