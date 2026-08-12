import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { hostApi } from '@/lib/host-api';
import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';
import { cn } from '@/lib/utils';
import { TitleBar } from '@/components/layout/TitleBar';

type AuthMode = 'token' | 'password';

export function Setup() {
  const { t } = useTranslation('setup');
  const navigate = useNavigate();
  const markSetupComplete = useSettingsStore((state) => state.markSetupComplete);
  const setGatewayConnection = useSettingsStore((state) => state.setGatewayConnection);
  const setGatewayStatus = useGatewayStore((state) => state.setStatus);
  const [url, setUrl] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('token');
  const [credential, setCredential] = useState('');
  const [showCredential, setShowCredential] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    void hostApi.gateway.connection().then((connection) => {
      setUrl(connection.url);
      setAuthMode(connection.authMode);
    }).catch(() => {});
  }, []);

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setWarning(null);
    let normalizedUrl: string;
    try {
      const parsed = new URL(url.trim());
      if ((parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') || !parsed.hostname) {
        throw new Error(t('connection.invalidUrl'));
      }
      if (parsed.username || parsed.password) throw new Error(t('connection.credentialsInUrl'));
      normalizedUrl = parsed.toString();
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : t('connection.invalidUrl'));
      return;
    }
    if (!credential.trim()) {
      setError(t('connection.credentialRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const result = await hostApi.gateway.configure(normalizedUrl, authMode, credential);
      if (!result.success) {
        const status = result.status;
        if (status) setGatewayStatus(status);
        if (status?.errorCode === 'unauthorized') throw new Error(t('connection.unauthorized'));
        if (status?.errorCode === 'pairing-required') {
          setWarning(t('connection.pairingRequired'));
          return;
        }
        if (status?.errorCode === 'origin-not-allowed') throw new Error(t('connection.originNotAllowed'));
        throw new Error(result.error || t('connection.unreachable'));
      }
      if (result.status) setGatewayStatus(result.status);
      setGatewayConnection(normalizedUrl, authMode);
      markSetupComplete();
      navigate('/', { replace: true });
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : t('connection.unreachable'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div data-testid="setup-page" className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <main className="flex flex-1 items-center justify-center overflow-auto px-6 py-8">
      <section className="w-full max-w-[430px] rounded-xl border border-border bg-card shadow-sm">
        <header className="flex items-center gap-3 border-b border-border px-6 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-black/5 dark:bg-white/5">
            <PlugZap className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight">{t('connection.title')}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('connection.subtitle')}</p>
          </div>
        </header>

        <form className="space-y-5 px-6 py-6" onSubmit={connect}>
          <div className="space-y-2">
            <Label htmlFor="gateway-url" className="text-xs">{t('connection.url')}</Label>
            <Input
              id="gateway-url"
              data-testid="remote-gateway-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="wss://gateway.example.com:18789"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="rounded-md bg-surface-input font-mono text-xs"
              disabled={submitting}
            />
            <p className="text-[11px] leading-4 text-muted-foreground">{t('connection.urlHelp')}</p>
            <p className="text-[11px] leading-4 text-muted-foreground">{t('connection.originHelp')}</p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">{t('connection.authMode')}</legend>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-black/5 p-1 dark:bg-white/5">
              {(['token', 'password'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  data-testid={`remote-gateway-auth-${mode}`}
                  className={cn(
                    'h-8 rounded-md text-xs transition-colors',
                    authMode === mode ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setAuthMode(mode)}
                  disabled={submitting}
                >
                  {t(`connection.${mode}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="gateway-credential" className="text-xs">
              {t(`connection.${authMode}`)}
            </Label>
            <div className="relative">
              <Input
                id="gateway-credential"
                data-testid="remote-gateway-credential"
                type={showCredential ? 'text' : 'password'}
                value={credential}
                onChange={(event) => setCredential(event.target.value)}
                autoComplete="off"
                className="rounded-md bg-surface-input pr-10 font-mono text-xs"
                disabled={submitting}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
                onClick={() => setShowCredential((value) => !value)}
                aria-label={showCredential ? t('connection.hideCredential') : t('connection.showCredential')}
              >
                {showCredential ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] leading-4 text-muted-foreground">{t('connection.secureStorage')}</p>
          </div>

          {error && (
            <div role="alert" data-testid="remote-gateway-error" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {warning && (
            <div role="status" data-testid="remote-gateway-warning" className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {warning}
            </div>
          )}

          <Button type="submit" data-testid="remote-gateway-connect" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitting ? t('connection.connecting') : t('connection.connect')}
          </Button>
        </form>
      </section>
      </main>
    </div>
  );
}

export default Setup;
