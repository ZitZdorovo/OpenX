/**
 * Settings Page
 * Application configuration
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CircleHelp, Code2, Copy, ExternalLink, FileText, Info, Monitor, Moon, Network, Palette, RefreshCw, Search, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useUpdateStore } from '@/stores/update';
import { UpdateSettings } from '@/components/settings/UpdateSettings';
import { toUserMessage } from '@/lib/error-message';
import {
  clearUiTelemetry,
  getUiTelemetrySnapshot,
  subscribeUiTelemetry,
  trackUiEvent,
  type UiTelemetryEntry,
} from '@/lib/telemetry';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { hostApi, type OpenClawDoctorResult } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';
import { cn } from '@/lib/utils';
type ControlUiInfo = {
  url: string;
  port: number;
};

type SettingsSection = 'appearance' | 'gateway' | 'developer' | 'updates' | 'about';

export function Settings() {
  const { t, i18n } = useTranslation('settings');
  const navigate = useNavigate();
  const location = useLocation();
  const {
    theme,
    setTheme,
    language,
    setLanguage,
    launchAtStartup,
    setLaunchAtStartup,
    gatewayUrl,
    gatewayAuthMode,
    setGatewayConnection,
    proxyEnabled,
    proxyServer,
    proxyHttpServer,
    proxyHttpsServer,
    proxyAllServer,
    proxyBypassRules,
    setProxyEnabled,
    setProxyServer,
    setProxyHttpServer,
    setProxyHttpsServer,
    setProxyAllServer,
    setProxyBypassRules,
    devModeUnlocked,
    setDevModeUnlocked,
    telemetryEnabled,
    setTelemetryEnabled,
    agentBadgeMode,
    agentBadgeAliases,
    setAgentBadgeMode,
    setAgentBadgeAlias,
  } = useSettingsStore();

  const { status: gatewayStatus, restart: restartGateway } = useGatewayStore();
  const agents = useAgentsStore((state) => state.agents);
  const fetchAgents = useAgentsStore((state) => state.fetchAgents);
  const currentVersion = useUpdateStore((state) => state.currentVersion);
  const [controlUiInfo, setControlUiInfo] = useState<ControlUiInfo | null>(null);
  const [gatewayUrlDraft, setGatewayUrlDraft] = useState(gatewayUrl);
  const [gatewayAuthModeDraft, setGatewayAuthModeDraft] = useState<'token' | 'password'>(gatewayAuthMode);
  const [gatewayCredentialDraft, setGatewayCredentialDraft] = useState('');
  const [savingGateway, setSavingGateway] = useState(false);
  const [omniRouteUrl, setOmniRouteUrl] = useState('');
  const [omniRouteToken, setOmniRouteToken] = useState('');
  const [omniRouteConfigured, setOmniRouteConfigured] = useState(false);
  const [savingOmniRoute, setSavingOmniRoute] = useState(false);
  const [openclawCliCommand, setOpenclawCliCommand] = useState('');
  const [openclawCliError, setOpenclawCliError] = useState<string | null>(null);
  const [proxyServerDraft, setProxyServerDraft] = useState('');
  const [proxyHttpServerDraft, setProxyHttpServerDraft] = useState('');
  const [proxyHttpsServerDraft, setProxyHttpsServerDraft] = useState('');
  const [proxyAllServerDraft, setProxyAllServerDraft] = useState('');
  const [proxyBypassRulesDraft, setProxyBypassRulesDraft] = useState('');
  const [proxyEnabledDraft, setProxyEnabledDraft] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const [showTelemetryViewer, setShowTelemetryViewer] = useState(false);
  const [telemetryEntries, setTelemetryEntries] = useState<UiTelemetryEntry[]>([]);

  const isWindows = window.electron.platform === 'win32';
  const showCliTools = true;
  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [doctorRunningMode, setDoctorRunningMode] = useState<'diagnose' | 'fix' | null>(null);
  const [doctorResult, setDoctorResult] = useState<OpenClawDoctorResult | null>(null);
  const requestedSection = new URLSearchParams(location.search).get('section') as SettingsSection | null;
  const [activeSection, setActiveSection] = useState<SettingsSection>(requestedSection ?? 'appearance');
  const [settingsSearch, setSettingsSearch] = useState('');
  const settingsNavigation = useMemo(() => [
    { id: 'appearance' as const, label: t('appearance.title'), icon: Palette },
    { id: 'gateway' as const, label: t('gateway.title'), icon: Network },
    ...(devModeUnlocked ? [{ id: 'developer' as const, label: t('developer.title'), icon: Code2 }] : []),
    { id: 'updates' as const, label: t('updates.title'), icon: RefreshCw },
    { id: 'about' as const, label: t('about.title'), icon: Info },
  ], [devModeUnlocked, t]);
  const settingsSearchItems = useMemo(() => [
    { section: 'appearance' as const, target: 'settings-theme', label: t('appearance.theme') },
    { section: 'appearance' as const, target: 'settings-language', label: t('appearance.language') },
    { section: 'appearance' as const, target: 'settings-launch-at-startup', label: t('appearance.launchAtStartup') },
    { section: 'appearance' as const, target: 'agent-badge-mode', label: t('appearance.agentBadge') },
    { section: 'gateway' as const, target: 'settings-gateway-status', label: t('gateway.status') },
    { section: 'gateway' as const, target: 'gateway-url', label: t('remoteGateway.url') },
    { section: 'gateway' as const, target: 'settings-omniroute-limits', label: t('omniRouteLimits.title') },
    { section: 'appearance' as const, target: 'settings-dev-mode', label: t('advanced.devMode') },
    { section: 'appearance' as const, target: 'settings-telemetry', label: t('advanced.telemetry') },
    { section: 'developer' as const, target: 'settings-proxy-section', label: t('gateway.proxyTitle') },
    { section: 'updates' as const, target: 'settings-auto-update', label: t('updates.autoCheck') },
    { section: 'about' as const, target: 'settings-section-about', label: t('about.title') },
  ].filter((item) => item.section !== 'developer' || devModeUnlocked), [devModeUnlocked, t]);
  const filteredSettingsSearchItems = useMemo(() => {
    const query = settingsSearch.trim().toLocaleLowerCase();
    if (!query) return [];
    return settingsSearchItems.filter((item) => {
      const sectionLabel = settingsNavigation.find((section) => section.id === item.section)?.label ?? '';
      return `${item.label} ${sectionLabel}`.toLocaleLowerCase().includes(query);
    });
  }, [settingsNavigation, settingsSearch, settingsSearchItems]);

  const selectSection = (section: SettingsSection, target?: string) => {
    setActiveSection(section);
    navigate(`/settings?section=${section}`, { replace: true });
    if (target) {
      requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: 'center' }));
    }
  };

  useEffect(() => {
    const section = new URLSearchParams(location.search).get('section') as SettingsSection | null;
    if (section && settingsNavigation.some((item) => item.id === section)) setActiveSection(section);
  }, [location.search, settingsNavigation]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return;
      const openLayer = document.querySelector(
        '[role="dialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]',
      );
      if (openLayer) return;
      event.preventDefault();
      navigate(-1);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [navigate]);

  const handleShowLogs = async () => {
    try {
      const logs = await hostApi.logs.recent(100);
      setLogContent(logs.content);
      setShowLogs(true);
    } catch {
      setLogContent('(Failed to load logs)');
      setShowLogs(true);
    }
  };

  const handleOpenLogDir = async () => {
    try {
      const { dir: logDir } = await hostApi.logs.dir();
      if (logDir) {
        await hostApi.shell.showItemInFolder(logDir);
      }
    } catch {
      // ignore
    }
  };

  const handleRunOpenClawDoctor = async (mode: 'diagnose' | 'fix') => {
    setDoctorRunningMode(mode);
    try {
      const result = await hostApi.app.openClawDoctor(mode);
      setDoctorResult(result);
      if (result.success) {
        toast.success(mode === 'fix' ? t('developer.doctorFixSucceeded') : t('developer.doctorSucceeded'));
      } else {
        toast.error(result.error || (mode === 'fix' ? t('developer.doctorFixFailed') : t('developer.doctorFailed')));
      }
    } catch (error) {
      const message =
        toUserMessage(error) || (mode === 'fix' ? t('developer.doctorFixRunFailed') : t('developer.doctorRunFailed'));
      toast.error(message);
      setDoctorResult({
        mode,
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        command: 'openclaw doctor',
        cwd: '',
        durationMs: 0,
        error: message,
      });
    } finally {
      setDoctorRunningMode(null);
    }
  };

  const handleCopyDoctorOutput = async () => {
    if (!doctorResult) return;
    const payload = [
      `command: ${doctorResult.command}`,
      `cwd: ${doctorResult.cwd}`,
      `exitCode: ${doctorResult.exitCode ?? 'null'}`,
      `durationMs: ${doctorResult.durationMs}`,
      '',
      '[stdout]',
      doctorResult.stdout.trim() || '(empty)',
      '',
      '[stderr]',
      doctorResult.stderr.trim() || '(empty)',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(payload);
      toast.success(t('developer.doctorCopied'));
    } catch (error) {
      toast.error(`Failed to copy doctor output: ${String(error)}`);
    }
  };

  const refreshControlUiInfo = async () => {
    try {
      const result = await hostApi.gateway.controlUi();
      if (result.success && result.url && typeof result.port === 'number') {
        setControlUiInfo({ url: result.url, port: result.port });
      }
    } catch {
      // Ignore refresh errors
    }
  };

  const handleSaveGateway = async () => {
    if (!gatewayCredentialDraft.trim()) return;
    setSavingGateway(true);
    try {
      const result = await hostApi.gateway.configure(
        gatewayUrlDraft.trim(),
        gatewayAuthModeDraft,
        gatewayCredentialDraft,
      );
      setGatewayConnection(gatewayUrlDraft.trim(), gatewayAuthModeDraft);
      setGatewayCredentialDraft('');
      if (result.success) toast.success(t('remoteGateway.saved'));
      else toast.error(result.error || t('remoteGateway.failed'));
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      setSavingGateway(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void hostApi.usage.omniRouteConfig().then((config) => {
      if (cancelled) return;
      setOmniRouteUrl(config.baseUrl);
      setOmniRouteConfigured(config.configured);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveOmniRoute = async () => {
    setSavingOmniRoute(true);
    try {
      const result = await hostApi.usage.configureOmniRoute({
        baseUrl: omniRouteUrl,
        ...(omniRouteToken.trim() ? { managementToken: omniRouteToken } : {}),
      });
      if (!result.success) {
        toast.error(result.error || t('omniRouteLimits.description'));
        return;
      }
      setOmniRouteUrl(result.baseUrl);
      setOmniRouteConfigured(result.configured);
      setOmniRouteToken('');
      toast.success(t('omniRouteLimits.saved'));
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      setSavingOmniRoute(false);
    }
  };

  const handleDisconnectOmniRoute = async () => {
    setSavingOmniRoute(true);
    try {
      const result = await hostApi.usage.configureOmniRoute({
        baseUrl: '',
        clearToken: true,
      });
      if (!result.success) {
        toast.error(result.error || t('omniRouteLimits.description'));
        return;
      }
      setOmniRouteUrl('');
      setOmniRouteToken('');
      setOmniRouteConfigured(false);
      toast.success(t('omniRouteLimits.removed'));
    } catch (error) {
      toast.error(toUserMessage(error));
    } finally {
      setSavingOmniRoute(false);
    }
  };

  useEffect(() => {
    if (!showCliTools) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await hostApi.openclaw.getCliCommand();
        if (cancelled) return;
        if (result.success && result.command) {
          setOpenclawCliCommand(result.command);
          setOpenclawCliError(null);
        } else {
          setOpenclawCliCommand('');
          setOpenclawCliError(result.error || 'OpenClaw CLI unavailable');
        }
      } catch (error) {
        if (cancelled) return;
        setOpenclawCliCommand('');
        setOpenclawCliError(String(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [devModeUnlocked, showCliTools]);

  useEffect(() => {
    if (gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false) void fetchAgents();
  }, [fetchAgents, gatewayStatus.connectedAt, gatewayStatus.gatewayReady, gatewayStatus.state]);

  const handleCopyCliCommand = async () => {
    if (!openclawCliCommand) return;
    try {
      await navigator.clipboard.writeText(openclawCliCommand);
      toast.success(t('developer.cmdCopied'));
    } catch (error) {
      toast.error(`Failed to copy command: ${String(error)}`);
    }
  };

  useEffect(() => {
    const unsubscribe = hostEvents.onOpenClawCliInstalled((installedPath) => {
      toast.success(`openclaw CLI installed at ${installedPath}`);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!devModeUnlocked) return;
    setTelemetryEntries(getUiTelemetrySnapshot(200));
    const unsubscribe = subscribeUiTelemetry((entry) => {
      setTelemetryEntries((prev) => {
        const next = [...prev, entry];
        if (next.length > 200) {
          next.splice(0, next.length - 200);
        }
        return next;
      });
    });
    return unsubscribe;
  }, [devModeUnlocked]);

  useEffect(() => {
    setProxyEnabledDraft(proxyEnabled);
  }, [proxyEnabled]);

  useEffect(() => {
    setProxyServerDraft(proxyServer);
  }, [proxyServer]);

  useEffect(() => {
    setProxyHttpServerDraft(proxyHttpServer);
  }, [proxyHttpServer]);

  useEffect(() => {
    setProxyHttpsServerDraft(proxyHttpsServer);
  }, [proxyHttpsServer]);

  useEffect(() => {
    setProxyAllServerDraft(proxyAllServer);
  }, [proxyAllServer]);

  useEffect(() => {
    setProxyBypassRulesDraft(proxyBypassRules);
  }, [proxyBypassRules]);

  const proxySettingsDirty = useMemo(() => {
    return (
      proxyEnabledDraft !== proxyEnabled ||
      proxyServerDraft.trim() !== proxyServer ||
      proxyHttpServerDraft.trim() !== proxyHttpServer ||
      proxyHttpsServerDraft.trim() !== proxyHttpsServer ||
      proxyAllServerDraft.trim() !== proxyAllServer ||
      proxyBypassRulesDraft.trim() !== proxyBypassRules
    );
  }, [
    proxyAllServer,
    proxyAllServerDraft,
    proxyBypassRules,
    proxyBypassRulesDraft,
    proxyEnabled,
    proxyEnabledDraft,
    proxyHttpServer,
    proxyHttpServerDraft,
    proxyHttpsServer,
    proxyHttpsServerDraft,
    proxyServer,
    proxyServerDraft,
  ]);

  const handleSaveProxySettings = async () => {
    setSavingProxy(true);
    try {
      const normalizedProxyServer = proxyServerDraft.trim();
      const normalizedHttpServer = proxyHttpServerDraft.trim();
      const normalizedHttpsServer = proxyHttpsServerDraft.trim();
      const normalizedAllServer = proxyAllServerDraft.trim();
      const normalizedBypassRules = proxyBypassRulesDraft.trim();
      await hostApi.settings.setMany({
        proxyEnabled: proxyEnabledDraft,
        proxyServer: normalizedProxyServer,
        proxyHttpServer: normalizedHttpServer,
        proxyHttpsServer: normalizedHttpsServer,
        proxyAllServer: normalizedAllServer,
        proxyBypassRules: normalizedBypassRules,
      });

      setProxyServer(normalizedProxyServer);
      setProxyHttpServer(normalizedHttpServer);
      setProxyHttpsServer(normalizedHttpsServer);
      setProxyAllServer(normalizedAllServer);
      setProxyBypassRules(normalizedBypassRules);
      setProxyEnabled(proxyEnabledDraft);

      toast.success(t('gateway.proxySaved'));
      trackUiEvent('settings.proxy_saved', { enabled: proxyEnabledDraft });
    } catch (error) {
      toast.error(`${t('gateway.proxySaveFailed')}: ${toUserMessage(error)}`);
    } finally {
      setSavingProxy(false);
    }
  };

  const telemetryStats = useMemo(() => {
    let errorCount = 0;
    let slowCount = 0;
    for (const entry of telemetryEntries) {
      if (entry.event.endsWith('_error') || entry.event.includes('request_error')) {
        errorCount += 1;
      }
      const durationMs = typeof entry.payload.durationMs === 'number' ? entry.payload.durationMs : Number.NaN;
      if (Number.isFinite(durationMs) && durationMs >= 800) {
        slowCount += 1;
      }
    }
    return { total: telemetryEntries.length, errorCount, slowCount };
  }, [telemetryEntries]);

  const telemetryByEvent = useMemo(() => {
    const map = new Map<
      string,
      {
        event: string;
        count: number;
        errorCount: number;
        slowCount: number;
        totalDuration: number;
        timedCount: number;
        lastTs: string;
      }
    >();

    for (const entry of telemetryEntries) {
      const current = map.get(entry.event) ?? {
        event: entry.event,
        count: 0,
        errorCount: 0,
        slowCount: 0,
        totalDuration: 0,
        timedCount: 0,
        lastTs: entry.ts,
      };

      current.count += 1;
      current.lastTs = entry.ts;

      if (entry.event.endsWith('_error') || entry.event.includes('request_error')) {
        current.errorCount += 1;
      }

      const durationMs = typeof entry.payload.durationMs === 'number' ? entry.payload.durationMs : Number.NaN;
      if (Number.isFinite(durationMs)) {
        current.totalDuration += durationMs;
        current.timedCount += 1;
        if (durationMs >= 800) {
          current.slowCount += 1;
        }
      }

      map.set(entry.event, current);
    }

    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  }, [telemetryEntries]);

  const handleCopyTelemetry = async () => {
    try {
      const serialized = telemetryEntries.map((entry) => JSON.stringify(entry)).join('\n');
      await navigator.clipboard.writeText(serialized);
      toast.success(t('developer.telemetryCopied'));
    } catch (error) {
      toast.error(`${t('common:status.error')}: ${String(error)}`);
    }
  };

  const handleClearTelemetry = () => {
    clearUiTelemetry();
    setTelemetryEntries([]);
    toast.success(t('developer.telemetryCleared'));
  };

  const handleLanguageChange = (nextLanguage: string) => {
    if (nextLanguage === language) return;
    const translateNext = i18n.getFixedT(nextLanguage, 'settings');
    setLanguage(nextLanguage);
    toast.success(translateNext('appearance.menuLanguageUpdated'));
  };

  return (
    <div
      data-testid="settings-page"
      className="openx-page-root"
    >
      <div className="flex h-full min-h-0">
        <aside className="flex w-60 shrink-0 flex-col border-r border-border/60 bg-surface-sidebar px-3 py-4" data-testid="settings-navigation">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mb-4 flex h-9 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{t('navigation.back')}</span>
          </button>
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={settingsSearch}
              onChange={(event) => setSettingsSearch(event.target.value)}
              placeholder={t('navigation.search')}
              aria-label={t('navigation.search')}
              className="h-9 rounded-xl bg-black/[0.025] pl-9 text-sm dark:bg-white/[0.035]"
            />
          </div>
          <nav className="space-y-1">
            {!settingsSearch.trim() && settingsNavigation.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                data-testid={`settings-nav-${id}`}
                onClick={() => selectSection(id)}
                className={cn(
                  'flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors',
                  activeSection === id
                    ? 'bg-black/5 font-medium text-foreground dark:bg-white/10'
                    : 'text-foreground/75 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
            {settingsSearch.trim() && filteredSettingsSearchItems.map((item) => {
              const section = settingsNavigation.find((entry) => entry.id === item.section);
              const Icon = section?.icon ?? CircleHelp;
              return (
                <button
                  key={`${item.section}:${item.target}`}
                  type="button"
                  data-testid={`settings-search-result-${item.target}`}
                  onClick={() => selectSection(item.section, item.target)}
                  className="flex min-h-10 w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-foreground/90">{item.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{section?.label}</span>
                  </span>
                </button>
              );
            })}
            {settingsSearch.trim() && filteredSettingsSearchItems.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                <CircleHelp className="mb-2 h-4 w-4" />
                {t('navigation.noResults')}
              </div>
            )}
          </nav>
        </aside>
      <div className="openx-page-frame min-w-0 flex-1">
        {/* Header */}
        <div className="openx-page-header">
          <div>
            <h1 className="openx-page-title">
              {t('title')}
            </h1>
            <p className="text-subtitle text-foreground/70 font-medium">{t('subtitle')}</p>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2 space-y-12">
          {/* Appearance */}
          <div className={cn(activeSection !== 'appearance' && 'hidden')} data-testid="settings-section-appearance">
            <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight">
              {t('appearance.title')}
            </h2>
            <div className="space-y-6">
              <div id="settings-theme" className="space-y-3">
                <Label className="text-sm font-medium text-foreground/80">{t('appearance.theme')}</Label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={theme === 'light' ? 'secondary' : 'outline'}
                    className={cn(
                      'rounded-full px-5 h-10 border-black/10 dark:border-white/10',
                      theme === 'light'
                        ? 'bg-black/5 dark:bg-white/10 text-foreground'
                        : 'bg-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5',
                    )}
                    onClick={() => setTheme('light')}
                  >
                    <Sun className="h-4 w-4 mr-2" />
                    {t('appearance.light')}
                  </Button>
                  <Button
                    variant={theme === 'dark' ? 'secondary' : 'outline'}
                    className={cn(
                      'rounded-full px-5 h-10 border-black/10 dark:border-white/10',
                      theme === 'dark'
                        ? 'bg-black/5 dark:bg-white/10 text-foreground'
                        : 'bg-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5',
                    )}
                    onClick={() => setTheme('dark')}
                  >
                    <Moon className="h-4 w-4 mr-2" />
                    {t('appearance.dark')}
                  </Button>
                  <Button
                    variant={theme === 'system' ? 'secondary' : 'outline'}
                    className={cn(
                      'rounded-full px-5 h-10 border-black/10 dark:border-white/10',
                      theme === 'system'
                        ? 'bg-black/5 dark:bg-white/10 text-foreground'
                        : 'bg-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5',
                    )}
                    onClick={() => setTheme('system')}
                  >
                    <Monitor className="h-4 w-4 mr-2" />
                    {t('appearance.system')}
                  </Button>
                </div>
              </div>
              <div id="settings-language" className="space-y-3">
                <Label className="text-sm font-medium text-foreground/80">{t('appearance.language')}</Label>
                <div className="flex flex-wrap gap-2">
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <Button
                      key={lang.code}
                      variant={language === lang.code ? 'secondary' : 'outline'}
                      className={cn(
                        'rounded-full px-5 h-10 border-black/10 dark:border-white/10',
                        language === lang.code
                          ? 'bg-black/5 dark:bg-white/10 text-foreground'
                          : 'bg-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5',
                      )}
                      onClick={() => handleLanguageChange(lang.code)}
                    >
                      {lang.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="settings-launch-at-startup" className="text-sm font-medium text-foreground/80">{t('appearance.launchAtStartup')}</Label>
                  <p className="text-meta text-muted-foreground mt-1">{t('appearance.launchAtStartupDesc')}</p>
                </div>
                <Switch id="settings-launch-at-startup" checked={launchAtStartup} onCheckedChange={setLaunchAtStartup} />
              </div>
              <div className="space-y-3 border-t border-black/5 pt-5 dark:border-white/5">
                <div>
                  <Label htmlFor="agent-badge-mode" className="text-sm font-medium text-foreground/80">{t('appearance.agentBadge')}</Label>
                  <p className="mt-1 text-meta text-muted-foreground">{t('appearance.agentBadgeDesc')}</p>
                </div>
                <select
                  id="agent-badge-mode"
                  value={agentBadgeMode}
                  onChange={(event) => setAgentBadgeMode(event.target.value as typeof agentBadgeMode)}
                  className="h-9 w-full max-w-sm rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="full">{t('appearance.agentBadgeFull')}</option>
                  <option value="initial">{t('appearance.agentBadgeInitial')}</option>
                  <option value="hidden">{t('appearance.agentBadgeHidden')}</option>
                  <option value="custom">{t('appearance.agentBadgeCustom')}</option>
                </select>
                {agentBadgeMode === 'custom' && (
                  <div className="max-w-xl space-y-2">
                    {agents.map((agent) => (
                      <label key={agent.id} className="grid grid-cols-[minmax(0,1fr)_minmax(140px,220px)] items-center gap-3 text-sm">
                        <span className="min-w-0 truncate text-foreground/80" title={`${agent.name} (${agent.id})`}>{agent.name}</span>
                        <Input
                          key={`${agent.id}:${agentBadgeAliases[agent.id] ?? ''}`}
                          defaultValue={agentBadgeAliases[agent.id] ?? ''}
                          placeholder={agent.name}
                          className="h-8 rounded-lg text-sm"
                          onBlur={(event) => setAgentBadgeAlias(agent.id, event.currentTarget.value)}
                        />
                      </label>
                    ))}
                    {agents.length === 0 && <p className="text-meta text-muted-foreground">{t('appearance.agentBadgeNoAgents')}</p>}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-black/5 pt-5 dark:border-white/5">
                <div>
                  <Label htmlFor="settings-dev-mode" className="text-sm font-medium text-foreground">{t('advanced.devMode')}</Label>
                  <p className="text-meta text-muted-foreground mt-1">{t('advanced.devModeDesc')}</p>
                </div>
                <Switch
                  id="settings-dev-mode"
                  checked={devModeUnlocked}
                  onCheckedChange={setDevModeUnlocked}
                  data-testid="settings-dev-mode-switch"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="settings-telemetry" className="text-sm font-medium text-foreground">{t('advanced.telemetry')}</Label>
                  <p className="text-meta text-muted-foreground mt-1">{t('advanced.telemetryDesc')}</p>
                </div>
                <Switch id="settings-telemetry" checked={telemetryEnabled} onCheckedChange={setTelemetryEnabled} />
              </div>
            </div>
          </div>

          <Separator className="hidden" />

          {/* Gateway */}
          <div className={cn(activeSection !== 'gateway' && 'hidden')} data-testid="settings-section-gateway">
            <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight">
              {t('gateway.title')}
            </h2>
            <div className="space-y-6">
              <div id="settings-gateway-status" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <Label className="text-sm font-medium text-foreground">{t('gateway.status')}</Label>
                  <p className="text-meta text-muted-foreground mt-1 font-mono">{gatewayUrl}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-meta font-medium border',
                      gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false
                        ? 'bg-green-500/10 text-green-600 dark:text-green-500 border-green-500/20'
                        : gatewayStatus.state === 'running'
                          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
                          : gatewayStatus.state === 'error'
                            ? 'bg-red-500/10 text-red-600 dark:text-red-500 border-red-500/20'
                            : 'bg-black/5 dark:bg-white/5 text-muted-foreground border-transparent',
                    )}
                  >
                    <div
                      className={cn(
                        'w-1.5 h-1.5 rounded-full',
                        gatewayStatus.state === 'running' && gatewayStatus.gatewayReady !== false
                          ? 'bg-green-500'
                          : gatewayStatus.state === 'running'
                            ? 'bg-amber-500'
                            : gatewayStatus.state === 'error'
                              ? 'bg-red-500'
                              : 'bg-muted-foreground',
                      )}
                    />
                    {gatewayStatus.state === 'running' && gatewayStatus.gatewayReady === false
                      ? 'starting'
                      : gatewayStatus.state}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={restartGateway}
                    className="rounded-full h-8 px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    {t('common:actions.restart')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleShowLogs}
                    className="rounded-full h-8 px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    {t('gateway.logs')}
                  </Button>
                </div>
              </div>

              {showLogs && (
                <div className="p-4 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-medium text-sm">{t('gateway.appLogs')}</p>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={handleOpenLogDir}
                      >
                        <ExternalLink className="h-3 w-3 mr-1.5" />
                        {t('gateway.openFolder')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs rounded-full hover:bg-black/5 dark:hover:bg-white/10"
                        onClick={() => setShowLogs(false)}
                      >
                        {t('common:actions.close')}
                      </Button>
                    </div>
                  </div>
                  <pre className="text-xs text-muted-foreground bg-surface-input p-4 rounded-xl max-h-60 overflow-auto whitespace-pre-wrap font-mono border border-black/5 dark:border-white/5 shadow-inner">
                    {logContent || t('chat:noLogs')}
                  </pre>
                </div>
              )}

              <div className="grid gap-3 rounded-2xl border border-black/5 bg-black/[0.025] p-4 dark:border-white/5 dark:bg-white/[0.025]">
                <div className="grid gap-2">
                  <Label htmlFor="gateway-url">{t('remoteGateway.url')}</Label>
                  <Input id="gateway-url" value={gatewayUrlDraft} onChange={(event) => setGatewayUrlDraft(event.target.value)} placeholder="wss://gateway.example.com" className="font-mono" />
                </div>
                <div className="flex gap-2">
                  {(['token', 'password'] as const).map((mode) => (
                    <Button key={mode} type="button" size="sm" variant={gatewayAuthModeDraft === mode ? 'secondary' : 'outline'} onClick={() => setGatewayAuthModeDraft(mode)}>
                      {t(`remoteGateway.${mode}`)}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input type="password" value={gatewayCredentialDraft} onChange={(event) => setGatewayCredentialDraft(event.target.value)} placeholder={t(gatewayAuthModeDraft === 'token' ? 'remoteGateway.tokenPlaceholder' : 'remoteGateway.passwordPlaceholder')} className="font-mono" />
                  <Button type="button" onClick={() => void handleSaveGateway()} disabled={savingGateway || !gatewayCredentialDraft.trim()}>
                    {savingGateway ? t('remoteGateway.connecting') : t('remoteGateway.saveConnect')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('remoteGateway.secure')}</p>
                <p className="text-xs text-muted-foreground">{t('remoteGateway.deviceIdentity')}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{t('remoteGateway.originHelp')}</p>
              </div>

              <div id="settings-omniroute-limits" className="grid gap-3 rounded-2xl border border-black/5 bg-black/[0.025] p-4 dark:border-white/5 dark:bg-white/[0.025]" data-testid="settings-omniroute-limits">
                <div>
                  <Label className="text-sm font-medium text-foreground">{t('omniRouteLimits.title')}</Label>
                  <p className="mt-1 text-xs text-muted-foreground">{t('omniRouteLimits.description')}</p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="omniroute-url">{t('omniRouteLimits.url')}</Label>
                  <Input
                    id="omniroute-url"
                    value={omniRouteUrl}
                    onChange={(event) => setOmniRouteUrl(event.target.value)}
                    placeholder={t('omniRouteLimits.urlPlaceholder')}
                    className="font-mono"
                    data-testid="settings-omniroute-url"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="omniroute-token">{t('omniRouteLimits.token')}</Label>
                  <Input
                    id="omniroute-token"
                    type="password"
                    value={omniRouteToken}
                    onChange={(event) => setOmniRouteToken(event.target.value)}
                    placeholder={t(omniRouteConfigured ? 'omniRouteLimits.tokenSavedPlaceholder' : 'omniRouteLimits.tokenPlaceholder')}
                    className="font-mono"
                    data-testid="settings-omniroute-token"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => void handleSaveOmniRoute()}
                    disabled={savingOmniRoute || !omniRouteUrl.trim() || (!omniRouteConfigured && !omniRouteToken.trim())}
                    data-testid="settings-omniroute-save"
                  >
                    {t('omniRouteLimits.save')}
                  </Button>
                  {omniRouteConfigured && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleDisconnectOmniRoute()}
                      disabled={savingOmniRoute}
                    >
                      {t('omniRouteLimits.disconnect')}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t('omniRouteLimits.secure')}</p>
                <p className="font-mono text-[11px] text-muted-foreground">{t('omniRouteLimits.remoteHint')}</p>
              </div>

            </div>
          </div>

          {/* Developer */}
          {devModeUnlocked && activeSection === 'developer' && (
            <>
              <Separator className="hidden" />
              <div data-testid="settings-developer-section">
                <h2
                  data-testid="settings-developer-title"
                  className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight"
                >
                  {t('developer.title')}
                </h2>
                <div className="space-y-8">
                  {/* Gateway Proxy */}
                  <div id="settings-proxy-section" className="space-y-4" data-testid="settings-proxy-section">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label htmlFor="settings-proxy" className="text-sm font-medium text-foreground/80">{t('gateway.proxyTitle')}</Label>
                        <p className="text-meta text-muted-foreground">{t('gateway.proxyDesc')}</p>
                      </div>
                      <Switch
                        id="settings-proxy"
                        checked={proxyEnabledDraft}
                        onCheckedChange={setProxyEnabledDraft}
                        data-testid="settings-proxy-toggle"
                      />
                    </div>

                    <div className="flex items-center gap-4">
                      <Button
                        variant="outline"
                        onClick={handleSaveProxySettings}
                        disabled={savingProxy || !proxySettingsDirty}
                        data-testid="settings-proxy-save-button"
                        className="rounded-xl h-10 px-5 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <RefreshCw className={`h-4 w-4 mr-2${savingProxy ? ' animate-spin' : ''}`} />
                        {savingProxy ? t('common:status.saving') : t('common:actions.save')}
                      </Button>
                      <p className="text-xs text-muted-foreground">{t('gateway.proxyRestartNote')}</p>
                    </div>

                    {proxyEnabledDraft && (
                      <div className="space-y-4 pt-2">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="proxy-server" className="text-meta text-foreground/80">
                              {t('gateway.proxyServer')}
                            </Label>
                            <Input
                              id="proxy-server"
                              value={proxyServerDraft}
                              onChange={(event) => setProxyServerDraft(event.target.value)}
                              placeholder="http://127.0.0.1:7890"
                              className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                            />
                            <p className="text-tiny text-muted-foreground">{t('gateway.proxyServerHelp')}</p>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="proxy-http-server" className="text-meta text-foreground/80">
                              {t('gateway.proxyHttpServer')}
                            </Label>
                            <Input
                              id="proxy-http-server"
                              value={proxyHttpServerDraft}
                              onChange={(event) => setProxyHttpServerDraft(event.target.value)}
                              placeholder={proxyServerDraft || 'http://127.0.0.1:7890'}
                              className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                            />
                            <p className="text-tiny text-muted-foreground">{t('gateway.proxyHttpServerHelp')}</p>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="proxy-https-server" className="text-meta text-foreground/80">
                              {t('gateway.proxyHttpsServer')}
                            </Label>
                            <Input
                              id="proxy-https-server"
                              value={proxyHttpsServerDraft}
                              onChange={(event) => setProxyHttpsServerDraft(event.target.value)}
                              placeholder={proxyServerDraft || 'http://127.0.0.1:7890'}
                              className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                            />
                            <p className="text-tiny text-muted-foreground">{t('gateway.proxyHttpsServerHelp')}</p>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="proxy-all-server" className="text-meta text-foreground/80">
                              {t('gateway.proxyAllServer')}
                            </Label>
                            <Input
                              id="proxy-all-server"
                              value={proxyAllServerDraft}
                              onChange={(event) => setProxyAllServerDraft(event.target.value)}
                              placeholder={proxyServerDraft || 'socks5://127.0.0.1:7891'}
                              className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                            />
                            <p className="text-tiny text-muted-foreground">{t('gateway.proxyAllServerHelp')}</p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="proxy-bypass" className="text-meta text-foreground/80">
                            {t('gateway.proxyBypass')}
                          </Label>
                          <Input
                            id="proxy-bypass"
                            value={proxyBypassRulesDraft}
                            onChange={(event) => setProxyBypassRulesDraft(event.target.value)}
                            placeholder="<local>;localhost;127.0.0.1;::1"
                            className="h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent font-mono text-meta"
                          />
                          <p className="text-tiny text-muted-foreground">{t('gateway.proxyBypassHelp')}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 pt-4">
                    <Label className="text-sm font-medium text-foreground/80">{t('remoteGateway.controlUi')}</Label>
                    <p className="text-meta text-muted-foreground">{t('remoteGateway.hidden')}</p>
                    <Button type="button" variant="outline" onClick={() => void refreshControlUiInfo()}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {controlUiInfo?.url || t('common:actions.load')}
                    </Button>
                  </div>

                  {showCliTools && (
                    <div className="space-y-3">
                      <Label className="text-sm font-medium text-foreground">{t('developer.cli')}</Label>
                      <p className="text-meta text-muted-foreground">{t('developer.cliDesc')}</p>
                      {isWindows && <p className="text-xs text-muted-foreground">{t('developer.cliPowershell')}</p>}
                      <div className="flex flex-wrap gap-2">
                        <Input
                          readOnly
                          value={openclawCliCommand}
                          placeholder={openclawCliError || t('developer.cmdUnavailable')}
                          className="font-mono text-meta h-10 rounded-xl bg-black/5 dark:bg-white/5 border-transparent flex-1 min-w-[200px]"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCopyCliCommand}
                          disabled={!openclawCliCommand}
                          className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          {t('common:actions.copy')}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-sm font-medium text-foreground">{t('developer.doctor')}</Label>
                        <p className="text-meta text-muted-foreground mt-1">{t('developer.doctorDesc')}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleRunOpenClawDoctor('diagnose')}
                          disabled={doctorRunningMode !== null}
                          className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <RefreshCw
                            className={`h-4 w-4 mr-2${doctorRunningMode === 'diagnose' ? ' animate-spin' : ''}`}
                          />
                          {doctorRunningMode === 'diagnose' ? t('common:status.running') : t('developer.runDoctor')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleRunOpenClawDoctor('fix')}
                          disabled={doctorRunningMode !== null}
                          className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <RefreshCw className={`h-4 w-4 mr-2${doctorRunningMode === 'fix' ? ' animate-spin' : ''}`} />
                          {doctorRunningMode === 'fix' ? t('common:status.running') : t('developer.runDoctorFix')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleCopyDoctorOutput}
                          disabled={!doctorResult}
                          className="rounded-xl h-10 px-4 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          {t('common:actions.copy')}
                        </Button>
                      </div>
                    </div>

                    {doctorResult && (
                      <div className="space-y-3 rounded-2xl border border-black/10 dark:border-white/10 p-5 bg-black/5 dark:bg-white/5">
                        <div className="flex flex-wrap gap-2 text-xs">
                          <Badge
                            variant={doctorResult.success ? 'secondary' : 'destructive'}
                            className="rounded-full px-3 py-1"
                          >
                            {doctorResult.mode === 'fix'
                              ? doctorResult.success
                                ? t('developer.doctorFixOk')
                                : t('developer.doctorFixIssue')
                              : doctorResult.success
                                ? t('developer.doctorOk')
                                : t('developer.doctorIssue')}
                          </Badge>
                          <Badge variant="outline" className="rounded-full px-3 py-1">
                            {t('developer.doctorExitCode')}: {doctorResult.exitCode ?? 'null'}
                          </Badge>
                          <Badge variant="outline" className="rounded-full px-3 py-1">
                            {t('developer.doctorDuration')}: {Math.round(doctorResult.durationMs)}ms
                          </Badge>
                        </div>
                        <div className="space-y-1 text-xs text-muted-foreground font-mono break-all">
                          <p>
                            {t('developer.doctorCommand')}: {doctorResult.command}
                          </p>
                          <p>
                            {t('developer.doctorWorkingDir')}: {doctorResult.cwd || '-'}
                          </p>
                          {doctorResult.error && (
                            <p>
                              {t('developer.doctorError')}: {doctorResult.error}
                            </p>
                          )}
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-foreground/80">{t('developer.doctorStdout')}</p>
                            <pre className="max-h-72 overflow-auto rounded-xl border border-black/10 dark:border-white/10 bg-surface-input p-3 text-tiny font-mono whitespace-pre-wrap break-words">
                              {doctorResult.stdout.trim() || t('developer.doctorOutputEmpty')}
                            </pre>
                          </div>
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-foreground/80">{t('developer.doctorStderr')}</p>
                            <pre className="max-h-72 overflow-auto rounded-xl border border-black/10 dark:border-white/10 bg-surface-input p-3 text-tiny font-mono whitespace-pre-wrap break-words">
                              {doctorResult.stderr.trim() || t('developer.doctorOutputEmpty')}
                            </pre>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-sm font-medium text-foreground">{t('developer.telemetryViewer')}</Label>
                        <p className="text-meta text-muted-foreground mt-1">{t('developer.telemetryViewerDesc')}</p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowTelemetryViewer((prev) => !prev)}
                        className="rounded-full px-5 h-9 bg-transparent border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        {showTelemetryViewer ? t('common:actions.hide') : t('common:actions.show')}
                      </Button>
                    </div>

                    {showTelemetryViewer && (
                      <div className="space-y-4 rounded-2xl border border-black/10 dark:border-white/10 p-5 bg-black/5 dark:bg-white/5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="secondary"
                            className="rounded-full px-3 py-1 bg-surface-modal border border-black/5 dark:border-white/5"
                          >
                            {t('developer.telemetryTotal')}: {telemetryStats.total}
                          </Badge>
                          <Badge
                            variant={telemetryStats.errorCount > 0 ? 'destructive' : 'secondary'}
                            className={cn(
                              'rounded-full px-3 py-1',
                              telemetryStats.errorCount === 0 &&
                                'bg-surface-modal border border-black/5 dark:border-white/5',
                            )}
                          >
                            {t('developer.telemetryErrors')}: {telemetryStats.errorCount}
                          </Badge>
                          <Badge
                            variant={telemetryStats.slowCount > 0 ? 'secondary' : 'outline'}
                            className={cn(
                              'rounded-full px-3 py-1',
                              telemetryStats.slowCount === 0 &&
                                'bg-surface-modal border border-black/5 dark:border-white/5',
                            )}
                          >
                            {t('developer.telemetrySlow')}: {telemetryStats.slowCount}
                          </Badge>
                          <div className="ml-auto flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleCopyTelemetry}
                              className="rounded-full h-8 px-4 bg-surface-modal border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/10"
                            >
                              <Copy className="h-3.5 w-3.5 mr-1.5" />
                              {t('common:actions.copy')}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleClearTelemetry}
                              className="rounded-full h-8 px-4 bg-surface-modal border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/10"
                            >
                              {t('common:actions.clear')}
                            </Button>
                          </div>
                        </div>

                        <div className="max-h-80 overflow-auto rounded-xl border border-black/10 dark:border-white/10 bg-surface-modal shadow-inner">
                          {telemetryByEvent.length > 0 && (
                            <div className="border-b border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-3">
                              <p className="mb-3 text-xs font-semibold text-muted-foreground">
                                {t('developer.telemetryAggregated')}
                              </p>
                              <div className="space-y-1.5 text-xs">
                                {telemetryByEvent.map((item) => (
                                  <div
                                    key={item.event}
                                    className="grid grid-cols-[minmax(0,1.6fr)_0.7fr_0.9fr_0.8fr_1fr] gap-2 rounded-lg border border-black/5 dark:border-white/5 bg-surface-modal px-3 py-2"
                                  >
                                    <span className="truncate font-medium" title={item.event}>
                                      {item.event}
                                    </span>
                                    <span className="text-muted-foreground">n={item.count}</span>
                                    <span className="text-muted-foreground">
                                      avg={item.timedCount > 0 ? Math.round(item.totalDuration / item.timedCount) : 0}ms
                                    </span>
                                    <span className="text-muted-foreground">slow={item.slowCount}</span>
                                    <span className="text-muted-foreground">err={item.errorCount}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="space-y-2 p-3 font-mono text-xs">
                            {telemetryEntries.length === 0 ? (
                              <div className="text-muted-foreground text-center py-4">
                                {t('developer.telemetryEmpty')}
                              </div>
                            ) : (
                              telemetryEntries
                                .slice()
                                .reverse()
                                .map((entry) => (
                                  <div
                                    key={entry.id}
                                    className="rounded-lg border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 p-3"
                                  >
                                    <div className="flex items-center justify-between gap-3 mb-2">
                                      <span className="font-semibold text-foreground">{entry.event}</span>
                                      <span className="text-muted-foreground text-tiny">{entry.ts}</span>
                                    </div>
                                    <pre className="whitespace-pre-wrap text-tiny text-muted-foreground overflow-x-auto">
                                      {JSON.stringify({ count: entry.count, ...entry.payload }, null, 2)}
                                    </pre>
                                  </div>
                                ))
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          <Separator className="hidden" />

          {/* Updates */}
          <div className={cn(activeSection !== 'updates' && 'hidden')} data-testid="settings-section-updates">
            <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight">
              {t('updates.title')}
            </h2>
            <div className="space-y-6">
              <UpdateSettings />

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="settings-auto-update" className="text-sm font-medium text-foreground">{t('updates.autoCheck')}</Label>
                  <p className="text-meta text-muted-foreground mt-1">{t('updates.autoCheckDesc')}</p>
                </div>
                <Switch id="settings-auto-update" checked={false} disabled aria-label={t('updates.autoCheck')} />
              </div>
            </div>
          </div>

          <Separator className="hidden" />

          {/* About */}
          <div id="settings-section-about" className={cn(activeSection !== 'about' && 'hidden')} data-testid="settings-section-about">
            <h2 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight">{t('about.title')}</h2>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground font-semibold">{t('about.appName')}</strong> - {t('about.tagline')}
              </p>
              <p>{t('about.basedOn')}</p>
              <p>{t('about.version', { version: currentVersion })}</p>
              <div className="flex gap-4 pt-3">
                <Button
                  variant="link"
                  className="h-auto p-0 text-sm text-blue-500 hover:text-blue-600 font-medium"
                  onClick={() => window.electron.openExternal('https://valuecell.ai')}
                >
                  {t('about.docs')}
                </Button>
                <Button
                  variant="link"
                  className="h-auto p-0 text-sm text-blue-500 hover:text-blue-600 font-medium"
                  onClick={() => window.electron.openExternal('https://github.com/ZitZdorovo/OpenX')}
                >
                  {t('about.github')}
                </Button>
                <Button
                  variant="link"
                  className="h-auto p-0 text-sm text-blue-500 hover:text-blue-600 font-medium"
                  onClick={() =>
                    window.electron.openExternal('https://github.com/ZitZdorovo/OpenX#readme')
                  }
                >
                  {t('about.faq')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

export default Settings;
