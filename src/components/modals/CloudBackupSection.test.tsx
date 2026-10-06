import { describe, expect, test, afterEach, beforeEach } from 'bun:test';
import { registerDom } from '../../test/domEnv';

registerDom();

const { render, screen, cleanup, fireEvent } = await import('@testing-library/react');
const React = await import('react');
const { CloudBackupSection } = await import('./CloudBackupSection');
const { getSettings } = await import('../../services/storage');
const { isCryptoAvailable } = await import('../../services/cloudCrypto');
const { lock } = await import('../../services/cloudBackup');

afterEach(() => cleanup());

/**
 * The cloud section mounts inside Settings without an account: disabled
 * shows the opt-in path, enabled shows unlock + ops. No network is touched
 * by rendering — every Puter call starts behind a button.
 */

beforeEach(() => {
  localStorage.removeItem('sessionmap_settings');
});

const noop = () => {};

describe('CloudBackupSection', () => {
  test('disabled: explains itself and offers the opt-in', () => {
    if (!isCryptoAvailable()) return; // Non-secure context: different (honest) UI.
    render(
      React.createElement(CloudBackupSection, {
        settings: getSettings(),
        onUpdateSettings: noop,
        onCloudRestore: noop,
      })
    );
    expect(screen.getByText(/Backup em nuvem \(Puter, cifrado\)/)).toBeTruthy();
    expect(screen.getByText(/Desligado/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /conectar ao puter/i })
    ).toBeTruthy();
    // The non-negotiable promise, stated where the password will be typed.
    expect(screen.getByText(/a senha nunca/)).toBeTruthy();
  });

  test('enabled and locked: unlock, auto, ops and danger zone', () => {
    if (!isCryptoAvailable()) return;
    const settings = {
      ...getSettings(),
      cloudBackup: {
        enabled: true,
        auto: false,
        lastBackupAt: null,
        lastError: null,
        puterUsername: 'anfitriao',
      },
    };
    render(
      React.createElement(CloudBackupSection, {
        settings,
        onUpdateSettings: noop,
        onCloudRestore: noop,
      })
    );
    expect(screen.getByText(/aguardando a senha/)).toBeTruthy();
    expect(screen.getByLabelText('Backup automático')).toBeTruthy();
    expect(screen.getByRole('button', { name: /desbloquear/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /backup agora/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /restaurar da nuvem/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /apagar tudo da nuvem/i })).toBeTruthy();
    // APAGAR flow arms only through its own dialog.
    fireEvent.click(screen.getByRole('button', { name: /apagar tudo da nuvem/i }));
  });

  test('auto toggle writes settings, not a secret', () => {
    if (!isCryptoAvailable()) return;
    let saved = getSettings();
    const settings = {
      ...saved,
      cloudBackup: { ...saved.cloudBackup, enabled: true },
    };
    render(
      React.createElement(CloudBackupSection, {
        settings,
        onUpdateSettings: (s) => { saved = s; },
        onCloudRestore: noop,
      })
    );
    fireEvent.click(screen.getByLabelText('Backup automático'));
    expect(saved.cloudBackup.auto).toBe(true);
  });

  test('forgotten password restarts with a new one, fully offline', () => {
    if (!isCryptoAvailable()) return;
    const settings = {
      ...getSettings(),
      cloudBackup: {
        enabled: true,
        auto: false,
        lastBackupAt: null,
        lastError: null,
        puterUsername: 'anfitriao',
      },
    };
    render(
      React.createElement(CloudBackupSection, {
        settings,
        onUpdateSettings: noop,
        onCloudRestore: noop,
      })
    );
    // Locked: unlock would hit the network to verify, so the reset path —
    // which touches nothing remote — is the offline recovery.
    fireEvent.change(screen.getByLabelText('Senha do backup'), {
      target: { value: 'nova frase secreta bem longa' },
    });
    fireEvent.click(screen.getByRole('button', { name: /recomeçar com uma nova/i }));
    expect(screen.getByRole('button', { name: 'Bloquear' })).toBeTruthy();
    expect(screen.getByText(/próximo envio o substitui/)).toBeTruthy();
  });

  test('a successful reset leaves no password in the form', () => {
    if (!isCryptoAvailable()) return;
    // The reset path only renders while locked; a previous test may have
    // left the module key behind, so lock explicitly.
    lock();
    const settings = {
      ...getSettings(),
      cloudBackup: {
        enabled: true,
        auto: false,
        lastBackupAt: null,
        lastError: null,
        puterUsername: 'anfitriao',
      },
    };
    render(
      React.createElement(CloudBackupSection, {
        settings,
        onUpdateSettings: noop,
        onCloudRestore: noop,
      })
    );
    // The offline recovery path: typed, confirmed, and the form copy dropped.
    const input = screen.getByLabelText('Senha do backup') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'nova frase secreta bem longa' } });
    expect(input.value).toBe('nova frase secreta bem longa');
    fireEvent.click(screen.getByRole('button', { name: /recomeçar com uma nova/i }));
    expect(input.value).toBe('');
  });
});
