import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Cloud,
  CloudOff,
  Download,
  Lock,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { Settings } from '../../types';
import { getSettings } from '../../services/storage';
import {
  applyRestore,
  backupNow,
  backupWithCachedPassphrase,
  clearBackupError,
  describeCloudStatus,
  formatCloudAgo,
  isUnlocked,
  listRemoteFiles,
  lock,
  previewRestore,
  provePassphrase,
  recordBackupError,
  recordBackupSuccess,
  unlock,
  type RestorePreview,
} from '../../services/cloudBackup';
import {
  isCryptoAvailable,
  MIN_PASSPHRASE_LENGTH,
  validatePassphrase,
} from '../../services/cloudCrypto';
import {
  deleteBackupPaths,
  getSpace,
  getUsername,
  isSignedIn,
  loadPuter,
  puterErrorMessage,
  signIn,
  signOut,
  type CloudFile,
  type CloudSpace,
  type Puter,
} from '../../services/puterCloud';
import { Divider } from '../ui/Controls';
import { ConfirmDialog } from '../ui/Modal';
import { TypeToConfirmDialog } from '../ui/TypeToConfirmDialog';

interface CloudBackupSectionProps {
  settings: Settings;
  onUpdateSettings: (s: Settings) => void;
  /** Re-reads storage after a cloud restore lands many records at once. */
  onCloudRestore: () => void | Promise<void>;
}

/**
 * Totally optional encrypted Puter backup, off by default.
 *
 * The passphrase is typed here and lives in tab memory only (see
 * cloudBackup.ts): it is never written to settings, storage, or the cloud.
 * The cloud only ever receives { salt, iv, ct }. What the user can verify
 * without leaving this screen: WHO holds it (username), WHAT is there (file
 * list with sizes and dates, via readdir), and HOW MUCH space it takes.
 */
