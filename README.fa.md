[فارسی](README.fa.md) · [English](README.md)

# AyDream — ربات و کلاینت Minecraft

AyDream یک پروژهٔ اتوماسیون Minecraft است که از یک ربات مبتنی بر Mineflayer با Node.js، یک ماژول کلاینت Fabric و یک پنل کنترل از راه دور مبتنی بر GitHub Actions تشکیل شده است.

## بخش‌های پروژه

- **ربات Node.js:** ربات مبتنی بر Mineflayer در فایل `bot.js`.
- **کلاینت Fabric:** سورس ماژول در پوشهٔ `aydream-client/`؛ تنظیم‌شده برای Minecraft 1.21.8، Fabric Loader و Java 21.
- **اجرای از راه دور:** ورک‌فلو `.github/workflows/aydream.yml` ربات را از طریق GitHub Actions اجرا می‌کند.
- **پنل وب:** رابط پوشهٔ `panel/` و APIهای پوشهٔ `api/` امکان Start، Stop، Restart، Status و مشاهدهٔ Logs را برای Runner فراهم می‌کنند.

## پیش‌نیازها

- Node.js؛ Runner خودکار فعلاً از Node.js 24 استفاده می‌کند.
- Java 21 برای ماژول کلاینت Fabric
- تنظیمات سرور و حساب Minecraft متناسب با ربات
- تنظیم GitHub Actions برای استفاده از Runner از راه دور

## اجرای محلی ربات

وابستگی‌ها را نصب کن:

```bash
npm install
```

ربات را اجرا کن:

```bash
node bot.js
```

در ویندوز، فایل `start.bat` همین دستور را اجرا می‌کند.

## اجرای تست‌ها

```bash
npm test
```

این فرمان از تست‌رانر داخلی Node.js استفاده می‌کند.

## ساخت کلاینت Fabric

از داخل پوشهٔ `aydream-client/`:

```bash
./gradlew build
```

در ویندوز:

```bat
gradlew.bat build
```

این ماژول برای Minecraft 1.21.8 و Java 21 تنظیم شده است.

## پنل کنترل از راه دور

پنل می‌تواند ورک‌فلو `aydream.yml` را اجرا و اجرای فعال آن را مدیریت کند:

- **Start** — شروع یک اجرای جدید
- **Stop** — لغو اجرای فعال
- **Restart** — لغو اجرای فعلی و شروع اجرای تازه
- **Status** — دریافت وضعیت آخرین اجرا
- **Logs** — نمایش Jobها و لینک گزارش‌های GitHub

راهنمای استقرار پنل در [PANEL_SETUP.md](PANEL_SETUP.md) قرار دارد.

راهنمای فعلی این متغیرها را برای GitHub Actions معرفی می‌کند:

- `AYDREAM_HOST`
- `AYDREAM_PORT`
- `AYDREAM_USERNAME`
- `AYDREAM_VERSION`
- `AYDREAM_CONTROLLER`
- `AYDREAM_PASSWORD`

برای پنل Vercel نیز `GITHUB_TOKEN` و `PANEL_KEY` لازم هستند.

**نکتهٔ امنیتی:** راهنمای فعلی، `AYDREAM_PASSWORD` را به‌صورت GitHub Actions Variable می‌خواند؛ مقدار Variableها Mask نمی‌شود. برای امنیت بیشتر، رمز را به GitHub Actions Secret منتقل کن و ورک‌فلو را طوری تغییر بده که مقدار را از `secrets.*` بخواند. هیچ رمز یا کلید واقعی را داخل مخزن Commit نکن.

## ورک‌فلوها

- [اجرای AyDream](.github/workflows/aydream.yml)
- [ساخت کلاینت](.github/workflows/aydream-client.yml)
- [بررسی‌ها و تست‌ها](.github/workflows/aydream-checks.yml)

## مجوز

در حال حاضر مجوز اعلام‌شده برای پکیج Node.js در `package.json` برابر ISC است. پیش از انتشار یا بازتوزیع کل پروژه، مجوز هر بخش را جداگانه بررسی کن.
