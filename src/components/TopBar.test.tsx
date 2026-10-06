import { describe, expect, test, afterEach } from 'bun:test';
import { registerDom } from '../test/domEnv';

registerDom();

const { render, fireEvent, cleanup, act, within } = await import('@testing-library/react');
const React = await import('react');
const { TopBar } = await import('./TopBar');
const { OverflowMenu } = await import('./ui/OverflowMenu');

let container: HTMLElement | null = null;

type Overrides = Partial<{
  isClientConnected: boolean;
  focusZoomOn: boolean;
  isDark: boolean;
  canRestoreSplit: boolean;
  narrowPane: 'outline' | 'map' | null;
}>;

const calls: string[] = [];

function setup(overrides: Overrides = {}) {
  calls.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  render(
    React.createElement(TopBar, {
      clientName: 'Maria',
      sessionLabel: '28/09/2026',
      isClientConnected: true,
      focusZoomOn: false,
      isDark: false,
      canRestoreSplit: false,
      narrowPane: null,
      onSwapPane: () => calls.push('swapPane'),
      onOpenClients: () => calls.push('clients'),
      onOpenClientWindow: () => calls.push('clientWindow'),
      onFocusClientWindow: () => calls.push('focusClient'),
      onStopSharing: () => calls.push('stopSharing'),
      onOpenMapList: () => calls.push('mapList'),
      onToggleFocusZoom: () => calls.push('focusZoom'),
      onOpenShareGuide: () => calls.push('share'),
      onOpenExport: () => calls.push('export'),
      onToggleTheme: () => calls.push('theme'),
      onOpenSettings: () => calls.push('settings'),
      onRestoreSplit: () => calls.push('restoreSplit'),
      ...overrides,
    }),
    { container }
  );
}

const bar = () => container as HTMLElement;
const byLabel = (label: string) =>
  bar().querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const buttons = () => Array.from(bar().querySelectorAll('button'));

afterEach(() => {
  cleanup();
  container?.remove();
  container = null;
});