export const CloudBackupSection: React.FC<CloudBackupSectionProps> = ({
  settings,
  onUpdateSettings,
  onCloudRestore,
}) => {
  const cloud = settings.cloudBackup;
  const status = describeCloudStatus(cloud);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Session-only form state. Cleared on lock/disconnect/unmount: memory,
  // never storage.
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [account, setAccount] = useState<string | null>(cloud.puterUsername);
  const [files, setFiles] = useState<CloudFile[] | null>(null);
  const [space, setSpace] = useState<CloudSpace | null>(null);

  const [pendingRestore, setPendingRestore] = useState<RestorePreview | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CloudFile[] | null>(null);

  const apiRef = useRef<Puter | null>(null);

  useEffect(() => {
    setAccount(cloud.puterUsername);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.puterUsername]);

  // Passwords must not outlive the session UI: clear on unmount.
  useEffect(
    () => () => {
      setPassword('');
      setPasswordConfirm('');
    },
    []
  );

  if (!isCryptoAvailable()) {
    return (
      <div className="p-4 rounded-panel border border-caution/40 bg-surface-sunken text-xs">
        <h3 className="font-bold text-content flex items-center gap-1.5">
          <CloudOff className="w-4 h-4" aria-hidden="true" />
          Backup em nuvem indisponível aqui
        </h3>
        <p className="mt-1 font-medium text-content-muted">
          A cifragem exige Web Crypto, que só existe em HTTPS ou localhost. Por
          HTTP na rede local o backup em nuvem fica desligado — de propósito:
          sem cripto, nada sobe.
        </p>
      </div>
    );
  }

  /** Pushes the freshly-read settings up, so the footer indicator follows. */
  const syncSettings = () => onUpdateSettings(getSettings());

  const fail = (e: unknown) => {
    // Everything funnels through puterErrorMessage: our own Errors carry
    // Portuguese sentences that pass through untouched, coded rejections
    // get mapped, and offline surfaces first.
    const message = puterErrorMessage(e);
    recordBackupError(message);
    syncSettings();
    setError(message);
  };

  const needPassword = (): string | null => {
    if (password.trim()) return password;
    return null;
  };

  const handleConnect = async () => {
    setBusy('connect');
    setError(null);
    setNotice(null);
    try {
      const api = await loadPuter();
      apiRef.current = api;
      // Popup: this runs inside the click gesture, so the browser allows it.
      if (!isSignedIn(api)) await signIn(api);
      const username = await getUsername(api);
      setAccount(username);
      onUpdateSettings({
        ...getSettings(),
        cloudBackup: { ...getSettings().cloudBackup, puterUsername: username },
      });
      await refreshRemote(api);
      setNotice(
        username ? `Conectado como ${username}.` : 'Conectado ao Puter.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : puterErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const refreshRemote = async (api?: Puter | null) => {
    const live = api ?? apiRef.current;
    if (!live || !isSignedIn(live)) return;
    try {
      const [listed, quota] = await Promise.all([
        listRemoteFiles(live),
        getSpace(live),
      ]);
      setFiles(listed);
      setSpace(quota);
    } catch {
      // Listing is transparency, not the mission: a failure here must not
      // mask the backup result that may have just succeeded.
    }
  };

  const handleEnable = async () => {
    const problem = validatePassphrase(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== passwordConfirm) {
      setError('As duas senhas não conferem.');
      return;
    }
    setBusy('enable');
    setError(null);
    setNotice(null);
    try {
      // Prove the passphrase seals AND opens before anything is trusted.
      await provePassphrase(password);
      const api = apiRef.current ?? (await loadPuter());
      apiRef.current = api;
      if (!isSignedIn(api)) await signIn(api);
      const username = await getUsername(api);
      await backupNow(api, password);
      unlock(password);
      recordBackupSuccess(username);
      onUpdateSettings({
        ...getSettings(),
        cloudBackup: { ...getSettings().cloudBackup, enabled: true, puterUsername: username },
      });
      setAccount(username);
      await refreshRemote(api);
      setNotice('Backup em nuvem ativado: primeiro envio já cifrado e guardado.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const handleUnlock = async () => {
    const pw = needPassword();
    if (!pw) {
      setError('Digite a senha do backup para desbloquear.');
      return;
    }
    setBusy('unlock');
    setError(null);
    setNotice(null);
    try {
      const api = apiRef.current ?? (await loadPuter());
      apiRef.current = api;
      if (!isSignedIn(api)) await signIn(api);
      const remote = await listRemoteFiles(api);
      setFiles(remote);
      if (remote.length > 0) {
        // A remote file exists: trial-decrypt proves the password. Wrong
        // password (or tampering) rejects here, before anything is trusted.
        await previewRestore(api, pw);
      }
      unlock(pw);
      clearBackupError();
      syncSettings();
      setNotice(
        remote.length > 0
          ? 'Senha conferida com o arquivo da nuvem. Backup automático retomado.'
          : 'Desbloqueado. Ainda não há backup na nuvem.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : puterErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const handleLock = () => {
    lock();
    setPassword('');
    setPasswordConfirm('');
    syncSettings();
    setNotice('Senha esquecida neste navegador. O automático pausa até desbloquear.');
  };

  /**
   * Starts over with a new passphrase, WITHOUT verifying against the cloud
   * file — that file was sealed with the forgotten one, so verification is
   * impossible by definition. The next backup overwrites it at the same path,
   * and until then the old blob sits unreadable. This is the recovery path
   * for a lost passphrase; the alternative (no path) would brick the feature.
   */
  const handleResetPassword = () => {
    const problem = validatePassphrase(password);
    if (problem) {
      setError(problem);
      return;
    }
    unlock(password);
    clearBackupError();
    syncSettings();
    setNotice(
      'Nova senha em uso. O backup antigo da nuvem ficou ilegível — o próximo envio o substitui.'
    );
  };

  const handleBackupNow = async () => {
    // Typed password wins; the remembered session key is the one-click
    // fallback when unlocked. Locked AND empty field: ask, do not guess.
    const effective = password.trim() ? password : null;
    if (!effective && !isUnlocked()) {
      setError('Digite a senha do backup para enviar.');
      return;
    }
    setBusy('backup');
    setError(null);
    setNotice(null);
    try {
      const api = apiRef.current ?? (await loadPuter());
      apiRef.current = api;
      const result = effective
        ? await (async () => {
            const r = await backupNow(api, effective);
            unlock(effective);
            return r;
          })()
        : await backupWithCachedPassphrase(api);
      recordBackupSuccess(result.username);
      syncSettings();
      await refreshRemote(api);
      setNotice(`Enviado e cifrado (${formatBytes(result.bytes)}). A nuvem nunca vê o conteúdo.`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const handlePreviewRestore = async () => {
    const effective = needPassword();
    if (!effective) {
      setError('Digite a senha do backup para ler a nuvem.');
      return;
    }
    setBusy('restore');
    setError(null);
    setNotice(null);
    try {
      const api = apiRef.current ?? (await loadPuter());
      apiRef.current = api;
      if (!isSignedIn(api)) await signIn(api);
      const preview = await previewRestore(api, effective);
      (apiRef as { previewPw?: string }).previewPw = effective;
      setPendingRestore(preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : puterErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmRestore = async () => {
    const preview = pendingRestore;
    const pw = (apiRef as { previewPw?: string }).previewPw;
    setPendingRestore(null);
    if (!preview || !pw) return;
    setBusy('restore');
    try {
      const api = apiRef.current ?? (await loadPuter());
      const counts = await applyRestore(api, pw);
      await onCloudRestore();
      setNotice(
        `Restaurado da nuvem: ${counts.maps} ${counts.maps === 1 ? 'sessão' : 'sessões'}, ` +
          `${counts.clients} ${counts.clients === 1 ? 'cliente' : 'clientes'}.`
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
      (apiRef as { previewPw?: string }).previewPw = undefined;
    }
  };

  const handleAskDelete = async () => {
    setBusy('list');
    setError(null);
    try {
      const api = apiRef.current ?? (await loadPuter());
      apiRef.current = api;
      if (!isSignedIn(api)) await signIn(api);
      const remote = await listRemoteFiles(api);
      setFiles(remote);
      if (remote.length === 0) {
        setNotice('A nuvem já está vazia: nada para apagar.');
        return;
      }
      setPendingDelete(remote);
    } catch (e) {
      setError(e instanceof Error ? e.message : puterErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const confirmDeleteAll = async () => {
    const targets = pendingDelete;
    setPendingDelete(null);
    if (!targets || targets.length === 0) return;
    setBusy('delete');
    try {
      const api = apiRef.current ?? (await loadPuter());
      await deleteBackupPaths(api, targets.map((f) => f.path));
      // Nothing up there anymore, so "last backup" is honestly null again.
      const s = getSettings();
      onUpdateSettings({
        ...s,
        cloudBackup: { ...s.cloudBackup, lastBackupAt: null, lastError: null },
      });
      await refreshRemote(api);
      setNotice('Tudo apagado da nuvem. O backup local continua intacto.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async () => {
    try {
      if (apiRef.current) signOut(apiRef.current);
    } catch {
      // ignore
    }
    apiRef.current = null;
    lock();
    setPassword('');
    setPasswordConfirm('');
    setAccount(null);
    setFiles(null);
    setSpace(null);
    setNotice('Desconectado do Puter e senha esquecida. Ative de novo quando quiser.');
  };

  const statusLine = () => {
    if (!cloud.enabled) return 'Desligado — tudo fica só neste navegador.';
    switch (status.kind) {
      case 'locked':
        return 'Ligado, aguardando a senha para retomar.';
      case 'error':
        return `Última tentativa falhou: ${status.lastError ?? 'erro'}`;
      case 'never':
        return 'Ligado, nenhum envio ainda.';
      case 'ok':
        return `Último envio ${formatCloudAgo(Date.now(), status.lastBackupAt)}.`;
      default:
        return '';
    }
  };

  return (
    <>
      <Divider />
      <section aria-label="Backup em nuvem">
        <h3 className="text-xs font-bold text-content uppercase tracking-wider flex items-center gap-1.5">
          {cloud.enabled ? (
            <Cloud className="w-3.5 h-3.5 text-accent-text" aria-hidden="true" />
          ) : (
            <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          Backup em nuvem (Puter, cifrado)
        </h3>
        <p className="mt-1 text-[11px] font-medium text-content-muted">
          Opcional e desligado por padrão. Quando ligado, cada envio é cifrado
          <strong> neste navegador </strong>
          antes de subir: a nuvem guarda só bytes ilegíveis, e a senha nunca
          sai daqui. {statusLine()}
          {account && (
            <>
              {' '}Conta: <strong>{account}</strong>.
            </>
          )}
        </p>

        {error && (
          <p role="alert" className="mt-2 p-2.5 rounded-control border border-caution/40 bg-surface-sunken text-[11px] font-semibold text-content">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-2 p-2.5 rounded-control border border-line bg-accent-soft text-[11px] font-semibold text-content">
            {notice}
          </p>
        )}

        {!cloud.enabled ? (
          <div className="mt-3 space-y-2.5">
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={busy !== null}
              className="ctl w-full text-xs font-bold"
            >
              <Cloud className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{busy === 'connect' ? 'Conectando…' : account ? `Conectado como ${account}` : '1 · Conectar ao Puter'}</span>
            </button>
            {account && (
              <>
                <div>
                  <label htmlFor="cloud-new-password" className="block text-xs font-bold text-content uppercase tracking-wider mb-1.5">
                    2 · Senha do backup (só sua, mínimo {MIN_PASSPHRASE_LENGTH} caracteres)
                  </label>
                  <input
                    id="cloud-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Uma frase que só você saiba"
                    className="w-full h-11 px-3 text-sm rounded-control border border-line bg-surface-raised text-content placeholder:text-content-subtle"
                  />
                </div>
                <div>
                  <label htmlFor="cloud-new-password-confirm" className="block text-xs font-bold text-content uppercase tracking-wider mb-1.5">
                    Confirmar a senha
                  </label>
                  <input
                    id="cloud-new-password-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    placeholder="Repita a frase"
                    className="w-full h-11 px-3 text-sm rounded-control border border-line bg-surface-raised text-content placeholder:text-content-subtle"
                  />
                </div>
                <p className="text-[11px] font-medium text-content-muted">
                  Sem a senha, nem você abre o backup depois — não há
                  recuperação. Guarde-a onde guarda senhas.
                </p>
                <button
                  type="button"
                  onClick={() => void handleEnable()}
                  disabled={busy !== null}
                  className="ctl ctl-primary w-full text-xs font-bold"
                >
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{busy === 'enable' ? 'Ativando e enviando…' : '3 · Ativar e fazer o primeiro envio'}</span>
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="mt-3 space-y-2.5">
            {/* Unlock / lock */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 min-w-0">
                <label htmlFor="cloud-password" className="sr-only">
                  Senha do backup
                </label>
                <input
                  id="cloud-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isUnlocked() ? 'Desbloqueado ✓ (senha guardada só nesta sessão)' : 'Senha do backup'}
                  disabled={isUnlocked()}
                  className="w-full h-11 px-3 text-sm rounded-control border border-line bg-surface-raised text-content placeholder:text-content-subtle disabled:opacity-60"
                />
              </div>
              {isUnlocked() ? (
                <button
                  type="button"
                  onClick={handleLock}
                  className="ctl text-xs font-bold shrink-0"
                >
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Bloquear</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleUnlock()}
                  disabled={busy !== null}
                  className="ctl ctl-primary text-xs font-bold shrink-0"
                >
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{busy === 'unlock' ? 'Conferindo…' : 'Desbloquear'}</span>
                </button>
              )}
            </div>
            {!isUnlocked() && (
              <div>
                <button
                  type="button"
                  onClick={handleResetPassword}
                  disabled={busy !== null}
                  className="text-[11px] font-bold text-content-muted hover:text-content underline underline-offset-2"
                >
                  Esqueci a senha — recomeçar com uma nova
                </button>
                <p className="mt-0.5 text-[11px] font-medium text-content-muted">
                  O backup antigo da nuvem fica ilegível; o próximo envio o
                  substitui. Nada no navegador muda.
                </p>
              </div>
            )}

            {/* Auto */}
            <label className="flex items-center justify-between gap-3 p-2.5 rounded-control border border-line bg-surface-sunken cursor-pointer">
              <span className="text-xs font-bold text-content">
                Backup automático
                <span className="block text-[11px] font-medium text-content-muted">
                  Envia sozinho ~1 min após salvar, só desbloqueado e online. Nunca abre login sozinho.
                </span>
              </span>
              <input
                type="checkbox"
                checked={cloud.auto}
                onChange={(e) =>
                  onUpdateSettings({
                    ...getSettings(),
                    cloudBackup: { ...getSettings().cloudBackup, auto: e.target.checked },
                  })
                }
                aria-label="Backup automático"
                className="w-5 h-5 accent-[var(--accent-text)] shrink-0"
              />
            </label>

            {/* Manual ops */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleBackupNow()}
                disabled={busy !== null}
                className="ctl ctl-primary text-xs font-bold"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{busy === 'backup' ? 'Enviando…' : 'Backup agora'}</span>
              </button>
              <button
                type="button"
                onClick={() => void handlePreviewRestore()}
                disabled={busy !== null}
                className="ctl text-xs font-bold"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{busy === 'restore' ? 'Lendo…' : 'Restaurar da nuvem'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setBusy('list');
                  const api = apiRef.current;
                  (async () => {
                    try {
                      const live = api ?? (await loadPuter());
                      apiRef.current = live;
                      await refreshRemote(live);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : puterErrorMessage(e));
                    } finally {
                      setBusy(null);
                    }
                  })();
                }}
                disabled={busy !== null}
                className="ctl text-xs font-bold"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Ver arquivos</span>
              </button>
            </div>

            {/* Transparency: what is up there, byte counts included */}
            {(files !== null || space !== null) && (
              <div className="p-2.5 rounded-control border border-line bg-surface-sunken text-[11px]">
                {space && (
                  <p className="font-mono font-bold text-content-muted">
                    Puter: {formatBytes(space.used)} de {formatBytes(space.capacity)} usados
                  </p>
                )}
                {files !== null && (
                  files.length === 0 ? (
                    <p className="mt-1 font-medium text-content-muted">Nenhum arquivo do SessionMap na nuvem.</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {files.map((f) => (
                        <li key={f.path} className="flex items-center justify-between gap-2 font-medium text-content-muted">
                          <span className="font-mono truncate">{f.name}</span>
                          <span className="shrink-0 font-mono">
                            {f.size !== null ? formatBytes(f.size) : '?'}
                            {f.modified ? ` · ${new Date(f.modified).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </div>
            )}

            {/* Danger zone */}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleAskDelete()}
                disabled={busy !== null}
                className="ctl ctl-danger text-xs font-bold"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Apagar tudo da nuvem…</span>
              </button>
              <button
                type="button"
                onClick={() => void handleDisconnect()}
                disabled={busy !== null}
                className="ctl text-xs font-bold"
              >
                <CloudOff className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Desconectar</span>
              </button>
            </div>
            <p className="text-[11px] font-medium text-content-muted">
              Apagar da nuvem não toca neste navegador. Desconectar esquece a
              senha aqui e pausa o automático.
            </p>
          </div>
        )}
      </section>

      {/* Portaled: true siblings of every dialog in the DOM, so no focus
          trap ever contains another. */}
      {createPortal(
        <ConfirmDialog
          isOpen={pendingRestore !== null}
          title="Restaurar da nuvem?"
          confirmLabel="Restaurar backup"
          cancelLabel="Cancelar"
          onCancel={() => setPendingRestore(null)}
          onConfirm={() => void confirmRestore()}
          description={
            pendingRestore ? (
              <>
                <p>
                  A nuvem guarda <strong>{pendingRestore.maps} sessões</strong>
                  {pendingRestore.clients > 0 && <> e <strong>{pendingRestore.clients} clientes</strong></>}
                  {pendingRestore.exportedAt && <> (enviado em {new Date(pendingRestore.exportedAt).toLocaleDateString('pt-BR')})</>}.
                </p>
                <p className="mt-2 text-content-subtle">
                  Sessões e clientes com o mesmo id serão substituídos. Tipos e
                  roteiros novos são somados.
                </p>
              </>
            ) : null
          }
        />,
        document.body
      )}
      {createPortal(
        <TypeToConfirmDialog
          isOpen={pendingDelete !== null}
          title="Apagar tudo da nuvem?"
          requireWord="APAGAR"
          confirmLabel="Apagar tudo da nuvem"
          cancelLabel="Manter"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDeleteAll()}
          description={
            pendingDelete ? (
              <>
                <p>Estes arquivos somem do seu Puter, sem desfazer:</p>
                <ul className="mt-1 space-y-0.5 font-mono">
                  {pendingDelete.map((f) => (
                    <li key={f.path}>· {f.name}</li>
                  ))}
                </ul>
                <p className="mt-2 text-content-subtle">
                  O backup local continua intacto — só a cópia da nuvem vai.
                </p>
              </>
            ) : null
          }
        />,
        document.body
      )}
    </>
  );
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
