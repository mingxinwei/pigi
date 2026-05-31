import React, { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { IconLoader2 } from '@tabler/icons-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { NativeSelect, NativeSelectOption } from './ui/native-select';
import type { AuthProviderInfo } from '../../../shared/ipcContract';

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: AuthProviderInfo[];
  onLoginOAuth: (providerId: string) => Promise<void>;
  onLoginApiKey: (providerId: string, apiKey: string) => Promise<void>;
  onLogout: (providerId: string) => Promise<void>;
}

export default function LoginDialog({
  open,
  onOpenChange,
  providers,
  onLoginOAuth,
  onLoginApiKey,
  onLogout,
}: LoginDialogProps): React.JSX.Element {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [apiKeyProvider, setApiKeyProvider] = useState('');
  const [apiKeyValue, setApiKeyValue] = useState('');
  const [addProviderOpen, setAddProviderOpen] = useState(false);

  const apiKeyProviders = providers.filter((p) => p.authType === 'api_key');
  const oauthProviders = providers.filter((p) => p.authType === 'oauth');
  const configuredApiKeyProviders = apiKeyProviders.filter((p) => p.hasAuth);

  const reset = useCallback(() => {
    setLoadingProvider(null);
    setApiKeyProvider('');
    setApiKeyValue('');
    setAddProviderOpen(false);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) reset();
      onOpenChange(nextOpen);
    },
    [onOpenChange, reset],
  );

  const loginAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const handleOAuthLogin = useCallback(
    async (providerId: string) => {
      const abort = { cancelled: false };
      loginAbortRef.current = abort;
      setLoadingProvider(providerId);
      try {
        await onLoginOAuth(providerId);
        if (!abort.cancelled) toast.success(`Authenticated with ${providerId}`);
      } catch (err) {
        if (!abort.cancelled) toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        if (!abort.cancelled) setLoadingProvider(null);
      }
    },
    [onLoginOAuth],
  );

  // Note: cancel is UI-only. The utility process login RPC continues running
  // (authStorage.login holds a callback server open). The abort.cancelled flag
  // ensures stale results are ignored when they eventually resolve.
  const handleCancelLogin = useCallback(() => {
    loginAbortRef.current.cancelled = true;
    setLoadingProvider(null);
  }, []);

  const handleApiKeySubmit = useCallback(async () => {
    if (!apiKeyProvider.trim() || !apiKeyValue.trim()) return;
    setLoadingProvider(apiKeyProvider.trim());
    try {
      await onLoginApiKey(apiKeyProvider.trim(), apiKeyValue.trim());
      toast.success(`API key saved for ${apiKeyProvider.trim()}`);
      setApiKeyProvider('');
      setApiKeyValue('');
      setAddProviderOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingProvider(null);
    }
  }, [apiKeyProvider, apiKeyValue, onLoginApiKey]);

  const handleLogout = useCallback(
    async (providerId: string) => {
      setLoadingProvider(providerId);
      try {
        await onLogout(providerId);
      } finally {
        setLoadingProvider(null);
      }
    },
    [onLogout],
  );

  const listRef = useRef<HTMLDivElement>(null);

  const handleListKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const container = listRef.current;
    if (!container) return;
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    );
    if (buttons.length === 0) return;
    // activeElement is Element|null; indexOf returns -1 if not found which is handled below
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number;
    if (e.key === 'ArrowDown') {
      nextIndex = currentIndex < buttons.length - 1 ? currentIndex + 1 : 0;
    } else {
      nextIndex = currentIndex > 0 ? currentIndex - 1 : buttons.length - 1;
    }
    buttons[nextIndex].focus();
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Authentication</DialogTitle>
          <DialogDescription>Sign in to an AI provider.</DialogDescription>
        </DialogHeader>

        {/* OAuth section */}
        <div>
          <div className="text-sm font-medium mb-2">OAuth</div>
          <div ref={listRef} onKeyDown={handleListKeyDown} className="flex flex-col gap-2">
            {oauthProviders.map((provider) => {
              const isLoading = loadingProvider === provider.id;
              const isEnvAuth =
                provider.authStatus.source === 'environment' ||
                provider.authStatus.source === 'fallback';
              return (
                <div
                  key={provider.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div>
                    <div className="font-normal text-sm">{provider.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {isEnvAuth
                        ? `Via ${provider.authStatus.source}`
                        : provider.hasAuth
                          ? 'Authenticated'
                          : 'Not configured'}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {provider.hasAuth && !isEnvAuth && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={loadingProvider !== null}
                        onClick={() => handleLogout(provider.id)}
                      >
                        Logout
                      </Button>
                    )}
                    {!isEnvAuth &&
                      (isLoading ? (
                        <Button variant="ghost" size="sm" onClick={handleCancelLogin}>
                          Cancel
                        </Button>
                      ) : (
                        <Button
                          variant={provider.hasAuth ? 'outline' : 'default'}
                          size="sm"
                          disabled={loadingProvider !== null}
                          onClick={() => handleOAuthLogin(provider.id)}
                        >
                          {provider.hasAuth ? 'Re-login' : 'Login'}
                        </Button>
                      ))}
                  </div>
                </div>
              );
            })}
            {oauthProviders.length === 0 && (
              <div className="text-sm text-muted-foreground py-4 text-center">
                No OAuth providers available.
              </div>
            )}
          </div>
        </div>

        {/* API key section */}
        <div className="border-t pt-3">
          <div className="text-sm font-medium mb-2">API key</div>

          {/* Configured API key providers */}
          {configuredApiKeyProviders.length > 0 && (
            <div className="flex flex-col gap-2 mb-3">
              {configuredApiKeyProviders.map((provider) => {
                const isEnvAuth =
                  provider.authStatus.source === 'environment' ||
                  provider.authStatus.source === 'fallback';
                return (
                  <div
                    key={provider.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div>
                      <div className="font-normal text-sm">{provider.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {isEnvAuth ? `Via ${provider.authStatus.source}` : 'Authenticated'}
                      </div>
                    </div>
                    {!isEnvAuth && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={loadingProvider !== null}
                        onClick={() => handleLogout(provider.id)}
                      >
                        Logout
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Add provider (collapsible) */}
          <Collapsible open={addProviderOpen} onOpenChange={setAddProviderOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-2 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <span>Add provider</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-3 pt-2">
                <NativeSelect
                  className="w-full"
                  value={apiKeyProvider}
                  onChange={(e) => setApiKeyProvider(e.target.value)}
                  disabled={loadingProvider !== null}
                >
                  <NativeSelectOption value="" disabled>
                    Select a provider
                  </NativeSelectOption>
                  {apiKeyProviders.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {apiKeyProvider && (
                  <>
                    <div>
                      <label className="text-sm font-normal mb-1 block">API key</label>
                      <input
                        type="password"
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
                        placeholder="sk-..."
                        value={apiKeyValue}
                        onChange={(e) => setApiKeyValue(e.target.value)}
                        disabled={loadingProvider !== null}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleApiKeySubmit();
                        }}
                      />
                    </div>
                    <Button
                      className="self-start"
                      disabled={
                        loadingProvider !== null || !apiKeyProvider.trim() || !apiKeyValue.trim()
                      }
                      variant="outline"
                      onClick={handleApiKeySubmit}
                    >
                      {loadingProvider === apiKeyProvider.trim() ? (
                        <IconLoader2 className="size-4 animate-spin" />
                      ) : (
                        'Save'
                      )}
                    </Button>
                  </>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </DialogContent>
    </Dialog>
  );
}
