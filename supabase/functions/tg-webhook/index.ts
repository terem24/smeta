// Приём вебхука от Telegram-бота для монтажников (личные уведомления по КП,
// опроснику и чатам — см. tgNotify в installer_settings и логику в send-push).
//
// Бот принимает два вида сообщений:
//  1. /start <токен> от кнопки «Подключить Telegram» в личном кабинете
//     (app.js: connectTelegram). Токен одноразовый и живёт 10 минут: users.id
//     для этого не годится, потому что тот же id уже публичный — используется
//     в ссылке на опросник (oprosnik.html?m=<id>), и его знает любой клиент
//     монтажника.
//  2. Обычный текст от chat_id, который принадлежит администратору (ADMIN_EMAILS)
//     — трактуем как ответ на последний вопрос монтажника (send-push,
//     reason=installer_reply) и кладём в переписку тем же способом, что и
//     кнопка «Отправить» в панели управления (app.js: sendAdminMessage).
//     У обычного монтажника, подключившего бота ради своих уведомлений, текст
//     по-прежнему ничего не делает — молча игнорируется, как и раньше.
//
// Verify JWT выключен: вызывает сервер Telegram, а не наш клиент. Вместо JWT —
// секрет в заголовке X-Telegram-Bot-Api-Secret-Token, который Telegram присылает
// сам, если его задали при регистрации вебхука (setWebhook ...&secret_token=...).
//
// Секреты (Edge Function Secrets):
//   TG_INSTALLER_BOT_TOKEN — токен бота от @BotFather
//   TG_WEBHOOK_SECRET — тот же secret_token, что передан в setWebhook
//   FCM_SERVICE_ACCOUNT, SUPABASE_SERVICE_ROLE_KEY — те же, что у send-push;
//     нужны, чтобы разбудить телефон монтажника пушем сразу после ответа
//     (код пуша здесь продублирован из send-push — при правке одного менять и
//     второй).

const CONNECT_TOKEN_TTL_MS = 10 * 60 * 1000;

// Тот же список, что в app.js (app.isAdminEmail) и в send-push — только эти
// адреса могут отвечать монтажникам обычным текстом.
const ADMIN_EMAILS = [
  "kovdorekb@gmail.com",
  "kovdor24@yandex.ru",
  "dima24ba@gmail.com",
];

// --- FCM: тот же код, что в send-push/index.ts (см. комментарий выше) ------

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const pemToDer = (pem: string) => {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

async function getFcmAccessToken(sa: { client_email: string; private_key: string }) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = unsigned + "." + b64url(new Uint8Array(sig));

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data || !data.access_token) throw new Error("Не удалось авторизоваться в сервисе уведомлений");
  return data.access_token as string;
}

