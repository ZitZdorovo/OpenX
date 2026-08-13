import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useUpdateStore } from '@/stores/update';
import { UpdateToast } from './UpdateToast';

const AVAILABLE_TOAST_ID = 'openx-update-available';
const DOWNLOADED_TOAST_ID = 'openx-update-downloaded';
const STARTUP_CHECK_DELAY_MS = 8_000;
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

/**
 * Shows global update prompts outside the Settings page.
 *
 * The update store owns IPC communication; this component only reacts to
 * store state changes and presents user-facing actions via a custom
 * Sonner toast (`UpdateToast`) that follows the active OpenX theme.
 */
export function UpdateNotifier() {
  const { t } = useTranslation('settings');
  const status = useUpdateStore((state) => state.status);
  const updateInfo = useUpdateStore((state) => state.updateInfo);
  const init = useUpdateStore((state) => state.init);
  const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
  const downloadUpdate = useUpdateStore((state) => state.downloadUpdate);
  const installUpdate = useUpdateStore((state) => state.installUpdate);
  const lastAvailableVersionRef = useRef<string | null>(null);
  const lastDownloadedVersionRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let intervalId: number | undefined;

    const checkInBackground = () => {
      if (!disposed && navigator.onLine) void checkForUpdates({ silent: true });
    };

    const startupId = window.setTimeout(() => {
      checkInBackground();
      intervalId = window.setInterval(checkInBackground, UPDATE_CHECK_INTERVAL_MS);
    }, STARTUP_CHECK_DELAY_MS);

    const handleOnline = () => checkInBackground();
    window.addEventListener('online', handleOnline);
    void init();

    return () => {
      disposed = true;
      window.clearTimeout(startupId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
    };
  }, [checkForUpdates, init]);

  useEffect(() => {
    const version = updateInfo?.version || t('updates.toast.unknownVersion');
    const dismissLabel = t('updates.action.later');

    if (status !== 'available') {
      toast.dismiss(AVAILABLE_TOAST_ID);
      lastAvailableVersionRef.current = null;
    }

    if (status !== 'downloaded') {
      toast.dismiss(DOWNLOADED_TOAST_ID);
      lastDownloadedVersionRef.current = null;
    }

    if (status === 'available') {
      if (lastAvailableVersionRef.current === version) return;
      lastAvailableVersionRef.current = version;

      toast.custom(
        (toastId) => (
          <UpdateToast
            variant="available"
            title={t('updates.toast.availableTitle')}
            description={t('updates.toast.availableDescription', { version })}
            primaryActionLabel={t('updates.action.download')}
            dismissLabel={dismissLabel}
            onPrimaryAction={() => {
              toast.dismiss(toastId);
              lastAvailableVersionRef.current = null;
              void downloadUpdate();
            }}
            onDismiss={() => {
              toast.dismiss(toastId);
            }}
          />
        ),
        {
          id: AVAILABLE_TOAST_ID,
          duration: Infinity,
          position: 'bottom-left',
        },
      );
      return;
    }

    if (status === 'downloaded') {
      if (lastDownloadedVersionRef.current === version) return;
      lastDownloadedVersionRef.current = version;

      toast.custom(
        (toastId) => (
          <UpdateToast
            variant="downloaded"
            title={t('updates.toast.downloadedTitle')}
            description={t('updates.toast.downloadedDescription', { version })}
            primaryActionLabel={t('updates.action.install')}
            dismissLabel={dismissLabel}
            onPrimaryAction={() => {
              toast.dismiss(toastId);
              lastDownloadedVersionRef.current = null;
              installUpdate();
            }}
            onDismiss={() => {
              toast.dismiss(toastId);
            }}
          />
        ),
        {
          id: DOWNLOADED_TOAST_ID,
          duration: Infinity,
          position: 'bottom-left',
        },
      );
    }
  }, [downloadUpdate, installUpdate, status, t, updateInfo?.version]);

  return null;
}

export default UpdateNotifier;
