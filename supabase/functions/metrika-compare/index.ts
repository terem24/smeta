// Сверка с Яндекс Метрикой для админки.
//
// Отдаёт администратору основные цифры счётчика 109490947 за N последних дней, чтобы
// рядом с нашим учётом визитов показать, сколько из них видит Метрика.
// Токен Метрики (OAuth, право metrika:read) лежит в секрете YM_TOKEN, в коде его нет.
// Без токена функция отвечает {error: "no_token"}, админка пишет, что сделать.
// Доступ только у администратора: проверяем is_admin() от имени вызывающего.
//
// Развёртывание: supabase functions deploy metrika-compare
// Токен:        supabase secrets set YM_TOKEN=<токен>
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const COUNTER = '109490947';
const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    try {
        const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
            global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
        });
        const { data: admin } = await sb.rpc('is_admin');
        if (admin !== true) return json({ error: 'forbidden' }, 403);

        const token = Deno.env.get('YM_TOKEN');
        if (!token) return json({ error: 'no_token' });

        const body = await req.json().catch(() => ({}));
        const days = Math.min(Math.max(parseInt(body.days) || 7, 1), 365);

        const url = new URL('https://api-metrika.yandex.net/stat/v1/data');
        url.searchParams.set('ids', COUNTER);
        url.searchParams.set('metrics', 'ym:s:visits,ym:s:users,ym:s:bounceRate,ym:s:avgVisitDurationSeconds,ym:s:pageDepth');
        url.searchParams.set('date1', `${days - 1}daysAgo`);
        url.searchParams.set('date2', 'today');
        url.searchParams.set('accuracy', 'full');

        const res = await fetch(url, { headers: { Authorization: `OAuth ${token}` } });
        if (!res.ok) return json({ error: `metrika_${res.status}` });
        const j = await res.json();
        const t = Array.isArray(j.totals?.[0]) ? j.totals[0] : j.totals;
        if (!Array.isArray(t)) return json({ error: 'metrika_bad_answer' });
        return json({ visits: t[0], users: t[1], bounce: t[2], avgSec: t[3], depth: t[4] });
    } catch (e) {
        return json({ error: String((e as Error)?.message ?? e) }, 500);
    }
});
