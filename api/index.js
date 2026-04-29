export const config = { runtime: "edge" };

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

// فقط متدهای مجاز
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

// حذف هدرهای مشکل‌ساز
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

export default async function handler(req) {
  try {
    if (!TARGET_BASE) {
      return new Response("Server misconfigured", { status: 500 });
    }

    if (!ALLOWED_METHODS.has(req.method)) {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(req.url);

    // ساخت URL مقصد
    const targetUrl = TARGET_BASE + url.pathname + url.search;

    // ساخت header جدید (سبک و امن)
    const headers = new Headers();

    for (const [key, value] of req.headers) {
      const k = key.toLowerCase();

      if (HOP_BY_HOP.has(k)) continue;
      if (k === "host") continue;

      // برای کاهش ریسک
      if (k === "cookie") continue;

      headers.set(key, value);
    }

    // اضافه کردن IP
    const ip =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "";

    if (ip) {
      headers.set("x-forwarded-for", ip);
    }

    // تنظیمات fetch سبک (CPU کمتر)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let body = null;

    // فقط در صورت نیاز body بخون (صرفه‌جویی CPU)
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await req.arrayBuffer();
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: "follow",
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // پاسخ مستقیم بدون پردازش اضافی (کم‌مصرف)
    return new Response(upstream.body, {
      status: upstream.status,
      headers: upstream.headers,
    });
  } catch (err) {
    console.error("Proxy error:", err);
    return new Response("Bad Gateway", { status: 502 });
  }
}