# Участие в разработке OpenX

Спасибо за интерес к проекту. Перед изменениями ознакомьтесь с архитектурными правилами в `AGENTS.md`.

## Подготовка

```bash
pnpm run init
pnpm dev
```

OpenX работает только с удалённым OpenClaw Gateway. Не добавляйте локальные замены серверных функций и не передавайте секреты в renderer-процесс.

## Перед pull request

```bash
pnpm run typecheck
pnpm run lint:check
pnpm test
pnpm run build:vite
```

Для изменений связи с Gateway также выполните:

```bash
pnpm run comms:replay
pnpm run comms:compare
pnpm run harness:ci
```

Пользовательские изменения интерфейса должны содержать Electron E2E-сценарий. Текст интерфейса необходимо добавлять одновременно в английскую и русскую локализации.

## Сообщения об ошибках

Публичные ошибки и предложения оформляйте через [GitHub Issues](https://github.com/ZitZdorovo/OpenX/issues). Уязвимости отправляйте приватно через GitHub Security Advisories.
