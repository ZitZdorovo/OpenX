/**
 * Chat Input Component
 * Textarea with send button and universal file upload support.
 * Enter to send, Shift+Enter for new line.
 * Supports: native file picker, clipboard paste, drag & drop.
 * Files are staged through the typed Host API and included as local media
 * references in the ACP session/prompt request.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { SendHorizontal, Square, X, Paperclip, FileText, Film, Music, FileArchive, File, FolderOpen, Loader2, AtSign, Search, ChevronDown, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineNameEditor } from '@/components/ui/InlineNameEditor';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { useGatewayStore } from '@/stores/gateway';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useArtifactPanel } from '@/stores/artifact-panel';
import { buildPreviewTarget } from '@/components/file-preview/build-preview-target';
import { useProviderStore } from '@/stores/providers';
import { buildConfiguredModelOptions, buildGatewayModelOptions, isConfiguredModelRefAvailable, resolveConfiguredModelRef } from '@/lib/model-options';
import {
  availableThinkingLevels,
  groupConfiguredModels,
  normalizeThinkingLevel,
  parseModelVariant,
  resolveGroupVariant,
  resolveModelDisplayName,
  thinkingLevelLabel,
  type ConfiguredModelGroup,
  type ThinkingLevel,
} from '@/lib/model-display';
import { mostUsedModelSelection, useModelPreferencesStore, type ModelSelection } from '@/stores/model-preferences';
import { useModelCatalogStore } from '@/stores/model-catalog';
import type { AgentSummary } from '@/types/agent';
import type { QuickAccessSkill } from '@/types/skill';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { rendererExtensionRegistry } from '@/extensions/registry';
import { collectDroppedFiles } from '@/lib/collect-dropped-files';
import { fetchQuickAccessSkills } from '@/lib/quick-access-skills';
import { DEFAULT_WORKSPACE_CWD, isDefaultWorkspacePath, normalizeWorkspacePath } from '@/lib/workspace-context';
import { RequestStats } from './RequestStats';

// ── Types ────────────────────────────────────────────────────────

export interface FileAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  stagedPath: string;        // Host-staged path included in ACP prompt media
  preview: string | null;    // data URL for images, null for others
  status: 'staging' | 'ready' | 'error';
  error?: string;
}

export interface ChatWorkspaceOption {
  path: string;
  label: string;
}

interface ChatInputProps {
  onSend: (text: string, attachments?: FileAttachment[], targetAgentId?: string | null) => void;
  onStop?: () => void;
  disabled?: boolean;
  sending?: boolean;
  imageGenerating?: boolean;
  workspaceLabel?: string;
  workspacePath?: string;
  workspaceOptions?: ChatWorkspaceOption[];
  workspaceReadOnly?: boolean;
  onSelectWorkspace?: (path: string) => void;
  usage?: unknown;
}

// ── Helpers ──────────────────────────────────────────────────────

const DIRECTORY_MIME_TYPE = 'application/x-directory';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getSkillPrefix(skillName: string): string {
  return `/${skillName}  `;
}

function needsLeadingSkillSpace(value: string, position: number): boolean {
  return position > 0 && !/\s/.test(value[position - 1] ?? '');
}

type SkillTokenRange = { start: number; end: number };

function findSkillTokenRange(value: string, skillName: string): SkillTokenRange | null {
  const token = getSkillPrefix(skillName);
  const start = value.indexOf(token);
  if (start === -1) return null;
  return { start, end: start + token.length };
}

function findSkillTokenRanges(value: string): SkillTokenRange[] {
  const ranges: SkillTokenRange[] = [];
  const skillTokenPattern = /\/[^\s]+ {2}/g;
  let match: RegExpExecArray | null;
  while ((match = skillTokenPattern.exec(value)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function removeSkillToken(value: string, skillName: string): string {
  const range = findSkillTokenRange(value, skillName);
  if (!range) return value;
  return `${value.slice(0, range.start)}${value.slice(range.end)}`;
}

const SKILL_TOKEN_CLASS =
  'openx-skill-token-overlay pointer-events-auto cursor-pointer rounded-md text-skill-fg underline-offset-2 hover:underline [-webkit-box-decoration-break:clone] [box-decoration-break:clone] [text-shadow:0_0_10px_rgba(47,107,255,0.38)] dark:text-skill-fg-dark dark:[text-shadow:0_0_12px_rgba(37,99,235,0.42)]';

function renderHighlightedComposerText(
  value: string,
  tokenRanges: SkillTokenRange[],
  options: { onPreviewSkill: (skillName: string) => void; previewTooltip: string },
) {
  if (tokenRanges.length === 0) {
    return <>{value}{value.endsWith('\n') ? '\n' : '\u200b'}</>;
  }

  const chunks: React.ReactNode[] = [];
  let cursor = 0;

  for (const tokenRange of tokenRanges) {
    const token = value.slice(tokenRange.start, tokenRange.end);
    const tokenLabel = token.trimEnd();
    const tokenTrailingSpace = token.slice(tokenLabel.length);
    const skillName = tokenLabel.startsWith('/') ? tokenLabel.slice(1) : tokenLabel;

    if (tokenRange.start > cursor) {
      chunks.push(value.slice(cursor, tokenRange.start));
    }
    chunks.push(
      <span
        key={`skill-token-${tokenRange.start}`}
        data-testid="chat-composer-skill-token"
        data-skill-name={skillName}
        title={options.previewTooltip}
        className={SKILL_TOKEN_CLASS}
        onMouseDown={(event) => {
          // Keep focus in the textarea while still receiving the click.
          event.preventDefault();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          options.onPreviewSkill(skillName);
        }}
      >
        {tokenLabel}
      </span>,
      tokenTrailingSpace,
    );
    cursor = tokenRange.end;
  }

  if (cursor < value.length) {
    chunks.push(value.slice(cursor));
  }
  chunks.push(value.endsWith('\n') ? '\n' : '\u200b');

  return <>{chunks}</>;
}

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType === DIRECTORY_MIME_TYPE) return <FolderOpen className={className} />;
  if (mimeType.startsWith('video/')) return <Film className={className} />;
  if (mimeType.startsWith('audio/')) return <Music className={className} />;
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/xml') return <FileText className={className} />;
  if (mimeType.includes('zip') || mimeType.includes('compressed') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar') || mimeType.includes('7z')) return <FileArchive className={className} />;
  if (mimeType === 'application/pdf') return <FileText className={className} />;
  return <File className={className} />;
}

/**
 * Read a browser File object as base64 string (without the data URL prefix).
 */