// Пуш монтажнику сразу после ответа администрации — та же польза, что от обычного
// ответа из панели (reason=broadcast в send-push), но без сессии: вызывает не
// браузер, а сам Telegram, и авторизовать здесь нечем.
async function pushToInstaller(
  userId: string,
  title: string,
  body: string,
  supabaseUrl: string,
  serviceKey: string,
) {
  try {
    const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!saRaw) return;
    const sa = JSON.parse(saRaw);
    const rest = { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json" };
    const tokenRows = await fetch(
      `${supabaseUrl}/rest/v1/push_tokens?select=token&user_id=eq.${encodeURIComponent(userId)}`,
      { headers: rest },
    ).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!Array.isArray(tokenRows) || !tokenRows.length) return;

    const accessToken = await getFcmAccessToken(sa);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
    await Promise.all(tokenRows.map((row: { token: string }) =>
      fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token: row.token,
            notification: { title, body: body.slice(0, 240) },
            data: { reason: "broadcast", open: "messages" },
            android: { priority: "high", notification: { channel_id: "heatcalc", sound: "default" } },
          },
        }),
      }).catch(() => {})
    ));
  } catch (e) {
    console.error("tg-webhook: пуш монтажнику не ушёл", e);
  }
}

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
    if (!chatId) return new Response("ok");

    const rest = {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      "Content-Type": "application/json",
    };
    const get = async (path: string) => {
      const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers: rest });
      if (!r.ok) return null;
      return await r.json().catch(() => null);
    };

    const reply = (t: string) =>
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: t }),
      }).catch((e) => console.error("tg-webhook: sendMessage упал", e));

    // --- /start <токен> — подключение уведомлений (как раньше) --------------

    if (text.startsWith("/start")) {
      const token = text.replace(/^\/start/, "").trim();
      if (!token) {
        await reply("Чтобы подключить уведомления, нажмите «Подключить Telegram» в личном кабинете HeatCalc.ru — оттуда придёт правильная ссылка.");
        return new Response("ok");
      }

      const rows = await get(
        `users?tg_connect_token=eq.${encodeURIComponent(token)}&select=id,tg_connect_token_at&limit=1`,
      );
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
    }

    // --- Обычный текст от администратора — ответ монтажнику -----------------

    const trimmed = text.trim();
    if (!trimmed) return new Response("ok");

    const adminRows = await get(`users?tg_chat_id=eq.${encodeURIComponent(String(chatId))}&select=id,email&limit=1`);
    const adminRow = Array.isArray(adminRows) && adminRows[0] ? adminRows[0] : null;
    if (!adminRow || !ADMIN_EMAILS.includes(String(adminRow.email || "").toLowerCase())) {
      // Обычный монтажник написал боту что-то помимо /start — не наша забота,
      // молчим, как и раньше.
      return new Response("ok");
    }

    // Последний вопрос, адресованный администрации целиком (recipient_id пуст,
    // type='reply') — тот же критерий, что у «Ответ монтажника» в send-push.
    const lastReplyRows = await get(
      "messages?type=eq.reply&recipient_id=is.null&select=id,sender_id,text&order=created_at.desc&limit=1",
    );
    const lastReply = Array.isArray(lastReplyRows) && lastReplyRows[0] ? lastReplyRows[0] : null;
    if (!lastReply) {
      await reply("Не нашлось вопроса от монтажника, на который можно ответить — пока никто не писал.");
      return new Response("ok");
    }

    const installerRows = await get(
      `users?id=eq.${encodeURIComponent(String(lastReply.sender_id))}&select=username,email,last_name,first_name&limit=1`,
    );
    const installer = Array.isArray(installerRows) && installerRows[0] ? installerRows[0] : null;
    const installerName = installer
      ? ([installer.last_name, installer.first_name].filter(Boolean).join(" ") || installer.username || installer.email || "монтажник")
      : "монтажник";

    const insertResp = await fetch(`${supabaseUrl}/rest/v1/messages`, {
      method: "POST",
      headers: { ...rest, Prefer: "return=representation" },
      body: JSON.stringify({
        sender_id: adminRow.id,
        recipient_id: lastReply.sender_id,
        text: trimmed,
        type: "private",
        reply_to_id: lastReply.id,
      }),
    });
    const inserted = insertResp.ok ? await insertResp.json().catch(() => null) : null;
    const insertedRow = Array.isArray(inserted) && inserted[0] ? inserted[0] : null;
    if (!insertResp.ok || !insertedRow) {
      await reply("Не удалось отправить ответ — попробуйте из панели управления на сайте.");
      return new Response("ok");
    }

    await pushToInstaller(String(lastReply.sender_id), "Сообщение от администратора", trimmed, supabaseUrl, serviceKey);

    const quote = String(lastReply.text || "").slice(0, 120);
    await reply(`✅ Ответ отправлен: ${installerName}\nЕго вопрос: «${quote}»`);
    return new Response("ok");
  } catch (e) {
    console.error("tg-webhook crashed:", e);
    return new Response("ok");
  }
});
