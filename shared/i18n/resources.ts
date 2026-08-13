import type { LanguageCode } from '../language';

// EN
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enDashboard from './locales/en/dashboard.json';
import enChat from './locales/en/chat.json';
import enChannels from './locales/en/channels.json';
import enAgents from './locales/en/agents.json';
import enSkills from './locales/en/skills.json';
import enCron from './locales/en/cron.json';
import enSetup from './locales/en/setup.json';
import enMenu from './locales/en/menu.json';
import enOrganization from './locales/en/organization.json';

// RU
import ruCommon from './locales/ru/common.json';
import ruSettings from './locales/ru/settings.json';
import ruDashboard from './locales/ru/dashboard.json';
import ruChat from './locales/ru/chat.json';
import ruChannels from './locales/ru/channels.json';
import ruAgents from './locales/ru/agents.json';
import ruSkills from './locales/ru/skills.json';
import ruCron from './locales/ru/cron.json';
import ruSetup from './locales/ru/setup.json';
import ruMenu from './locales/ru/menu.json';
import ruOrganization from './locales/ru/organization.json';

export const I18N_NAMESPACES = [
  'common',
  'settings',
  'dashboard',
  'chat',
  'channels',
  'agents',
  'skills',
  'cron',
  'setup',
  'menu',
  'organization',
] as const;

export const I18N_RESOURCES = {
  en: {
    common: enCommon,
    settings: enSettings,
    dashboard: enDashboard,
    chat: enChat,
    channels: enChannels,
    agents: enAgents,
    skills: enSkills,
    cron: enCron,
    setup: enSetup,
    menu: enMenu,
    organization: enOrganization,
  },
  ru: {
    common: ruCommon,
    settings: ruSettings,
    dashboard: ruDashboard,
    chat: ruChat,
    channels: ruChannels,
    agents: ruAgents,
    skills: ruSkills,
    cron: ruCron,
    setup: ruSetup,
    menu: ruMenu,
    organization: ruOrganization,
  },
} as const;

export type MenuLabels = typeof enMenu;

export const MENU_LABELS: Record<LanguageCode, MenuLabels> = {
  en: enMenu,
  ru: ruMenu,
};
