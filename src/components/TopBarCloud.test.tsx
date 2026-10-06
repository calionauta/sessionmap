import { describe, expect, test, afterEach } from 'bun:test';
import { registerDom } from '../test/domEnv';

registerDom();

const { render, fireEvent, screen, cleanup } = await import('@testing-library/react');
const React = await import('react');
const { TopBar } = await import('./TopBar');

afterEach(() => cleanup());

/**
 * The cloud pill in the session bar.
 *
 * The complaint was "nothing up top says whether the cloud is connected".
 * Pins: absent while the feature is off (the default offline product shows
 * nothing new), present with the shared label when on, and a click goes to
 * Settings — a status pill, never an action disguised as one.
 */

function renderBar(cloud: React.ComponentProps<typeof TopBar>['cloud'], onOpenSettings: () => void) {
  return render(
    React.createElement(TopBar, {
      clientName: 'Ana',
      sessionLabel: 'Sessão 1',
      isClientConnected: false,
      focusZoomOn: false,
      isDark: false,
      canRestoreSplit: false,
      narrowPane: null,
      onSwapPane: () => {},
      onOpenClients: () => {},
      onOpenClientWindow: () => {},
      onFocusClientWindow: () => {},
      onStopSharing: () => {},
      onOpenMapList: () => {},
      onToggleFocusZoom: () => {},
      onOpenShareGuide: () => {},
      onOpenExport: () => {},
      onToggleTheme: () => {},
      onOpenSettings,
      onRestoreSplit: () => {},
      cloud,
    })
  );
}

describe('TopBar cloud pill', () => {
  test('absent while the feature is off', () => {
    renderBar(null, () => {});
    expect(screen.queryByText(/nuvem/)).toBeNull();
  });

  test('absent when the prop is omitted (older callers)', () => {
    renderBar(undefined, () => {});
    expect(screen.queryByText(/nuvem/)).toBeNull();
  });

  test('present with the shared label and opens settings', () => {
    let opened = 0;
    renderBar(
      { label: 'nuvem: aguardando senha', hint: 'automático ligado', kind: 'locked' },
      () => { opened += 1; }
    );
    const pill = screen.getByRole('button', { name: /backup em nuvem: nuvem: aguardando senha/i });
    expect(pill.getAttribute('title')).toBe('automático ligado');
    fireEvent.click(pill);
    expect(opened).toBe(1);
  });
});
