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
  isPaused: boolean;
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
      isPaused: false,
      focusZoomOn: false,
      isDark: false,
      canRestoreSplit: false,
      narrowPane: null,
      onSwapPane: () => calls.push('swapPane'),
      onOpenClients: () => calls.push('clients'),
      onOpenClientWindow: () => calls.push('clientWindow'),
      onFocusClientWindow: () => calls.push('focusClient'),
      onTogglePause: () => calls.push('pause'),
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
const labels = () => buttons().map((b) => b.textContent?.trim() ?? '');

afterEach(() => {
  cleanup();
  container?.remove();
  container = null;
});

describe('the session bar', () => {
  test('the share action exists exactly once', () => {
    setup({ isClientConnected: false });
    const matching = buttons().filter((b) => (b.textContent ?? '').includes('Compartilhar'));
    expect(matching).toHaveLength(1);
    expect(bar().textContent).not.toContain('[Abrir]');
  });

  test('disconnected, the one action is to share', () => {
    setup({ isClientConnected: false });
    const action = buttons().find((b) => (b.textContent ?? '').includes('Compartilhar'))!;
    expect(action.className).toContain('ctl-primary');
    act(() => {
      fireEvent.click(action);
    });
    expect(calls).toEqual(['clientWindow']);
  });

  test('connected, the same button reports sharing and pauses', () => {
    // Sharing and pause stay two pieces of state; the button reports which
    // one it is about rather than merging them into a label that means two
    // different things.
    setup({ isClientConnected: true, isPaused: false });
    const action = buttons().find((b) => (b.textContent ?? '').includes('Compartilhado'))!;
    expect(action.className).not.toContain('ctl-primary');
    act(() => {
      fireEvent.click(action);
    });
    expect(calls).toEqual(['pause']);
  });

  test('paused, it offers to resume', () => {
    setup({ isClientConnected: true, isPaused: true });
    expect(labels().some((l) => l.includes('Retomar tela'))).toBe(true);
  });

  test('the pause action is never hidden, at any width', () => {
    // It used to live inside a `hidden lg:flex` cluster, so below 1024px the
    // host could not pause the client's screen except by remembering
    // Ctrl+.. The status pill may hide; the action may not.
    setup({ isClientConnected: true });
    const action = buttons().find((b) => (b.textContent ?? '').includes('Compartilhado'))!;
    expect(action.className).not.toContain('hidden');
  });

  test('the status is a status, not a second button', () => {
    setup({ isClientConnected: true });
    const status = bar().querySelector('[role="status"]')!;
    expect(status.querySelector('button')).toBeNull();
  });

  test('the bar is four controls and a menu, not fourteen buttons', () => {
    setup({ isClientConnected: true });
    // 1 switcher, 1 action, 1 export, 1 menu trigger. Everything else moved.
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
