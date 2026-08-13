<div align="center">

# OpenX

**Независимый desktop-клиент для удалённого OpenClaw Gateway**

[![Check and Build](https://github.com/ZitZdorovo/OpenX/actions/workflows/check.yml/badge.svg)](https://github.com/ZitZdorovo/OpenX/actions/workflows/check.yml)
[![Electron E2E](https://github.com/ZitZdorovo/OpenX/actions/workflows/electron-e2e.yml/badge.svg)](https://github.com/ZitZdorovo/OpenX/actions/workflows/electron-e2e.yml)
[![Release](https://github.com/ZitZdorovo/OpenX/actions/workflows/release.yml/badge.svg)](https://github.com/ZitZdorovo/OpenX/actions/workflows/release.yml)
[![GitHub release](https://img.shields.io/github/v/release/ZitZdorovo/OpenX?display_name=tag&sort=semver)](https://github.com/ZitZdorovo/OpenX/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-2ea44f.svg)](LICENSE)

[Возможности](#возможности) · [Быстрый старт](#запуск-для-разработки) · [Сборка](#сборка) · [Архитектура](#архитектура) · [Безопасность](#безопасность)

</div>

OpenX — кроссплатформенный Electron-клиент для удалённого [OpenClaw Gateway](https://docs.openclaw.ai). Приложение предоставляет интерфейс для чатов, агентов, моделей, каналов, навыков и задач Cron, не подменяя серверную часть OpenClaw.

> OpenX подключается к уже работающему Gateway по `ws://` или `wss://`. Клиент не устанавливает, не запускает, не перезапускает и не восстанавливает Gateway на локальной машине.

## Возможности

- чаты с потоковыми ответами, инструментами и вложениями;
- организация сессий по проектам и вложенным папкам;
- выбор агента и модели непосредственно в чате;
- управление удалёнными агентами, каналами, навыками и Cron-задачами;
- безопасное хранение токена или пароля через Electron `safeStorage`;
- автоматические обновления через [GitHub Releases](https://github.com/ZitZdorovo/OpenX/releases);
- светлая и тёмная темы;
- интерфейс на английском и русском языках.

## Требования

- Windows, macOS или Linux;
- Node.js 24;
- pnpm версии, указанной в `package.json`;
- доступный OpenClaw Gateway и данные для авторизации.

## Запуск для разработки

```bash
git clone https://github.com/ZitZdorovo/OpenX.git
cd OpenX
pnpm run init
pnpm dev
```

При первом запуске укажите адрес удалённого Gateway и выберите авторизацию по токену или паролю. Секреты остаются в основном процессе Electron и не передаются renderer-процессу.

## Проверка проекта

```bash
pnpm run typecheck
pnpm run lint:check
pnpm test
pnpm run test:e2e
pnpm run harness:ci
```

Проверки протокола связи с Gateway:

```bash
pnpm run comms:replay
pnpm run comms:compare
```

## Сборка

```bash
# Windows
pnpm run package:win

# macOS
pnpm run package:mac

# Linux
pnpm run package:linux
```

Готовые пакеты создаются в каталоге `release/`. Этот каталог генерируется локально и не хранится в Git.

## Релизы и обновления

Workflow `.github/workflows/release.yml` запускается при публикации тега `v*`. Версия тега должна совпадать с `version` в `package.json`.

```bash
pnpm version patch
```

После успешной сборки GitHub Actions публикует пакеты и update-манифесты в GitHub Releases. Стабильный тег становится последним релизом; версии с суффиксом, например `-beta.1`, публикуются как предварительные.

Установленная версия OpenX проверяет стабильный канал GitHub Releases вскоре после запуска и повторяет проверку каждые шесть часов. При появлении новой версии рядом с «Настройки» отображается синяя кнопка обновления. OpenX всегда запрашивает подтверждение перед загрузкой и перед перезапуском для установки.

## Архитектура

```text
electron/   основной процесс, Gateway WebSocket, безопасное хранилище и host API
src/        React renderer и пользовательский интерфейс
shared/     общие типы, контракты и локализации
tests/      unit- и Electron E2E-тесты
harness/    спецификации архитектуры и протокола связи
scripts/    сборка, упаковка и проверка релизов
```

Renderer обращается к системным возможностям только через типизированный `host-api`. Подключение, авторизация, повторные соединения и RPC к Gateway принадлежат основному процессу Electron.

## Происхождение проекта

OpenX — самостоятельное приложение и независимо поддерживаемый GitHub-репозиторий. Текущая кодовая база содержит части, производные от [ClawX](https://github.com/ValueCell-ai/ClawX), и существенно переработана для архитектуры удалённого Gateway. OpenX не является официальным продуктом и не поддерживается авторами ClawX или OpenClaw.

Исходные уведомления об авторских правах и лицензиях сохранены в [LICENSE](LICENSE) и [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Безопасность

Не добавляйте токены, пароли, сертификаты и `.env`-файлы в репозиторий. Обнаруженные уязвимости следует сообщать приватно через GitHub Security Advisories проекта.

## Лицензия

[MIT](LICENSE). Сведения о коде сторонних проектов приведены в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
