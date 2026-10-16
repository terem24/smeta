// Очередь постов Telegram-канала для робота публикации (.github/workflows/channel-post.yml).
//
// Робот сам шлёт в Telegram (токен бота — в секретах GitHub), а сюда ходит за
// постом и отмечает отправку. Таблица channel_posts закрыта RLS (только админ),
// поэтому функция работает под service role.
//
// Пропуск — OIDC-токен GitHub Actions: его подписывает GitHub, и выдать его может
// только workflow этого репозитория. Общий секрет заводить не нужно.
//
//   POST {action: "due"}                    → один утверждённый пост, чей день настал (по Москве)
//   POST {action: "sent", id, message_id}   → отметить опубликованным
//
// Заголовок: Authorization: Bearer <OIDC-токен с audience heatcalc-channel>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5.9.6";

const REPO = "terem24/smeta";
const ISSUER = "https://token.actions.githubusercontent.com";
const JWKS = createRemoteJWKSet(new URL(ISSUER + "/.well-known/jwks"));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: "heatcalc-channel" });
    if (payload.repository !== REPO) return json({ error: "forbidden" }, 403);
  } catch (_) {
    return json({ error: "forbidden" }, 403);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { /* пустое тело */ }

  if (body.action === "due") {
    const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    const { data, error } = await db.from("channel_posts")
      .select("id, post_date, rubric, title, body, image, button_text, button_url")
      .eq("status", "approved").lte("post_date", today)
      .order("post_date").order("id").limit(1);
    if (error) return json({ error: error.message }, 500);
    return json({ post: (data && data[0]) || null, today });
  }

  if (body.action === "sent") {
    const id = Number(body.id);
    if (!id) return json({ error: "id" }, 400);
    const { error } = await db.from("channel_posts")
      .update({ status: "sent", sent_at: new Date().toISOString(), tg_message_id: Number(body.message_id) || null })
      .eq("id", id).eq("status", "approved");
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
});
