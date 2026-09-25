<?php
/**
 * Уведомления владельцу в Телеграм: форма обратной связи и заявка на «Профи».
 *
 * До 25.09.2026 app.js ходил в api.telegram.org сам, с токеном бота прямо в коде. Репозиторий
 * публичный, так что токеном мог пользоваться любой: писать владельцу от имени бота и читать
 * то, что пишут боту. Теперь токен есть только здесь, на сервере. Он и номер чата лежат рядом
 * в tg_notify_secret.php — файл в .gitignore, кладётся на Beget руками вместе с этим:
 *
 *     <?php return ['bot_token' => '…', 'chat_id' => '…'];
 *
 * Нет файла — отвечаем 503, сайт это переживает (уведомление не критично, письмо через
 * EmailJS уходит отдельно).
 *
 * Защита. Текст сообщения собирает браузер, поэтому без ограничений этот адрес стал бы
 * такой же дверью к владельцу, какой был токен. Пропускаем только:
 *   - запросы со страниц heatcalc.ru (заголовок Origin, а без него — Referer);
 *   - два известных вида сообщений (kind), заголовок которых подставляет сервер;
 *   - не больше 10 сообщений в час с одного адреса и 100 в час всего.
 * Origin подделать можно, но только не из чужой страницы в браузере — от случайного
 * мусора этого хватает, от упорного спамера держит частота.
 */

error_reporting(0);
ini_set('display_errors', 0);

$ALLOWED_ORIGINS = ['https://heatcalc.ru', 'https://www.heatcalc.ru'];
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($origin, $ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=UTF-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

function reply($code, $data) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    reply(405, ['ok' => false, 'error' => 'method']);
}

// Откуда пришёл запрос. Браузер при запросе с другого сайта всегда ставит Origin, так что
// чужая страница сюда не достучится; Referer — запасной путь для старых браузеров.
$fromSite = in_array($origin, $ALLOWED_ORIGINS, true);
if (!$fromSite && $origin === '') {
    $referer = isset($_SERVER['HTTP_REFERER']) ? $_SERVER['HTTP_REFERER'] : '';
    foreach ($ALLOWED_ORIGINS as $o) {
        if (strpos($referer, $o . '/') === 0) { $fromSite = true; break; }
    }
}
if (!$fromSite) {
    reply(403, ['ok' => false, 'error' => 'origin']);
}

$KINDS = [
    'feedback'    => '📩 ОБРАТНАЯ СВЯЗЬ',
    'pro_request' => '🔥 ЗАЯВКА НА ПРОФИ',
];

$in = json_decode(file_get_contents('php://input'), true);
if (!is_array($in)) {
    reply(400, ['ok' => false, 'error' => 'bad_request']);
}
$kind = isset($in['kind']) && is_string($in['kind']) ? $in['kind'] : '';
if (!isset($KINDS[$kind])) {
    reply(400, ['ok' => false, 'error' => 'kind']);
}
$text = isset($in['text']) && is_string($in['text']) ? $in['text'] : '';
$text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $text);
$text = trim(mb_substr($text, 0, 3500, 'UTF-8'));
if ($text === '') {
    reply(400, ['ok' => false, 'error' => 'text']);
}

// Частота: по адресу и общая. Метки времени за последний час — в файлах во временной папке.
function rate_ok($file, $limit, $now) {
    $hits = [];
    if (is_file($file)) {
        $hits = array_filter(explode(',', (string)@file_get_contents($file)), function ($t) use ($now) {
            return is_numeric($t) && ($now - (int)$t) < 3600;
        });
    }
    if (count($hits) >= $limit) return false;
    $hits[] = $now;
    @file_put_contents($file, implode(',', $hits), LOCK_EX);
    return true;
}
$now = time();
$ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '0';
$tmp = sys_get_temp_dir();
if (!rate_ok($tmp . '/hc_tg_' . md5($ip . '|heatcalc'), 10, $now)
    || !rate_ok($tmp . '/hc_tg_all_heatcalc', 100, $now)) {
    reply(429, ['ok' => false, 'error' => 'rate']);
}

$secretFile = __DIR__ . '/tg_notify_secret.php';
$secret = is_file($secretFile) ? include $secretFile : null;
if (!is_array($secret) || empty($secret['bot_token']) || empty($secret['chat_id'])) {
    reply(503, ['ok' => false, 'error' => 'not_configured']);
}

$ch = curl_init('https://api.telegram.org/bot' . $secret['bot_token'] . '/sendMessage');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    'chat_id' => $secret['chat_id'],
    'text'    => $KINDS[$kind] . "\n" . $text,
], JSON_UNESCAPED_UNICODE));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($code !== 200) {
    reply(502, ['ok' => false, 'error' => 'telegram']);
}
reply(200, ['ok' => true]);