describe('the session bar', () => {
  test('the present action exists exactly once', () => {
    setup({ isClientConnected: false });
    const matching = buttons().filter((b) => (b.textContent ?? '').includes('Apresentar'));
    expect(matching).toHaveLength(1);
    expect(bar().textContent).not.toContain('[Abrir]');
  });

  test('disconnected, the one action presents, and says what it does', () => {
    setup({ isClientConnected: false });
    const action = buttons().find((b) => (b.textContent ?? '').includes('Apresentar'))!;
    expect(action.className).toContain('ctl-primary');
    expect(action.getAttribute('title')).toContain('nova janela');
    expect(bar().querySelector('[role="status"]')).toBeNull();
    act(() => {
      fireEvent.click(action);
    });
    expect(calls).toEqual(['clientWindow']);
  });

  test('live, the dot reports and the action ends: no pause anywhere', () => {
    // One action, one read-only state. No pause button, no shortcut, no
    // paused state: ending and re-presenting covers everything.
    setup({ isClientConnected: true });
    expect(bar().querySelector('[aria-label*="Pausar"]')).toBeNull();
    expect(bar().textContent).not.toContain('Pausado');
    const status = bar().querySelector('[role="status"]')!;
    expect(status.textContent).toContain('Ao vivo');
    expect(status.querySelector('button')).toBeNull();
  });

  test('live, ending the presentation stops it', () => {
    setup({ isClientConnected: true });
    const stop = buttons().find((b) =>
      (b.textContent ?? '').includes('Encerrar apresentação')
    )!;
    expect(stop.className).toContain('ctl-danger');
    act(() => {
      fireEvent.click(stop);
    });
    expect(calls).toEqual(['stopSharing']);
  });

  test('no state leaks into button labels', () => {
    setup({ isClientConnected: false });
    expect(bar().textContent).not.toContain('Não compartilhado');
    expect(bar().textContent).not.toContain('Compartilhado');
    expect(bar().textContent).not.toContain('Compartilhando');
    setup({ isClientConnected: true });
    expect(bar().textContent).not.toContain('Não compartilhado');
    expect(bar().textContent).not.toContain('Compartilhado');
    expect(bar().textContent).not.toContain('Compartilhando');
  });

  test('the bar is four controls and a menu, not fourteen buttons', () => {
    setup({ isClientConnected: false });
    // 1 switcher, 1 share action, 1 export, 1 menu trigger. Everything else moved.
    expect(buttons()).toHaveLength(4);
  });

  test('sharing swaps one action for another: same four controls', () => {
    setup({ isClientConnected: true });
    // 1 switcher, 1 end-presentation, 1 export, 1 menu trigger. The bar
    // never dances: one slot, one action, whatever the state.
    expect(buttons()).toHaveLength(4);
  });

  test('the secondary tools moved into the menu, still reachable', () => {
    setup();
    act(() => {
      fireEvent.click(byLabel('Mais ferramentas'));
    });
    const menu = bar().querySelector('[role="menu"]')!;
    const text = menu.textContent ?? '';
    for (const label of [
      'Mapas e sessões',
      'Zoom no foco',
      'Guia de compartilhamento',
      'Configurações',
      'Tema escuro',
    ]) {
      expect(text).toContain(label);
    }
  });

  test('preferences are checkboxes in the menu, not buttons that look like toggles', () => {
    setup({ focusZoomOn: true });
    act(() => {
      fireEvent.click(byLabel('Mais ferramentas'));
    });
    const zoom = bar().querySelector('[role="menuitemcheckbox"]')!;
    expect(zoom.getAttribute('aria-checked')).toBe('true');
  });

  test('a menu entry runs its action and closes', () => {
    setup();
    act(() => {
      fireEvent.click(byLabel('Mais ferramentas'));
    });
    const item = within(bar().querySelector('[role="menu"]')!).getByText('Configurações');
    act(() => {
      fireEvent.click(item.closest('button')!);
    });
    expect(calls).toEqual(['settings']);
    expect(bar().querySelector('[role="menu"]')).toBeNull();
  });

  test('restoring the split appears only when the outline is off screen', () => {
    setup({ canRestoreSplit: false });
    act(() => {
      fireEvent.click(byLabel('Mais ferramentas'));
    });
    expect(bar().querySelector('[role="menu"]')!.textContent).not.toContain('Restaurar');
    act(() => {
      fireEvent.click(byLabel('Mais ferramentas'));
    });
    setup({ canRestoreSplit: true });
    act(() => {
      fireEvent.click(byLabel('Mais ferramentas'));
    });
    expect(bar().querySelector('[role="menu"]')!.textContent).toContain('Restaurar');
  });

  test('export stayed in the bar, because it is used every session', () => {
    // Hiding it would have been a downgrade dressed as a tidy-up.
    setup();
    act(() => {
      fireEvent.click(byLabel('Exportar mapa'));
    });
    expect(calls).toEqual(['export']);
  });

  test('the client window can still be brought back to the front', async () => {
    // The regression this caught: "Janela do Participante" also un-minimised the
    // client's screen, because window.open with a named target reuses the
    // window. Letting the connect button take the primary slot quietly took
    // that away, and a client minimising their window mid-session is ordinary.
    setup({ isClientConnected: true });
    act(() => {
      fireEvent.click(byLabel('Mais ferramentas'));
    });
    const item = within(bar().querySelector('[role="menu"]')!).getByText(
      'Trazer a tela compartilhada para a frente'
    );
    act(() => {
      fireEvent.click(item.closest('button')!);
    });
    expect(calls).toEqual(['focusClient']);
  });

  test('there is nothing to bring forward when no client is connected', () => {
    setup({ isClientConnected: false });
    act(() => {
      fireEvent.click(byLabel('Mais ferramentas'));
    });
    expect(bar().querySelector('[role="menu"]')!.textContent).not.toContain(
      'Trazer a tela'
    );
  });

  test('the privacy note is still announced, not just a glyph', () => {
    // It was a visible "PRIVADO" badge. Shrinking it to an icon with no label
    // would have taken the fact away from anyone not looking at the mouse.
    setup();
    const lock = bar().querySelector('[role="img"]')!;
    expect(lock.getAttribute('aria-label')).toContain('Privado');
  });
});

