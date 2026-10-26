// Очередь выпусков «Что нового» для робота публикации (.github/workflows/weekly-digest.yml).
//
// Робот сам собирает страницы (они лежат в репозитории), а сюда ходит за очередью и
// отмечает выпуск. Таблица news_issues закрыта RLS (только админ), поэтому функция
// работает под service role. Пропуск — OIDC-токен GitHub Actions с audience heatcalc-news.
//
//   POST {action: "list"}                  → все выпуски, кроме черновиков и отклонённых, + paused
//   POST {action: "published", id, push}   → отметить опубликованным (push — дата отправки или "skipped")
//   POST {action: "seed", issues: [...]}   → разовая заливка очереди (только новые даты)

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
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: "heatcalc-news" });
    if (payload.repository !== REPO) return json({ error: "forbidden" }, 403);
  } catch (_) {
    return json({ error: "forbidden" }, 403);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { /* пустое тело */ }

  if (body.action === "list") {
    const { data: st } = await db.from("app_settings").select("value").eq("key", "news").maybeSingle();
    const { data, error } = await db.from("news_issues")
      .select("id, issue_date, title, recap, items, status, published_at, push_status")
      .in("status", ["approved", "published"]).order("issue_date");
    if (error) return json({ error: error.message }, 500);
    return json({ issues: data || [], paused: !!(st && st.value && st.value.paused) });
  }

  if (body.action === "published") {
    const id = Number(body.id);
    if (!id) return json({ error: "id" }, 400);
    const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    const row: Record<string, unknown> = { status: "published", published_at: today };
    if (body.push) row.push_status = String(body.push);
    const { error } = await db.from("news_issues").update(row).eq("id", id).in("status", ["approved", "published"]);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (body.action === "seed") {
    const issues = Array.isArray(body.issues) ? body.issues : [];
    const rows = issues.map((i: Record<string, unknown>) => ({
      issue_date: i.issue_date, title: i.title || "", recap: !!i.recap, items: i.items || [],
      status: i.status || "approved", published_at: i.published_at || null, push_status: i.push_status || null,
    }));
    const { error } = await db.from("news_issues").upsert(rows, { onConflict: "issue_date", ignoreDuplicates: true });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, count: rows.length });
  }

  return json({ error: "unknown action" }, 400);
});
