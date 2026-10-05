<?php
/**
 * Запись прайса дистрибьютора, загруженного из админки.
 *
 * Админ выбирает Excel-выгрузку дистрибьютора, браузер сам разбирает её и присылает
 * сюда готовый список «артикул → цена». Сам Excel сюда не попадает и нигде не
 * хранится. Файл dist_prices_data/<ключ>.json читает dist_price_get.php — его
 * забирают браузеры монтажников дистрибьютора и накладывают цены на каталог.
 *
 * Почему Beget, а не Supabase: прайс весит ~150 КБ, и его качает каждый монтажник
 * при каждом входе. На бесплатном тарифе Supabase это быстро съело бы лимит
 * исходящего трафика. Здесь файл отдаётся с кэшем (ETag), повторный запрос — 304.
 *
 * Кто может писать. Проверка та же, что у правок спорных позиций: токен сессии
 * Supabase уходит в Auth за email, а право на прайс спрашивается у самой базы —
 * функцией dist_price_can_edit(ключ) с токеном этого пользователя. Владелец и
 * администратор правят любой прайс, наблюдатель — только прайсы своих компаний.
 * Менеджер дистрибьютора писать не может: функция ему откажет.
 *
 * После записи в базу уходит строка журнала загрузок (dist_price_upload_log) —
 * кто, когда, сколько позиций. Это тоже под токеном пользователя, ключей
 * сервиса на хостинге нет.
 *
 * Выложить на Beget вручную (git push его не выкладывает). Рядом должна быть
 * возможность создать папку dist_prices_data.
 */

error_reporting(0);
ini_set('display_errors', 0);

$ALLOWED_ORIGINS = ['https://heatcalc.ru', 'https://www.heatcalc.ru', 'https://terem24.github.io', 'http://localhost:8080', 'http://127.0.0.1:8080'];
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($origin, $ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=UTF-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

const SUPABASE_HOST = 'https://ahanbwugsmcyvrwbmtlx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_gcMJ-PvJmKavObbnePFGZQ_O-pu5O2p';
const MAX_BODY = 4000000;          // байт; прайс на 20 тысяч позиций — около 600 КБ
const MAX_ITEMS = 30000;
const MAX_PRICE = 10000000;

function fail($code, $msg) {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function bearerToken() {
    foreach (getallheaders() as $name => $value) {
        if (strtolower($name) === 'authorization' && stripos($value, 'Bearer ') === 0) {
            return trim(substr($value, 7));
        }
    }
    return null;
}

function sbCall($method, $path, $token, $body = null) {
    $ch = curl_init(SUPABASE_HOST . $path);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    $headers = ['apikey: ' . SUPABASE_ANON_KEY, 'Authorization: Bearer ' . $token];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    }
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, $resp === false ? null : json_decode($resp, true)];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail(405, 'POST only');
}

$token = bearerToken();
if (!$token) fail(401, 'Нужно войти в аккаунт');

list($code, $user) = sbCall('GET', '/auth/v1/user', $token);
$email = (is_array($user) && !empty($user['email'])) ? strtolower($user['email']) : null;
if ($code >= 400 || !$email) fail(401, 'Сессия недействительна — войдите заново');

$raw = file_get_contents('php://input');
if ($raw === false || strlen($raw) > MAX_BODY) fail(413, 'Файл слишком большой');
$body = json_decode($raw, true);
if (!is_array($body)) fail(400, 'Не удалось прочитать данные');

$key = isset($body['key']) ? (string)$body['key'] : '';
if (!preg_match('/^[a-z0-9][a-z0-9-]{1,39}$/', $key)) fail(400, 'Некорректный ключ прайса');

// Право на этот прайс — у базы, под токеном пользователя
list($code, $can) = sbCall('POST', '/rest/v1/rpc/dist_price_can_edit', $token, ['p_key' => $key]);
if ($code >= 400 || $can !== true) fail(403, 'Нет права загружать этот прайс-лист');

$date = isset($body['date']) ? (string)$body['date'] : '';
if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $date, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1])) {
    fail(400, 'Некорректная дата прайса');
}
$items = isset($body['items']) && is_array($body['items']) ? $body['items'] : null;
if (!$items) fail(400, 'В прайсе нет позиций');
if (count($items) > MAX_ITEMS) fail(400, 'Слишком много позиций');

$clean = [];
foreach ($items as $art => $price) {
    $art = trim((string)$art);
    // Тот же шаблон, что у артикулов каталога; цена — целые рубли
    if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._\/-]{1,63}$/', $art)) continue;
    if (!is_numeric($price)) continue;
    $p = (int)round((float)$price);
    if ($p <= 0 || $p > MAX_PRICE) continue;
    $clean[$art] = $p;
}
// Если отсеялось много — это не тот файл, а не «пара кривых строк»
if (count($clean) < 1 || count($clean) < count($items) * 0.9) {
    fail(400, 'Больше 10 % позиций не прошли проверку (артикул или цена) — проверьте файл');
}
ksort($clean, SORT_STRING);

$dir = __DIR__ . '/dist_prices_data';
if (!is_dir($dir) && !@mkdir($dir, 0755, true)) fail(500, 'Не удалось создать папку для прайса');
$htaccess = $dir . '/.htaccess';
if (!is_file($htaccess)) @file_put_contents($htaccess, "Require all denied\n");

$now = gmdate('c');
$doc = ['key' => $key, 'date' => $date, 'uploaded_at' => $now, 'count' => count($clean), 'items' => $clean];
$json = json_encode($doc, JSON_UNESCAPED_UNICODE);
if ($json === false) fail(500, 'Не удалось собрать файл прайса');

// Запись целиком и атомарно: сначала временный файл, потом переименование, чтобы
// браузер монтажника не получил половину прайса
$file = $dir . '/' . $key . '.json';
$tmp = $file . '.tmp' . getmypid();
if (@file_put_contents($tmp, $json, LOCK_EX) === false || !@rename($tmp, $file)) {
    @unlink($tmp);
    fail(500, 'Не удалось записать прайс на сервер');
}

// Журнал загрузок в базе. Не удалось записать журнал — прайс уже лежит, поэтому
// отвечаем успехом и говорим, что журнал не пополнился.
$stats = isset($body['stats']) && is_array($body['stats']) ? $body['stats'] : [];
$n = function ($k) use ($stats) { return isset($stats[$k]) && is_numeric($stats[$k]) ? max(0, (int)$stats[$k]) : 0; };
list($lcode) = sbCall('POST', '/rest/v1/rpc/dist_price_upload_log', $token, [
    'p_key' => $key,
    'p_price_date' => $date,
    'p_items' => count($clean),
    'p_added' => $n('added'),
    'p_changed' => $n('changed'),
    'p_removed' => $n('removed'),
    'p_files' => $n('files'),
    'p_mode' => (isset($body['mode']) && $body['mode'] === 'replace') ? 'replace' : 'merge',
]);

echo json_encode(['ok' => true, 'count' => count($clean), 'date' => $date, 'uploaded_at' => $now, 'logged' => $lcode < 400], JSON_UNESCAPED_UNICODE);