function readFileAsBase64(file: globalThis.File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!dataUrl || !dataUrl.includes(',')) {
        reject(new Error(`Invalid data URL from FileReader for ${file.name}`));
        return;
      }
      const base64 = dataUrl.split(',')[1];
      if (!base64) {
        reject(new Error(`Empty base64 data for ${file.name}`));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// ── Component ────────────────────────────────────────────────────

export function ChatInput({
  onSend,
  onStop,
  disabled = false,
  sending = false,
  imageGenerating = false,
  workspaceLabel,
  workspacePath,
  workspaceOptions = [],
  workspaceReadOnly = false,
  onSelectWorkspace,
  usage,
}: ChatInputProps) {
  const { t } = useTranslation('chat');
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [targetAgentId, setTargetAgentId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [thinkingPickerOpen, setThinkingPickerOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [quickSkills, setQuickSkills] = useState<QuickAccessSkill[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<QuickAccessSkill | null>(null);
  const [switchingModelRef, setSwitchingModelRef] = useState<string | null>(null);
  const [optimisticModelRef, setOptimisticModelRef] = useState<string | null>(null);
  const [providerSnapshotReady, setProviderSnapshotReady] = useState(false);
  const [editingModelKey, setEditingModelKey] = useState<string | null>(null);
  const [editingModelName, setEditingModelName] = useState('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const thinkingPickerRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const restoredSessionRef = useRef<string | null>(null);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const agents = useAgentsStore((s) => s.agents);
  const updateAgentModel = useAgentsStore((s) => s.updateAgentModel);
  const defaultModelRef = useAgentsStore((s) => s.defaultModelRef);
  const providerAccounts = useProviderStore((s) => s.accounts);
  const providerStatuses = useProviderStore((s) => s.statuses);
  const providerDefaultAccountId = useProviderStore((s) => s.defaultAccountId);
  const providerVendors = useProviderStore((s) => s.vendors);
  const providerError = useProviderStore((s) => s.error);
  const refreshProviderSnapshot = useProviderStore((s) => s.refreshProviderSnapshot);
  const modelAliases = useModelPreferencesStore((s) => s.aliases);
  const savedThinkingLevels = useModelPreferencesStore((s) => s.thinkingLevels);
  const modelPresets = useModelPreferencesStore((s) => s.presets);
  const sessionModelSelections = useModelPreferencesStore((s) => s.sessionSelections);
  const applyStoredModelSelection = useModelPreferencesStore((s) => s.applySelection);
  const createModelPreset = useModelPreferencesStore((s) => s.createPreset);
  const renameModelPreset = useModelPreferencesStore((s) => s.renamePreset);
  const deleteModelPreset = useModelPreferencesStore((s) => s.deletePreset);
  const setModelAlias = useModelPreferencesStore((s) => s.setAlias);
  const resetModelAlias = useModelPreferencesStore((s) => s.resetAlias);
  const gatewayModels = useModelCatalogStore((s) => s.models);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const currentSession = useChatStore((s) => (
    s.sessions.find((session) => session.key === s.currentSessionKey) ?? null
  ));
  const currentAgent = useMemo(
    () => (agents ?? []).find((agent) => agent.id === currentAgentId) ?? null,
    [agents, currentAgentId],
  );
  const currentAgentName = useMemo(
    () => currentAgent?.name ?? currentAgentId,
    [currentAgent, currentAgentId],
  );
  const modelOptions = useMemo(() => {
    const remoteOptions = buildGatewayModelOptions(gatewayModels);
    if (remoteOptions.length > 0) return remoteOptions;
    return buildConfiguredModelOptions(
      providerAccounts,
      providerStatuses,
      providerVendors,
      providerDefaultAccountId,
    );
  }, [gatewayModels, providerAccounts, providerDefaultAccountId, providerStatuses, providerVendors]);
  const modelGroups = useMemo(() => groupConfiguredModels(modelOptions), [modelOptions]);
  const configuredModelRef = useMemo(
    () => resolveConfiguredModelRef(currentAgent?.modelRef, defaultModelRef, modelOptions),
    [currentAgent?.modelRef, defaultModelRef, modelOptions],
  );
  const effectiveModelRef = optimisticModelRef || configuredModelRef;
  const effectiveModelVariant = useMemo(() => parseModelVariant(effectiveModelRef), [effectiveModelRef]);
  const currentModelGroup = useMemo(
    () => modelGroups.find((group) => group.baseKey === effectiveModelVariant.baseKey) ?? null,
    [effectiveModelVariant.baseKey, modelGroups],
  );
  const currentModelLabel = useMemo(() => {
    return resolveModelDisplayName(
      effectiveModelRef,
      modelAliases[effectiveModelVariant.baseKey],
      modelOptions.find((option) => option.modelRef === effectiveModelRef)?.label,
    );
  }, [effectiveModelRef, effectiveModelVariant.baseKey, modelAliases, modelOptions]);
  const mentionableAgents = useMemo(
    () => (agents ?? []).filter((agent) => agent.id !== currentAgentId),
    [agents, currentAgentId],
  );
  const selectedTarget = useMemo(
    () => (agents ?? []).find((agent) => agent.id === targetAgentId) ?? null,
    [agents, targetAgentId],
  );
  const filteredQuickSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    if (!query) return quickSkills;
    return quickSkills.filter((skill) =>
      skill.name.toLowerCase().includes(query)
      || skill.description.toLowerCase().includes(query)
      || skill.sourceLabel.toLowerCase().includes(query),
    );
  }, [quickSkills, skillQuery]);
  const showAgentPicker = mentionableAgents.length > 0;
  // Keep the picker available even with a single model: aliases and presets live
  // in the same menu and must not disappear for a one-model Gateway.
  const showModelPicker = modelGroups.length > 0;
  const encodedThinkingLevels = useMemo(
    () => availableThinkingLevels(currentModelGroup),
    [currentModelGroup],
  );
  const usesEncodedThinkingVariants = encodedThinkingLevels.length > 1;
  const gatewayThinkingLevels = useMemo(() => (
    (currentSession?.thinkingLevels ?? [])
      .map((option) => normalizeThinkingLevel(option.id))
      .filter((level): level is ThinkingLevel => level !== null)
  ), [currentSession?.thinkingLevels]);
  const gatewayThinkingLabels = useMemo(() => new Map(
    (currentSession?.thinkingLevels ?? []).flatMap((option) => {
      const level = normalizeThinkingLevel(option.id);
      return level ? [[level, option.label] as const] : [];
    }),
  ), [currentSession?.thinkingLevels]);
  const thinkingLevels = usesEncodedThinkingVariants ? encodedThinkingLevels : gatewayThinkingLevels;
  // No advertised profile and no set of model-id variants means Thinking is
  // unsupported. Do not render a control that can produce an invalid patch.
  const showThinkingPicker = thinkingLevels.length > 1;
  const currentThinkingLevel = usesEncodedThinkingVariants
    ? effectiveModelVariant.level
    : normalizeThinkingLevel(currentSession?.thinkingLevel)
      ?? normalizeThinkingLevel(currentSession?.thinkingDefault)
      ?? 'off';
  const displayThinkingLevel = (level: ThinkingLevel): string => (
    usesEncodedThinkingVariants
      ? thinkingLevelLabel(level)
      : gatewayThinkingLabels.get(level) ?? thinkingLevelLabel(level)
  );
  const chatComposerStatusComponents = rendererExtensionRegistry.getChatComposerStatusComponents();
  const inputDisabled = disabled;
  const workspaceSelectorDisabled = workspaceReadOnly || inputDisabled || sending || !onSelectWorkspace;
  const skillTokenRanges = useMemo(() => findSkillTokenRanges(input), [input]);
  const openArtifactPreview = useArtifactPanel((s) => s.openPreview);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await refreshProviderSnapshot();
      } finally {
        if (!cancelled) setProviderSnapshotReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshProviderSnapshot]);

  useEffect(() => {
    if (gatewayStatus.state === 'running') return;
    let cancelled = false;
    hostApi.gateway.status()
      .then((status) => {
        if (cancelled) return;
        if (status.state === 'running') {
          void refreshProviderSnapshot();
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gatewayStatus.state, refreshProviderSnapshot]);

  useEffect(() => {
    setOptimisticModelRef(null);
  }, [currentAgent?.modelRef, currentAgentId]);

  useEffect(() => {
    if (workspaceSelectorDisabled) {
      setWorkspaceMenuOpen(false);
    }
  }, [workspaceSelectorDisabled]);

  useEffect(() => {
    if (!providerSnapshotReady || providerError || !currentAgent || switchingModelRef || optimisticModelRef) return;
    const override = (currentAgent.overrideModelRef || '').trim();
    if (!override || isConfiguredModelRefAvailable(override, modelOptions)) return;
    void updateAgentModel(currentAgent.id, null).catch(() => {});
  }, [currentAgent, modelOptions, optimisticModelRef, providerError, providerSnapshotReady, switchingModelRef, updateAgentModel]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 240)}px`;
    }
  }, [input]);

  // Focus textarea on mount (avoids Windows focus loss after session delete + native dialog)
  useEffect(() => {
    if (!inputDisabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [inputDisabled]);

  useEffect(() => {
    if (!targetAgentId) return;
    if (targetAgentId === currentAgentId) {
      setTargetAgentId(null);
      setPickerOpen(false);
      return;
    }
    if (!(agents ?? []).some((agent) => agent.id === targetAgentId)) {
      setTargetAgentId(null);
      setPickerOpen(false);
    }
  }, [agents, currentAgentId, targetAgentId]);

  useEffect(() => {
    if (!pickerOpen && !skillPickerOpen && !modelPickerOpen && !thinkingPickerOpen && !workspaceMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideAgentPicker = pickerRef.current?.contains(target);
      const insideSkillPicker = skillPickerRef.current?.contains(target);
      const insideModelPicker = modelPickerRef.current?.contains(target);
      const insideThinkingPicker = thinkingPickerRef.current?.contains(target);
      const insideWorkspaceMenu = workspaceMenuRef.current?.contains(target);
      if (!insideAgentPicker && !insideSkillPicker && !insideModelPicker && !insideThinkingPicker && !insideWorkspaceMenu) {
        setPickerOpen(false);
        setSkillPickerOpen(false);
        setModelPickerOpen(false);
        setThinkingPickerOpen(false);
        setWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [modelPickerOpen, pickerOpen, skillPickerOpen, thinkingPickerOpen, workspaceMenuOpen]);

  useEffect(() => {
    if (!pickerOpen && !skillPickerOpen && !modelPickerOpen && !thinkingPickerOpen && !workspaceMenuOpen) return;
    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPickerOpen(false);
      setSkillPickerOpen(false);
      setModelPickerOpen(false);
      setThinkingPickerOpen(false);
      setWorkspaceMenuOpen(false);
    };
    document.addEventListener('keydown', handleDocumentKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown, true);
    };
  }, [modelPickerOpen, pickerOpen, skillPickerOpen, thinkingPickerOpen, workspaceMenuOpen]);

  useEffect(() => {
    setSelectedSkill((prev) => {
      if (prev) {
        setInput((currentInput) => removeSkillToken(currentInput, prev.name));
      }
      return null;
    });
    setSkillPickerOpen(false);
    setWorkspaceMenuOpen(false);
    setSkillQuery('');
    setQuickSkills([]);
    setSkillsError(null);
  }, [currentAgentId]);

  useEffect(() => {
    if (!selectedSkill) return;
    const tokenRange = findSkillTokenRange(input, selectedSkill.name);
    if (!tokenRange) {
      setSelectedSkill(null);
    }
  }, [input, selectedSkill]);

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
  }, []);

  const moveCaretTo = useCallback((position: number) => {
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(position, position);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
    });
  }, []);

  const normalizeSelectionAroundSkill = useCallback(() => {
    if (skillTokenRanges.length === 0) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? 0;
    if (selectionStart !== selectionEnd) return;
    const tokenRange = skillTokenRanges.find((range) => selectionStart > range.start && selectionStart < range.end);
    if (tokenRange) {
      moveCaretTo(tokenRange.end);
    }
  }, [moveCaretTo, skillTokenRanges]);

  const loadQuickSkills = useCallback(async (): Promise<QuickAccessSkill[]> => {
    if (!currentAgent) {
      setQuickSkills([]);
      setSkillsError(null);
      return [];
    }
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const result = await fetchQuickAccessSkills({
        workspace: currentAgent.workspace,
        agentDir: currentAgent.agentDir,
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to load skills');
      }
      const list = result.skills || [];
      setQuickSkills(list);
      return list;
    } catch (error) {
      setQuickSkills([]);
      setSkillsError(String(error));
      return [];
    } finally {
      setSkillsLoading(false);
    }
  }, [currentAgent]);

  const handleSkillTokenPreview = useCallback(async (skillName: string) => {
    let list = quickSkills;
    if (list.length === 0 && currentAgent) {
      list = await loadQuickSkills();
    }
    const skill = list.find((entry) => entry.name === skillName);
    if (!skill) {
      toast.error(
        t('composer.skillPreviewNotFound', 'Could not find this skill. Open the skill picker to refresh the list.'),
      );
      return;
    }
    openArtifactPreview(buildPreviewTarget(skill.manifestPath));
  }, [quickSkills, currentAgent, loadQuickSkills, openArtifactPreview, t]);

  useEffect(() => {
    if (!skillPickerOpen) return;
    void loadQuickSkills();
  }, [skillPickerOpen, loadQuickSkills]);

  const applyModelSelection = useCallback(async (
    selection: ModelSelection,
    intentional: boolean,
    applyThinkingOverride = false,
  ) => {
    if (!currentAgent || switchingModelRef) return;
    const modelRef = selection.modelRef;
    const previousModelRef = effectiveModelRef;
    setSwitchingModelRef(modelRef);
    setOptimisticModelRef(modelRef);
    setModelPickerOpen(false);
    setThinkingPickerOpen(false);
    try {
      if (currentSessionKey) {
        const targetGroup = modelGroups.find(
          (group) => group.baseKey === parseModelVariant(modelRef).baseKey,
        ) ?? null;
        const encodedModelVariants = availableThinkingLevels(targetGroup).length > 1;
        // A previous per-session thinking override may be invalid for the newly
        // selected model. Clear it in the same model patch, then use the exact
        // profile returned by Gateway to decide whether a second patch is valid.
        const patched = await useGatewayStore.getState().rpc<{
          resolved?: {
            thinkingLevel?: string;
            thinkingLevels?: Array<{ id: string; label: string }>;
          };
        }>('sessions.patch', {
          key: currentSessionKey,
          model: modelRef,
          thinkingLevel: null,
        });
        let appliedThinkingLevel = encodedModelVariants
          ? parseModelVariant(modelRef).level
          : normalizeThinkingLevel(patched.resolved?.thinkingLevel) ?? 'off';
        const supportedLevels = new Set(
          (patched.resolved?.thinkingLevels ?? [])
            .map((option) => normalizeThinkingLevel(option.id))
            .filter((level): level is ThinkingLevel => level !== null),
        );
        if (
          applyThinkingOverride
          && !encodedModelVariants
          && supportedLevels.has(selection.thinkingLevel)
        ) {
          try {
            const thinkingPatch = await useGatewayStore.getState().rpc<{
              resolved?: { thinkingLevel?: string };
            }>('sessions.patch', {
              key: currentSessionKey,
              thinkingLevel: selection.thinkingLevel,
            });
            appliedThinkingLevel = normalizeThinkingLevel(thinkingPatch.resolved?.thinkingLevel)
              ?? selection.thinkingLevel;
          } catch (error) {
            // The model switch itself succeeded. A concurrently changed remote
            // profile must degrade to the Gateway default, not surface a broken
            // selector or roll the model back.
            console.warn('Gateway rejected a stale Thinking profile selection:', error);
          }
        }
        applyStoredModelSelection({
          sessionKey: currentSessionKey,
          selection: { modelRef, thinkingLevel: appliedThinkingLevel },
          intentional,
        });
        await useChatStore.getState().loadSessions({ force: true });
      } else {
        // Compatibility path for the short interval before a new chat has a
        // Gateway session key. Existing agent-default behaviour remains intact.
        const desiredOverride = modelRef === (defaultModelRef || '').trim() ? null : modelRef;
        await updateAgentModel(currentAgent.id, desiredOverride);
        applyStoredModelSelection({ sessionKey: currentSessionKey, selection, intentional });
      }
    } catch (error) {
      setOptimisticModelRef(previousModelRef);
      toast.error(t('composer.modelSwitchFailed', { error: String(error) }));
    } finally {
      setSwitchingModelRef(null);
      textareaRef.current?.focus();
    }
  }, [applyStoredModelSelection, currentAgent, currentSessionKey, defaultModelRef, effectiveModelRef, modelGroups, switchingModelRef, t, updateAgentModel]);

  const handleSelectModelGroup = useCallback((group: ConfiguredModelGroup) => {
    const activeLevel = group.baseKey === effectiveModelVariant.baseKey
      ? currentThinkingLevel
      : savedThinkingLevels[group.baseKey];
    const option = resolveGroupVariant(group, activeLevel);
    const variant = parseModelVariant(option.modelRef);
    void applyModelSelection({ modelRef: option.modelRef, thinkingLevel: variant.level }, true, false);
  }, [applyModelSelection, currentThinkingLevel, effectiveModelVariant.baseKey, savedThinkingLevels]);

  const handleSelectThinkingLevel = useCallback((level: ThinkingLevel) => {
    if (!currentModelGroup) return;
    setThinkingPickerOpen(false);
    const option = resolveGroupVariant(currentModelGroup, level);
    void applyModelSelection({ modelRef: option.modelRef, thinkingLevel: level }, true, true);
  }, [applyModelSelection, currentModelGroup]);

  const handleSelectPreset = useCallback((preset: ModelSelection) => {
    if (!isConfiguredModelRefAvailable(preset.modelRef, modelOptions)) return;
    void applyModelSelection(preset, true, true);
  }, [applyModelSelection, modelOptions]);

  const handleCreatePreset = useCallback(() => {
    if (!effectiveModelRef) return;
    const name = window.prompt(t('composer.presetNamePrompt'), currentModelLabel);
    if (!name?.trim()) return;
    createModelPreset(name, { modelRef: effectiveModelRef, thinkingLevel: currentThinkingLevel });
  }, [createModelPreset, currentModelLabel, currentThinkingLevel, effectiveModelRef, t]);

  const startEditingModelName = useCallback((group: ConfiguredModelGroup) => {
    setEditingModelKey(group.baseKey);
    setEditingModelName(resolveModelDisplayName(
      group.original.modelRef,
      modelAliases[group.baseKey],
      group.original.label,
    ));
  }, [modelAliases]);

  const finishEditingModelName = useCallback((name: string) => {
    if (editingModelKey) setModelAlias(editingModelKey, name);
    setEditingModelKey(null);
    setEditingModelName('');
  }, [editingModelKey, setModelAlias]);

  useEffect(() => {
    if (!currentSessionKey || modelOptions.length === 0 || restoredSessionRef.current === currentSessionKey) return;
    const saved = sessionModelSelections[currentSessionKey];
    const mostUsed = mostUsedModelSelection(useModelPreferencesStore.getState());
    const selection = saved && isConfiguredModelRefAvailable(saved.modelRef, modelOptions)
      ? saved
      : mostUsed && isConfiguredModelRefAvailable(mostUsed.modelRef, modelOptions)
        ? mostUsed
        : null;
    restoredSessionRef.current = currentSessionKey;
    if (selection) void applyModelSelection(selection, false, true);
  }, [applyModelSelection, currentSessionKey, modelOptions, sessionModelSelections]);

  const handleWorkspaceButtonClick = useCallback(() => {
    if (workspaceSelectorDisabled) return;
    setPickerOpen(false);
    setSkillPickerOpen(false);
    setModelPickerOpen(false);
    setThinkingPickerOpen(false);
    setWorkspaceMenuOpen((open) => !open);
  }, [workspaceSelectorDisabled]);

  const handleWorkspaceKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    setWorkspaceMenuOpen(false);
    event.stopPropagation();
  }, []);

  const handleSelectWorkspace = useCallback((path: string) => {
    if (workspaceSelectorDisabled || !onSelectWorkspace) return;
    onSelectWorkspace(path);
    setWorkspaceMenuOpen(false);
    textareaRef.current?.focus();
  }, [onSelectWorkspace, workspaceSelectorDisabled]);

  const handleSelectDefaultWorkspace = useCallback(() => {
    handleSelectWorkspace(DEFAULT_WORKSPACE_CWD);
  }, [handleSelectWorkspace]);

  const handleChooseOtherWorkspace = useCallback(async () => {
    if (workspaceSelectorDisabled || !onSelectWorkspace) return;
    setWorkspaceMenuOpen(false);
    try {
      const result = await hostApi.dialog.open({
        title: t('composer.workspacePickerTitle'),
        buttonLabel: t('composer.workspacePickerButton'),
        defaultPath: workspacePath,
        properties: ['openDirectory', 'createDirectory'],
      });
      const selected = result.filePaths[0]?.trim();
      if (!result.canceled && selected) onSelectWorkspace(selected);
    } catch {
      toast.error(t('composer.workspacePickerFailed'));
    } finally {
      textareaRef.current?.focus();
    }
  }, [onSelectWorkspace, t, workspacePath, workspaceSelectorDisabled]);

  // ── File staging via native dialog / Electron drag-drop paths ──

  const stagePathFiles = useCallback(async (filePaths: string[]) => {
    if (filePaths.length === 0) return;

    const tempIds: string[] = [];
    for (const filePath of filePaths) {
      const tempId = crypto.randomUUID();
      tempIds.push(tempId);
      const fileName = filePath.split(/[\\/]/).pop() || 'file';
      setAttachments(prev => [...prev, {
        id: tempId,
        fileName,
        mimeType: '',
        fileSize: 0,
        stagedPath: '',
        preview: null,
        status: 'staging' as const,
      }]);
    }

    try {
      const staged = await hostApi.files.stagePaths({ filePaths });

      setAttachments(prev => {
        let updated = [...prev];
        for (let i = 0; i < tempIds.length; i++) {
          const tempId = tempIds[i];
          const data = staged[i];
          if (data) {
            updated = updated.map(a =>
              a.id === tempId
                ? { ...data, status: 'ready' as const }
                : a,
            );
          } else {
            console.warn(`[stagePathFiles] No staged data for tempId=${tempId} at index ${i}`);
            updated = updated.map(a =>
              a.id === tempId
                ? { ...a, status: 'error' as const, error: 'Staging failed' }
                : a,
            );
          }
        }
        return updated;
      });
    } catch (err) {
      console.error('[stagePathFiles] Failed to stage files:', err);
      setAttachments(prev => prev.map(a =>
        a.status === 'staging'
          ? { ...a, status: 'error' as const, error: String(err) }
          : a,
      ));
    }
  }, []);

  const pickFiles = useCallback(async () => {
    try {
      const result = await hostApi.dialog.open({
        properties: ['openFile', 'multiSelections'],
      });
      if (result.canceled || !result.filePaths?.length) return;
      await stagePathFiles(result.filePaths);
    } catch (err) {
      console.error('[pickFiles] Failed to open file dialog:', err);
    }
  }, [stagePathFiles]);

  // ── Stage browser File objects (paste / drag-drop) ─────────────

  const stageBufferFiles = useCallback(async (files: globalThis.File[]) => {
    for (const file of files) {
      const tempId = crypto.randomUUID();
      setAttachments(prev => [...prev, {
        id: tempId,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        stagedPath: '',
        preview: null,
        status: 'staging' as const,
      }]);

      try {
        const base64 = await readFileAsBase64(file);
        const staged = await hostApi.files.stageBuffer({
          base64,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
        });
        setAttachments(prev => prev.map(a =>
          a.id === tempId ? { ...staged, status: 'ready' as const } : a,
        ));
      } catch (err) {
        console.error(`[stageBuffer] Error staging ${file.name}:`, err);
        setAttachments(prev => prev.map(a =>
          a.id === tempId
            ? { ...a, status: 'error' as const, error: String(err) }
            : a,
        ));
      }
    }
  }, []);

  // ── Attachment management ──────────────────────────────────────

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const allReady = attachments.length === 0 || attachments.every(a => a.status === 'ready');
  const hasFailedAttachments = attachments.some((a) => a.status === 'error');
  const canSend = (input.trim() || attachments.length > 0)
    && allReady
    && !inputDisabled
    && !sending
    && !imageGenerating;
  const canStop = sending && !inputDisabled && !!onStop;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    const readyAttachments = attachments.filter(a => a.status === 'ready');
    const textToSend = input.trim();
    const attachmentsToSend = readyAttachments.length > 0 ? readyAttachments : undefined;

    if (rendererExtensionRegistry.hasChatBeforeSendHooks()) {
      const guard = await rendererExtensionRegistry.runChatBeforeSend({
        text: textToSend,
        attachments: attachmentsToSend,
        targetAgentId,
      });
      if (!guard.ok) {
        if (guard.message) {
          toast.error(guard.message);
        }
        return;
      }
    }

    // Capture values before clearing — clear input immediately for snappy UX,
    // but keep attachments available for the async send
    setInput('');
    setAttachments([]);
    setSelectedSkill(null);
    setSkillQuery('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSend(textToSend, attachmentsToSend, targetAgentId);
    setTargetAgentId(null);
    setPickerOpen(false);
    setSkillPickerOpen(false);
    setWorkspaceMenuOpen(false);
  }, [input, attachments, canSend, onSend, targetAgentId]);

  const handleStop = useCallback(() => {
    if (!canStop) return;
    onStop?.();
  }, [canStop, onStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Backspace') {
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find((range) =>
          selectionStart === selectionEnd
          && selectionStart > range.start
          && selectionStart <= range.end,
        );

        if (
          tokenRange
        ) {
          e.preventDefault();
          const valueWithoutToken = `${input.slice(0, tokenRange.start)}${input.slice(tokenRange.end)}`;
          setInput(valueWithoutToken);
          setSelectedSkill(null);
          moveCaretTo(tokenRange.start);
          return;
        }

        if (!input) {
          if (selectedSkill) {
            setSelectedSkill(null);
            return;
          }
          setTargetAgentId(null);
          return;
        }
      }
      if (e.key === 'ArrowLeft' && skillTokenRanges.length > 0) {
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find((range) => selectionStart === selectionEnd && selectionStart === range.end);
        if (tokenRange) {
          e.preventDefault();
          moveCaretTo(tokenRange.start);
          return;
        }
      }
      if (e.key === 'ArrowRight' && skillTokenRanges.length > 0) {
        const textarea = textareaRef.current;
        const selectionStart = textarea?.selectionStart ?? 0;
        const selectionEnd = textarea?.selectionEnd ?? 0;
        const tokenRange = skillTokenRanges.find((range) => selectionStart === selectionEnd && selectionStart === range.start);
        if (tokenRange) {
          e.preventDefault();
          moveCaretTo(tokenRange.end);
          return;
        }
      }
      if (e.key === 'Escape') {
        setPickerOpen(false);
        setSkillPickerOpen(false);
        setModelPickerOpen(false);
        setWorkspaceMenuOpen(false);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const nativeEvent = e.nativeEvent as KeyboardEvent;
        if (isComposingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
          return;
        }
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, input, moveCaretTo, selectedSkill, skillTokenRanges],
  );

  // Handle paste (Ctrl/Cmd+V with files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: globalThis.File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) pastedFiles.push(file);
        }
      }
      if (pastedFiles.length > 0) {
        e.preventDefault();
        stageBufferFiles(pastedFiles);
      }
    },
    [stageBufferFiles],
  );

  // Handle drag & drop
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const hasFiles = (event: DragEvent) => {
      const transfer = event.dataTransfer;
      return Boolean(
        transfer
        && (transfer.files.length > 0 || Array.from(transfer.types ?? []).includes('Files')),
      );
    };
    const handleWindowDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragOver(true);
    };
    const handleWindowDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    };
    const handleWindowDragLeave = (event: DragEvent) => {
      if (!event.relatedTarget) setDragOver(false);
    };
    const handleWindowDrop = (event: DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      setDragOver(false);
      const { pathFiles, bufferFiles } = collectDroppedFiles(event.dataTransfer);
      if (pathFiles.length === 0 && bufferFiles.length === 0) {
        toast.error(t('composer.folderDropUnsupported'));
        return;
      }
      if (pathFiles.length > 0) void stagePathFiles(pathFiles);
      if (bufferFiles.length > 0) void stageBufferFiles(bufferFiles);
    };

    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);
    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [stageBufferFiles, stagePathFiles, t]);

  return (
    <div
      data-testid="chat-composer"
      className={cn(
        'mx-auto w-full max-w-3xl shrink-0 px-4 pb-[15px] pt-[15px]',
      )}
    >
      {dragOver && createPortal(
        <div
          data-testid="chat-drop-overlay"
          className="pointer-events-none fixed inset-3 z-[10000] grid place-items-center rounded-3xl border-2 border-dashed border-primary/55 bg-background/80 text-foreground shadow-2xl backdrop-blur-sm"
        >
          <div className="flex items-center gap-3 rounded-2xl bg-surface-modal px-5 py-4 text-sm font-medium shadow-lg">
            <Paperclip className="h-5 w-5 text-primary" aria-hidden="true" />
            {t('composer.dropOverlay')}
          </div>
        </div>,
        document.body,
      )}
      <div className="w-full">
        {sending && (
          <div
            data-testid="chat-composer-working-indicator"
            role="status"
            aria-live="polite"
            aria-label={t('composer.thinking')}
            className="mb-2 flex h-5 items-center gap-2 text-sm text-muted-foreground"
          >
            <span
              data-testid="chat-composer-dot-pulse"
              aria-hidden="true"
              className="openx-chat-thinking-dot-pulse"
            >
              <span className="openx-chat-thinking-dot-pulse-inner">
                <span className="openx-chat-thinking-dot-pulse-dot" />
              </span>
            </span>
            <span>{t('composer.thinking')}</span>
          </div>
        )}

        {!sending && imageGenerating && (
          <div
            data-testid="chat-composer-image-generation-indicator"
            role="status"
            aria-live="polite"
            aria-label={t('imageGeneration.generating')}
            className="mb-2 flex h-5 items-center gap-2 text-sm text-muted-foreground"
          >
            <span
              data-testid="chat-composer-image-generation-dot-pulse"
              aria-hidden="true"
              className="openx-chat-thinking-dot-pulse"
            >
              <span className="openx-chat-thinking-dot-pulse-inner">
                <span className="openx-chat-thinking-dot-pulse-dot" />
              </span>
            </span>
            <span>{t('imageGeneration.generating')}</span>
          </div>
        )}

        {/* Attachment Previews */}
        {attachments.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {attachments.map((att) => (
              <AttachmentPreview
                key={att.id}
                attachment={att}
                onRemove={() => removeAttachment(att.id)}
              />
            ))}
          </div>
        )}

        {/* Input Container */}
        <div
          data-testid="chat-composer-surface"
          className={`relative bg-surface-modal rounded-2xl shadow-sm border px-3 pt-2.5 pb-[10px] transition-all ${dragOver ? 'border-primary ring-1 ring-primary' : 'border-black/10 dark:border-white/10'}`}
        >
          {selectedTarget && (
            <div className="flex flex-wrap gap-2 pb-1.5">
              <button
                type="button"
                onClick={() => setTargetAgentId(null)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1 text-meta font-medium text-foreground transition-colors hover:bg-primary/10"
                title={t('composer.clearTarget')}
              >
                <span>{t('composer.targetChip', { agent: selectedTarget.name })}</span>
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          )}

          {/* Text Row — flush-left */}
          <div className="relative min-h-[48px]">
            {skillTokenRanges.length > 0 && (
              <div
                aria-hidden="true"
                data-testid="chat-composer-highlight"
                className="pointer-events-none absolute inset-0 z-20 overflow-hidden whitespace-pre-wrap break-words text-sm leading-relaxed text-transparent"
              >
                {renderHighlightedComposerText(input, skillTokenRanges, {
                  onPreviewSkill: (name) => {
                    void handleSkillTokenPreview(name);
                  },
                  previewTooltip: t('composer.skillPreviewTooltip', 'Preview SKILL.md'),
                })}
              </div>
            )}
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onSelect={normalizeSelectionAroundSkill}
              onClick={normalizeSelectionAroundSkill}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onPaste={handlePaste}
              placeholder={inputDisabled ? t('composer.gatewayDisconnectedPlaceholder') : ''}
              disabled={inputDisabled}
              data-testid="chat-composer-input"
              className={cn(
                'relative z-10 min-h-[48px] max-h-[240px] resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none bg-transparent p-0 text-sm leading-relaxed placeholder:text-muted-foreground/60',
                skillTokenRanges.length > 0 && 'selection:bg-primary/20',
              )}
              rows={1}
            />
          </div>

          {/* Action Row — icons on their own line */}
          <div className="mt-1.5 flex items-center gap-1" data-testid="chat-composer-actions">
            {/* Attach Button */}
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors"
              onClick={pickFiles}
              disabled={inputDisabled || sending}
              title={t('composer.attachFiles')}
            >
              <Paperclip className="h-3.5 w-3.5" />
            </Button>

            {showAgentPicker && (
              <div ref={pickerRef} className="relative shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="chat-composer-agent"
                  className={cn(
                    'h-8 w-8 rounded-lg text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10 hover:text-foreground transition-colors',
                    (pickerOpen || selectedTarget) && 'bg-primary/10 text-primary hover:bg-primary/20'
                  )}
                  onClick={() => {
                    setSkillPickerOpen(false);
                    setModelPickerOpen(false);
                    setThinkingPickerOpen(false);
                    setWorkspaceMenuOpen(false);
                    setPickerOpen((open) => !open);
                  }}
                  disabled={inputDisabled || sending}
                  title={t('composer.pickAgent')}
                >
                  <AtSign className="h-3.5 w-3.5" />
                </Button>
                {pickerOpen && (
                  <div className="absolute left-0 bottom-full z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10">
                    <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                      {t('composer.agentPickerTitle', { currentAgent: currentAgentName })}
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {mentionableAgents.map((agent) => (
                        <AgentPickerItem
                          key={agent.id}
                          agent={agent}
                          selected={agent.id === targetAgentId}
                          onSelect={() => {
                            setTargetAgentId(agent.id);
                            setPickerOpen(false);
                            textareaRef.current?.focus();
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div ref={skillPickerRef} className="relative shrink-0">
              <button
                type="button"
                data-testid="chat-composer-skill"
                className={cn(
                  'inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50',
                  (skillPickerOpen || selectedSkill) && 'text-foreground',
                )}
                onClick={() => {
                  setPickerOpen(false);
                  setModelPickerOpen(false);
                  setThinkingPickerOpen(false);
                  setWorkspaceMenuOpen(false);
                  setSkillPickerOpen((open) => !open);
                }}
                disabled={inputDisabled || sending}
                title={t('composer.pickSkill')}
              >
                <span>{t('composer.skillButton')}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', skillPickerOpen && 'rotate-180')} />
              </button>
              {skillPickerOpen && (
                <div className="absolute left-0 bottom-full z-20 mb-2 w-80 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10">
                  <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      value={skillQuery}
                      onChange={(event) => setSkillQuery(event.target.value)}
                      placeholder={t('composer.skillSearchPlaceholder')}
                      className="w-full bg-transparent text-meta outline-none placeholder:text-muted-foreground/70"
                      autoFocus
                    />
                  </div>
                  <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                    {t('composer.skillPickerTitle', { agent: currentAgentName })}
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {skillsLoading ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground">
                        {t('composer.skillLoading')}
                      </div>
                    ) : skillsError ? (
                      <div className="px-3 py-4 text-xs text-destructive">
                        {skillsError}
                      </div>
                    ) : filteredQuickSkills.length === 0 ? (
                      <div className="px-3 py-4 text-xs text-muted-foreground">
                        {t('composer.skillEmpty')}
                      </div>
                    ) : (
                      filteredQuickSkills.map((skill) => (
                        <SkillPickerItem
                          key={`${skill.source}:${skill.name}`}
                          skill={skill}
                          selected={false}
                          onSelect={() => {
                            const textarea = textareaRef.current;
                            const nextToken = getSkillPrefix(skill.name);
                            const selectionStart = textarea?.selectionStart ?? input.length;
                            const selectionEnd = textarea?.selectionEnd ?? input.length;
                            let nextValue = input;
                            let adjustedStart = selectionStart;
                            let adjustedEnd = selectionEnd;

                            const leadingSpace = needsLeadingSkillSpace(nextValue, adjustedStart) ? ' ' : '';
                            nextValue = `${nextValue.slice(0, adjustedStart)}${leadingSpace}${nextToken}${nextValue.slice(adjustedEnd)}`;
                            setSelectedSkill(null);
                            setInput(nextValue);
                            setSkillPickerOpen(false);
                            setSkillQuery('');
                            requestAnimationFrame(() => {
                              textareaRef.current?.focus();
                              const cursorPosition = adjustedStart + leadingSpace.length + nextToken.length;
                              textareaRef.current?.setSelectionRange(cursorPosition, cursorPosition);
                            });
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {showModelPicker && (
              <div ref={modelPickerRef} className="relative shrink-0">
                <button
                  type="button"
                  data-testid="chat-model-picker-button"
                  className={cn(
                    'inline-flex h-8 max-w-[220px] items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:opacity-50',
                    (modelPickerOpen || switchingModelRef) && 'text-foreground',
                  )}
                  onClick={() => {
                    setPickerOpen(false);
                    setSkillPickerOpen(false);
                    setThinkingPickerOpen(false);
                    setWorkspaceMenuOpen(false);
                    setModelPickerOpen((open) => !open);
                  }}
                  disabled={inputDisabled || sending || !currentAgent || !!switchingModelRef}
                  title={t('composer.pickModel')}
                >
                  {switchingModelRef ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : null}
                  <span className="truncate">{currentModelLabel}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', modelPickerOpen && 'rotate-180')} />
                </button>
                {modelPickerOpen && (
                  <div
                    className="absolute left-0 bottom-full z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10"
                    data-testid="chat-model-picker-menu"
                  >
                    <div className="flex items-center justify-between px-3 py-2 text-tiny font-medium text-muted-foreground/80">
                      <span>{t('composer.modelPickerTitle')}</span>
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
                        title={t('composer.savePreset')}
                        onClick={handleCreatePreset}
                      >
                        <Plus className="h-3 w-3" />
                        {t('composer.preset')}
                      </button>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {modelPresets.length > 0 && (
                        <div className="mb-1 border-b border-black/10 pb-1 dark:border-white/10" data-testid="chat-model-presets">
                          <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                            {t('composer.presets')}
                          </div>
                          {modelPresets.map((preset) => {
                            const available = isConfiguredModelRefAvailable(preset.modelRef, modelOptions);
                            const active = preset.modelRef === effectiveModelRef && preset.thinkingLevel === currentThinkingLevel;
                            return (
                              <div key={preset.id} className={cn('group/preset flex min-h-9 items-center rounded-xl', active && 'bg-primary/10')}>
                                {editingPresetId === preset.id ? (
                                  <InlineNameEditor
                                    value={preset.name}
                                    ariaLabel={t('composer.editPresetName')}
                                    saveLabel={t('composer.saveModelName')}
                                    cancelLabel={t('composer.cancelModelName')}
                                    onSave={(name) => { renameModelPreset(preset.id, name); setEditingPresetId(null); }}
                                    onCancel={() => setEditingPresetId(null)}
                                  />
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      disabled={!available}
                                      title={available ? preset.modelRef : t('composer.presetModelUnavailable', { model: preset.modelRef })}
                                      className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-45"
                                      onClick={() => handleSelectPreset(preset)}
                                    >
                                      <span className="min-w-0">
                                        <span className="block truncate text-sm font-medium">{preset.name}</span>
                                        <span className="block truncate text-[10px] text-muted-foreground">{thinkingLevelLabel(preset.thinkingLevel)}</span>
                                      </span>
                                      {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                                    </button>
                                    <button type="button" className="p-1 text-muted-foreground opacity-0 hover:text-foreground group-hover/preset:opacity-100" title={t('composer.editPresetName')} onClick={() => setEditingPresetId(preset.id)}><Pencil className="h-3.5 w-3.5" /></button>
                                    <button type="button" className="mr-2 p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover/preset:opacity-100" title={t('composer.deletePreset')} onClick={() => deleteModelPreset(preset.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {modelGroups.map((group) => {
                        const isActive = group.baseKey === effectiveModelVariant.baseKey;
                        const displayName = resolveModelDisplayName(group.original.modelRef, modelAliases[group.baseKey], group.original.label);
                        const isEditing = editingModelKey === group.baseKey;
                        return (
                          <div
                            key={group.baseKey}
                            className={cn(
                              'group/model flex min-h-9 items-center rounded-xl transition-colors',
                              isActive ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
                            )}
                          >
                            {isEditing ? (
                              <InlineNameEditor
                                value={editingModelName}
                                ariaLabel={t('composer.editModelName')}
                                saveLabel={t('composer.saveModelName')}
                                cancelLabel={t('composer.cancelModelName')}
                                resetLabel={t('composer.resetModelName')}
                                onSave={finishEditingModelName}
                                onCancel={() => setEditingModelKey(null)}
                                onReset={() => { resetModelAlias(group.baseKey); setEditingModelKey(null); }}
                              />
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSelectModelGroup(group)}
                                  className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left text-sm font-medium"
                                  data-testid={`chat-model-picker-option-${group.baseKey}`}
                                  title={group.original.modelRef}
                                >
                                  <span className="truncate">{displayName}</span>
                                  {isActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
                                </button>
                                <button
                                  type="button"
                                  className="mr-2 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-black/5 hover:text-foreground group-hover/model:opacity-100 dark:hover:bg-white/10"
                                  title={t('composer.editModelName')}
                                  aria-label={t('composer.editModelNameFor', { model: displayName })}
                                  onClick={() => startEditingModelName(group)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {showThinkingPicker && currentModelGroup && (
              <div ref={thinkingPickerRef} className="relative shrink-0">
                <button
                  type="button"
                  data-testid="chat-thinking-picker-button"
                  className={cn(
                    'inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-meta font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
                    thinkingPickerOpen && 'text-foreground',
                  )}
                  disabled={inputDisabled || sending || !!switchingModelRef}
                  onClick={() => {
                    setPickerOpen(false);
                    setSkillPickerOpen(false);
                    setModelPickerOpen(false);
                    setWorkspaceMenuOpen(false);
                    setThinkingPickerOpen((open) => !open);
                  }}
                  title={t('composer.thinkingEffort')}
                >
                  <span>{displayThinkingLevel(currentThinkingLevel)}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', thinkingPickerOpen && 'rotate-180')} />
                </button>
                {thinkingPickerOpen && (
                  <div className="absolute bottom-full left-0 z-20 mb-2 w-44 overflow-hidden rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10" data-testid="chat-thinking-picker-menu">
                    <div className="px-3 py-2 text-tiny font-medium text-muted-foreground/80">{t('composer.thinkingEffort')}</div>
                    {thinkingLevels.map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => handleSelectThinkingLevel(level)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
                          currentThinkingLevel === level ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
                        )}
                      >
                        <span>{displayThinkingLevel(level)}</span>
                        {currentThinkingLevel === level && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Button
              onClick={sending ? handleStop : handleSend}
              disabled={sending ? !canStop : !canSend}
              size="icon"
              data-testid="chat-composer-send"
              className={`ml-auto shrink-0 h-8 w-8 rounded-lg transition-colors ${
                (sending || canSend)
                  ? 'bg-black/5 dark:bg-white/10 text-foreground hover:bg-black/10 dark:hover:bg-white/20'
                  : 'text-muted-foreground/50 hover:bg-transparent bg-transparent'
              }`}
              variant="ghost"
              title={sending ? t('composer.stop') : t('composer.send')}
            >
              {sending ? (
                <Square className="h-3.5 w-3.5" fill="currentColor" />
              ) : (
                <SendHorizontal className="h-4 w-4" strokeWidth={2} />
              )}
            </Button>
          </div>
        </div>
        <div
          className="mt-[15px] flex h-6 min-w-0 items-center justify-between gap-2 px-[5px] text-tiny text-muted-foreground/60"
          data-testid="chat-composer-footer"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {workspaceLabel && workspacePath && (
              <div ref={workspaceMenuRef} className="relative min-w-0 shrink" onKeyDown={handleWorkspaceKeyDown}>
                <button
                  type="button"
                  data-testid="chat-workspace-selector"
                  title={workspacePath}
                  aria-disabled={workspaceSelectorDisabled ? 'true' : undefined}
                  aria-expanded={!workspaceSelectorDisabled ? workspaceMenuOpen : undefined}
                  tabIndex={workspaceSelectorDisabled ? -1 : undefined}
                  onClick={workspaceSelectorDisabled ? undefined : handleWorkspaceButtonClick}
                  className={cn(
                    'inline-flex h-6 min-w-0 max-w-[260px] items-center gap-1 rounded-full border px-2',
                    'bg-black/[0.02] text-tiny font-medium text-foreground/75 transition-colors dark:bg-white/[0.04]',
                    workspaceSelectorDisabled
                      ? 'cursor-default border-transparent opacity-80'
                      : 'border-black/10 hover:bg-black/5 hover:text-foreground dark:border-white/10 dark:hover:bg-white/10',
                  )}
                >
                  <FolderOpen className="h-3 w-3 shrink-0" />
                  <span className="min-w-0 truncate">
                    {t('composer.workspacePrefix', { workspace: workspaceLabel })}
                  </span>
                  {!workspaceSelectorDisabled && (
                    <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', workspaceMenuOpen && 'rotate-180')} />
                  )}
                </button>
                {workspaceMenuOpen && !workspaceSelectorDisabled && (
                  <div
                    data-testid="chat-workspace-menu"
                    className="absolute bottom-full left-0 z-20 mb-2 max-h-80 w-64 overflow-y-auto rounded-2xl border border-black/10 bg-surface-modal p-1.5 shadow-xl dark:border-white/10"
                  >
                    <button
                      type="button"
                      data-testid="chat-workspace-default"
                      aria-current={isDefaultWorkspacePath(workspacePath) ? 'true' : undefined}
                      onClick={handleSelectDefaultWorkspace}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10',
                        isDefaultWorkspacePath(workspacePath) && 'bg-black/5 dark:bg-white/10',
                      )}
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{t('composer.defaultWorkspaceOption')}</span>
                      {isDefaultWorkspacePath(workspacePath) && <Check className="h-3.5 w-3.5 shrink-0" />}
                    </button>
                    {workspaceOptions.map((option) => {
                      const optionPath = normalizeWorkspacePath(option.path);
                      if (!optionPath || isDefaultWorkspacePath(optionPath)) return null;
                      const selected = optionPath === normalizeWorkspacePath(workspacePath);
                      return (
                        <button
                          key={optionPath}
                          type="button"
                          data-testid={`chat-workspace-option-${encodeURIComponent(optionPath)}`}
                          title={optionPath}
                          aria-current={selected ? 'true' : undefined}
                          onClick={() => handleSelectWorkspace(optionPath)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10',
                            selected && 'bg-black/5 dark:bg-white/10',
                          )}
                        >
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{option.label}</span>
                          {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                    <div className="my-1 border-t border-black/5 dark:border-white/10" />
                    <button
                      type="button"
                      data-testid="chat-workspace-choose-other"
                      onClick={() => void handleChooseOtherWorkspace()}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{t('composer.chooseOtherWorkspaceOption')}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
            <RequestStats
              usage={usage}
              model={modelOptions.find((option) => option.modelRef === effectiveModelRef)}
            />
            {chatComposerStatusComponents.map((Component, index) => (
              <Component key={`${index}`} gatewayStatus={gatewayStatus} />
            ))}
            {hasFailedAttachments && (
              <Button
                variant="link"
                size="sm"
                className="h-auto shrink-0 p-0 text-tiny"
                onClick={() => {
                  setAttachments((prev) => prev.filter((att) => att.status !== 'error'));
                  void pickFiles();
                }}
              >
                {t('composer.retryFailedAttachments')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Attachment Preview ───────────────────────────────────────────

function AttachmentPreview({
  attachment,
  onRemove,
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  const { t } = useTranslation('chat');
  const isImage = attachment.mimeType.startsWith('image/') && attachment.preview;

  return (
    <div className="relative group rounded-lg overflow-hidden border border-border">
      {isImage ? (
        // Image thumbnail
        <div className="w-16 h-16">
          <img
            src={attachment.preview!}
            alt={attachment.fileName}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        // Generic file card
        <div className="flex items-center gap-2 px-3 py-2 bg-surface-input/50 max-w-[200px]">
          <FileIcon mimeType={attachment.mimeType} className="h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 overflow-hidden">
            <p className="text-xs font-medium truncate">{attachment.fileName}</p>
            <p className="text-2xs text-muted-foreground">
              {attachment.mimeType === DIRECTORY_MIME_TYPE
                ? t('composer.folderAttachment')
                : attachment.fileSize > 0
                  ? formatFileSize(attachment.fileSize)
                  : '...'}
            </p>
          </div>
        </div>
      )}

      {/* Staging overlay */}
      {attachment.status === 'staging' && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
          <Loader2 className="h-4 w-4 text-white animate-spin" />
        </div>
      )}

      {/* Error overlay */}
      {attachment.status === 'error' && (
        <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
          <span className="text-2xs text-destructive font-medium px-1">{t('common:status.error')}</span>
        </div>
      )}

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${t('common:actions.delete')}: ${attachment.fileName}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function AgentPickerItem({
  agent,
  selected,
  onSelect,
}: {
  agent: AgentSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition-colors',
        selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5'
      )}
    >
      <span className="text-sm font-medium text-foreground">{agent.name}</span>
      <span className="text-tiny text-muted-foreground">
        {agent.modelDisplay}
      </span>
    </button>
  );
}

function SkillPickerItem({
  skill,
  selected,
  onSelect,
}: {
  skill: QuickAccessSkill;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid={`chat-composer-skill-option-${skill.name}`}
          onClick={onSelect}
          className={cn(
            'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors',
            selected ? 'bg-primary/10 text-foreground' : 'hover:bg-black/5 dark:hover:bg-white/5',
          )}
        >
          <div className="min-w-0">
            <div className="truncate text-meta font-semibold text-foreground">
              <span className="font-mono">/{skill.name}</span>
            </div>
            <div className="truncate text-tiny text-muted-foreground">
              {skill.sourceLabel}
            </div>
          </div>
          <span className="rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-2xs font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]">
            {skill.sourceLabel}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
        {skill.description}
      </TooltipContent>
    </Tooltip>
  );
}
