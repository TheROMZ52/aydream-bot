<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:050505,35:171717,70:303030,100:050505&height=190&section=header&text=AyDream&fontSize=54&fontColor=ffffff&fontAlignY=38&desc=MINECRAFT%20BOT%2C%20CLIENT%20AND%20CONTROL%20PANEL&descAlignY=62&descSize=13" width="100%" />

<br/>

<img src="https://img.shields.io/badge/NODE.JS-111111?style=for-the-badge&logo=nodedotjs&logoColor=white" /> <img src="https://img.shields.io/badge/MINEFLAYER-111111?style=for-the-badge&logo=minecraft&logoColor=white" /> <img src="https://img.shields.io/badge/FABRIC-111111?style=for-the-badge&logo=fabric&logoColor=white" /> <img src="https://img.shields.io/github/stars/TheROMZ52/aydream-bot?style=for-the-badge&color=111111&labelColor=050505&logo=github" /> <img src="https://img.shields.io/github/last-commit/TheROMZ52/aydream-bot?style=for-the-badge&color=111111&labelColor=050505" />

<br/>

## AyDream — ربات و کلاینت Minecraft

[فارسی](README.fa.md) · [English](README.md)

### ربات، کلاینت و پنل کنترل برای ماینکرفت؛ چون ظاهراً یک روش برای وصل شدن به سرور کافی نبود.

<img src="https://skillicons.dev/icons?i=nodejs,js,java,gradle,githubactions,vercel&theme=dark" />

</div>

---

AyDream یک پروژهٔ اتوماسیون Minecraft است که از یک ربات مبتنی بر Mineflayer با Node.js، یک ماژول کلاینت Fabric و یک پنل کنترل از راه دور مبتنی بر GitHub Actions تشکیل شده است.

---

## 01 / بخش‌های پروژه

- **ربات Node.js:** ربات مبتنی بر Mineflayer در فایل `bot.js`.
- **کلاینت Fabric:** سورس ماژول در پوشهٔ `aydream-client/`؛ تنظیم‌شده برای Minecraft 1.21.8، Fabric Loader و Java 21.
- **اجرای از راه دور:** ورک‌فلو `.github/workflows/aydream.yml` ربات را از طریق GitHub Actions اجرا می‌کند.
- **پنل وب:** رابط پوشهٔ `panel/` و APIهای پوشهٔ `api/` امکان Start، Stop، Restart، Status و مشاهدهٔ Logs را برای Runner فراهم می‌کنند.

---

<details>
<summary><b>02 / پیش‌نیازها</b></summary>
<br/>

- Node.js؛ Runner خودکار فعلاً از Node.js 24 استفاده می‌کند.
- Java 21 برای ماژول کلاینت Fabric
- تنظیمات سرور و حساب Minecraft متناسب با ربات
- تنظیم GitHub Actions برای استفاده از Runner از راه دور

</details>

---

## 03 / اجرای محلی ربات

وابستگی‌ها را نصب کن:

```bash
npm install
```

ربات را اجرا کن:

```bash
node bot.js
```

در ویندوز، فایل `start.bat` همین دستور را اجرا می‌کند.

---

<details>
<summary><b>04 / اجرای تست‌ها</b></summary>
<br/>

```bash
npm test
```

این فرمان از تست‌رانر داخلی Node.js استفاده می‌کند.

</details>

---

## 05 / ساخت کلاینت Fabric

از داخل پوشهٔ `aydream-client/`:

```bash
./gradlew build
```

در ویندوز:

```bat
gradlew.bat build
```

این ماژول برای Minecraft 1.21.8 و Java 21 تنظیم شده است.

---

## 06 / پنل کنترل از راه دور

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

---

<details>
<summary><b>07 / ورک‌فلوها</b></summary>
<br/>

- [اجرای AyDream](.github/workflows/aydream.yml)
- [ساخت کلاینت](.github/workflows/aydream-client.yml)
- [بررسی‌ها و تست‌ها](.github/workflows/aydream-checks.yml)

</details>

---

<details>
<summary><b>08 / مجوز</b></summary>
<br/>

در حال حاضر مجوز اعلام‌شده برای پکیج Node.js در `package.json` برابر ISC است. پیش از انتشار یا بازتوزیع کل پروژه، مجوز هر بخش را جداگانه بررسی کن.

</details>

---

<div align="center">

<a href="https://github.com/TheROMZ52?tab=repositories"><img src="https://img.shields.io/badge/MORE%20PROJECTS-111111?style=for-the-badge&logo=github&logoColor=white" /></a>

<br/><br/>

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:050505,50:202020,100:050505&height=110&section=footer" width="100%" />

<sub>© TheROMZ52 • ساخته‌شده با کد، کنجکاوی و تعداد مشکوکی تب باز.</sub>

</div>
