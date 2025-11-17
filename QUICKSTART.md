# Quick Start Guide

Быстрое руководство по началу работы с AI Browser Automation.

## Установка (2 минуты)

```bash
# 1. Установите зависимости
npm install

# 2. Создайте конфигурацию
cp .env.example .env

# 3. Добавьте ваш Claude API ключ в .env
# Получите ключ: https://console.anthropic.com/
nano .env  # или используйте любой редактор
```

В `.env` замените `your_api_key_here` на ваш реальный ключ:
```env
ANTHROPIC_API_KEY=sk-ant-api03-...
```

## Первый запуск

```bash
npm start
```

Вы увидите меню:
```
Main Menu:
1. Start new automation task
2. Launch browser (manual login)
3. Continue with existing session
4. List available sessions
5. Change session
6. Exit
```

## Сценарий 1: Простая задача (без входа в аккаунт)

1. Выберите **1** (Start new automation task)
2. Введите задачу, например:
   ```
   Найди информацию о погоде в Москве на сайте yandex.ru/pogoda
   ```
3. ИИ автоматически:
   - Откроет браузер
   - Зайдет на сайт
   - Найдет нужную информацию
   - Покажет результат

## Сценарий 2: Работа с аутентификацией

### Шаг 1: Ручной вход
1. Выберите **2** (Launch browser for manual login)
2. В открывшемся браузере:
   - Зайдите на нужный сайт (например, GitHub)
   - Войдите в ваш аккаунт
   - Вернитесь в терминал и нажмите Enter

### Шаг 2: Автоматизация
1. Выберите **1** (Start new automation task)
2. Введите задачу для аутентифицированного аккаунта:
   ```
   Зайди на github.com и найди мои репозитории
   ```

Ваша сессия сохранена! При следующем запуске выберите **3** (Continue with existing session).

## Сценарий 3: Работа с несколькими аккаунтами

```bash
# Запустите приложение
npm start

# Выберите 5 (Change session)
# Введите имя новой сессии, например: "work-account"

# Выберите 2 (Launch browser)
# Войдите в рабочий аккаунт

# Теперь у вас две сессии:
# - default (личный аккаунт)
# - work-account (рабочий аккаунт)

# Переключайтесь между ними через меню "Change session"
```

## Примеры задач

### Поиск и навигация
```
Зайди на Google и найди "лучшие практики Node.js"
```

### Извлечение информации
```
Открой сайт hacker news и покажи топ 5 новостей
```

### Взаимодействие с формами
```
Зайди на example.com и заполни контактную форму тестовыми данными
```
*Система запросит подтверждение перед отправкой*

### Мониторинг
```
Зайди на statuscake.com и проверь статус моих сервисов
```

## Программное использование

Вместо CLI можно использовать API напрямую:

```javascript
import { BrowserManager } from './src/browser/BrowserManager.js';
import { ClaudeClient } from './src/claude/ClaudeClient.js';
import { ContextManager } from './src/context/ContextManager.js';
import { MainAgent } from './src/agents/MainAgent.js';

// Инициализация
const browser = new BrowserManager({ headless: false });
const claude = new ClaudeClient(process.env.ANTHROPIC_API_KEY);
const context = new ContextManager();
const agent = new MainAgent(browser, claude, context);

// Запуск браузера
await browser.launch('my-session');

// Выполнение задачи
const result = await agent.executeGoal('Зайди на google.com и найди Node.js');

console.log('Result:', result);
```

Больше примеров в `examples/programmatic-usage.js`.

## Важные настройки

### Headless режим
По умолчанию браузер видимый. Для headless режима:
```env
BROWSER_HEADLESS=true
```

### Лимит шагов
Максимум 50 шагов на задачу. Изменить:
```env
MAX_STEPS=100
```

### Директория сессий
По умолчанию `./sessions/`. Изменить:
```env
SESSION_DIR=/path/to/sessions
```

## Безопасность

### Подтверждение действий

Система **автоматически** запрашивает подтверждение для:
- ✉️ Отправки форм
- 💳 Финансовых операций
- 🗑️ Удаления данных
- 📤 Отправки сообщений

Пример:
```
⚠️  CONFIRMATION REQUIRED ⚠️
──────────────────────────────────────────────────
Action: type
Reasoning: Filling the payment form with card details
Parameters:
  selector: #card-number
  text: 4111-1111-1111-1111
──────────────────────────────────────────────────
Do you want to proceed with this action? (y/n):
```

Введите `y` для подтверждения или `n` для отмены.

## Troubleshooting

### Ошибка: "ANTHROPIC_API_KEY is required"
- Проверьте, что файл `.env` существует
- Убедитесь, что ключ API правильный
- Ключ должен начинаться с `sk-ant-`

### Браузер не запускается
```bash
# Проверьте установку Puppeteer
npm install puppeteer --force

# Установите зависимости Chromium (Linux)
sudo apt-get install -y chromium-browser
```

### ИИ не может найти элемент
- Убедитесь, что страница полностью загружена
- Проверьте, что элемент видим на странице
- Попробуйте описать элемент более детально

### Высокое использование токенов
Настройте лимит контекста:
```env
MAX_CONTEXT_SIZE=5000
```

## Следующие шаги

1. Прочитайте [README.md](README.md) для полной документации
2. Изучите [ARCHITECTURE.md](ARCHITECTURE.md) для понимания работы системы
3. Посмотрите [examples/](examples/) для программных примеров
4. Прочитайте [CLAUDE.md](CLAUDE.md) для расширения функциональности

## Поддержка

Вопросы и предложения:
- GitHub Issues: создайте issue в репозитории
- Документация: см. файлы README.md и ARCHITECTURE.md

---

**Готово к работе!** 🚀

Запустите `npm start` и введите вашу первую задачу для ИИ.
