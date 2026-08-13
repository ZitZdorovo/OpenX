/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Navigate, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Component, useEffect } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Toaster } from 'sonner';
import i18n from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Models } from './pages/Models';
import { Chat } from './pages/Chat';
import { Agents } from './pages/Agents';
import { Channels } from './pages/Channels';
import { Skills } from './pages/Skills';
import { Cron } from './pages/Cron';
import { ImageGenerationPage } from './pages/ImageGeneration';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import { useSettingsStore } from './stores/settings';
import { useUpdateStore } from './stores/update';
import { useGatewayStore } from './stores/gateway';
import { useProviderStore } from './stores/providers';
import { rendererExtensionRegistry } from './extensions/registry';
import { loadExternalRendererExtensions } from './extensions/_ext-bridge.generated';
import { UpdateNotifier } from './components/update/UpdateNotifier';
import { useNewChatAction } from './components/layout/use-new-chat-action';
import { hostEvents } from './lib/host-events';


/**
 * Error Boundary to catch and display React rendering errors
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React Error Boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground" role="alert">
          <div className="w-full max-w-lg rounded-3xl border border-border bg-surface-modal p-8 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-2xl text-destructive" aria-hidden="true">!</div>
            <h1 className="font-serif text-3xl font-normal tracking-tight">{i18n.t('common:errorBoundary.title')}</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{i18n.t('common:errorBoundary.description')}</p>
            {this.state.error?.message && (
              <details className="mt-5 rounded-xl border border-border bg-background/60 p-3 text-left">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{i18n.t('common:errorBoundary.details')}</summary>
                <p className="mt-2 break-words font-mono text-xs text-foreground/75">{this.state.error.message}</p>
              </details>
            )}
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
              {i18n.t('common:errorBoundary.reload')}
          </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const initSettings = useSettingsStore((state) => state.init);
  const theme = useSettingsStore((state) => state.theme);
  const language = useSettingsStore((state) => state.language);
  const setupComplete = useSettingsStore((state) => state.setupComplete);
  const settingsInitialized = useSettingsStore((state) => state.initialized);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const initGateway = useGatewayStore((state) => state.init);
  const initUpdate = useUpdateStore((state) => state.init);
  const initProviders = useProviderStore((state) => state.init);
  const handleNewChat = useNewChatAction();

  useEffect(() => {
    let cancelled = false;

    void initSettings().finally(() => {
      if (!cancelled) {
        void initUpdate();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [initSettings, initUpdate]);

  // Sync i18n language with persisted settings on mount
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Initialize Gateway connection on mount
  useEffect(() => {
    initGateway();
  }, [initGateway]);

  // Initialize provider snapshot on mount
  useEffect(() => {
    initProviders();
  }, [initProviders]);

  // Redirect to setup wizard if not complete
  useEffect(() => {
    if (settingsInitialized && !setupComplete && !location.pathname.startsWith('/setup')) {
      navigate('/setup');
    }
  }, [settingsInitialized, setupComplete, location.pathname, navigate]);

  // Listen for navigation events from main process
  useEffect(() => {
    const unsubscribe = hostEvents.onNavigate((path) => {
      navigate(path);
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigate]);

  useEffect(() => {
    const unsubscribe = hostEvents.onNewChat(handleNewChat);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [handleNewChat]);

  // Apply theme
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  // Load external renderer extensions (generated by scripts/generate-ext-bridge.mjs)
  // and initialize all registered extensions.
  useEffect(() => {
    loadExternalRendererExtensions();
    void rendererExtensionRegistry.initializeAll();
    return () => rendererExtensionRegistry.teardownAll();
  }, []);

  const extraRoutes = rendererExtensionRegistry.getExtraRoutes();

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <Routes>
          {/* Setup wizard (shown on first launch) */}
          <Route path="/setup/*" element={<Setup />} />

          {/* Main application routes */}
          <Route element={<MainLayout />}>
            <Route path="/" element={<Chat />} />
            <Route path="/models" element={<Models />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/cron" element={<Cron />} />
            <Route path="/image-generation" element={devModeUnlocked ? <ImageGenerationPage /> : <Navigate to="/" replace />} />
            <Route path="/settings/*" element={<Settings />} />
            {extraRoutes.map((r) => (
              <Route key={r.path} path={r.path} element={<r.component />} />
            ))}
          </Route>
        </Routes>

        <UpdateNotifier />

        {/* Global toast notifications */}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          theme={theme}
          style={{ zIndex: 99999 }}
        />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