describe('the overflow menu', () => {
  const entries = [
    { key: 'a', label: 'Alpha', onSelect: () => calls.push('a') },
    { key: 'b', label: 'Beta', onSelect: () => calls.push('b') },
    { key: 'c', label: 'Gamma', onSelect: () => calls.push('c') },
  ];

  function setupMenu() {
    calls.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    render(
      React.createElement(OverflowMenu, { entries, label: 'Mais ferramentas' }),
      { container }
    );
  }

  const trigger = () => byLabel('Mais ferramentas');
  const menu = () => container!.querySelector('[role="menu"]');
  const items = () => Array.from(container!.querySelectorAll<HTMLElement>('[role="menuitem"]'));

  test('the trigger says it opens a menu', () => {
    setupMenu();
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    act(() => {
      fireEvent.click(trigger());
    });
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  test('arrow keys move between the items, which role=menu promises', () => {
    setupMenu();
    act(() => {
      fireEvent.click(trigger());
    });
    const panel = menu()!;
    act(() => {
      fireEvent.keyDown(panel, { key: 'ArrowDown' });
    });
    expect(document.activeElement?.textContent).toBe('Beta');
    act(() => {
      fireEvent.keyDown(panel, { key: 'ArrowDown' });
    });
    expect(document.activeElement?.textContent).toBe('Gamma');
    act(() => {
      fireEvent.keyDown(panel, { key: 'ArrowDown' });
    });
    // Wraps, rather than dead-ending at the last item.
    expect(document.activeElement?.textContent).toBe('Alpha');
    act(() => {
      fireEvent.keyDown(panel, { key: 'ArrowUp' });
    });
    expect(document.activeElement?.textContent).toBe('Gamma');
  });

  test('Escape closes it and hands focus back to the trigger', () => {
    setupMenu();
    act(() => {
      fireEvent.click(trigger());
    });
    act(() => {
      fireEvent.keyDown(menu()!, { key: 'Escape' });
    });
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  test('a click outside closes it', () => {
    setupMenu();
    act(() => {
      fireEvent.click(trigger());
    });
    act(() => {
      fireEvent.pointerDown(document.body);
    });
    expect(menu()).toBeNull();
  });

  test('Tab leaves the menu rather than trapping the keyboard', () => {
    // A menu that traps Tab makes the whole bar unreachable by keyboard, which
    // is a far worse bug than the crowding this component was written to fix.
    setupMenu();
    act(() => {
      fireEvent.click(trigger());
    });
    act(() => {
      fireEvent.keyDown(menu()!, { key: 'Tab' });
    });
    expect(menu()).toBeNull();
  });

  test('every item is reachable by keyboard, with a roving tab stop', () => {
    setupMenu();
    act(() => {
      fireEvent.click(trigger());
    });
    const stops = items().filter((i) => i.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
  });
});

describe('the narrow-window pane switch', () => {
  test('it appears only when the window is too narrow for a split', () => {
    // Above the breakpoint it is noise: both panes fit, and a button whose
    // label is "ver o mapa" would be a lie.
    setup();
    expect(bar().querySelector('[aria-label*="Ver o mapa"]')).toBeNull();
    expect(bar().querySelector('[aria-label*="Ver os tópicos"]')).toBeNull();
  });

  test('on the outline it offers the map, and vice versa', () => {
    setup({ narrowPane: 'outline' });
    const swap = byLabel('Ver o mapa da sessão');
    act(() => {
      fireEvent.click(swap);
    });
    expect(calls).toEqual(['swapPane']);

    setup({ narrowPane: 'map' });
    expect(bar().querySelector('[aria-label="Ver os tópicos da sessão"]')).not.toBeNull();
  });

  test('it counts as a control in the bar, and the bar stays small', () => {
    // The bar's whole point is a ceiling on how much lives in it. On a phone it
    // gains exactly one button, and the map switch is not hiding behind a menu:
    // it is the navigation between the only two surfaces there are.
    setup({ narrowPane: 'outline', isClientConnected: true });
    expect(buttons()).toHaveLength(5);
    expect(byLabel('Mais ferramentas')).not.toBeNull();
  });
});
