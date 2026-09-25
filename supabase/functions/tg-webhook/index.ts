// Приём вебхука от Telegram-бота для монтажников (личные уведомления по КП,
// опроснику и чатам — см. tgNotify в installer_settings и логику в send-push).
//
// Единственное, что бот умеет принимать, — команду /start <токен> от кнопки
// «Подключить Telegram» в личном кабинете (app.js: connectTelegram). Токен
// одноразовый и живёт 10 минут: users.id для этого не годится, потому что тот же
// id уже публичный — используется в ссылке на опросник (oprosnik.html?m=<id>),
// и его знает любой клиент монтажника.
//
// Verify JWT выключен: вызывает сервер Telegram, а не наш клиент. Вместо JWT —
// секрет в заголовке X-Telegram-Bot-Api-Secret-Token, который Telegram присылает
// сам, если его задали при регистрации вебхука (setWebhook ...&secret_token=...).
//
// Секреты (Edge Function Secrets):
//   TG_INSTALLER_BOT_TOKEN — токен бота от @BotFather
//   TG_WEBHOOK_SECRET — тот же secret_token, что передан в setWebhook

const CONNECT_TOKEN_TTL_MS = 10 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");

  try {
    const webhookSecret = Deno.env.get("TG_WEBHOOK_SECRET");
    const gotSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (!webhookSecret || gotSecret !== webhookSecret) {
      return new Response("forbidden", { status: 403 });
    }

    const botToken = Deno.env.get("TG_INSTALLER_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!botToken || !supabaseUrl || !serviceKey) {
      console.error("tg-webhook: не заданы переменные окружения");
      return new Response("ok"); // Telegram не должен долбить повторами
    }

    const update = await req.json().catch(() => null);
    const msg = update && update.message;
    const chatId = msg && msg.chat && msg.chat.id;
    const text = String((msg && msg.text) || "");
    if (!chatId || !text.startsWith("/start")) return new Response("ok");

    const reply = (t: string) =>
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: t }),
      }).catch((e) => console.error("tg-webhook: sendMessage упал", e));

    const token = text.replace(/^\/start/, "").trim();
    if (!token) {
      await reply("Чтобы подключить уведомления, нажмите «Подключить Telegram» в личном кабинете HeatCalc.ru — оттуда придёт правильная ссылка.");
      return new Response("ok");
    }

    const rest = {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      "Content-Type": "application/json",
    };

    const rows = await fetch(
      `${supabaseUrl}/rest/v1/users?tg_connect_token=eq.${encodeURIComponent(token)}&select=id,tg_connect_token_at&limit=1`,
      { headers: rest },
    ).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const row = Array.isArray(rows) && rows[0] ? rows[0] : null;

    const age = row ? Date.now() - new Date(row.tg_connect_token_at || 0).getTime() : Infinity;
    if (!row || !isFinite(age) || age > CONNECT_TOKEN_TTL_MS) {
      await reply("Ссылка устарела или уже использована. Нажмите «Подключить Telegram» в личном кабинете HeatCalc.ru ещё раз.");
      return new Response("ok");
    }

    const username = (msg.from && msg.from.username) || null;
    await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(String(row.id))}`, {
      method: "PATCH",
      headers: rest,
      body: JSON.stringify({
        tg_chat_id: chatId,
        tg_username: username,
        tg_connect_token: null,
        tg_connect_token_at: null,
      }),
    });

    await reply(
      "Telegram подключён ✅\nСюда будут приходить уведомления по КП, опроснику и сообщениям из калькулятора — выберите, какие именно, в личном кабинете HeatCalc.ru.",
    );
    return new Response("ok");
  } catch (e) {
    console.error("tg-webhook crashed:", e);
    return new Response("ok");
  }
});
