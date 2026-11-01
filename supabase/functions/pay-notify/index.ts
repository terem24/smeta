// Заявка «Я оплатил» — владельцу в бот монтажников с кнопками «✅ Оплачено» / «✗ Отклонить».
//
// Вызывает браузер сразу после pay_request_grace (subscription.js: requestWithGrace) с id
// заявки. Нажатие кнопки ловит tg-webhook (callback_query «pay:ok:<id>» / «pay:no:<id>»)
// и зовёт pay_confirm_tg в базе.
//
// Защита: Verify JWT на шлюзе выключен, как у остальных функций проекта; вместо него
// токен проверяется здесь (/auth/v1/user). Звать может только вошедший пользователь, и только про
// свою заявку (user_id заявки = его запись в users), не старше 10 минут и один раз
// (tg_notified_at). Текст собирается здесь из базы, а не из браузера.
//
// Секреты: TG_INSTALLER_BOT_TOKEN, SUPABASE_SERVICE_ROLE_KEY (те же, что у tg-webhook).

const ADMIN_EMAILS = ["kovdor24@yandex.ru"]; // тот же список, что в tg-webhook

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (code: number, data: unknown) =>
  new Response(JSON.stringify(data), { status: code, headers: { ...cors, "Content-Type": "application/json" } });

const fmtRub = (n: unknown) => Math.round(Number(n) || 0).toLocaleString("ru-RU") + " ₽";
const fmtMsk = (d: string) =>
  new Date(d).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false });
  try {
    const botToken = Deno.env.get("TG_INSTALLER_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!botToken || !supabaseUrl || !serviceKey) return json(503, { ok: false, error: "not_configured" });

    const body = await req.json().catch(() => null);
    const id = String((body && body.id) || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { ok: false, error: "id" });

    // Кто зовёт: пользователь по его JWT
    const authHeader = req.headers.get("Authorization") || "";
    const who = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: authHeader } })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!who || !who.id) return json(401, { ok: false, error: "auth" });

    const rest = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" };
    const get = async (path: string) => {
      const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: rest });
      return r.ok ? await r.json().catch(() => null) : null;
    };

    const me = (await get(`users?auth_user_id=eq.${encodeURIComponent(who.id)}&select=id,email,last_name,first_name,username,region,phone&limit=1`) || [])[0];
    const pay = (await get(`subscription_payments?id=eq.${id}&select=*&limit=1`) || [])[0];
    if (!me || !pay || String(pay.user_id) !== String(me.id)) return json(403, { ok: false, error: "owner" });
    if (pay.tg_notified_at || pay.status !== "requested") return json(200, { ok: true, skipped: "done" });
    if (Date.now() - new Date(pay.created_at).getTime() > 10 * 60 * 1000) return json(200, { ok: true, skipped: "old" });

    const admins = await get(`users?email=in.(${ADMIN_EMAILS.map(encodeURIComponent).join(",")})&tg_chat_id=not.is.null&select=tg_chat_id`) || [];
    if (!admins.length) return json(200, { ok: false, error: "no_admin_chat" });

    const settings = (await get(`app_settings?key=eq.subscription&select=value&limit=1`) || [])[0];
    const plan = settings && settings.value && settings.value.plans && settings.value.plans[pay.plan];
    const planName = (plan && (plan.label || plan.title)) || pay.plan || "—";
    const name = [me.last_name, me.first_name].filter(Boolean).join(" ") || me.username || "";

    const lines = [
      "🔥 ЗАЯВКА НА ПРОФИ",
      (name ? name + " · " : "") + (pay.email || me.email || ""),
      me.phone ? "Телефон: " + me.phone : null,
      pay.region ? "Регион: " + pay.region : null,
      "Тариф: " + planName + (pay.rub ? " — " + fmtRub(pay.rub) : "") + (pay.promo ? " (акция «" + pay.promo + "»)" : ""),
      pay.grace_until ? "Профи на 24 часа включён — до " + fmtMsk(pay.grace_until) + " (МСК)." : "Профи на 24 часа не включён (уже давали по неподтверждённой заявке).",
      "",
      "Проверьте поступление в Т-Банке и нажмите кнопку.",
    ].filter((x) => x !== null);

    let sent = false;
    for (const a of admins) {
      const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: a.tg_chat_id,
          text: lines.join("\n"),
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Оплачено", callback_data: "pay:ok:" + id },
              { text: "✗ Отклонить", callback_data: "pay:no:" + id },
            ]],
          },
        }),
      }).catch(() => null);
      if (r && r.ok) sent = true;
    }
    if (sent) {
      await fetch(`${supabaseUrl}/rest/v1/subscription_payments?id=eq.${id}`, {
        method: "PATCH", headers: rest, body: JSON.stringify({ tg_notified_at: new Date().toISOString() }),
      });
    }
    return json(200, { ok: sent });
  } catch (e) {
    console.error("pay-notify crashed:", e);
    return json(500, { ok: false });
  }
});
