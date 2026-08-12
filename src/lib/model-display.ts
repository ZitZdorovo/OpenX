import { splitModelRef, type ConfiguredModelOption } from './model-options';

export const THINKING_LEVELS = [
  'off',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'adaptive',
  'max',
  'ultra',
] as const;
export type ThinkingLevel = typeof THINKING_LEVELS[number];

export interface ParsedModelVariant {
  baseKey: string;
  baseId: string;
  level: ThinkingLevel;
}

export interface ConfiguredModelGroup {
  baseKey: string;
  baseId: string;
  variants: Partial<Record<ThinkingLevel, ConfiguredModelOption>>;
  original: ConfiguredModelOption;
}

const MODEL_ABBREVIATIONS = new Map([
  ['ai', 'AI'],
  ['api', 'API'],
  ['gpt', 'GPT'],
  ['llm', 'LLM'],
  ['mcp', 'MCP'],
  ['ocr', 'OCR'],
  ['vl', 'VL'],
]);

/** Names that cannot be derived reliably from an id alone. */
const EXPLICIT_MODEL_NAMES: Readonly<Record<string, string>> = {
  'gemini-pro-agent': 'Gemini Pro Agent',
  'gpt-5.6-sol': 'GPT 5.6 Sol',
  'gpt-5-6-sol': 'GPT 5.6 Sol',
};

export function parseModelVariant(raw: string | null | undefined): ParsedModelVariant {
  const source = typeof raw === 'string' ? raw.trim() : '';
  if (!source) return { baseKey: 'unknown', baseId: 'unknown', level: 'off' };

  const lower = source.toLowerCase();
  if (lower.includes('gemini-pro-agent')) {
    return { baseKey: 'gemini-pro-agent', baseId: 'gemini-pro-agent', level: 'max' };
  }
  if (lower.includes('gemini-3.1-pro-low') || lower.includes('gemeni-3.1-pro-low')) {
    return { baseKey: 'gemini-pro-agent', baseId: 'gemini-pro-agent', level: 'low' };
  }

  let baseId = source.replace(/^(?:[^/]+\/)+/, '');
  let level: ThinkingLevel = 'off';
  const suffix = baseId.match(/-(none|off|low|medium|high|xhigh|max|ultra)$/i);
  if (suffix) {
    level = suffix[1].toLowerCase() as ThinkingLevel;
    baseId = baseId.slice(0, -suffix[0].length);
  }
  baseId = baseId.replace(/[-_\s]thinking$/i, '');
  return { baseKey: baseId.toLowerCase(), baseId, level };
}

export function formatAutomaticModelName(raw: string | null | undefined): string {
  const { baseId } = parseModelVariant(raw);
  if (baseId === 'unknown') return 'Model';
  const explicitName = EXPLICIT_MODEL_NAMES[baseId.toLowerCase()];
  if (explicitName) return explicitName;
  if (/claude-?3[.-]?5-?sonnet/i.test(baseId) || /claude.*sonnet.*3[.-]?5/i.test(baseId)) return 'Claude Sonnet 3.5';
  if (/claude-?3[.-]?5-?haiku/i.test(baseId) || /claude.*haiku.*3[.-]?5/i.test(baseId)) return 'Claude Haiku 3.5';

  const normalizedBaseId = baseId.replace(/\b(gpt|gemini|claude)-(\d+)-(\d+)(?=-|$)/gi, '$1-$2.$3');
  return normalizedBaseId
    .split(/[-_/\s]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^\d+(?:\.\d+)+$/.test(part)) return part;
      const abbreviation = MODEL_ABBREVIATIONS.get(part.toLowerCase());
      if (abbreviation) return abbreviation;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ')
    .replace(/(Claude)\s+(\d+(?:\.\d+)?)\s+([A-Za-z]+)/gi, '$1 $3 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveModelDisplayName(
  raw: string | null | undefined,
  userOverride?: string | null,
  explicitLabel?: string | null,
): string {
  const override = userOverride?.trim();
  if (override) return override;
  const explicit = explicitLabel?.trim();
  const rawModelId = splitModelRef(raw)?.modelId || raw?.trim();
  // Catalogs often repeat the raw id in `name`; that is not a human-authored
  // mapping and should still receive the automatic formatter.
  const generatedProviderLabel = rawModelId ? explicit?.startsWith(`${rawModelId} (`) : false;
  if (explicit && explicit !== raw && explicit !== rawModelId && !generatedProviderLabel) return explicit;
  return formatAutomaticModelName(raw) || raw?.trim() || 'Model';
}

export function groupConfiguredModels(options: ConfiguredModelOption[]): ConfiguredModelGroup[] {
  const groups = new Map<string, ConfiguredModelGroup>();
  for (const option of options) {
    const parsed = parseModelVariant(option.modelRef);
    const group = groups.get(parsed.baseKey) ?? {
      baseKey: parsed.baseKey,
      baseId: parsed.baseId,
      variants: {},
      original: option,
    };
    group.variants[parsed.level] = option;
    groups.set(parsed.baseKey, group);
  }
  return [...groups.values()];
}

export function resolveGroupVariant(
  group: ConfiguredModelGroup,
  preferredLevel?: string | null,
): ConfiguredModelOption {
  const preferred = THINKING_LEVELS.includes(preferredLevel as ThinkingLevel)
    ? preferredLevel as ThinkingLevel
    : null;
  if (preferred && group.variants[preferred]) return group.variants[preferred]!;
  for (const level of THINKING_LEVELS) {
    if (group.variants[level]) return group.variants[level]!;
  }
  return group.original;
}

export function availableThinkingLevels(group: ConfiguredModelGroup | null): ThinkingLevel[] {
  if (!group) return [];
  return THINKING_LEVELS.filter((level) => Boolean(group.variants[level]));
}

export function thinkingLevelLabel(level: ThinkingLevel): string {
  if (level === 'none') return 'Off';
  if (level === 'xhigh') return 'Xhigh';
  if (level === 'adaptive') return 'Adaptive';
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function normalizeThinkingLevel(value: string | null | undefined): ThinkingLevel | null {
  const normalized = value?.trim().toLowerCase();
  return THINKING_LEVELS.includes(normalized as ThinkingLevel)
    ? normalized as ThinkingLevel
    : null;
}
