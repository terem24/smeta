<?php
/**
 * Журнал заявок на монтаж — для вкладки «Заявки» в админке.
 *
 * Отдаёт то, что накопил lead.php в leads_log.php: дату, источник (слаг статьи,
 * с которой человек пришёл), состав работ, адрес, имя и телефон.
 *
 * Почему с проверкой доступа, а не открыто: в журнале персональные данные —
 * имя и телефон человека, оставившего заявку. Открытый эндпоинт сделал бы их
 * доступными любому, кто знает адрес, и это уже не «неаккуратно», а нарушение.
 * Проверка — та же, что в recognize_archive.php: токен сессии Supabase уходит
 * в Auth за email, дальше сверяется роль. Ключ, публичный в app.js, секретом
 * не является; защита живёт в токене сессии.
 *
 * Отдаём только владельцам: заявки уходят конкретным монтажникам, и видеть
 * телефоны заказчиков всем администраторам ни к чему.
 */

error_reporting(0);
ini_set('display_errors', 0);

$ALLOWED_ORIGINS = ['https://heatcalc.ru', 'https://www.heatcalc.ru'];
$origin = isset($_SERVER['HTTP_ORIGIN']) ? $_SERVER['HTTP_ORIGIN'] : '';
if (in_array($origin, $ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=UTF-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit(0);
}

const SUPABASE_HOST = 'https://ahanbwugsmcyvrwbmtlx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_gcMJ-PvJmKavObbnePFGZQ_O-pu5O2p';
const OWNER_EMAILS = ['kovdorekb@gmail.com', 'kovdor24@yandex.ru', 'dima24ba@gmail.com'];
const MAX_ROWS = 500;

function bearerToken() {
    foreach (getallheaders() as $name => $value) {
        if (strtolower($name) === 'authorization' && stripos($value, 'Bearer ') === 0) {
            return trim(substr($value, 7));
        }
    }
    return null;
}

function tokenEmail($token) {
    if (!$token) return null;
    $ch = curl_init(SUPABASE_HOST . '/auth/v1/user');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'apikey: ' . SUPABASE_ANON_KEY,
        'Authorization: Bearer ' . $token,
    ]);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($resp === false || $code >= 400) return null;
    $user = json_decode($resp, true);
    $email = isset($user['email']) ? $user['email'] : null;
    return $email ? strtolower($email) : null;
}

$email = tokenEmail(bearerToken());
if (!$email || !in_array($email, OWNER_EMAILS, true)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'forbidden']);
    exit;
}

$logFile = __DIR__ . '/leads_log.php';
if (!is_file($logFile)) {
    echo json_encode(['ok' => true, 'items' => []], JSON_UNESCAPED_UNICODE);
    exit;
}

// Журнал — построчный JSON, первая строка (php exit) защищает файл от
// (Сам тег закрытия PHP в комментарии «//» писать нельзя: он заканчивает скрипт,
// и дальше сервер отдавал браузеру исходный текст этого файла вместо заявок.)
// чтения через веб. Читаем с конца: свежие заявки нужнее старых.
$lines = @file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
if (!is_array($lines)) $lines = [];
$items = [];
for ($i = count($lines) - 1; $i >= 0 && count($items) < MAX_ROWS; $i--) {
    $line = trim($lines[$i]);
    if ($line === '' || $line[0] !== '{') continue;   // служебная первая строка
    $row = json_decode($line, true);
    if (is_array($row)) $items[] = $row;
}

// Одна строка журнала с испорченной кодировкой (обрезанный UTF-8) роняла json_encode
// целиком: он возвращал false, и браузер получал пустой ответ — вкладка «Заявки»
// писала «не удалось прочитать», хотя все заявки были на месте. Битый символ
// заменяем на «�», а если сломалось что-то другое — отвечаем ошибкой с причиной.
$out = json_encode(['ok' => true, 'items' => $items], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
if ($out === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'encode: ' . json_last_error_msg()]);
    exit;
}
echo $out;
